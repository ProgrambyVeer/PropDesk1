import type { DealStage, RequirementType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, fieldError, forbidden, inr, parse } from '../lib/http';
import { nextCode } from '../lib/codes';
import { loadOwned, canViewProperty } from '../lib/scope';
import { logActivity } from '../lib/activity';
import { getSetting } from '../lib/settings';
import { notify } from './notifications';
import { optDate, optNum, optStr } from './validation';
import type { Actor } from '../types';

export const STAGES: DealStage[] = ['NEW', 'CONTACTED', 'INTERESTED', 'SITE_VISIT_SCHEDULED', 'SITE_VISIT_COMPLETED', 'NEGOTIATION', 'DOCUMENTATION', 'CLOSED', 'LOST'];
export const PROBABILITY: Record<DealStage, number> = { NEW: 10, CONTACTED: 20, INTERESTED: 35, SITE_VISIT_SCHEDULED: 50, SITE_VISIT_COMPLETED: 60, NEGOTIATION: 75, DOCUMENTATION: 90, CLOSED: 100, LOST: 0 };
const OPPOSITE: Record<RequirementType, RequirementType> = {
  BUY_LOOKING: 'SELL_OFFERING', SELL_OFFERING: 'BUY_LOOKING', RENT_LOOKING: 'RENT_OFFERING', RENT_OFFERING: 'RENT_LOOKING', LEASE_LOOKING: 'LEASE_OFFERING', LEASE_OFFERING: 'LEASE_LOOKING',
};
const human = (t: string) => t.replace(/_/g, ' ');
const LOOKING_TYPES = ['BUY_LOOKING', 'RENT_LOOKING', 'LEASE_LOOKING'] as const;
const OFFERING_TYPES = ['SELL_OFFERING', 'RENT_OFFERING', 'LEASE_OFFERING'] as const;

export const expectedCommission = (value?: number | null, pct?: number | null, fixed?: number | null) =>
  fixed != null ? fixed : value != null && pct != null ? Math.round((value * pct) / 100) : null;

export const samePropertyConflictWhere = (clientId: string, propertyId: string, type: RequirementType, excludeRequirementId?: string) => ({
  clientId, propertyId, status: 'ACTIVE' as const, requirementId: excludeRequirementId ? { not: excludeRequirementId } : undefined,
  requirement: {
    type: { in: [...(type.endsWith('_OFFERING') ? LOOKING_TYPES : OFFERING_TYPES)] as any },
    status: 'ACTIVE' as const, deletedAt: null,
  },
});

export async function assertNoConflict(clientId: string, propertyId: string, type: RequirementType, excludeRequirementId?: string) {
  const c = await prisma.propertyClient.findFirst({
    where: samePropertyConflictWhere(clientId, propertyId, type, excludeRequirementId),
    include: { requirement: { select: { code: true, type: true } }, property: { select: { code: true } } },
  });
  if (c) throw conflict(`Same-property conflict: this client already has ${human(c.requirement.type)} for ${c.property.code} (${c.requirement.code}). A client cannot offer and look for the same property.`);
}

/* ---------------- Links ---------------- */
export const linkSchema = z.object({
  clientId: z.string().min(1), requirementId: z.string().min(1), propertyId: z.string().min(1),
  interestLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(), notes: optStr, dealValue: optNum, commission: optNum,
});

