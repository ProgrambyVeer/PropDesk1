import 'dotenv/config';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { prisma } from '../src/lib/prisma';
import { scoreMatch } from '../src/services/matching';
import { runSchedulerTick } from '../src/services/notifications';

const app = createApp();
const api = () => request(app);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

async function pcLogin(phone: string) {
  await api().post('/api/v1/auth/send-otp').send({ phone }).expect(200);
  const r = await api().post('/api/v1/auth/verify-otp').send({ phone, code: process.env.MOCK_OTP_CODE || '123456' }).expect(200);
  return { token: r.body.data.token as string, user: r.body.data.user };
}
const as = (t: string) => ({ get: (u: string) => api().get(u).set('Authorization', `Bearer ${t}`), post: (u: string, b: any = {}) => api().post(u).set('Authorization', `Bearer ${t}`).send(b), patch: (u: string, b: any) => api().patch(u).set('Authorization', `Bearer ${t}`).send(b), del: (u: string) => api().delete(u).set('Authorization', `Bearer ${t}`) });
const RES = (clientId: string, x: any = {}) => ({ clientId, type: 'BUY_LOOKING', category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Whitefield', bhk: 3, amount: 15000000, dimLength: 40, dimWidth: 45, ...x });
const PROP = { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Whitefield', bhk: 3, builtUpArea: 1800, dimLength: 40, dimWidth: 45, facing: 'East', transactions: [{ kind: 'SALE', salePrice: 14500000 }, { kind: 'RENT', rentAmount: 55000, depositAmount: 300000, availableDate: '2030-01-01' }] };

let TA = ''; let A: ReturnType<typeof as>; let B: ReturnType<typeof as>; let ADMIN: ReturnType<typeof as>;
let clientA: any; let clientB: any; let reqs: any[] = []; let propA: any; let userB: any;
const googleVerify = vi.spyOn(OAuth2Client.prototype, 'verifyIdToken');
const googlePayload = (overrides: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com', aud: 'google-test-client-id', exp: Math.floor(Date.now() / 1000) + 3600,
  sub: 'google-subject-1', email: 'Google.User@Example.com', email_verified: true, name: 'Google User', ...overrides,
});
const googleTicket = (payload: Record<string, unknown>) => ({ getPayload: () => payload }) as any;

beforeAll(async () => {
  config.googleClientId = 'google-test-client-id';
  TA = (await pcLogin('9000000001')).token; A = as(TA);
  const b = await pcLogin('9000000002'); B = as(b.token); userB = b.user;
  await prisma.adminUser.create({ data: { email: 'root@test.local', name: 'Root', role: 'SUPER_ADMIN', passwordHash: await bcrypt.hash('RootPass123!', 4) } });
  await prisma.adminUser.create({ data: { email: 'ro@test.local', name: 'RO', role: 'READ_ONLY_ADMIN', passwordHash: await bcrypt.hash('RootPass123!', 4) } });
  const r = await api().post('/api/v1/admin/auth/login').send({ email: 'root@test.local', password: 'RootPass123!' }).expect(200);
  ADMIN = as(r.body.data.token);
});

describe('Google PC authentication', () => {
  it('rejects invalid, expired, wrong-audience, wrong-issuer, and unverified credentials', async () => {
    googleVerify.mockRejectedValueOnce(new Error('invalid signature'));
    await api().post('/api/v1/auth/google').send({ credential: 'invalid' }).expect(401);
    googleVerify.mockResolvedValueOnce(googleTicket(googlePayload({ exp: Math.floor(Date.now() / 1000) - 1 })));
    await api().post('/api/v1/auth/google').send({ credential: 'expired' }).expect(401);
    googleVerify.mockResolvedValueOnce(googleTicket(googlePayload({ aud: 'another-client' })));
    await api().post('/api/v1/auth/google').send({ credential: 'wrong-audience' }).expect(401);
    googleVerify.mockResolvedValueOnce(googleTicket(googlePayload({ iss: 'https://attacker.example' })));
    await api().post('/api/v1/auth/google').send({ credential: 'wrong-issuer' }).expect(401);
    googleVerify.mockResolvedValueOnce(googleTicket(googlePayload({ email_verified: false })));
    await api().post('/api/v1/auth/google').send({ credential: 'unverified' }).expect(401);
  });

  it('creates a verified Google PC once, uses PC sessions, isolates records, and leaves admin auth unchanged', async () => {
    googleVerify.mockResolvedValue(googleTicket(googlePayload()));
    const signedIn = await api().post('/api/v1/auth/google').send({ credential: 'valid' }).expect(200);
    const googleUser = signedIn.body.data.user;
    expect(googleUser.email).toBe('google.user@example.com'); expect(googleUser.phone).toBeNull();
    expect(googleUser.onboarded).toBe(false); expect(signedIn.body.data.showOnboarding).toBe(true);
    const stored = await prisma.user.findUnique({ where: { id: googleUser.id } });
    expect(stored?.googleSub).toBe('google-subject-1'); expect(stored?.phone).toBeNull();
    const repeat = await api().post('/api/v1/auth/google').send({ credential: 'valid' }).expect(200);
    expect(repeat.body.data.user.id).toBe(googleUser.id);
    expect(await prisma.user.count({ where: { googleSub: 'google-subject-1' } })).toBe(1);
    const googlePc = as(signedIn.body.data.token);
    await googlePc.get('/api/v1/auth/me').expect(200);
    await api().get('/api/v1/auth/me').expect(401);
    const ownedClient = (await googlePc.post('/api/v1/clients', { name: 'Google Tenant Client', phone: '9845012381', location: 'Whitefield' }).expect(201)).body.data;
    await B.get(`/api/v1/clients/${ownedClient.id}`).expect(403);
    const adminMe = await ADMIN.get('/api/v1/admin/auth/me').expect(200);
    expect(adminMe.body.data.role).toBe('SUPER_ADMIN');
  });

  it('does not link an existing phone account by email or replace its identity', async () => {
    const phoneUser = await prisma.user.findUniqueOrThrow({ where: { phone: '9000000001' } });
    await prisma.user.update({ where: { id: phoneUser.id }, data: { email: 'phone.account@example.com' } });
    googleVerify.mockResolvedValue(googleTicket(googlePayload({ sub: 'unlinked-subject', email: 'Phone.Account@Example.com' })));
    const response = await api().post('/api/v1/auth/google').send({ credential: 'same-email' }).expect(409);
    expect(response.body.error.message).toContain('never automatically linked');
    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: phoneUser.id } });
    expect(unchanged.googleSub).toBeNull(); expect(unchanged.phone).toBe('9000000001');
    expect(await prisma.user.findUnique({ where: { googleSub: 'unlinked-subject' } })).toBeNull();
  });

  it('rejects duplicate Google email identities rather than linking them', async () => {
    googleVerify.mockResolvedValue(googleTicket(googlePayload({ sub: 'second-google-subject' })));
    await api().post('/api/v1/auth/google').send({ credential: 'duplicate-email' }).expect(409);
    expect(await prisma.user.count({ where: { email: 'google.user@example.com' } })).toBe(1);
  });
});

