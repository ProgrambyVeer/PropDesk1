import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { conflict, notFound, pageMeta, paging, parse, str } from '../lib/http';
import { nextCode } from '../lib/codes';

export const TICKET_CATEGORIES = ['Login & Account', 'Profile & Settings', 'Clients', 'Properties', 'Requirements & Matching', 'Deals & Follow-ups', 'Sharing', 'Notifications', 'Technical Issue', 'Other'] as const;
export const TICKET_MODULES = ['Home', 'Clients', 'Properties', 'Requirements', 'Deals', 'Follow Ups', 'Notifications', 'Drafts & Bin', 'Profile', 'Other'] as const;
export const TICKET_URGENCIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

const ticketSchema = z.object({
  category: z.string().refine((v): v is (typeof TICKET_CATEGORIES)[number] => (TICKET_CATEGORIES as readonly string[]).includes(v), 'Select an issue category'),
  module: z.enum([...TICKET_MODULES]).optional().or(z.literal('').transform(() => undefined)),
  summary: z.string().trim().min(3, 'Summary is required').max(120, 'Keep the summary under 120 characters'),
  description: z.string().trim().min(10, 'Please describe the issue (at least 10 characters)').max(4000, 'Description is too long'),
  urgency: z.enum([...TICKET_URGENCIES]).default('NORMAL'),
  contactEmail: z.string().trim().email('Enter a valid email address').max(200),
});

const view = (t: any) => ({ id: t.id, code: t.code, category: t.category, module: t.module, summary: t.summary, urgency: t.urgency, status: t.status, createdAt: t.createdAt, updatedAt: t.updatedAt });

// The owner is always taken from the authenticated session, never from the request body.
export async function createTicket(userId: string, body: unknown) {
  const d = parse(ticketSchema, body);
  const dup = await prisma.supportTicket.findFirst({ where: { userId, summary: d.summary, description: d.description, createdAt: { gte: new Date(Date.now() - 60_000) } } });
  if (dup) throw conflict('This ticket was already submitted a moment ago.');
  const t = await prisma.supportTicket.create({ data: { code: await nextCode('TKT'), userId, category: d.category, module: d.module, summary: d.summary, description: d.description, urgency: d.urgency, contactEmail: d.contactEmail } });
  return view(t);
}

export async function listTickets(userId: string) {
  return (await prisma.supportTicket.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })).map(view);
}

const messageSchema = z.object({ body: z.string().trim().min(1, 'Message cannot be empty').max(2000, 'Message is too long (max 2000 characters)') });
const msgView = (m: any) => ({ id: m.id, sender: m.sender, body: m.body, createdAt: m.createdAt, adminName: m.admin?.name ?? null });
const detailView = (t: any) => ({ ...view(t), description: t.description, contactEmail: t.contactEmail, closedAt: t.closedAt, pc: t.user ? { id: t.user.id, name: t.user.name, email: t.user.email } : undefined, messages: (t.messages || []).map(msgView) });
const withAll = { messages: { orderBy: { createdAt: 'asc' as const }, include: { admin: { select: { name: true } } } }, user: { select: { id: true, name: true, email: true } } };

async function addMessage(ticketId: string, sender: 'PC' | 'ADMIN', body: string, adminId?: string) {
  const dup = await prisma.ticketMessage.findFirst({ where: { ticketId, sender, body, createdAt: { gte: new Date(Date.now() - 5_000) } } });
  if (dup) throw conflict('This message was already sent.');
  await prisma.$transaction([
    prisma.ticketMessage.create({ data: { ticketId, sender, body, adminId } }),
    prisma.supportTicket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } }),
  ]);
}

// Scoped to the owner: another PC's ticket is indistinguishable from a missing one.
async function ownTicket(userId: string, id: string) {
  const t = await prisma.supportTicket.findFirst({ where: { id, userId }, include: withAll });
  if (!t) throw notFound('Ticket');
  return t;
}

export async function getTicket(userId: string, id: string) {
  return detailView(await ownTicket(userId, id));
}

export async function replyAsPc(userId: string, id: string, body: unknown) {
  const d = parse(messageSchema, body);
  const t = await ownTicket(userId, id);
  if (t.status === 'CLOSED') throw conflict('This ticket is closed. Create a new ticket to continue.');
  await addMessage(t.id, 'PC', d.body);
  if (t.status === 'RESOLVED') await prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'OPEN' } });
  return detailView(await ownTicket(userId, id));
}

export async function closeOwnTicket(userId: string, id: string) {
  const t = await ownTicket(userId, id);
  if (t.status !== 'CLOSED') await prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: new Date() } });
  return detailView(await ownTicket(userId, id));
}

export async function adminListTickets(q: Record<string, unknown>) {
  const p = paging(q, ['createdAt', 'updatedAt']);
  const where: any = {};
  if (str(q.status)) where.status = q.status;
  if (str(q.category)) where.category = q.category;
  if (str(q.q)) where.OR = [{ code: { contains: String(q.q), mode: 'insensitive' } }, { summary: { contains: String(q.q), mode: 'insensitive' } }, { user: { name: { contains: String(q.q), mode: 'insensitive' } } }];
  const [total, items] = await Promise.all([prisma.supportTicket.count({ where }), prisma.supportTicket.findMany({ where, ...p, include: { user: { select: { id: true, name: true, email: true } } } })]);
  return { items: items.map((t) => ({ ...view(t), pc: t.user })), meta: pageMeta(total, p) };
}

export async function adminGetTicket(id: string) {
  const t = await prisma.supportTicket.findUnique({ where: { id }, include: withAll });
  if (!t) throw notFound('Ticket');
  return detailView(t);
}

export async function adminReply(adminId: string, id: string, body: unknown) {
  const d = parse(messageSchema, body);
  const t = await prisma.supportTicket.findUnique({ where: { id } });
  if (!t) throw notFound('Ticket');
  if (t.status === 'CLOSED') throw conflict('This ticket is closed. Reopen it to reply.');
  await addMessage(id, 'ADMIN', d.body, adminId);
  if (t.status === 'OPEN') await prisma.supportTicket.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
  return adminGetTicket(id);
}

export async function adminSetStatus(id: string, body: unknown) {
  const { status } = parse(z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }), body);
  const t = await prisma.supportTicket.findUnique({ where: { id } });
  if (!t) throw notFound('Ticket');
  await prisma.supportTicket.update({ where: { id }, data: { status, closedAt: status === 'CLOSED' ? new Date() : null } });
  return { before: view(t), after: await adminGetTicket(id) };
}