export async function createLink(actor: Actor, input: z.infer<typeof linkSchema>) {
  const req = await loadOwned<any>('requirement', input.requirementId, actor, { include: { client: { select: { id: true, name: true } } } });
  if (req.clientId !== input.clientId && req.client?.id !== input.clientId) {
    const client = await loadOwned<any>('client', input.clientId, actor);
    if (client.id !== req.clientId) throw badRequest('Requirement does not belong to this client');
  }
  const property = await prisma.property.findFirst({ where: { OR: [{ id: input.propertyId }, { code: input.propertyId }], deletedAt: null, status: 'ACTIVE' } });
  if (!property) throw badRequest('Select an active property');
  const access = await canViewProperty(actor, property);
  if (!access || (actor.kind === 'admin' && property.ownerId !== req.ownerId)) throw forbidden('You cannot link this property');
  await assertNoConflict(req.clientId, property.id, req.type);
  const data = { interestLevel: input.interestLevel ?? 'MEDIUM', notes: input.notes ?? null, dealValue: input.dealValue ?? null, commission: input.commission ?? null };
  const link = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${property.id}))`;
    const samePropertyConflict = await tx.propertyClient.findFirst({
      where: samePropertyConflictWhere(req.clientId, property.id, req.type, req.id),
      include: { requirement: { select: { code: true, type: true } }, property: { select: { code: true } } },
    });
    if (samePropertyConflict) throw conflict(`Same-property conflict: this client already has ${human(samePropertyConflict.requirement.type)} for ${samePropertyConflict.property.code} (${samePropertyConflict.requirement.code}). A client cannot offer and look for the same property.`);
    if (req.type.endsWith('_OFFERING')) {
      const otherOffer = await tx.propertyClient.findFirst({
        where: { propertyId: property.id, clientId: { not: req.clientId }, status: 'ACTIVE', requirement: { type: { in: [...OFFERING_TYPES] as any }, status: 'ACTIVE', deletedAt: null } },
        include: { client: { select: { name: true } }, requirement: { select: { code: true } } },
      });
      if (otherOffer) throw conflict(`${property.code} is already offered by ${otherOffer.client.name} (${otherOffer.requirement.code}). A property can have only one offering client.`);
    }
    const existing = await tx.propertyClient.findUnique({ where: { requirementId_propertyId: { requirementId: req.id, propertyId: property.id } } });
    if (existing?.status === 'ACTIVE') return existing;
    return existing
      ? tx.propertyClient.update({ where: { id: existing.id }, data: { ...data, status: 'ACTIVE' } })
      : tx.propertyClient.create({ data: { ...data, ownerId: req.ownerId, clientId: req.clientId, propertyId: property.id, requirementId: req.id } });
  });
  await logActivity(actor, {
    entityType: 'LINK', entityId: link.id, ownerId: req.ownerId, action: 'PROPERTY_LINKED', description: `${property.code} linked to ${req.code}`,
    requirementId: req.id, requirementCode: req.code, clientId: req.clientId, propertyId: property.id,
  });
  return link;
}

/* ---------------- Deals ---------------- */
export const dealCreateSchema = z.object({
  clientId: z.string().min(1), requirementId: z.string().min(1), propertyId: z.string().min(1),
  dealValue: optNum, commissionPercent: optNum, commissionFixed: optNum, notes: optStr,
});
export const dealUpdateSchema = z.object({ dealValue: optNum, commissionPercent: optNum, commissionFixed: optNum, finalCommission: optNum, notes: optStr });
export const stageSchema = z.object({
  stage: z.enum(STAGES as [DealStage, ...DealStage[]]), note: optStr, dealValue: optNum, finalCommission: optNum, commissionPercent: optNum,
  closingDate: optDate, lossReason: optStr,
  confirmCompetingDeals: z.boolean().optional(), deactivateProperty: z.boolean().optional(),
});

async function dealContext(actor: Actor, input: z.infer<typeof dealCreateSchema>) {
  const req = await loadOwned<any>('requirement', input.requirementId, actor, { include: { client: { select: { id: true, name: true } } } });
  if (!req.type.endsWith('_LOOKING')) throw badRequest('Deals must be created from a saved looking requirement');
  const offerType = OPPOSITE[req.type as RequirementType];
  if (req.clientId !== input.clientId) {
    const client = await loadOwned<any>('client', input.clientId, actor);
    if (client.id !== req.clientId) throw badRequest('Requirement does not belong to this client');
  }
  const property = await prisma.property.findFirst({ where: { OR: [{ id: input.propertyId }, { code: input.propertyId }], deletedAt: null, status: 'ACTIVE' } });
  if (!property) throw badRequest('Select an active property');
  if (!(await canViewProperty(actor, property))) throw forbidden('You cannot create a deal on this property');
  const link = await prisma.propertyClient.findUnique({ where: { requirementId_propertyId: { requirementId: req.id, propertyId: property.id } } });
  if (!link || link.status !== 'ACTIVE') throw badRequest(`Create a lead for ${req.code} and ${property.code} before creating a deal`);
  const offering = await prisma.propertyClient.findFirst({
    where: { propertyId: property.id, status: 'ACTIVE', requirement: { type: offerType, status: 'ACTIVE', deletedAt: null } },
    include: { client: { select: { id: true, name: true } }, requirement: { select: { id: true, code: true, type: true, amount: true, deposit: true, availableDate: true, leasePeriodMonths: true } } },
  });
  if (!offering) throw badRequest(`No compatible ${human(offerType)} is linked to ${property.code}`);
  return { req, property, link, offering };
}

export async function previewDeal(actor: Actor, body: unknown) {
  const input = parse(dealCreateSchema.pick({ clientId: true, requirementId: true, propertyId: true }), body);
  const { req, property, link, offering } = await dealContext(actor, input);
  return { client: { id: req.clientId, name: req.client?.name }, requirement: { id: req.id, code: req.code, type: req.type }, property: { id: property.id, code: property.code, location: property.location, subtype: property.subtype }, lead: { id: link.id }, offering: { client: offering.client, requirement: offering.requirement } };
}

export async function createDeal(actor: Actor, body: unknown) {
  const input = parse(dealCreateSchema, body);
  const { req, property, link, offering } = await dealContext(actor, input);
  const open = await prisma.deal.findFirst({ where: { requirementId: req.id, propertyId: property.id, deletedAt: null, stage: { notIn: ['CLOSED', 'LOST'] } } });
  if (open) throw conflict(`An open deal (${open.code}) already exists for ${req.code} and ${property.code}`);
  const pct = input.commissionPercent ?? (input.commissionFixed == null ? await getSetting<number>('commission.defaultPercent') : null);
  const deal = await prisma.deal.create({
    data: {
      code: await nextCode('DEAL'), ownerId: req.ownerId, clientId: req.clientId, propertyId: property.id, requirementId: req.id, offeringRequirementId: offering.requirement.id, linkId: link.id,
      dealValue: input.dealValue ?? offering.requirement.amount ?? null, commissionPercent: pct, commissionFixed: input.commissionFixed ?? null,
      expectedCommission: expectedCommission(input.dealValue ?? offering.requirement.amount, pct, input.commissionFixed), notes: input.notes ?? null,
      history: { create: { toStage: 'NEW', note: 'Deal created', changedBy: actor.name || actor.kind } },
    },
  });
  await logActivity(actor, {
    entityType: 'DEAL', entityId: deal.id, entityCode: deal.code, ownerId: deal.ownerId, action: 'DEAL_CREATED',
    description: `Deal ${deal.code} created for ${req.code} · ${property.code}${deal.dealValue ? ` · ${inr(deal.dealValue)}` : ''}`,
    requirementId: req.id, requirementCode: req.code, clientId: req.clientId, propertyId: property.id, dealId: deal.id,
  });
  return deal;
}

export async function updateDeal(actor: Actor, id: string, body: unknown) {
  const input = parse(dealUpdateSchema, body);
  const deal = await loadOwned<any>('deal', id, actor, { include: { requirement: { select: { code: true } } } });
  const next = { ...deal, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  const exp = expectedCommission(next.dealValue, next.commissionPercent, next.commissionFixed);
  const updated = await prisma.deal.update({
    where: { id: deal.id },
    data: { dealValue: next.dealValue, commissionPercent: next.commissionPercent, commissionFixed: next.commissionFixed, finalCommission: next.finalCommission, notes: next.notes, expectedCommission: exp },
  });
  const commissionChanged = exp !== deal.expectedCommission || next.finalCommission !== deal.finalCommission;
  await logActivity(actor, {
    entityType: 'DEAL', entityId: deal.id, entityCode: deal.code, ownerId: deal.ownerId, action: commissionChanged ? 'COMMISSION_CHANGED' : 'DEAL_EDITED',
    description: commissionChanged ? `Commission for ${deal.code} changed: expected ${inr(deal.expectedCommission)} → ${inr(exp)}` : `Deal ${deal.code} updated`,
    requirementId: deal.requirementId, requirementCode: deal.requirement.code, clientId: deal.clientId, propertyId: deal.propertyId, dealId: deal.id,
    metadata: { before: { dealValue: deal.dealValue, expectedCommission: deal.expectedCommission, finalCommission: deal.finalCommission }, after: { dealValue: updated.dealValue, expectedCommission: exp, finalCommission: updated.finalCommission } },
  });
  return updated;
}

const COMPETING_DEAL_LOSS_REASON = 'Automatically marked LOST because another deal for this property was successfully closed as WON.';

export async function previewBuyClose(actor: Actor, id: string) {
  const deal = await loadOwned<any>('deal', id, actor, { include: { requirement: { select: { type: true } }, property: { select: { code: true } } } });
  if (!deal.requirement.type.endsWith('_LOOKING')) return { purchaseFlow: false, competingDeals: [] };
  const competingDeals = await prisma.deal.findMany({
    where: { propertyId: deal.propertyId, id: { not: deal.id }, deletedAt: null, stage: { notIn: ['CLOSED', 'LOST'] } },
    select: { id: true, code: true, client: { select: { name: true } }, requirement: { select: { code: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return { purchaseFlow: true, propertyCode: deal.property.code, competingDeals };
}

export async function changeStage(actor: Actor, id: string, body: unknown) {
  const input = parse(stageSchema, body);
  const deal = await loadOwned<any>('deal', id, actor, { include: { requirement: true, property: { select: { code: true } } } });
  if (deal.stage === input.stage) throw badRequest(`Deal is already in ${human(input.stage)}`);
  const data: any = { stage: input.stage };
  if (input.stage === 'CLOSED') {
    const value = input.dealValue ?? deal.dealValue;
    const pct = input.commissionPercent ?? deal.commissionPercent;
    const final = input.finalCommission ?? expectedCommission(value, pct, deal.commissionFixed);
    const errors: Record<string, string> = {};
    if (!value) errors.dealValue = 'Deal value is required to close';
    if (final == null) errors.finalCommission = 'Final commission is required to close';
    if (!input.closingDate) errors.closingDate = 'Closing date is required';
    if (Object.keys(errors).length) throw fieldError(errors);
    Object.assign(data, { dealValue: value, commissionPercent: pct, finalCommission: final, closingDate: input.closingDate, expectedCommission: expectedCommission(value, pct, deal.commissionFixed), notes: input.note ?? deal.notes, lossReason: null });
  } else if (input.stage === 'LOST') {
    if (!input.lossReason) throw fieldError({ lossReason: 'Loss reason is required' });
    Object.assign(data, { lossReason: input.lossReason, closingDate: null });
  }
  const purchaseFlow = input.stage === 'CLOSED' && deal.requirement.type.endsWith('_LOOKING');
  let updated: any;
  let competingDeals: { id: string; code: string; requirementId: string; clientId: string; linkId: string | null; stage: DealStage }[] = [];
  if (purchaseFlow) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${deal.propertyId}))`;
      const current = await tx.deal.findFirst({ where: { id: deal.id, deletedAt: null }, include: { requirement: { select: { type: true } } } });
      if (!current || current.stage === 'CLOSED' || current.stage === 'LOST') throw conflict('This deal is no longer open');
      if (!current.requirement.type.endsWith('_LOOKING')) throw conflict('This closure flow applies only to Looking deals');
      const competitors = await tx.deal.findMany({
        where: { propertyId: deal.propertyId, id: { not: deal.id }, deletedAt: null, stage: { notIn: ['CLOSED', 'LOST'] } },
        select: { id: true, code: true, requirementId: true, clientId: true, linkId: true, stage: true },
      });
      if (competitors.length && !input.confirmCompetingDeals) throw conflict(`Confirm marking ${competitors.length} competing deal${competitors.length === 1 ? '' : 's'} as lost before closing this purchase`);
      const winner = await tx.deal.update({
        where: { id: deal.id },
        data: { ...data, history: { create: { fromStage: deal.stage, toStage: 'CLOSED', note: input.note ?? null, changedBy: actor.name || actor.kind } } },
      });
      for (const competitor of competitors) {
        await tx.deal.update({
          where: { id: competitor.id },
          data: {
            stage: 'LOST', lossReason: COMPETING_DEAL_LOSS_REASON, closingDate: null,
            history: { create: { fromStage: competitor.stage, toStage: 'LOST', note: COMPETING_DEAL_LOSS_REASON, changedBy: actor.name || actor.kind } },
          },
        });
        if (competitor.linkId) await tx.propertyClient.updateMany({ where: { id: competitor.linkId }, data: { dealStage: 'LOST' } });
      }
      if (winner.linkId) await tx.propertyClient.updateMany({ where: { id: winner.linkId }, data: { dealStage: 'CLOSED' } });
      if (input.deactivateProperty) await tx.property.update({ where: { id: deal.propertyId }, data: { status: 'INACTIVE' } });
      await tx.requirement.update({ where: { id: deal.requirementId }, data: { status: 'FULFILLED' } });
      const offeringLink = await tx.propertyClient.findFirst({
        where: {
          propertyId: deal.propertyId, status: 'ACTIVE',
          requirementId: winner.offeringRequirementId ?? undefined,
          requirement: { type: OPPOSITE[current.requirement.type as RequirementType], status: 'ACTIVE', deletedAt: null },
        },
        select: { requirementId: true },
      });
      if (offeringLink) {
        await tx.requirement.updateMany({
          where: { id: offeringLink.requirementId, status: 'ACTIVE', deletedAt: null },
          data: { status: 'FULFILLED' },
        });
      }
      return { winner, competitors };
    });
    updated = result.winner;
    competingDeals = result.competitors;
  } else {
    updated = await prisma.deal.update({
      where: { id: deal.id },
      data: { ...data, history: { create: { fromStage: deal.stage, toStage: input.stage, note: input.note ?? input.lossReason ?? null, changedBy: actor.name || actor.kind } } },
    });
    if (deal.linkId) await prisma.propertyClient.updateMany({ where: { id: deal.linkId }, data: { dealStage: input.stage } });
  }
  if (input.stage === 'CLOSED' && !purchaseFlow) {
    await prisma.requirement.update({ where: { id: deal.requirementId }, data: { status: 'FULFILLED' } });
  }
  const refs = { requirementId: deal.requirementId, requirementCode: deal.requirement.code, clientId: deal.clientId, propertyId: deal.propertyId, dealId: deal.id };
  await logActivity(actor, {
    entityType: 'DEAL', entityId: deal.id, entityCode: deal.code, ownerId: deal.ownerId, action: 'DEAL_STAGE_CHANGED',
    description: `${deal.code}: ${human(deal.stage)} → ${human(input.stage)}`, metadata: { from: deal.stage, to: input.stage, note: input.note }, ...refs,
  });
  if (input.stage === 'CLOSED') {
    await logActivity(actor, { entityType: 'DEAL', entityId: deal.id, entityCode: deal.code, ownerId: deal.ownerId, action: 'DEAL_CLOSED', description: `${deal.code} closed at ${inr(updated.dealValue)} · commission ${inr(updated.finalCommission)}`, ...refs });
  }
  for (const competitor of competingDeals) {
    await logActivity(actor, {
      entityType: 'DEAL', entityId: competitor.id, entityCode: competitor.code, ownerId: deal.ownerId, action: 'DEAL_STAGE_CHANGED',
      description: `${competitor.code}: ${human(competitor.stage)} → LOST. ${COMPETING_DEAL_LOSS_REASON}`,
      requirementId: competitor.requirementId, clientId: competitor.clientId, propertyId: deal.propertyId, dealId: competitor.id,
      metadata: { winningDealId: deal.id, propertyId: deal.propertyId, confirmedBy: actor.name || actor.kind },
    });
  }
  await notify({ recipientId: deal.ownerId, type: 'DEAL_STAGE_UPDATE', title: `${deal.code} moved to ${human(input.stage)}`, body: `${deal.requirement.code} · ${deal.property.code}`, dealId: deal.id, requirementId: deal.requirementId, clientId: deal.clientId, propertyId: deal.propertyId, link: `/deals/${deal.id}` });
  return updated;
}