describe('Mandatory requirement isolation test', () => {
  it('creates client A with REQ-000001..3, edits/deletes/restores only REQ-000002, next ID is new', async () => {
    clientA = (await A.post('/api/v1/clients', { name: 'Rahul Sharma', phone: '9845012345', location: 'Whitefield' }).expect(201)).body.data;
    for (const x of [{}, { type: 'RENT_LOOKING', location: 'Varthur', bhk: 2, amount: 45000 }, { type: 'LEASE_LOOKING', category: 'COMMERCIAL', subCategory: 'Full Commercial', subtype: 'Shop', location: 'HSR Layout', amount: 8000000, leasePeriodMonths: 60, bhk: null, code: 'REQ-999999' }]) {
      reqs.push((await A.post('/api/v1/requirements', RES(clientA.id, x)).expect(201)).body.data);
    }
    expect(reqs.map((r) => r.code)).toEqual(['REQ-000001', 'REQ-000002', 'REQ-000003']);
    const snap = async () => Promise.all(reqs.map(async (r) => (await A.get(`/api/v1/requirements/${r.id}`).expect(200)).body.data));
    const before = await snap();
    await A.patch(`/api/v1/requirements/${reqs[1].id}`, { amount: 50000, bhk: 3 }).expect(200);
    const after = await snap();
    expect(after[0].updatedAt).toBe(before[0].updatedAt); expect(after[0].amount).toBe(15000000);
    expect(after[1].amount).toBe(50000); expect(after[1].code).toBe('REQ-000002');
    expect(after[2].updatedAt).toBe(before[2].updatedAt);
    await A.del(`/api/v1/requirements/${reqs[1].id}`).expect(200);
    const list = (await A.get(`/api/v1/requirements?clientId=${clientA.id}`).expect(200)).body.data.map((r: any) => r.code);
    expect(list.sort()).toEqual(['REQ-000001', 'REQ-000003']);
    const bin = (await A.get('/api/v1/bin').expect(200)).body.data;
    const item = bin.find((b: any) => b.entityCode === 'REQ-000002');
    expect(item).toBeTruthy();
    const restored = (await A.post(`/api/v1/bin/${item.id}/restore`).expect(200)).body.data;
    expect(restored.code).toBe('REQ-000002'); expect(restored.id).toBe(reqs[1].id);
    const next = (await A.post('/api/v1/requirements', RES(clientA.id)).expect(201)).body.data;
    expect(next.code).toBe('REQ-000004');
  });
  it('permanently deleted requirement IDs are never reused', async () => {
    const r = (await A.post('/api/v1/requirements', RES(clientA.id)).expect(201)).body.data;
    await A.del(`/api/v1/requirements/${r.id}`).expect(200);
    const item = (await A.get('/api/v1/bin').expect(200)).body.data.find((b: any) => b.entityCode === r.code);
    await A.del(`/api/v1/bin/${item.id}`).expect(200);
    const n = (await A.post('/api/v1/requirements', RES(clientA.id)).expect(201)).body.data;
    expect(Number(n.code.slice(4))).toBeGreaterThan(Number(r.code.slice(4)));
  });
});

