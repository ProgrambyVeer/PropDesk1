import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { conflict, parse } from '../lib/http';
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
