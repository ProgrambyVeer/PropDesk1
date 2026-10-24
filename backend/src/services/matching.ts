import type { Property, PropertyTransaction, Requirement, RequirementType, TransactionKind } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { canonicalSubtype } from './validation';

export const TX_FOR: Record<RequirementType, TransactionKind> = {
  BUY_LOOKING: 'SALE', SELL_OFFERING: 'SALE', RENT_LOOKING: 'RENT', RENT_OFFERING: 'RENT', LEASE_LOOKING: 'LEASE', LEASE_OFFERING: 'LEASE',
};
const OFFERING_FOR: Partial<Record<RequirementType, RequirementType>> = {
  BUY_LOOKING: 'SELL_OFFERING', RENT_LOOKING: 'RENT_OFFERING', LEASE_LOOKING: 'LEASE_OFFERING',
};
export const isLooking = (t: RequirementType) => t.endsWith('_LOOKING');
export const txPrice = (t: PropertyTransaction) => (t.kind === 'SALE' ? t.salePrice : t.kind === 'RENT' ? t.rentAmount : t.leaseAmount);

type LinkedOffer = Pick<Requirement, 'id' | 'code' | 'type' | 'amount' | 'deposit' | 'availableDate' | 'leasePeriodMonths' | 'status' | 'deletedAt'>;
type P = Property & { transactions: PropertyTransaction[]; linkedOffers?: LinkedOffer[] };
export interface MatchReason { factor: string; matched: boolean; partial?: boolean; detail: string }
export interface MatchResult { score: number; reasons: MatchReason[]; matchedOffer?: LinkedOffer }

export function interestedClientCounts(
  associations: { propertyId: string; clientId: string; type: RequirementType }[],
) {
  const clientsByProperty = new Map<string, Set<string>>();
  for (const association of associations) {
    if (!isLooking(association.type)) continue;
    const clients = clientsByProperty.get(association.propertyId) || new Set<string>();
    clients.add(association.clientId);
    clientsByProperty.set(association.propertyId, clients);
  }
  return new Map([...clientsByProperty].map(([propertyId, clients]) => [propertyId, clients.size]));
}