describe('Validation', () => {
  it('rejects bad phone and irrelevant subtypes but allows missing dimensions', async () => {
    await A.post('/api/v1/clients', { name: 'X', phone: '123', location: 'HSR' }).expect(422);
    const noDimensions = await A.post('/api/v1/requirements', RES(clientA.id, { dimLength: null, dimWidth: null })).expect(201);
    expect(noDimensions.body.data.dimLength).toBeNull(); expect(noDimensions.body.data.dimWidth).toBeNull();
    await A.post('/api/v1/requirements', RES(clientA.id, { subtype: 'Shop' })).expect(422);
    const bad = await A.post('/api/v1/properties', { ...PROP, transactions: [{ kind: 'RENT', rentAmount: 1 }] }).expect(422);
    expect(bad.body.error.details.fieldErrors['RENT.availableDate']).toBeTruthy();
  });
  it('persists amenities when creating and editing a looking requirement', async () => {
    const created = (await A.post('/api/v1/requirements', RES(clientA.id, { amenities: ['Gym', 'Security'] })).expect(201)).body.data;
    expect(created.amenities).toEqual(['Gym', 'Security']);
    await A.patch(`/api/v1/requirements/${created.id}`, { amenities: ['Gym', 'Garden'] }).expect(200);
    expect((await A.get(`/api/v1/requirements/${created.id}`).expect(200)).body.data.amenities).toEqual(['Gym', 'Garden']);
  });
  it('allows property creation without transaction intent and preserves multiple requirement facings', async () => {
    const p = await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Koramangala', bhk: 2, builtUpArea: 900, dimLength: 30, dimWidth: 30, facing: 'East' }).expect(201);
    expect(p.body.data.code).toMatch(/^PROP-\d{6}$/);
    const req = await A.post('/api/v1/requirements', RES(clientA.id, { facing: ['East', 'North'], category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Koramangala', locations: ['Koramangala', 'Hebbal'], amount: 6500000 })).expect(201);
    expect(req.body.data.facing).toContain('East'); expect(req.body.data.facing).toContain('North');
    const saved = await A.get(`/api/v1/requirements/${req.body.data.id}`).expect(200);
    expect(String(saved.body.data.facing)).toContain('East');
    expect(saved.body.data.locations).toEqual(['Koramangala', 'Hebbal']);
    const seller = (await A.post('/api/v1/clients', { name: 'Validation Seller', phone: '9845012997', location: 'Whitefield' }).expect(201)).body.data;
    const offering = await A.post('/api/v1/requirements', RES(seller.id, { type: 'SELL_OFFERING', facing: ['West', 'South'], locations: ['Whitefield', 'Hebbal'], amount: 7000000 })).expect(201);
    expect(offering.body.data.facing).toBe('West'); expect(offering.body.data.locations).toEqual(['Whitefield']);
  });
});

describe('Properties, photos, matching, linking, deals', () => {
  it('creates a multi-transaction property and strips irrelevant fields', async () => {
    propA = (await A.post('/api/v1/properties', { ...PROP, khata: 'A Khata' }).expect(201)).body.data;
    expect(propA.code).toMatch(/^PROP-\d{6}$/); expect(propA.transactions).toHaveLength(2); expect(propA.khata).toBeNull();
    expect(propA.transactions.find((t: any) => t.kind === 'SALE').depositAmount).toBeNull();
  });
  it('links an offering after creating a client without duplicate requirements or leads', async () => {
    const seller = (await A.post('/api/v1/clients', { name: 'Property First Seller', phone: '9845012999', location: 'Whitefield' }).expect(201)).body.data;
    await A.post(`/api/v1/clients/${seller.id}/offerings`, {
      propertyId: propA.id,
      offerings: [{ type: 'RENT_OFFERING', amount: 60000, deposit: 300000, availableDate: '2030-02-01', leasePeriodMonths: 12 }],
    }).expect(200);
    const first = (await A.get(`/api/v1/clients/${seller.id}`).expect(200)).body.data;
    expect(first.requirements).toHaveLength(1); expect(first.links).toHaveLength(1);
    expect(first.links[0].requirement.type).toBe('RENT_OFFERING');
    await A.post(`/api/v1/clients/${seller.id}/offerings`, {
      propertyId: propA.id,
      offerings: [{ type: 'RENT_OFFERING', amount: 62000, deposit: 300000, availableDate: '2030-03-01', leasePeriodMonths: 12 }],
    }).expect(200);
    const edited = (await A.get(`/api/v1/clients/${seller.id}`).expect(200)).body.data;
    expect(edited.requirements).toHaveLength(1); expect(edited.links).toHaveLength(1); expect(edited.requirements[0].amount).toBe(62000);
    const conflictingSeller = (await A.post('/api/v1/clients', { name: 'Conflicting Seller', phone: '9845012998', location: 'Whitefield' }).expect(201)).body.data;
    await A.post(`/api/v1/clients/${conflictingSeller.id}/offerings`, { propertyId: propA.id, offerings: [{ type: 'SELL_OFFERING', amount: 16000000 }] }).expect(409);
  });
  it('persists, reorders and deletes photos', async () => {
    const up = await api().post(`/api/v1/properties/${propA.id}/photos`).set('Authorization', `Bearer ${TA}`).attach('photos', PNG, { filename: 'a.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    await api().post(`/api/v1/properties/${propA.id}/photos`).set('Authorization', `Bearer ${TA}`).attach('photos', Buffer.from('not-an-image-file'), { filename: 'x.png', contentType: 'image/png' }).expect(400);
    const p = (await A.get(`/api/v1/properties/${propA.id}`).expect(200)).body.data;
    expect(p.photos).toHaveLength(1);
    await api().get(p.photos[0].url).expect(200);
    await A.del(`/api/v1/property-photos/${p.photos[0].id}`).expect(200);
  });
  it('matches per requirement with reasons', async () => {
    const seller = await prisma.client.findFirstOrThrow({ where: { phone: '9845012999' } });
    await A.post(`/api/v1/clients/${seller.id}/offerings`, { propertyId: propA.id, offerings: [{ type: 'SELL_OFFERING', amount: 14500000 }] }).expect(200);
    const m = (await A.get(`/api/v1/requirements/${reqs[0].id}/matches`).expect(200)).body.data;
    expect(m[0].property.id).toBe(propA.id); expect(m[0].score).toBe(100);
    expect(m[0].reasons.find((r: any) => r.factor === 'Location').detail).toContain('matched');
    expect(m[0].reasons.find((r: any) => r.factor === 'Budget').detail).toContain('Within budget');
    const m3 = (await A.get(`/api/v1/requirements/${reqs[2].id}/matches`).expect(200)).body.data;
    expect(m3.find((x: any) => x.property.id === propA.id)).toBeUndefined();
  });
  it('keeps compatible-category subtype differences visible with zero subtype points', async () => {
    const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Standalone', location: 'Subtype Locality', transactions: [{ kind: 'SALE', salePrice: 12000000 }] }).expect(201)).body.data;
    const seller = (await A.post('/api/v1/clients', { name: 'Subtype Seller', phone: '9920012388', location: 'Subtype Locality' }).expect(201)).body.data;
    const offering = (await A.post(`/api/v1/clients/${seller.id}/offerings`, { propertyId: property.id, offerings: [{ type: 'SELL_OFFERING', amount: 12000000 }] }).expect(200)).body.data[0].requirement;
    const requirement = (await A.post('/api/v1/requirements', RES(clientA.id, { subtype: 'Apartment', location: 'Subtype Locality', locations: ['Subtype Locality'], amount: 15000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    const match = (await A.get(`/api/v1/requirements/${requirement.id}/matches`).expect(200)).body.data.find((item: any) => item.property.id === property.id);
    expect(match).toBeTruthy();
    expect(property.subtype).toBe('Standalone Building');
    expect(match.reasons.find((reason: any) => reason.factor === 'Subtype')).toMatchObject({ matched: false, detail: 'Requested Apartment; property is Standalone Building' });
    const reverse = (await A.get(`/api/v1/requirements/${offering.id}/matches`).expect(200)).body.data;
    expect(reverse.some((item: any) => item.matchedRequirement.id === requirement.id)).toBe(true);
  });
  it('keeps location differences visible and treats missing location preferences neutrally', async () => {
    const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Standalone', location: 'Property Locality', area: 4000, facing: 'South', transactions: [{ kind: 'SALE', salePrice: 12000000 }] }).expect(201)).body.data;
    const seller = (await A.post('/api/v1/clients', { name: 'Location Seller', phone: '9920012387', location: 'Property Locality' }).expect(201)).body.data;
    await A.post(`/api/v1/clients/${seller.id}/offerings`, { propertyId: property.id, offerings: [{ type: 'SELL_OFFERING', amount: 12000000 }] }).expect(200);
    const requirement = (await A.post('/api/v1/requirements', RES(clientA.id, { location: 'Requested Locality', locations: ['Requested Locality'], amount: 15000000, area: 1000, facing: 'North', dimLength: null, dimWidth: null })).expect(201)).body.data;
    const match = (await A.get(`/api/v1/requirements/${requirement.id}/matches`).expect(200)).body.data.find((item: any) => item.property.id === property.id);
    expect(match).toBeTruthy();
    expect(match.score).toBeLessThan(40);
    expect(match.reasons.find((reason: any) => reason.factor === 'Location')).toMatchObject({ matched: false, detail: 'Requested Requested Locality; property is Property Locality' });
    const [savedRequirement, savedProperty] = await Promise.all([
      prisma.requirement.findUniqueOrThrow({ where: { id: requirement.id } }),
      prisma.property.findUniqueOrThrow({ where: { id: property.id }, include: { transactions: true } }),
    ]);
    expect(scoreMatch({ ...savedRequirement, location: '', locations: [] }, savedProperty)?.reasons.some((reason) => reason.factor === 'Location')).toBe(false);
    expect(scoreMatch(savedRequirement, { ...savedProperty, location: '' })?.reasons.some((reason) => reason.factor === 'Location')).toBe(false);
  });
  it('matches all six requirement types to only their transaction family and honors locality alternatives', async () => {
    const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Test Locality', bhk: 3, transactions: [
      { kind: 'SALE', salePrice: 14500000 }, { kind: 'RENT', rentAmount: 55000, availableDate: '2030-01-01' }, { kind: 'LEASE', leaseAmount: 7800000, leasePeriodMonths: 36, availableDate: '2030-01-01' },
    ] }).expect(201)).body.data;
    const seller = (await A.post('/api/v1/clients', { name: 'Transaction Match Seller', phone: '9845012979', location: 'Test Locality' }).expect(201)).body.data;
    await A.post(`/api/v1/clients/${seller.id}/offerings`, {
      propertyId: property.id,
      offerings: [
        { type: 'SELL_OFFERING', amount: 14500000 },
        { type: 'RENT_OFFERING', amount: 55000, deposit: 200000, availableDate: '2030-01-01', leasePeriodMonths: 12 },
        { type: 'LEASE_OFFERING', amount: 7800000, deposit: 500000, availableDate: '2030-01-01', leasePeriodMonths: 36 },
      ],
    }).expect(200);
    const cases = [
      { type: 'BUY_LOOKING', amount: 15000000 }, { type: 'SELL_OFFERING', amount: 16000000 },
      { type: 'RENT_LOOKING', amount: 60000 }, { type: 'RENT_OFFERING', amount: 60000, deposit: 200000, availableDate: '2030-01-01' },
      { type: 'LEASE_LOOKING', amount: 8000000, leasePeriodMonths: 36 }, { type: 'LEASE_OFFERING', amount: 8000000, leasePeriodMonths: 36, availableDate: '2030-01-01' },
    ];
    for (const [index, criteria] of cases.entries()) {
      const roleClient = (await A.post('/api/v1/clients', { name: `Match Client ${index}`, phone: `98450129${String(80 + index).padStart(2, '0')}`, location: 'Test Locality' }).expect(201)).body.data;
      const req = (await A.post('/api/v1/requirements', RES(roleClient.id, { ...criteria, location: 'Legacy locality', locations: ['Legacy locality', 'Test Locality'], dimLength: null, dimWidth: null })).expect(201)).body.data;
      const matches = (await A.get(`/api/v1/requirements/${req.id}/matches`).expect(200)).body.data;
      expect(matches.some((match: any) => match.property.id === property.id && match.score === 100 && match.reasons.some((reason: any) => reason.factor === 'Location' && reason.detail.includes('matched')))).toBe(true);
      await A.patch(`/api/v1/requirements/${req.id}`, { status: 'ON_HOLD' }).expect(200);
      expect((await A.get(`/api/v1/requirements/${req.id}/matches`).expect(200)).body.data).toHaveLength(0);
    }
    const rentOnly = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Test Locality', transactions: [{ kind: 'RENT', rentAmount: 50000, availableDate: '2030-01-01' }] }).expect(201)).body.data;
    const buy = (await A.post('/api/v1/requirements', RES(clientA.id, { location: 'Test Locality', amount: 20000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    const buyMatches = (await A.get(`/api/v1/requirements/${buy.id}/matches`).expect(200)).body.data;
    expect(buyMatches.some((match: any) => match.property.id === rentOnly.id)).toBe(false);
    const outsideBudget = (await A.post('/api/v1/requirements', RES(clientA.id, { location: 'Test Locality', locations: ['Test Locality'], amountMin: 9000000, amount: 10000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    const outsideMatches = (await A.get(`/api/v1/requirements/${outsideBudget.id}/matches`).expect(200)).body.data;
    expect(outsideMatches.some((match: any) => match.property.id === property.id)).toBe(false);
  });
  it('matches saved linked offers for each transaction pair and rejects an incompatible pair', async () => {
    const seller = (await A.post('/api/v1/clients', { name: 'Seller Client', phone: '9920012345', location: 'Test Locality' }).expect(201)).body.data;
    const buyer = (await A.post('/api/v1/clients', { name: 'Buyer Client', phone: '9920012346', location: 'Test Locality' }).expect(201)).body.data;
    const pairs = [
      { looking: 'BUY_LOOKING', offering: 'SELL_OFFERING', offerPrice: 12000000, min: 10000000, max: 15000000 },
      { looking: 'RENT_LOOKING', offering: 'RENT_OFFERING', offerPrice: 50000, min: 40000, max: 60000, deposit: 200000, availableDate: '2030-01-01' },
      { looking: 'LEASE_LOOKING', offering: 'LEASE_OFFERING', offerPrice: 7000000, min: 6000000, max: 8000000, leasePeriodMonths: 36, availableDate: '2030-01-01' },
    ];
    for (const pair of pairs) {
      const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Test Locality' }).expect(201)).body.data;
      const offer = (await A.post('/api/v1/requirements', RES(seller.id, { type: pair.offering, location: 'Test Locality', locations: ['Test Locality'], amount: pair.offerPrice, deposit: pair.deposit, leasePeriodMonths: pair.leasePeriodMonths, availableDate: pair.availableDate, dimLength: null, dimWidth: null })).expect(201)).body.data;
      await A.post('/api/v1/property-client-links', { clientId: seller.id, requirementId: offer.id, propertyId: property.id }).expect(201);
      const sellerOnlyProperties = (await A.get('/api/v1/properties?pageSize=100').expect(200)).body.data;
      expect(sellerOnlyProperties.find((item: any) => item.id === property.id).interestedClients).toBe(0);
      const looking = (await A.post('/api/v1/requirements', RES(buyer.id, { type: pair.looking, location: 'Old Locality', locations: ['Old Locality', 'Test Locality'], amountMin: pair.min, amount: pair.max, leasePeriodMonths: pair.leasePeriodMonths, availableDate: pair.availableDate, dimLength: null, dimWidth: null })).expect(201)).body.data;
      const matches = (await A.get(`/api/v1/requirements/${looking.id}/matches`).expect(200)).body.data;
      const candidate = matches.find((match: any) => match.property.id === property.id);
      expect(candidate).toBeTruthy(); expect(candidate.matchedOffer.id).toBe(offer.id); expect(candidate.matchedOffer.amount).toBe(pair.offerPrice);
      expect(candidate.linked).toBe(false);
      expect(candidate.reasons.some((reason: any) => reason.factor === 'Category')).toBe(true);
      expect(candidate.reasons.some((reason: any) => reason.factor === 'Subtype')).toBe(true);
      expect(candidate.reasons.some((reason: any) => reason.factor === 'Requirement type')).toBe(false);
      expect(candidate.reasons.find((reason: any) => reason.factor === 'Budget').detail).toContain('Within budget');
      const commandCenterMatch = (await A.get(`/api/v1/properties/${property.id}/analytics`).expect(200)).body.data.matchingBuyers.find((match: any) => match.requirementId === looking.id);
      expect(commandCenterMatch).toMatchObject({ score: candidate.score, hasLead: false });
      expect(commandCenterMatch.reasons).toEqual(candidate.reasons);
      const notAssociated = (await A.get('/api/v1/properties?pageSize=100').expect(200)).body.data;
      expect(notAssociated.find((item: any) => item.id === property.id).interestedClients).toBe(0);
      const firstLead = (await A.post('/api/v1/property-client-links', { clientId: buyer.id, requirementId: looking.id, propertyId: property.id }).expect(201)).body.data;
      const retriedLead = (await A.post('/api/v1/property-client-links', { clientId: buyer.id, requirementId: looking.id, propertyId: property.id }).expect(201)).body.data;
      expect(retriedLead.id).toBe(firstLead.id);
      const afterLead = (await A.get(`/api/v1/requirements/${looking.id}/matches`).expect(200)).body.data.find((match: any) => match.property.id === property.id);
      expect(afterLead).toMatchObject({ score: candidate.score, linked: true });
      await A.del(`/api/v1/property-client-links/${firstLead.id}`).expect(200);
      const afterLeadRemoval = (await A.get(`/api/v1/requirements/${looking.id}/matches`).expect(200)).body.data.find((match: any) => match.property.id === property.id);
      expect(afterLeadRemoval).toMatchObject({ score: candidate.score, linked: false });
      await A.post('/api/v1/property-client-links', { clientId: buyer.id, requirementId: looking.id, propertyId: property.id }).expect(201);
      const associatedBuyer = (await A.get('/api/v1/properties?pageSize=100').expect(200)).body.data;
      expect(associatedBuyer.find((item: any) => item.id === property.id).interestedClients).toBe(1);
      const duplicateLooking = (await A.post('/api/v1/requirements', RES(buyer.id, { type: pair.looking, location: 'Test Locality', locations: ['Test Locality'], amountMin: pair.min, amount: pair.max, leasePeriodMonths: pair.leasePeriodMonths, availableDate: pair.availableDate, dimLength: null, dimWidth: null })).expect(201)).body.data;
      await A.post('/api/v1/property-client-links', { clientId: buyer.id, requirementId: duplicateLooking.id, propertyId: property.id }).expect(201);
      const deduplicatedBuyer = (await A.get('/api/v1/properties?pageSize=100').expect(200)).body.data;
      expect(deduplicatedBuyer.find((item: any) => item.id === property.id).interestedClients).toBe(1);
      await A.patch(`/api/v1/requirements/${looking.id}`, { status: 'ON_HOLD' }).expect(200);
      await A.patch(`/api/v1/requirements/${duplicateLooking.id}`, { status: 'ON_HOLD' }).expect(200);
      const staleLinks = (await A.get('/api/v1/properties?pageSize=100').expect(200)).body.data;
      expect(staleLinks.find((item: any) => item.id === property.id).interestedClients).toBe(0);
      const list = (await A.get('/api/v1/properties').expect(200)).body.data;
      expect(list.find((item: any) => item.id === property.id).linkedOffers.some((item: any) => item.id === offer.id && item.amount === pair.offerPrice)).toBe(true);
    }
    const incompatibleProperty = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Test Locality' }).expect(201)).body.data;
    const rentOffer = (await A.post('/api/v1/requirements', RES(seller.id, { type: 'RENT_OFFERING', location: 'Test Locality', locations: ['Test Locality'], amount: 50000, deposit: 200000, availableDate: '2030-01-01', dimLength: null, dimWidth: null })).expect(201)).body.data;
    await A.post('/api/v1/property-client-links', { clientId: seller.id, requirementId: rentOffer.id, propertyId: incompatibleProperty.id }).expect(201);
    const buy = (await A.post('/api/v1/requirements', RES(buyer.id, { location: 'Test Locality', locations: ['Test Locality'], amount: 20000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    const buyMatches = (await A.get(`/api/v1/requirements/${buy.id}/matches`).expect(200)).body.data;
    expect(buyMatches.some((match: any) => match.property.id === incompatibleProperty.id)).toBe(false);
  });
  it('allows manually adding a non-matching eligible looking requirement as an interested buyer', async () => {
    const seller = (await A.post('/api/v1/clients', { name: 'Manual Interest Seller', phone: '9920012360', location: 'Test Locality' }).expect(201)).body.data;
    const buyer = (await A.post('/api/v1/clients', { name: 'Manual Interest Buyer', phone: '9920012361', location: 'Elsewhere' }).expect(201)).body.data;
    const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Test Locality' }).expect(201)).body.data;
    const offer = (await A.post('/api/v1/requirements', RES(seller.id, { type: 'SELL_OFFERING', amount: 12000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    await A.post('/api/v1/property-client-links', { clientId: seller.id, requirementId: offer.id, propertyId: property.id }).expect(201);
    const nonMatching = (await A.post('/api/v1/requirements', RES(buyer.id, { location: 'Elsewhere', locations: ['Elsewhere'], amount: 9000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    const candidates = (await A.get(`/api/v1/properties/${property.id}/interested-buyer-candidates`).expect(200)).body.data;
    expect(candidates.some((candidate: any) => candidate.client.id === buyer.id && candidate.requirement.id === nonMatching.id)).toBe(true);
    const association = (await A.post(`/api/v1/properties/${property.id}/interested-buyers`, { clientId: buyer.id, requirementId: nonMatching.id }).expect(201)).body.data;
    await A.post(`/api/v1/properties/${property.id}/interested-buyers`, { clientId: buyer.id, requirementId: nonMatching.id }).expect(409);
    expect((await A.get('/api/v1/properties?pageSize=100').expect(200)).body.data.find((item: any) => item.id === property.id).interestedClients).toBe(1);
    await A.del(`/api/v1/property-client-links/${association.id}`).expect(200);
    expect((await A.get(`/api/v1/requirements/${nonMatching.id}`).expect(200)).body.data.id).toBe(nonMatching.id);
    expect((await A.get(`/api/v1/properties/${property.id}`).expect(200)).body.data.links.some((link: any) => link.id === association.id)).toBe(false);
  });
  it('allows mixed client roles but blocks opposite roles on the same property', async () => {
    await A.post('/api/v1/property-client-links', { clientId: clientA.id, requirementId: reqs[0].id, propertyId: propA.id }).expect(201);
    const l2 = (await A.get(`/api/v1/property-client-links?requirementId=${reqs[1].id}`).expect(200)).body.data;
    expect(l2).toHaveLength(0);
    const sell = (await A.post('/api/v1/requirements', RES(clientA.id, { type: 'SELL_OFFERING' })).expect(201)).body.data;
    const sameProperty = await A.post('/api/v1/property-client-links', { clientId: clientA.id, requirementId: sell.id, propertyId: propA.id }).expect(409);
    expect(sameProperty.body.error.message).toContain('Same-property conflict');

    const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Test Locality' }).expect(201)).body.data;
    const mixed = (await A.post('/api/v1/clients', { name: 'Mixed Role Client', phone: '9920012398', location: 'Test Locality' }).expect(201)).body.data;
    const offer = (await A.post('/api/v1/requirements', RES(mixed.id, { type: 'SELL_OFFERING', location: 'Test Locality', amount: 10000000 })).expect(201)).body.data;
    await A.post('/api/v1/property-client-links', { clientId: mixed.id, requirementId: offer.id, propertyId: property.id }).expect(201);
    const looking = (await A.post('/api/v1/requirements', RES(mixed.id, { location: 'Test Locality', amount: 11000000 })).expect(201)).body.data;
    const reverseOrder = await A.post('/api/v1/property-client-links', { clientId: mixed.id, requirementId: looking.id, propertyId: property.id }).expect(409);
    expect(reverseOrder.body.error.message).toContain('Same-property conflict');
    const otherProperty = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Test Locality' }).expect(201)).body.data;
    await A.post('/api/v1/property-client-links', { clientId: mixed.id, requirementId: looking.id, propertyId: otherProperty.id }).expect(201);
  });
  it('allows separate offering types on one property and safely archives Lead and Requirement dependencies', async () => {
    const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Test Locality' }).expect(201)).body.data;
    const seller = (await A.post('/api/v1/clients', { name: 'Offering Seller A', phone: '9920012391', location: 'Test Locality' }).expect(201)).body.data;
    const linked = (await A.post(`/api/v1/clients/${seller.id}/offerings`, {
      propertyId: property.id,
      offerings: [
        { type: 'SELL_OFFERING', amount: 12000000 },
        { type: 'RENT_OFFERING', amount: 50000, deposit: 200000, availableDate: '2030-01-01', leasePeriodMonths: 12 },
        { type: 'LEASE_OFFERING', amount: 7000000, deposit: 500000, availableDate: '2030-01-01', leasePeriodMonths: 36 },
      ],
    }).expect(200)).body.data;
    expect(linked).toHaveLength(3);
    expect(new Set(linked.map((item: any) => item.requirement.id)).size).toBe(3);
    expect(linked.every((item: any) => item.requirement.clientId === seller.id && item.link.clientId === seller.id && item.link.propertyId === property.id && item.link.requirementId === item.requirement.id)).toBe(true);
    expect(linked.find((item: any) => item.requirement.type === 'SELL_OFFERING').requirement.amount).toBe(12000000);
    expect(linked.find((item: any) => item.requirement.type === 'RENT_OFFERING').requirement).toMatchObject({ amount: 50000, deposit: 200000, leasePeriodMonths: 12 });
    expect(linked.find((item: any) => item.requirement.type === 'LEASE_OFFERING').requirement).toMatchObject({ amount: 7000000, deposit: 500000, leasePeriodMonths: 36 });
    const duplicate = (await A.post(`/api/v1/clients/${seller.id}/offerings`, { propertyId: property.id, offerings: [{ type: 'RENT_OFFERING', amount: 52000, availableDate: '2030-02-01', leasePeriodMonths: 18 }] }).expect(200)).body.data;
    expect(duplicate).toHaveLength(1);
    expect((await A.get(`/api/v1/clients/${seller.id}`).expect(200)).body.data.requirements).toHaveLength(3);

    const leadClient = (await A.post('/api/v1/clients', { name: 'Lead Delete Client', phone: '9920012393', location: 'Test Locality' }).expect(201)).body.data;
    const leadRequirement = (await A.post('/api/v1/requirements', RES(leadClient.id, { location: 'Test Locality' })).expect(201)).body.data;
    const leadLink = (await A.post('/api/v1/property-client-links', { clientId: leadClient.id, requirementId: leadRequirement.id, propertyId: property.id }).expect(201)).body.data;
    const leadDeal = (await A.post('/api/v1/deals', { clientId: leadClient.id, requirementId: leadRequirement.id, propertyId: property.id, dealValue: 12000000 }).expect(201)).body.data;
    await A.del(`/api/v1/property-client-links/${leadLink.id}`).expect(200);
    expect((await prisma.propertyClient.findUnique({ where: { id: leadLink.id } }))?.status).toBe('UNLINKED');
    expect((await prisma.deal.findUnique({ where: { id: leadDeal.id } }))?.deletedAt).not.toBeNull();

    const requirementClient = (await A.post('/api/v1/clients', { name: 'Requirement Delete Client', phone: '9920012394', location: 'Test Locality' }).expect(201)).body.data;
    const requirement = (await A.post('/api/v1/requirements', RES(requirementClient.id, { location: 'Test Locality' })).expect(201)).body.data;
    const requirementLink = (await A.post('/api/v1/property-client-links', { clientId: requirementClient.id, requirementId: requirement.id, propertyId: property.id }).expect(201)).body.data;
    const requirementDeal = (await A.post('/api/v1/deals', { clientId: requirementClient.id, requirementId: requirement.id, propertyId: property.id, dealValue: 12000000 }).expect(201)).body.data;
    await A.del(`/api/v1/requirements/${requirement.id}`).expect(200);
    expect((await prisma.propertyClient.findUnique({ where: { id: requirementLink.id } }))?.status).toBe('UNLINKED');
    expect((await prisma.deal.findUnique({ where: { id: requirementDeal.id } }))?.deletedAt).not.toBeNull();
  });
  it('runs a deal through the pipeline with commission', async () => {
    const seller = await prisma.client.findFirstOrThrow({ where: { phone: '9845012999' } });
    await A.post(`/api/v1/clients/${seller.id}/offerings`, { propertyId: propA.id, offerings: [{ type: 'SELL_OFFERING', amount: 14500000 }] }).expect(200);
    const d = (await A.post('/api/v1/deals', { clientId: clientA.id, requirementId: reqs[0].id, propertyId: propA.id, dealValue: 15000000, commissionPercent: 1 }).expect(201)).body.data;
    expect(d.expectedCommission).toBe(150000); expect(d.requirementId).toBe(reqs[0].id); expect(d.offeringRequirementId).toBeTruthy();
    for (const s of ['CONTACTED', 'INTERESTED', 'SITE_VISIT_SCHEDULED', 'NEGOTIATION']) await A.post(`/api/v1/deals/${d.id}/stage`, { stage: s }).expect(200);
    await A.post(`/api/v1/deals/${d.id}/stage`, { stage: 'CLOSED' }).expect(422);
    const closed = (await A.post(`/api/v1/deals/${d.id}/stage`, { stage: 'CLOSED', closingDate: '2026-01-15' }).expect(200)).body.data;
    expect(closed.finalCommission).toBe(150000);
    const full = (await A.get(`/api/v1/deals/${d.id}`).expect(200)).body.data;
    expect(full.history.length).toBe(6);
    expect(full.timeline.some((t: any) => t.action === 'DEAL_CLOSED')).toBe(true);
  });
  it('closes a Buy deal atomically, inactivates only its property, and excludes an offering client from own matches', async () => {
    const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: 'Lifecycle Locality' }).expect(201)).body.data;
    const offerer = (await A.post('/api/v1/clients', { name: 'Lifecycle Offerer', phone: '9920012370', location: 'Lifecycle Locality' }).expect(201)).body.data;
    await A.post(`/api/v1/clients/${offerer.id}/offerings`, { propertyId: property.id, offerings: [{ type: 'SELL_OFFERING', amount: 12000000 }] }).expect(200);
    await A.post(`/api/v1/clients/${offerer.id}/offerings`, { propertyId: property.id, offerings: [{ type: 'RENT_OFFERING', amount: 50000, deposit: 100000 }] }).expect(200);
    const unrelatedRentOffering = await prisma.requirement.findFirstOrThrow({ where: { clientId: offerer.id, type: 'RENT_OFFERING' } });
    const ownLooking = (await A.post('/api/v1/requirements', RES(offerer.id, { location: 'Lifecycle Locality', locations: ['Lifecycle Locality'], amount: 15000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    expect((await A.get(`/api/v1/requirements/${ownLooking.id}/matches`).expect(200)).body.data.some((match: any) => match.property.id === property.id)).toBe(false);

    const buyerOne = (await A.post('/api/v1/clients', { name: 'Lifecycle Buyer One', phone: '9920012371', location: 'Lifecycle Locality' }).expect(201)).body.data;
    const buyerTwo = (await A.post('/api/v1/clients', { name: 'Lifecycle Buyer Two', phone: '9920012372', location: 'Lifecycle Locality' }).expect(201)).body.data;
    const reqOne = (await A.post('/api/v1/requirements', RES(buyerOne.id, { location: 'Lifecycle Locality', locations: ['Lifecycle Locality'], amount: 15000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    const reqTwo = (await A.post('/api/v1/requirements', RES(buyerTwo.id, { location: 'Lifecycle Locality', locations: ['Lifecycle Locality'], amount: 15000000, dimLength: null, dimWidth: null })).expect(201)).body.data;
    expect((await A.get(`/api/v1/requirements/${reqOne.id}/matches`).expect(200)).body.data.some((match: any) => match.property.id === property.id)).toBe(true);
    const leadOne = (await A.post('/api/v1/property-client-links', { clientId: buyerOne.id, requirementId: reqOne.id, propertyId: property.id }).expect(201)).body.data;
    const leadTwo = (await A.post('/api/v1/property-client-links', { clientId: buyerTwo.id, requirementId: reqTwo.id, propertyId: property.id }).expect(201)).body.data;
    const winner = (await A.post('/api/v1/deals', { clientId: buyerOne.id, requirementId: reqOne.id, propertyId: property.id, dealValue: 12000000 }).expect(201)).body.data;
    const competitor = (await A.post('/api/v1/deals', { clientId: buyerTwo.id, requirementId: reqTwo.id, propertyId: property.id, dealValue: 12000000 }).expect(201)).body.data;
    const preview = (await A.post(`/api/v1/deals/${winner.id}/close-preview`, {}).expect(200)).body.data;
    expect(preview.competingDeals.map((deal: any) => deal.id)).toContain(competitor.id);
    await A.post(`/api/v1/deals/${winner.id}/stage`, { stage: 'CLOSED', closingDate: '2026-02-01' }).expect(409);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: winner.id } })).stage).toBe('NEW');
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: competitor.id } })).stage).toBe('NEW');
    expect((await prisma.requirement.findUniqueOrThrow({ where: { id: winner.offeringRequirementId } })).status).toBe('ACTIVE');
    await A.post(`/api/v1/deals/${winner.id}/stage`, { stage: 'CLOSED', closingDate: '2026-02-01', confirmCompetingDeals: true, deactivateProperty: true }).expect(200);
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: winner.id } })).stage).toBe('CLOSED');
    expect((await prisma.deal.findUniqueOrThrow({ where: { id: competitor.id } })).stage).toBe('LOST');
    expect((await prisma.requirement.findUniqueOrThrow({ where: { id: winner.offeringRequirementId } })).status).toBe('FULFILLED');
    expect((await prisma.requirement.findUniqueOrThrow({ where: { id: unrelatedRentOffering.id } })).status).toBe('ACTIVE');
    expect((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).status).toBe('INACTIVE');
    expect((await A.get('/api/v1/properties?scope=mine&pageSize=100').expect(200)).body.data.some((item: any) => item.id === property.id)).toBe(false);
    expect((await A.get('/api/v1/properties?scope=inactive&pageSize=100').expect(200)).body.data.some((item: any) => item.id === property.id)).toBe(true);
    expect((await A.get(`/api/v1/requirements/${reqTwo.id}/matches`).expect(200)).body.data.some((match: any) => match.property.id === property.id)).toBe(false);
    expect((await prisma.propertyClient.findUniqueOrThrow({ where: { id: leadOne.id } })).status).toBe('ACTIVE');
    expect((await prisma.propertyClient.findUniqueOrThrow({ where: { id: leadTwo.id } })).status).toBe('ACTIVE');
  });
  it('applies competing-deal closure and audit history to Rent and Lease without deactivation', async () => {
    for (const [index, spec] of [
      { looking: 'RENT_LOOKING', offering: 'RENT_OFFERING', amount: 50000, deposit: 200000, months: 12 },
      { looking: 'LEASE_LOOKING', offering: 'LEASE_OFFERING', amount: 7000000, deposit: 500000, months: 36 },
    ].entries()) {
      const property = (await A.post('/api/v1/properties', { category: 'RESIDENTIAL', subtype: 'Apartment', location: `Closure Locality ${index}` }).expect(201)).body.data;
      const seller = (await A.post('/api/v1/clients', { name: `Closure Seller ${index}`, phone: `99200123${80 + index}`, location: `Closure Locality ${index}` }).expect(201)).body.data;
      await A.post(`/api/v1/clients/${seller.id}/offerings`, { propertyId: property.id, offerings: [{ type: spec.offering, amount: spec.amount, deposit: spec.deposit, availableDate: '2030-01-01', leasePeriodMonths: spec.months }] }).expect(200);
      const buyers = await Promise.all([0, 1].map(async (buyerIndex) => (await A.post('/api/v1/clients', { name: `Closure Buyer ${index}-${buyerIndex}`, phone: `99200124${index}${buyerIndex}`, location: `Closure Locality ${index}` }).expect(201)).body.data));
      const requirements = await Promise.all(buyers.map(async (buyer) => (await A.post('/api/v1/requirements', RES(buyer.id, { type: spec.looking, location: `Closure Locality ${index}`, locations: [`Closure Locality ${index}`], amount: spec.amount, leasePeriodMonths: spec.months, dimLength: null, dimWidth: null })).expect(201)).body.data));
      await Promise.all(requirements.map((requirement, requirementIndex) => A.post('/api/v1/property-client-links', { clientId: buyers[requirementIndex].id, requirementId: requirement.id, propertyId: property.id }).expect(201)));
      const deals = await Promise.all(requirements.map((requirement, requirementIndex) => A.post('/api/v1/deals', { clientId: buyers[requirementIndex].id, requirementId: requirement.id, propertyId: property.id, dealValue: spec.amount }).expect(201)));
      await A.post(`/api/v1/deals/${deals[0].body.data.id}/stage`, { stage: 'CLOSED', closingDate: '2026-02-01', confirmCompetingDeals: true, deactivateProperty: false }).expect(200);
      expect((await prisma.property.findUniqueOrThrow({ where: { id: property.id } })).status).toBe('ACTIVE');
      expect((await prisma.requirement.findUniqueOrThrow({ where: { id: deals[0].body.data.offeringRequirementId } })).status).toBe('FULFILLED');
      const lost = await prisma.deal.findUniqueOrThrow({ where: { id: deals[1].body.data.id }, include: { history: true } });
      expect(lost.stage).toBe('LOST');
      expect(lost.history.some((entry) => entry.note === 'Automatically marked LOST because another deal for this property was successfully closed as WON.')).toBe(true);
    }
  });
});

describe('Follow-ups & notifications', () => {
  it('reschedules and moves notification timing', async () => {
    const at = new Date(Date.now() + 2 * 3600e3);
    const fu = (await A.post('/api/v1/follow-ups', { clientId: clientA.id, requirementId: reqs[1].id, type: 'CALL', scheduledAt: at, reminderMinutes: 30 }).expect(201)).body.data;
    expect(fu.requirementId).toBe(reqs[1].id);
    const to = new Date(Date.now() + 26 * 3600e3);
    await A.post(`/api/v1/follow-ups/${fu.id}/reschedule`, { scheduledAt: to }).expect(200);
    const pend = await prisma.notification.findMany({ where: { followUpId: fu.id, status: 'PENDING' } });
    expect(pend.map((n) => n.scheduledFor.getTime()).sort()).toEqual([to.getTime() - 30 * 60e3, to.getTime()]);
    await prisma.notification.updateMany({ where: { followUpId: fu.id, status: 'PENDING', type: 'UPCOMING_FOLLOW_UP' }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await runSchedulerTick();
    const inbox = (await A.get('/api/v1/notifications').expect(200)).body.data;
    expect(inbox.some((n: any) => n.followUpId === fu.id && n.type === 'UPCOMING_FOLLOW_UP')).toBe(true);
    await A.post(`/api/v1/follow-ups/${fu.id}/complete`, { outcome: 'done' }).expect(200);
    expect(await prisma.notification.count({ where: { followUpId: fu.id, status: 'PENDING' } })).toBe(0);
  });
});

describe('Sharing', () => {
  it('shares in-app with a registered PC (view only) and falls back to WhatsApp', async () => {
    const r = (await A.post('/api/v1/property-shares', { propertyId: propA.id, targetType: 'PC', phone: userB.phone }).expect(201)).body.data;
    expect(r.registered).toBe(true); expect(r.share.permission).toBe('VIEW_ONLY');
    const duplicate = (await A.post('/api/v1/property-shares', { propertyId: propA.id, targetType: 'PC', phone: userB.phone }).expect(201)).body.data;
    expect(duplicate.share.id).toBe(r.share.id);
    const seen = (await B.get(`/api/v1/properties/${propA.id}`).expect(200)).body.data;
    expect(seen.access).toBe('VIEW_ONLY'); expect(seen.isShared).toBe(true);
    expect(seen.shares[0].sender.name).toBeTruthy(); expect(seen.shares[0].client).toBeUndefined();
    const clientShare = (await A.post('/api/v1/property-shares', { propertyId: propA.id, targetType: 'CLIENT', phone: clientA.phone }).expect(201)).body.data;
    expect(clientShare.share.clientId).toBe(clientA.id);
    const ownerView = (await A.get(`/api/v1/properties/${propA.id}`).expect(200)).body.data;
    expect(ownerView.shares.find((share: any) => share.targetType === 'CLIENT').client.name).toBe(clientA.name);
    expect(ownerView.shares.find((share: any) => share.targetType === 'PC').receiver.name).toBe(userB.name);
    await B.patch(`/api/v1/properties/${propA.id}`, { location: 'Hacked' }).expect(403);
    const un = (await A.post('/api/v1/property-shares', { propertyId: propA.id, targetType: 'CLIENT', phone: '9811111111' }).expect(201)).body.data;
    expect(un.registered).toBe(false); expect(un.message).toBe('Number not registered.'); expect(un.whatsappUrl).toContain('wa.me/919811111111');
    const list = (await A.get('/api/v1/properties').expect(200)).body.data;
    expect(list.find((p: any) => p.id === propA.id).isShared).toBe(true);
  });
});

describe('Tenant isolation & admin', () => {
  it('PC A cannot access PC B data (403); super admin can', async () => {
    clientB = (await B.post('/api/v1/clients', { name: 'Client B', phone: '9822222222', location: 'Hebbal' }).expect(201)).body.data;
    const reqB = (await B.post('/api/v1/requirements', RES(clientB.id)).expect(201)).body.data;
    const propB = (await B.post('/api/v1/properties', PROP).expect(201)).body.data;
    await A.get(`/api/v1/clients/${clientB.id}`).expect(403);
    await A.get(`/api/v1/requirements/${reqB.id}`).expect(403);
    await A.patch(`/api/v1/requirements/${reqB.id}`, { amount: 1 }).expect(403);
    await A.get(`/api/v1/properties/${propB.id}`).expect(403);
    await A.get(`/api/v1/requirements/${reqB.id}/matches`).expect(403);
    expect((await A.get('/api/v1/clients').expect(200)).body.data.some((c: any) => c.id === clientB.id)).toBe(false);
    await ADMIN.get(`/api/v1/admin/clients/${clientB.id}`).expect(200);
    await A.get('/api/v1/admin/dashboard').expect(401);
  });
  it('enforces admin RBAC and audits', async () => {
    const ro = await api().post('/api/v1/admin/auth/login').send({ email: 'ro@test.local', password: 'RootPass123!' }).expect(200);
    const RO = as(ro.body.data.token);
    await RO.get('/api/v1/admin/pcs').expect(200);
    await RO.post(`/api/v1/admin/pcs/${userB.id}/status`, { status: 'SUSPENDED', reason: 'x', confirm: true }).expect(403);
    await api().post('/api/v1/admin/auth/login').send({ email: 'root@test.local', password: 'wrong' }).expect(401);
    expect(await prisma.adminLoginAttempt.count({ where: { success: false } })).toBeGreaterThan(0);
    await expect(prisma.adminAuditLog.deleteMany({})).rejects.toThrow();
  });
  it('suspends and reactivates a PC', async () => {
    await ADMIN.post(`/api/v1/admin/pcs/${userB.id}/status`, { status: 'SUSPENDED', reason: 'KYC pending', confirm: true }).expect(200);
    await B.get('/api/v1/auth/me').expect(401);
    await api().post('/api/v1/auth/send-otp').send({ phone: userB.phone }).expect(403);
    await ADMIN.post(`/api/v1/admin/pcs/${userB.id}/status`, { status: 'ACTIVE', confirm: true }).expect(200);
    await pcLogin(userB.phone);
    const audit = (await ADMIN.get('/api/v1/admin/activity?kind=audit').expect(200)).body.data.map((a: any) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['PC_SUSPENDED', 'PC_ACTIVATED', 'ADMIN_LOGIN']));
  });
  it('admin edits requirement in isolation, purges with confirmation and exports CSV without secrets', async () => {
    await ADMIN.patch(`/api/v1/admin/requirements/${reqs[1].id}`, { amount: 47000 }).expect(200);
    expect((await A.get(`/api/v1/requirements/${reqs[0].id}`)).body.data.amount).toBe(15000000);
    await A.del(`/api/v1/clients/${clientA.id}`).expect(200);
    const bin = (await ADMIN.get('/api/v1/admin/bin').expect(200)).body.data.find((b: any) => b.entityType === 'CLIENT');
    await ADMIN.post(`/api/v1/admin/bin/${bin.id}/purge`, { confirmText: 'delete' }).expect(422);
    await ADMIN.post(`/api/v1/admin/bin/${bin.id}/restore`).expect(200);
    const csv = await ADMIN.get('/api/v1/admin/export/pcs').expect(200);
    expect(csv.text).toContain('pcCode'); expect(csv.text).not.toMatch(/password|otp|secret/i);
    await api().get('/api/v1/health').expect(200);
  });
});
