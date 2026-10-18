import { z } from 'zod';
import { FollowUpType } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, fieldError, forbidden, inr, isIndianMobile, normalizePhone, parse } from '../lib/http';
import { nextCode } from '../lib/codes';
import { canViewProperty, loadOwned } from '../lib/scope';
import { logActivity } from '../lib/activity';
import { getSetting } from '../lib/settings';
import { config } from '../config';
import { whatsapp } from '../providers/messaging';
import { cancelFollowUpNotifications, notify, scheduleFollowUpNotifications } from './notifications';
import { assertNoConflict, samePropertyConflictWhere } from './deals';
import { normalizeProperty, normalizeRequirement, normalizeTransactions, optDate, optInt, optNum, optStr, propertySchema, requirementSchema } from './validation';
import { scoreMatch, txPrice } from './matching';
import type { Actor } from '../types';

const changed = (before: any, after: any) => Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));

/* ---------------- Clients ---------------- */
const phoneField = z.string().transform(normalizePhone).refine(isIndianMobile, 'Enter a valid 10-digit Indian mobile number');
export const clientSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  phone: phoneField,
  location: z.string().trim().min(2, 'Location is required').max(120),
  email: z.preprocess((v) => (v === '' ? null : v), z.string().email('Enter a valid email').nullable().optional()),
  notes: optStr, isHot: z.boolean().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).strict();

const offeringSchema = z.object({
  type: z.enum(['SELL_OFFERING', 'RENT_OFFERING', 'LEASE_OFFERING']),
  propertyId: z.string().min(1, 'Property is required'),
  amount: optNum,
  deposit: optNum,
  leasePeriodMonths: optInt,
  availableDate: optDate,
});
type OfferingInput = z.infer<typeof offeringSchema>;
type OfferingTerms = Omit<OfferingInput, 'propertyId'>;

function offeringErrors(offering: OfferingTerms) {
  const offeringErrors: Record<string, string> = {};
  if (offering.amount == null) offeringErrors['offering.amount'] = 'Amount is required';
  if (offering.type === 'RENT_OFFERING' && offering.deposit == null) offeringErrors['offering.deposit'] = 'Security deposit is required';
  if (offering.type !== 'SELL_OFFERING' && offering.availableDate == null) offeringErrors['offering.availableDate'] = 'Effective-from date is required';
  if (offering.type !== 'SELL_OFFERING' && offering.leasePeriodMonths == null) offeringErrors['offering.leasePeriodMonths'] = offering.type === 'RENT_OFFERING' ? 'Rental period is required' : 'Lease period is required';
  return offeringErrors;
}

async function offeringRequirementData(property: any, offering: OfferingTerms) {
  const errors = offeringErrors(offering);
  if (Object.keys(errors).length) throw fieldError(errors);
  return normalizeRequirement({
    type: offering.type, category: property.category, subCategory: property.subCategory, subtype: property.subtype,
    location: property.location, locations: [property.location], locality: property.locality, bhk: property.bhk,
    bathrooms: property.bathrooms, area: property.area, dimLength: property.dimLength, dimWidth: property.dimWidth,
    dimUnit: property.dimUnit, amount: offering.amount, deposit: offering.deposit,
    leasePeriodMonths: offering.leasePeriodMonths, availableDate: offering.availableDate,
    facing: property.facing, floor: property.floor, totalFloors: property.totalFloors, furnishing: property.furnishing,
    propertyAge: property.propertyAge, parking: property.parking, amenities: property.amenities, khata: property.khata,
  } as any);
}