const near = (a: number, b: number, pct: number) => Math.abs(a - b) <= b * pct;
const norm = (s?: string | null) => (s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const normLocation = (s?: string | null) => {
  const value = norm(s);
  return value === 'banshankari' ? 'banashankari' : value;
};
const parseFacings = (s?: string | string[] | null) => {
  if (Array.isArray(s)) return s.map((x) => norm(x)).filter(Boolean);
  if (typeof s === 'string') return s.split(',').map((x) => norm(x)).filter(Boolean);
  return [];
};

export function scoreMatch(req: Requirement, prop: P): MatchResult | null {
  if (req.category !== prop.category) return null;
  const offerType = OFFERING_FOR[req.type];
  const linkedOffer = prop.linkedOffers?.find((offer) => {
    const isCounterOffer = offerType && offer.type === offerType;
    const isSelectedOffering = !isLooking(req.type) && offer.id === req.id && offer.type === req.type;
    return (isCounterOffer || isSelectedOffering) && offer.status === 'ACTIVE' && !offer.deletedAt && offer.amount != null;
  });
  const tx = isLooking(req.type) ? undefined : prop.transactions.find((t) => t.kind === TX_FOR[req.type] && t.status === 'ACTIVE' && txPrice(t) != null);
  if (!tx && !linkedOffer) return null;
  if (req.subCategory && norm(req.subCategory) !== norm(prop.subCategory)) return null;
  const locations = req.locations?.length ? req.locations : [req.location];
  const normalizedLocations = locations.map(normLocation).filter(Boolean);
  const ploc = normLocation(prop.location);
  const price = tx ? txPrice(tx) : linkedOffer?.amount;
  const conversion = req.dimUnit === prop.dimUnit ? 1 : req.dimUnit === 'METERS' ? 3.28084 : 1 / 3.28084;
  const reqFacings = parseFacings(req.facing);
  const propFacings = parseFacings(prop.facing);
  let earned = 0; let possible = 0;
  const reasons: MatchReason[] = [];
  const add = (factor: string, weight: number, fraction: number, detail: string) => {
    possible += weight; earned += weight * fraction;
    reasons.push({ factor, matched: fraction === 1, partial: fraction > 0 && fraction < 1, detail });
  };
  add('Category', 12, 1, `${prop.category} matched`);
  if (req.subCategory) add('Commercial type', 3, 1, `${prop.subCategory} matched`);
  if (req.subtype) {
    const subtypeMatched = canonicalSubtype(req.category, req.subtype) === canonicalSubtype(prop.category, prop.subtype);
    add('Subtype', req.subCategory ? 5 : 8, subtypeMatched ? 1 : 0, subtypeMatched ? `${prop.subtype} matched` : `Requested ${req.subtype}; property is ${prop.subtype}`);
  }
  if (normalizedLocations.length && ploc) {
    const locationMatched = normalizedLocations.includes(ploc);
    add('Location', 30, locationMatched ? 1 : 0, locationMatched ? `${prop.location} matched` : `Requested ${locations.filter(Boolean).join(', ')}; property is ${prop.location}`);
  }
  if (req.amount != null) {
    const min = req.amountMin ?? (isLooking(req.type) ? 0 : req.amount * 0.9);
    const max = isLooking(req.type) ? req.amount : req.amountMin ?? req.amount * 1.1;
    const withinBudget = price != null && price >= min && price <= max;
    add('Budget', 25, withinBudget ? 1 : 0, price == null ? 'Property price not listed' : withinBudget ? (isLooking(req.type) ? `Within budget (${price.toLocaleString('en-IN')})` : `Price overlaps offer range (${price.toLocaleString('en-IN')})`) : `Outside budget (${price.toLocaleString('en-IN')})`);
  }
  if (reqFacings.length) {
    const overlap = propFacings.some((facing) => reqFacings.includes(facing));
    add('Facing', 10, overlap ? 1 : 0, !propFacings.length ? 'Property facing not listed' : overlap ? `Facing matched (${prop.facing})` : `Facing differs (${prop.facing})`);
  }
  const areaChecks: { fraction: number; detail: string }[] = [];
  if (req.area) areaChecks.push({ fraction: prop.area ? (near(prop.area, req.area, 0.2) ? 1 : near(prop.area, req.area, 0.35) ? 0.5 : 0) : 0, detail: prop.area ? `${prop.area} sqft` : 'Property area not listed' });
  if (req.dimLength || req.dimWidth) {
    const checks: boolean[] = [];
    if (req.dimLength) checks.push(prop.dimLength != null && near(prop.dimLength, req.dimLength * conversion, 0.15));
    if (req.dimWidth) checks.push(prop.dimWidth != null && near(prop.dimWidth, req.dimWidth * conversion, 0.15));
    areaChecks.push({ fraction: checks.filter(Boolean).length / checks.length, detail: prop.dimLength && prop.dimWidth ? `${prop.dimLength} × ${prop.dimWidth} ${prop.dimUnit.toLowerCase()}` : 'Property dimensions incomplete' });
  }
  if (areaChecks.length) add('Area / dimensions', 10, areaChecks.reduce((sum, check) => sum + check.fraction, 0) / areaChecks.length, areaChecks.map((check) => check.detail).join(' · '));
  const otherChecks: { fraction: number; detail: string }[] = [];
  if (req.bhk) otherChecks.push({ fraction: prop.bhk ? (req.bhk === prop.bhk ? 1 : Math.abs(req.bhk - prop.bhk) === 1 ? 0.5 : 0) : 0, detail: prop.bhk ? `${prop.bhk} BHK` : 'BHK not listed' });
  if (req.bathrooms) otherChecks.push({ fraction: prop.bathrooms ? (req.bathrooms === prop.bathrooms ? 1 : 0) : 0, detail: prop.bathrooms ? `${prop.bathrooms} bathrooms` : 'Bathrooms not listed' });
  if (req.furnishing) otherChecks.push({ fraction: norm(req.furnishing) === norm(prop.furnishing) ? 1 : 0, detail: prop.furnishing ? `Furnishing: ${prop.furnishing}` : 'Furnishing not listed' });
  if (req.parking) otherChecks.push({ fraction: norm(req.parking) === norm(prop.parking) ? 1 : 0, detail: prop.parking ? `Parking: ${prop.parking}` : 'Parking not listed' });
  if (req.propertyAge) otherChecks.push({ fraction: norm(req.propertyAge) === norm(prop.propertyAge) ? 1 : 0, detail: prop.propertyAge ? `Age: ${prop.propertyAge}` : 'Property age not listed' });
  if (req.amenities.length) {
    const propertyAmenities = new Set(prop.amenities.map((amenity) => norm(amenity)));
    const matchingAmenities = req.amenities.filter((amenity) => propertyAmenities.has(norm(amenity)));
    otherChecks.push({ fraction: matchingAmenities.length / req.amenities.length, detail: matchingAmenities.length ? `Amenities matched: ${matchingAmenities.join(', ')}` : 'Requested amenities are not listed' });
  }
  if (req.availableDate) {
    const availableDate = tx?.availableDate ?? linkedOffer?.availableDate;
    const timely = !!availableDate && availableDate.getTime() <= req.availableDate.getTime() + 15 * 86400e3;
    otherChecks.push({ fraction: timely ? 1 : 0, detail: availableDate ? `Available ${availableDate.toISOString().slice(0, 10)}` : 'Availability date not listed' });
  }
  if (otherChecks.length) add('Other criteria', 5, otherChecks.reduce((sum, check) => sum + check.fraction, 0) / otherChecks.length, otherChecks.map((check) => check.detail).join(' · '));
  return { score: Math.round((earned / possible) * 100), reasons, ...(linkedOffer ? { matchedOffer: linkedOffer } : {}) };
}

export const matchInclude = { transactions: true, photos: { orderBy: { position: 'asc' as const }, take: 1 } };

export async function matchesForRequirement(req: Requirement, minScore?: number) {
  if (req.status !== 'ACTIVE' || req.deletedAt) return [];
  if (!isLooking(req.type)) {
    const offeringProperties = await prisma.propertyClient.findMany({
      where: { requirementId: req.id, status: 'ACTIVE', property: { deletedAt: null, status: 'ACTIVE' } },
      select: { propertyId: true },
    });
    const offeringPropertyIds = new Set(offeringProperties.map((link) => link.propertyId));
    return (await allMatchesForOwner(req.ownerId, minScore))
      .filter((match) => offeringPropertyIds.has(match.property.id) && match.matchedOffer?.id === req.id)
      .map((match) => ({ ...match, matchedRequirement: match.requirement, matchedClient: match.requirement.client }));
  }
  const props = await prisma.property.findMany({
    where: {
      deletedAt: null, status: 'ACTIVE', category: req.category,
      links: { none: { clientId: req.clientId, status: 'ACTIVE', requirement: { type: { in: ['SELL_OFFERING', 'RENT_OFFERING', 'LEASE_OFFERING'] }, status: 'ACTIVE', deletedAt: null } } },
      OR: [{ ownerId: req.ownerId }, { shares: { some: { senderId: { not: req.ownerId }, receiverId: req.ownerId, status: { not: 'REVOKED' } } } }],
    },
    include: { ...matchInclude, shares: { select: { id: true }, take: 1 } },
  });
  const expectedOffer = OFFERING_FOR[req.type];
  const linkedOffers = expectedOffer || !isLooking(req.type) ? await prisma.propertyClient.findMany({
    where: { ownerId: req.ownerId, status: 'ACTIVE', propertyId: { in: props.map((property) => property.id) }, requirement: { ownerId: req.ownerId, status: 'ACTIVE', deletedAt: null, client: { deletedAt: null }, OR: [...(expectedOffer ? [{ type: expectedOffer }] : []), ...(!isLooking(req.type) ? [{ id: req.id, type: req.type }] : [])] } },
    select: { propertyId: true, clientId: true, requirement: { select: { id: true, code: true, type: true, amount: true, deposit: true, availableDate: true, leasePeriodMonths: true, status: true, deletedAt: true } } },
  }) : [];
  const offersByProperty = new Map<string, { clientId: string; requirement: LinkedOffer }[]>();
  for (const link of linkedOffers) offersByProperty.set(link.propertyId, [...(offersByProperty.get(link.propertyId) || []), { clientId: link.clientId, requirement: link.requirement }]);
  const links = await prisma.propertyClient.findMany({ where: { requirementId: req.id, status: 'ACTIVE' }, select: { propertyId: true, id: true } });
  const linked = new Map(links.map((l) => [l.propertyId, l.id]));
  const openDeals = await prisma.deal.findMany({ where: { requirementId: req.id, deletedAt: null, stage: { notIn: ['CLOSED', 'LOST'] } }, select: { id: true, code: true, stage: true, propertyId: true }, orderBy: { createdAt: 'asc' } });
  const dealByProperty = new Map(openDeals.map((d) => [d.propertyId, { id: d.id, code: d.code, stage: d.stage }]));
  return props
    .map((p) => {
      const linkedOffers = offersByProperty.get(p.id) || [];
      const match = scoreMatch(req, { ...p, linkedOffers: linkedOffers.map((offer) => offer.requirement) });
      return { property: p, match };
    })
    .filter((x): x is { property: typeof props[number]; match: MatchResult } => !!x.match && (minScore == null || x.match.score >= minScore))
    .sort((a, b) => b.match.score - a.match.score)
    .map(({ property, match }) => ({ ...match, property, linked: linked.has(property.id), linkId: linked.get(property.id) || null, deal: dealByProperty.get(property.id) || null }));
}

// All requirement-property match pairs for an owner (used by dashboard / analytics).
export async function allMatchesForOwner(ownerId: string, minScore?: number) {
  const [reqs, props] = await Promise.all([
    prisma.requirement.findMany({ where: { ownerId, deletedAt: null, status: 'ACTIVE', client: { deletedAt: null } }, include: { client: { select: { id: true, name: true, code: true, phone: true, location: true } } } }),
    prisma.property.findMany({ where: { deletedAt: null, status: 'ACTIVE', OR: [{ ownerId }, { shares: { some: { senderId: { not: ownerId }, receiverId: ownerId, status: { not: 'REVOKED' } } } }] }, include: matchInclude }),
  ]);
  const linkedOffers = await prisma.propertyClient.findMany({
    where: { ownerId, status: 'ACTIVE', propertyId: { in: props.map((property) => property.id) }, requirement: { ownerId, type: { in: ['SELL_OFFERING', 'RENT_OFFERING', 'LEASE_OFFERING'] }, status: 'ACTIVE', deletedAt: null, client: { deletedAt: null } } },
    select: { propertyId: true, clientId: true, requirement: { select: { id: true, code: true, type: true, amount: true, deposit: true, availableDate: true, leasePeriodMonths: true, status: true, deletedAt: true } } },
  });
  const offersByProperty = new Map<string, { clientId: string; requirement: LinkedOffer }[]>();
  for (const link of linkedOffers) offersByProperty.set(link.propertyId, [...(offersByProperty.get(link.propertyId) || []), { clientId: link.clientId, requirement: link.requirement }]);
  const out: (MatchResult & { requirement: typeof reqs[number]; property: typeof props[number] })[] = [];
  for (const r of reqs) for (const p of props) {
    const linkedOffers = offersByProperty.get(p.id) || [];
    if (linkedOffers.some((offer) => offer.clientId === r.clientId)) continue;
    const m = scoreMatch(r, { ...p, linkedOffers: linkedOffers.map((offer) => offer.requirement) });
    if (m && (minScore == null || m.score >= minScore)) out.push({ ...m, requirement: r, property: p });
  }
  return out.sort((a, b) => b.score - a.score);
}
