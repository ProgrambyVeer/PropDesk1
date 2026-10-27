import { describe, expect, it } from 'vitest';
import { potentialPipelineTotals, stageDealValue } from '../src/services/dealTotals';

const CRORE = 10_000_000;
const deal = (propertyId: string, stage: string, dealValue: number | null, expectedCommission: number | null) => ({ propertyId, stage, dealValue, expectedCommission });

describe('potentialPipelineTotals', () => {
  it('counts one property with one interested buyer once', () => {
    expect(potentialPipelineTotals([deal('p1', 'INTERESTED', CRORE, 100_000)])).toMatchObject({ potentialDealValue: CRORE, potentialCommission: 100_000, properties: 1 });
  });

  it('does not multiply value or commission by the number of interested buyers', () => {
    const t = potentialPipelineTotals([deal('p1', 'NEW', CRORE, 100_000), deal('p1', 'CONTACTED', CRORE, 100_000), deal('p1', 'NEGOTIATION', CRORE, 100_000)]);
    expect(t).toMatchObject({ potentialDealValue: CRORE, potentialCommission: 100_000, properties: 1 });
  });

  it('counts each distinct property once regardless of buyer counts', () => {
    const t = potentialPipelineTotals([
      deal('p1', 'NEW', CRORE, 100_000), deal('p1', 'NEW', CRORE, 100_000), deal('p1', 'NEW', CRORE, 100_000),
      deal('p2', 'NEW', 2 * CRORE, 200_000), deal('p2', 'INTERESTED', 2 * CRORE, 200_000),
      deal('p3', 'NEW', 5 * CRORE, 500_000),
    ]);
    expect(t).toMatchObject({ potentialDealValue: 8 * CRORE, potentialCommission: 800_000, properties: 3 });
  });

  it('averages different commission estimates for one property instead of summing them', () => {
    const t = potentialPipelineTotals([deal('p1', 'NEW', CRORE, 90_000), deal('p1', 'NEW', CRORE, 120_000), deal('p1', 'NEW', CRORE, 150_000), deal('p2', 'NEW', CRORE, 60_000)]);
    expect(t.potentialCommission).toBe(120_000 + 60_000);
    expect(t.potentialDealValue).toBe(2 * CRORE);
  });

  it('ignores missing commission/value instead of averaging them as zero', () => {
    const t = potentialPipelineTotals([deal('p1', 'NEW', CRORE, 100_000), deal('p1', 'NEW', null, null)]);
    expect(t).toMatchObject({ potentialDealValue: CRORE, potentialCommission: 100_000 });
  });

  it('excludes closed and lost deals from the potential pipeline', () => {
    const t = potentialPipelineTotals([deal('p1', 'CLOSED', CRORE, 100_000), deal('p2', 'LOST', CRORE, 100_000), deal('p3', 'NEGOTIATION', 3 * CRORE, 300_000), deal('p3', 'CLOSED', 3 * CRORE, 300_000)]);
    expect(t).toMatchObject({ potentialDealValue: 3 * CRORE, potentialCommission: 300_000, properties: 1 });
  });

  it('returns zeros when there are no open deals', () => {
    expect(potentialPipelineTotals([])).toEqual({ potentialDealValue: 0, potentialCommission: 0, properties: 0 });
    expect(potentialPipelineTotals([deal('p1', 'CLOSED', CRORE, 1)]).potentialDealValue).toBe(0);
  });

  it('collapses duplicate property references from joined aggregation rows', () => {
    const row = deal('p1', 'NEW', CRORE, 100_000);
    expect(potentialPipelineTotals([row, { ...row }, { ...row }, { ...row }])).toMatchObject({ potentialDealValue: CRORE, potentialCommission: 100_000, properties: 1 });
  });

  it('does not mutate its input', () => {
    const rows = [deal('p1', 'NEW', CRORE, 100_000), deal('p1', 'CLOSED', CRORE, 100_000)];
    const copy = JSON.parse(JSON.stringify(rows));
    potentialPipelineTotals(rows);
    expect(rows).toEqual(copy);
  });
});

describe('stageDealValue', () => {
  it('counts a property once within a stage', () => {
    const rows = [deal('p1', 'NEW', CRORE, 1), deal('p1', 'NEW', CRORE, 1), deal('p2', 'NEW', CRORE, 1), deal('p1', 'INTERESTED', CRORE, 1)];
    expect(stageDealValue(rows, 'NEW')).toBe(2 * CRORE);
    expect(stageDealValue(rows, 'INTERESTED')).toBe(CRORE);
  });
});