async function syncClientOfferings(actor: Actor, client: any, propertyId: string, offerings: OfferingTerms[]) {
  const property = await prisma.property.findFirst({
    where: { OR: [{ id: propertyId }, { code: propertyId }], ownerId: client.ownerId, status: 'ACTIVE', deletedAt: null },
  });
  if (!property) throw fieldError({ 'offering.propertyId': 'Select an active property from My Properties' });
  const uniqueTypes = new Set<string>();
  if (!offerings.length) throw fieldError({ offering: 'Select at least one offering type' });
  for (const offering of offerings) {
    if (uniqueTypes.has(offering.type)) throw fieldError({ offering: `Duplicate ${offering.type.replace(/_/g, ' ')} selected` });
    uniqueTypes.add(offering.type);
  }
  const prepared = await Promise.all(offerings.map(async (offering) => ({ offering, data: await offeringRequirementData(property, offering), code: await nextCode('REQ') })));
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${property.id}))`;
    const samePropertyConflict = await tx.propertyClient.findFirst({
      where: samePropertyConflictWhere(client.id, property.id, offerings[0].type),
      include: { requirement: { select: { code: true, type: true } } },
    });
    if (samePropertyConflict) throw conflict(`Same-property conflict: this client already has ${samePropertyConflict.requirement.type.replace(/_/g, ' ')} (${samePropertyConflict.requirement.code}) for this property. A client cannot offer and look for the same property.`);
    const otherOffer = await tx.propertyClient.findFirst({
      where: {
        propertyId: property.id, clientId: { not: client.id }, status: 'ACTIVE',
        requirement: { type: { in: ['SELL_OFFERING', 'RENT_OFFERING', 'LEASE_OFFERING'] }, status: 'ACTIVE', deletedAt: null },
      },
      include: { client: { select: { name: true } }, requirement: { select: { code: true } } },
    });
    if (otherOffer) throw conflict(`${property.code} is already offered by ${otherOffer.client.name} (${otherOffer.requirement.code}). A property can have only one offering client.`);
    const saved = [];
    for (const item of prepared) {
      const existingLink = await tx.propertyClient.findFirst({
        where: { propertyId: property.id, clientId: client.id, requirement: { type: item.offering.type, status: 'ACTIVE', deletedAt: null } },
        include: { requirement: true },
      });
      const requirement = existingLink
        ? await tx.requirement.update({ where: { id: existingLink.requirement.id }, data: item.data })
        : await tx.requirement.create({ data: { ...item.data, code: item.code, ownerId: client.ownerId, clientId: client.id } });
      const link = existingLink
        ? await tx.propertyClient.update({ where: { id: existingLink.id }, data: { status: 'ACTIVE' } })
        : await tx.propertyClient.create({ data: { ownerId: client.ownerId, clientId: client.id, propertyId: property.id, requirementId: requirement.id } });
      saved.push({ requirement, link, property });
    }
    return saved;
  });
  for (const item of result) {
    await logActivity(actor, {
      entityType: 'REQUIREMENT', entityId: item.requirement.id, entityCode: item.requirement.code, ownerId: client.ownerId,
      requirementId: item.requirement.id, requirementCode: item.requirement.code, clientId: client.id,
      propertyId: item.property.id, action: 'REQUIREMENT_EDITED', description: `${item.requirement.code} offering saved for ${client.name}`,
    });
    await logActivity(actor, {
      entityType: 'LINK', entityId: item.link.id, ownerId: client.ownerId, requirementId: item.requirement.id,
      requirementCode: item.requirement.code, clientId: client.id, propertyId: item.property.id,
      action: 'PROPERTY_LINKED', description: `${item.property.code} linked to ${item.requirement.code}`,
    });
    await notifyRequirementMatches({ ...item.requirement, client });
  }
  return result;
}

export async function createClientOfferings(actor: Actor, clientId: string, propertyId: string, offerings: OfferingTerms[]) {
  const client = await loadOwned<any>('client', clientId, actor);
  return syncClientOfferings(actor, client, propertyId, offerings);
}

export async function createClient(actor: Actor, ownerId: string, body: unknown) {
  const clientInput = parse(clientSchema, body);
  const client = await prisma.client.create({ data: { ...clientInput, email: clientInput.email ?? null, code: await nextCode('CLI'), ownerId } });
  await logActivity(actor, { entityType: 'CLIENT', entityId: client.id, entityCode: client.code, ownerId, clientId: client.id, action: 'CLIENT_CREATED', description: `Client ${client.name} created` });
  return client;
}

export async function updateClient(actor: Actor, id: string, body: unknown) {
  const client = await loadOwned<any>('client', id, actor);
  const clientInput = parse(clientSchema.partial(), body);
  const updated = await prisma.client.update({ where: { id: client.id }, data: clientInput });
  const fields = changed(client, clientInput);
  await logActivity(actor, { entityType: 'CLIENT', entityId: client.id, entityCode: client.code, ownerId: client.ownerId, clientId: client.id, action: 'CLIENT_EDITED', description: `Client ${updated.name} edited${fields.length ? ` (${fields.join(', ')})` : ''}`, metadata: { fields } });
  return updated;
}

/* ---------------- Requirements ---------------- */
export async function createRequirement(actor: Actor, body: any) {
  const client = await loadOwned<any>('client', String(body?.clientId || ''), actor);
  const parsed = parse(requirementSchema, body);
  const data = normalizeRequirement(parsed);
  // Requirement code is always generated server-side; any client-supplied code/id is ignored.
  const req = await prisma.requirement.create({ data: { ...data, code: await nextCode('REQ'), ownerId: client.ownerId, clientId: client.id } });
  await logActivity(actor, {
    entityType: 'REQUIREMENT', entityId: req.id, entityCode: req.code, ownerId: req.ownerId, requirementId: req.id, requirementCode: req.code, clientId: client.id,
    action: 'REQUIREMENT_CREATED', description: `Requirement ${req.code} (${req.type.replace('_', ' ')}) created for ${client.name}`,
  });
  await notifyRequirementMatches(req);
  return req;
}

const REQ_EDITABLE = Object.keys(requirementSchema.shape);

// Updates exactly ONE requirement, addressed by its own id/code. Never by client id.
export async function updateRequirement(actor: Actor, id: string, body: any) {
  const req = await loadOwned<any>('requirement', id, actor);
  const merged: any = {};
  for (const k of REQ_EDITABLE) merged[k] = body && k in body ? body[k] : req[k];
  if (body && 'location' in body && !('locations' in body)) merged.locations = [body.location];
  const data = normalizeRequirement(parse(requirementSchema, merged));
  if (data.status === 'ACTIVE') {
    const links = await prisma.propertyClient.findMany({ where: { requirementId: req.id, status: 'ACTIVE' } });
    for (const l of links) await assertNoConflict(req.clientId, l.propertyId, data.type, req.id);
  }
  const fields = changed(req, data);
  const updated = await prisma.requirement.update({ where: { id: req.id }, data });
  await logActivity(actor, {
    entityType: 'REQUIREMENT', entityId: req.id, entityCode: req.code, ownerId: req.ownerId, requirementId: req.id, requirementCode: req.code, clientId: req.clientId,
    action: 'REQUIREMENT_EDITED', description: `Requirement ${req.code} edited${fields.length ? ` (${fields.join(', ')})` : ''}`, metadata: { fields },
  });
  await notifyRequirementMatches(updated);
  return updated;
}

export async function duplicateRequirement(actor: Actor, id: string) {
  const req = await loadOwned<any>('requirement', id, actor);
  const { id: _i, code: _c, createdAt: _a, updatedAt: _u, deletedAt: _d, ...rest } = req;
  const copy = await prisma.requirement.create({ data: { ...rest, status: 'ACTIVE', code: await nextCode('REQ') } });
  await logActivity(actor, { entityType: 'REQUIREMENT', entityId: copy.id, entityCode: copy.code, ownerId: copy.ownerId, requirementId: copy.id, requirementCode: copy.code, clientId: copy.clientId, action: 'REQUIREMENT_CREATED', description: `Requirement ${copy.code} created as a duplicate of ${req.code}` });
  return copy;
}

/* ---------------- Properties ---------------- */
export const propertyDetailInclude = {
  photos: { orderBy: { position: 'asc' as const } }, transactions: true,
  owner: { select: { id: true, name: true, pcCode: true, phone: true, profile: { select: { companyName: true } } } },
  links: { where: { status: 'ACTIVE' as const, client: { deletedAt: null }, requirement: { status: 'ACTIVE' as const, deletedAt: null, client: { deletedAt: null } } }, include: { client: { select: { id: true, name: true, phone: true, code: true } }, requirement: { select: { id: true, code: true, type: true, amount: true, deposit: true, availableDate: true, leasePeriodMonths: true } } } },
  deals: { where: { deletedAt: null }, include: { client: { select: { name: true } }, requirement: { select: { code: true, type: true } } }, orderBy: { updatedAt: 'desc' as const } },
  shares: { include: { receiver: { select: { name: true, phone: true } }, sender: { select: { name: true } }, client: { select: { name: true } } }, orderBy: { createdAt: 'desc' as const } },
};

async function notifyMatch(req: any, property: any, minScore: number) {
  const match = scoreMatch(req, property);
  if (!match || match.score < minScore) return;
  const existing = await prisma.notification.findFirst({ where: { recipientId: req.ownerId, propertyId: property.id, requirementId: req.id, type: 'PROPERTY_MATCH', status: { not: 'CANCELLED' } }, select: { id: true } });
  if (!existing) await notify({ recipientId: req.ownerId, type: 'PROPERTY_MATCH', title: `${match.score}% match for ${req.client?.name || 'your client'}`, body: `${property.code} matches ${req.code}`, propertyId: property.id, requirementId: req.id, clientId: req.clientId, link: `/requirements/${req.id}` });
}

async function notifyMatches(property: any) {
  if (property.status !== 'ACTIVE') return;
  const minScore = await getSetting<number>('matching.notifyScore');
  const shares = await prisma.propertyShare.findMany({ where: { propertyId: property.id, senderId: property.ownerId, receiverId: { not: null }, status: { not: 'REVOKED' } }, select: { receiverId: true } });
  const owners = [...new Set([property.ownerId, ...shares.map((share) => share.receiverId).filter((id): id is string => !!id)])];
  const reqs = await prisma.requirement.findMany({ where: { ownerId: { in: owners }, deletedAt: null, status: 'ACTIVE', category: property.category, client: { deletedAt: null } }, include: { client: { select: { name: true } } } });
  for (const req of reqs) await notifyMatch(req, property, minScore);
}

async function notifyRequirementMatches(req: any) {
  if (req.status !== 'ACTIVE' || req.deletedAt) return;
  const [minScore, requirement, properties] = await Promise.all([
    getSetting<number>('matching.notifyScore'),
    prisma.requirement.findUnique({ where: { id: req.id }, include: { client: { select: { name: true, deletedAt: true } } } }),
    prisma.property.findMany({ where: { deletedAt: null, status: 'ACTIVE', category: req.category, OR: [{ ownerId: req.ownerId }, { shares: { some: { senderId: { not: req.ownerId }, receiverId: req.ownerId, status: { not: 'REVOKED' } } } }] }, include: { transactions: true } }),
  ]);
  if (!requirement || requirement.client.deletedAt) return;
  for (const property of properties) await notifyMatch(requirement, property, minScore);
}

export async function createProperty(actor: Actor, ownerId: string, body: any) {
  const input = parse(propertySchema, body);
  const data = normalizeProperty(input);
  const txs = normalizeTransactions(input.transactions);
  const property = await prisma.property.create({ data: { ...data, code: await nextCode('PROP'), ownerId, transactions: { create: txs } }, include: { transactions: true } });
  await logActivity(actor, { entityType: 'PROPERTY', entityId: property.id, entityCode: property.code, ownerId, propertyId: property.id, action: 'PROPERTY_CREATED', description: `Property ${property.code} (${property.subtype}, ${property.location}) created` });
  await notifyMatches(property);
  return property;
}

const PROP_EDITABLE = Object.keys(propertySchema.shape).filter((k) => k !== 'transactions');
export async function updateProperty(actor: Actor, id: string, body: any) {
  const prop = await loadOwned<any>('property', id, actor, { include: { transactions: true } });
  const merged: any = {};
  for (const k of PROP_EDITABLE) merged[k] = body && k in body ? body[k] : prop[k];
  const data = normalizeProperty(parse(propertySchema, merged));
  let txs: any[] | null = null;
  if (body && Array.isArray(body.transactions)) txs = normalizeTransactions(parse(propertySchema.shape.transactions, body.transactions));
  const fields = changed(prop, data);
  await prisma.$transaction(async (tx) => {
    await tx.property.update({ where: { id: prop.id }, data });
    if (txs) {
      await tx.propertyTransaction.deleteMany({ where: { propertyId: prop.id, kind: { notIn: txs.map((t) => t.kind) } } });
      for (const t of txs) await tx.propertyTransaction.upsert({ where: { propertyId_kind: { propertyId: prop.id, kind: t.kind } }, create: { ...t, propertyId: prop.id }, update: t });
    }
  });
  if (txs) fields.push('transactions');
  await logActivity(actor, { entityType: 'PROPERTY', entityId: prop.id, entityCode: prop.code, ownerId: prop.ownerId, propertyId: prop.id, action: 'PROPERTY_EDITED', description: `Property ${prop.code} edited${fields.length ? ` (${fields.join(', ')})` : ''}`, metadata: { fields } });
  const updated = await prisma.property.findUnique({ where: { id: prop.id }, include: propertyDetailInclude });
  await notifyMatches(updated);
  return updated;
}

export function propertySummary(p: any, sender?: { name: string; phone: string | null; profile?: { companyName?: string | null } | null }) {
  const tx = (p.transactions || []).map((t: any) => `${t.kind === 'SALE' ? 'Sale' : t.kind === 'RENT' ? 'Rent' : 'Lease'}: ${inr(txPrice(t))}${t.kind !== 'SALE' && t.depositAmount ? ` (Deposit ${inr(t.depositAmount)})` : ''}`).join(' | ');
  const dims = p.dimLength && p.dimWidth ? `${p.dimLength} × ${p.dimWidth} ${p.dimUnit === 'METERS' ? 'm' : 'ft'}` : '';
  return [
    `*${p.code}* — ${p.bhk ? `${p.bhk} BHK ` : ''}${p.subtype} (${p.category.toLowerCase()})`,
    `Location: ${p.location}${p.locality ? `, ${p.locality}` : ''}`,
    tx,
    [p.area ? `Area: ${Math.round(p.area).toLocaleString('en-IN')} sqft` : '', dims ? `Dimensions: ${dims}` : ''].filter(Boolean).join(' | '),
    p.facing ? `Facing: ${p.facing}` : '',
    sender ? `Shared by ${sender.name}${sender.profile?.companyName ? ` (${sender.profile.companyName})` : ''}${sender.phone ? ` · +91 ${sender.phone}` : ''}` : '',
  ].filter(Boolean).join('\n');
}

/* ---------------- Follow-ups ---------------- */
export const followUpSchema = z.object({
  clientId: z.string().min(1, 'Client is required'), requirementId: optStr, propertyId: optStr, dealId: optStr,
  scheduledAt: z.preprocess((v) => (v ? new Date(v as string) : undefined), z.date({ error: 'Date and time are required' })),
  type: z.nativeEnum(FollowUpType), notes: optStr, reminderMinutes: optInt,
});

async function resolveFollowUpRefs(actor: Actor, input: any) {
  const client = await loadOwned<any>('client', input.clientId, actor);
  const out: any = { clientId: client.id, ownerId: client.ownerId, requirementId: null, propertyId: null, dealId: null };
  if (input.requirementId) {
    const r = await loadOwned<any>('requirement', input.requirementId, actor);
    if (r.clientId !== client.id) throw fieldError({ requirementId: 'Requirement does not belong to this client' });
    out.requirementId = r.id; out.requirementCode = r.code;
  }
  if (input.propertyId) {
    const p = await prisma.property.findFirst({ where: { OR: [{ id: input.propertyId }, { code: input.propertyId }], deletedAt: null } });
    if (!p || !(await canViewProperty(actor, p))) throw fieldError({ propertyId: 'Property not found' });
    out.propertyId = p.id;
  }
  if (input.dealId) {
    const d = await loadOwned<any>('deal', input.dealId, actor);
    if (d.clientId !== client.id) throw fieldError({ dealId: 'Deal does not belong to this client' });
    out.dealId = d.id; out.requirementId = out.requirementId || d.requirementId; out.propertyId = out.propertyId || d.propertyId;
  }
  return { refs: out, client };
}

export async function createFollowUp(actor: Actor, body: unknown) {
  const input = parse(followUpSchema, body);
  const { refs, client } = await resolveFollowUpRefs(actor, input);
  const { requirementCode, ...dbRefs } = refs;
  const fu = await prisma.followUp.create({
    data: { ...dbRefs, code: await nextCode('FU'), scheduledAt: input.scheduledAt, type: input.type, notes: input.notes ?? null, reminderMinutes: input.reminderMinutes ?? (await getSetting<number>('followup.defaultReminderMinutes')) },
  });
  await scheduleFollowUpNotifications(fu.id);
  await logActivity(actor, { entityType: 'FOLLOW_UP', entityId: fu.id, entityCode: fu.code, ownerId: fu.ownerId, clientId: fu.clientId, requirementId: fu.requirementId, requirementCode, propertyId: fu.propertyId, dealId: fu.dealId, action: 'FOLLOW_UP_CREATED', description: `${fu.type.replace('_', ' ')} follow-up ${fu.code} scheduled with ${client.name}` });
  return fu;
}

const fuInclude = { requirement: { select: { code: true } }, client: { select: { name: true } } };
const fuLog = (actor: Actor, fu: any, action: string, description: string, metadata?: any) => logActivity(actor, {
  entityType: 'FOLLOW_UP', entityId: fu.id, entityCode: fu.code, ownerId: fu.ownerId, clientId: fu.clientId, requirementId: fu.requirementId, requirementCode: fu.requirement?.code, propertyId: fu.propertyId, dealId: fu.dealId, action, description, metadata,
});

export async function updateFollowUp(actor: Actor, id: string, body: any) {
  const fu = await loadOwned<any>('followUp', id, actor, { include: fuInclude });
  const input = parse(followUpSchema.partial(), body);
  const { refs } = await resolveFollowUpRefs(actor, { clientId: input.clientId ?? fu.clientId, requirementId: 'requirementId' in body ? input.requirementId : fu.requirementId, propertyId: 'propertyId' in body ? input.propertyId : fu.propertyId, dealId: 'dealId' in body ? input.dealId : fu.dealId });
  const { requirementCode: _rc, ownerId: _o, ...dbRefs } = refs;
  const updated = await prisma.followUp.update({ where: { id: fu.id }, data: { ...dbRefs, scheduledAt: input.scheduledAt ?? fu.scheduledAt, type: input.type ?? fu.type, notes: input.notes !== undefined ? input.notes : fu.notes, reminderMinutes: input.reminderMinutes ?? fu.reminderMinutes } });
  await scheduleFollowUpNotifications(fu.id);
  await fuLog(actor, fu, 'FOLLOW_UP_EDITED', `Follow-up ${fu.code} edited`);
  return updated;
}

export async function rescheduleFollowUp(actor: Actor, id: string, body: any) {
  const fu = await loadOwned<any>('followUp', id, actor, { include: fuInclude });
  if (['COMPLETED', 'CANCELLED'].includes(fu.status)) throw badRequest(`A ${fu.status.toLowerCase()} follow-up cannot be rescheduled`);
  const { scheduledAt, reason } = parse(z.object({ scheduledAt: z.preprocess((v) => (v ? new Date(v as string) : undefined), z.date({ error: 'New date and time are required' })), reason: optStr }), body);
  if (scheduledAt <= new Date()) throw fieldError({ scheduledAt: 'Choose a future date and time' });
  const updated = await prisma.followUp.update({ where: { id: fu.id }, data: { scheduledAt, status: 'RESCHEDULED', rescheduleCount: { increment: 1 } } });
  await scheduleFollowUpNotifications(fu.id);
  await fuLog(actor, fu, 'FOLLOW_UP_RESCHEDULED', `Follow-up ${fu.code} rescheduled to ${scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}${reason ? ` — ${reason}` : ''}`, { from: fu.scheduledAt, to: scheduledAt, reason });
  return updated;
}

export async function setFollowUpStatus(actor: Actor, id: string, status: 'COMPLETED' | 'CANCELLED', body: any) {
  const fu = await loadOwned<any>('followUp', id, actor, { include: fuInclude });
  if (fu.status === status) throw badRequest(`Follow-up already ${status.toLowerCase()}`);
  const outcome = body?.outcome ? String(body.outcome).slice(0, 2000) : null;
  const updated = await prisma.followUp.update({ where: { id: fu.id }, data: { status, outcome, completedAt: status === 'COMPLETED' ? new Date() : null } });
  await cancelFollowUpNotifications(fu.id);
  await fuLog(actor, fu, status === 'COMPLETED' ? 'FOLLOW_UP_COMPLETED' : 'FOLLOW_UP_CANCELLED', `Follow-up ${fu.code} ${status.toLowerCase()}${outcome ? ` — ${outcome}` : ''}`);
  return updated;
}

export async function followUpWhatsApp(actor: Actor, id: string) {
  const fu = await loadOwned<any>('followUp', id, actor, { include: { client: true, property: { include: { transactions: true } }, owner: { include: { profile: true } } } });
  const text = [`Hi ${fu.client.name},`, fu.property ? `Following up regarding property ${fu.property.code} in ${fu.property.location}.` : 'Following up on your property requirement.',
    fu.type === 'SITE_VISIT' ? `Your site visit is scheduled for ${fu.scheduledAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}.` : '',
    `— ${fu.owner.name}${fu.owner.profile?.companyName ? `, ${fu.owner.profile.companyName}` : ''}`].filter(Boolean).join('\n');
  return { url: whatsapp.link(fu.client.phone, text), text };
}

/* ---------------- Sharing ---------------- */
export const shareSchema = z.object({
  propertyId: z.string().min(1), targetType: z.enum(['CLIENT', 'PC']), phone: phoneField, clientId: optStr, message: optStr,
  channel: z.enum(['IN_APP', 'WHATSAPP']).optional(),
});

export async function shareProperty(actor: Actor, body: unknown) {
  if (actor.kind !== 'pc') throw forbidden();
  const input = parse(shareSchema, body);
  if (input.targetType === 'PC' && input.clientId) throw fieldError({ clientId: 'PC shares cannot reference a client' });
  const property = await loadOwned<any>('property', input.propertyId, actor, { include: { transactions: true } });
  const sender = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, include: { profile: true } });
  if (input.phone === sender.phone) throw fieldError({ phone: 'You cannot share with your own number' });
  const client = input.targetType === 'CLIENT'
    ? input.clientId ? await loadOwned<any>('client', input.clientId, actor) : await prisma.client.findFirst({ where: { ownerId: actor.userId, phone: input.phone, deletedAt: null } })
    : null;
  if (client && client.phone !== input.phone) throw fieldError({ phone: 'The phone number must match the selected client' });
  const receiver = await prisma.user.findFirst({ where: { phone: input.phone, status: 'ACTIVE' } });
  const text = `${input.message ? `${input.message}\n\n` : ''}${propertySummary(property, sender)}\n${config.pcAppUrl}`;
  const waUrl = whatsapp.link(input.phone, text);
  const channel = input.channel ?? 'IN_APP';
  if (channel === 'IN_APP' && !receiver) return { registered: false, message: 'Number not registered.', whatsappUrl: waUrl, share: null };
  const existing = await prisma.propertyShare.findFirst({ where: { propertyId: property.id, senderId: actor.userId, targetType: input.targetType, receiverId: channel === 'IN_APP' ? receiver?.id ?? null : null, receiverPhone: input.phone, clientId: client?.id ?? null, status: { not: 'REVOKED' } } });
  if (existing) return { registered: !!receiver, share: existing, whatsappUrl: waUrl, message: `Already shared with ${receiver?.name || client?.name || (input.targetType === 'PC' ? 'PC' : 'client')}` };
  const share = await prisma.propertyShare.create({
    data: { propertyId: property.id, senderId: actor.userId, targetType: input.targetType, receiverId: channel === 'IN_APP' ? receiver!.id : receiver?.id ?? null, receiverPhone: input.phone, clientId: client?.id ?? null, channel, message: input.message ?? null },
  });
  if (channel === 'IN_APP' && receiver) {
    await notify({ recipientId: receiver.id, type: 'PROPERTY_SHARED', title: `${sender.name || 'A consultant'} shared ${property.code}`, body: `${property.subtype} · ${property.location} (view only)`, propertyId: property.id, link: `/properties/${property.id}` });
  }
  await logActivity(actor, {
    entityType: 'PROPERTY', entityId: property.id, entityCode: property.code, ownerId: actor.userId, propertyId: property.id, clientId: client?.id ?? null, action: 'PROPERTY_SHARED',
    description: `${property.code} shared with ${input.targetType === 'PC' ? 'consultant' : 'client'} ${receiver?.name || client?.name || ''} +91 ${input.phone} via ${channel === 'IN_APP' ? 'in-app' : 'WhatsApp'}`,
    metadata: { shareId: share.id, permission: share.permission, channel, receiverId: share.receiverId },
  });
  return { registered: !!receiver, share, whatsappUrl: waUrl, message: receiver ? `Shared with ${receiver.name || 'consultant'} in-app` : 'Shared via WhatsApp' };
}
