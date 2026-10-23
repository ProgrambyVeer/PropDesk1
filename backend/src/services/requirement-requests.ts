import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, conflict, fieldError, notFound, parse } from '../lib/http';
import { nextCode } from '../lib/codes';
import { logActivity } from '../lib/activity';
import { clientSchema, notifyRequirementMatches } from './records';
import { normalizeRequirement, requirementSchema } from './validation';

const LINK_DAYS = 14;
const MAX_REQUIREMENTS = 10;
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export async function createRequirementRequest(ownerId: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_DAYS * 86400e3);
  await prisma.requirementRequest.create({ data: { ownerId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

async function loadRequest(token: string) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) throw notFound('Link');
  const link = await prisma.requirementRequest.findUnique({ where: { tokenHash: hashToken(token) }, include: { owner: { select: { id: true, name: true, status: true, profile: { select: { companyName: true } } } } } });
  if (!link || link.owner.status !== 'ACTIVE') throw notFound('Link');
  return link;
}

// Only what the public form needs to display; nothing else about the PC is exposed.
export async function describeRequirementRequest(token: string) {
  const link = await loadRequest(token);
  const status = link.usedAt ? 'USED' : link.expiresAt < new Date() ? 'EXPIRED' : 'OPEN';
  return { status, agentName: link.owner.name || 'Your property consultant', companyName: link.owner.profile?.companyName ?? null };
}

const submissionSchema = z.object({
  idempotencyKey: z.string().trim().min(16).max(100),
  client: clientSchema.pick({ name: true, phone: true }),
  requirements: z.array(z.record(z.string(), z.unknown())).min(1, 'Add at least one requirement').max(MAX_REQUIREMENTS, `You can add up to ${MAX_REQUIREMENTS} requirements at once`),
}).strict();

// Reuses the CRM's own requirement validation, but only the "looking" types: offering requirements must be
// tied to one of the PC's saved properties, which a public client can never select.
function normalizeAll(list: Record<string, unknown>[]) {
  const errors: Record<string, string> = {};
  const rows = list.map((raw, i) => {
    try {
      if (!String(raw.type || '').endsWith('_LOOKING')) throw fieldError({ type: 'Choose what the client is looking for' });
      const { status: _status, ...input } = raw;
      return normalizeRequirement(parse(requirementSchema, input));
    } catch (e) {
      if (!(e instanceof AppError) || e.status !== 422) throw e;
      const fe = (e.details as any)?.fieldErrors || {};
      for (const [k, v] of Object.entries(fe)) errors[`requirements.${i}.${k}`] = (v as string[])[0];
      return null;
    }
  });
  if (Object.keys(errors).length) throw fieldError(errors);
  return rows as any[];
}

class AlreadyClaimed extends Error {}

async function storedResult(linkId: string) {
  const link = await prisma.requirementRequest.findUniqueOrThrow({ where: { id: linkId } });
  const requirements = await prisma.requirement.findMany({ where: { id: { in: link.requirementIds } }, orderBy: { createdAt: 'asc' }, select: { code: true, type: true } });
  return { duplicate: true, requirements };
}

export async function submitRequirementRequest(token: string, body: unknown) {
  const link = await loadRequest(token);
  const input = parse(submissionSchema, body);
  if (link.usedAt) {
    if (link.submissionKey === input.idempotencyKey) return storedResult(link.id);
    throw new AppError(409, 'LINK_USED', 'This requirement form has already been submitted. Ask your property consultant for a new link.');
  }
  if (link.expiresAt < new Date()) throw new AppError(410, 'LINK_EXPIRED', 'This requirement link has expired. Ask your property consultant for a new link.');
  const rows = normalizeAll(input.requirements);
  const ownerId = link.ownerId;
  const clientCode = await nextCode('CLI');
  const codes: string[] = [];
  for (let i = 0; i < rows.length; i += 1) codes.push(await nextCode('REQ'));

  let created: { client: any; requirements: any[]; isNewClient: boolean };
  try {
    created = await prisma.$transaction(async (tx) => {
      // Atomic claim: concurrent/double submissions block here and the loser aborts without creating anything.
      const claim = await tx.requirementRequest.updateMany({ where: { id: link.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date(), submissionKey: input.idempotencyKey } });
      if (claim.count === 0) throw new AlreadyClaimed();
      let client = await tx.client.findFirst({ where: { ownerId, phone: input.client.phone, deletedAt: null }, orderBy: { createdAt: 'asc' } });
      const isNewClient = !client;
      if (!client) client = await tx.client.create({ data: { name: input.client.name, phone: input.client.phone, location: rows[0].location, code: clientCode, ownerId } });
      const requirements: any[] = [];
      for (let i = 0; i < rows.length; i += 1) requirements.push(await tx.requirement.create({ data: { ...rows[i], code: codes[i], ownerId, clientId: client.id } }));
      await tx.requirementRequest.update({ where: { id: link.id }, data: { clientId: client.id, requirementIds: requirements.map((r) => r.id) } });
      return { client, requirements, isNewClient };
    });
  } catch (e) {
    if (!(e instanceof AlreadyClaimed)) throw e;
    const current = await prisma.requirementRequest.findUniqueOrThrow({ where: { id: link.id } });
    if (current.submissionKey === input.idempotencyKey) return storedResult(link.id);
    if (current.usedAt) throw new AppError(409, 'LINK_USED', 'This requirement form has already been submitted. Ask your property consultant for a new link.');
    throw conflict('This requirement link is no longer valid.');
  }

  const actor = { kind: 'pc' as const, userId: ownerId, name: link.owner.name };
  try {
    if (created.isNewClient) await logActivity(actor, { entityType: 'CLIENT', entityId: created.client.id, entityCode: created.client.code, ownerId, clientId: created.client.id, action: 'CLIENT_CREATED', description: `Client ${created.client.name} created via requirement form`, metadata: { source: 'public_requirement_form' } });
    for (const req of created.requirements) {
      await logActivity(actor, { entityType: 'REQUIREMENT', entityId: req.id, entityCode: req.code, ownerId, requirementId: req.id, requirementCode: req.code, clientId: created.client.id, action: 'REQUIREMENT_CREATED', description: `Requirement ${req.code} (${req.type.replace('_', ' ')}) submitted by ${created.client.name} via requirement form`, metadata: { source: 'public_requirement_form' } });
      await notifyRequirementMatches(req);
    }
  } catch { /* the records are committed; activity/notification failures must not fail the submission */ }
  return { duplicate: false, requirements: created.requirements.map((r) => ({ code: r.code, type: r.type })) };
}
