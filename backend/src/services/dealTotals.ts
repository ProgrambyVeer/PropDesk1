export interface PipelineDeal { propertyId: string; stage: string; dealValue?: number | null; expectedCommission?: number | null }

const OPEN_EXCLUDED = new Set(['CLOSED', 'LOST']);
const average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const numeric = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));

// A property with several interested buyers produces several deal rows. For pipeline metrics each property
// counts once: its value and its commission estimate are the average over the property's open deals (deals
// without a value/commission are ignored rather than pulling the average to zero).
export function potentialPipelineTotals(deals: PipelineDeal[]) {
  const byProperty = new Map<string, PipelineDeal[]>();
  for (const deal of deals) {
    if (OPEN_EXCLUDED.has(deal.stage)) continue;
    byProperty.set(deal.propertyId, [...(byProperty.get(deal.propertyId) ?? []), deal]);
  }
  let potentialDealValue = 0;
  let potentialCommission = 0;
  for (const group of byProperty.values()) {
    potentialDealValue += average(numeric(group.map((d) => d.dealValue)));
    potentialCommission += average(numeric(group.map((d) => d.expectedCommission)));
  }
  return { potentialDealValue: Math.round(potentialDealValue), potentialCommission: Math.round(potentialCommission), properties: byProperty.size };
}

// Same per-property rule applied to the deals of a single pipeline stage.
export const stageDealValue = (deals: PipelineDeal[], stage: string) => potentialPipelineTotals(deals.filter((d) => d.stage === stage)).potentialDealValue;
