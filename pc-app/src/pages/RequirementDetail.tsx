import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Minus, Pencil, Trash2, X } from 'lucide-react';
import { del, fileUrl, post } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { AMOUNT_LABEL, dims, human, inr, requirementLabel, txLabel, STAGE_TONE } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorState, KV, ListSkeleton, Mono, Section, Sheet } from '../components/ui';
import { Timeline } from '../components/domain';

export default function RequirementDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: r, loading, error, reload } = useFetch<any>(`/requirements/${id}`);
  const m = useFetch<any[]>(`/requirements/${id}/matches`);
  const act = useFetch<any[]>('/activity-logs', { requirementId: r?.id, pageSize: 30 });
  const [busy, setBusy] = useState<string | null>(null);
  const [dealPreview, setDealPreview] = useState<any>(null);
  useEffect(() => {
    const refreshMatches = () => {
      if (document.visibilityState === 'visible') m.reload();
    };
    window.addEventListener('focus', refreshMatches);
    document.addEventListener('visibilitychange', refreshMatches);
    return () => {
      window.removeEventListener('focus', refreshMatches);
      document.removeEventListener('visibilitychange', refreshMatches);
    };
  }, [m.reload]);
  if (error) return <ErrorState message={error} />;
  if (loading || !r) return <ListSkeleton />;
  const looking = String(r.type).endsWith('_LOOKING');
  const removeLead = async (lead: any) => {
    if (!confirm(`Delete Lead for ${requirementLabel(r.type, r.code)}? Any Deals created from this Lead will be archived. The property and client will remain.`)) return;
    setBusy(lead.propertyId);
    try { await del(`/property-client-links/${lead.id}`); toast.success('Lead deleted'); m.reload(); reload(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const deal = async (propertyId: string) => {
    setBusy(propertyId);
    try { setDealPreview(await post('/deals/preview', { clientId: r.clientId, requirementId: r.id, propertyId })); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const confirmDeal = async () => {
    setBusy(dealPreview.property.id);
    try {
      const d = await post('/deals', { clientId: r.clientId, requirementId: r.id, propertyId: dealPreview.property.id, dealValue: dealPreview.offering.requirement.amount });
      if (d.alreadyExists) { toast.warning(`Deal ${d.code} is already in the pipeline`); setDealPreview(null); m.reload(); reload(); return; }
      toast.success(`Deal ${d.code} created`); nav(`/deals/${d.id}`);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  return (
    <div className="space-y-6" data-testid="requirement-detail">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><Mono className="text-sm" >{requirementLabel(r.type, r.code)}</Mono><h1 className="mt-1 text-2xl font-extrabold tracking-tight" data-testid="requirement-title">{human(r.type)} · {r.bhk ? `${r.bhk} BHK ` : ''}{r.subtype}</h1>
          <p className="text-sm text-slate-500">For <Link to={`/clients/${r.clientId}`} className="font-semibold text-brand">{r.client.name}</Link> · {(r.locations?.length ? r.locations : [r.location]).join(', ')}</p></div>
        <Button variant="secondary" onClick={() => nav(`/requirements/${r.id}/edit`)} data-testid="requirement-edit-btn"><Pencil className="h-4 w-4" />Edit</Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="divide-y divide-slate-100 px-5 py-2 lg:col-span-1">
          <KV k="Category" v={`${human(r.category)}${r.subCategory ? ` · ${r.subCategory}` : ''}`} /><KV k={AMOUNT_LABEL[r.type]} v={`${r.amountMin ? `${inr(r.amountMin)} – ` : ''}${inr(r.amount)}`} />
          {r.deposit != null && <KV k="Deposit" v={inr(r.deposit)} />}{r.leasePeriodMonths && <KV k="Lease Period" v={`${r.leasePeriodMonths} months`} />}
          <KV k="Dimensions" v={dims(r)} /><KV k="Area" v={r.area ? `${r.area} sqft` : '—'} /><KV k="Facing" v={r.facing} /><KV k="Status" v={<Badge tone="green">{human(r.status)}</Badge>} />
        </Card>
        <Section title={`Matches for ${requirementLabel(r.type, r.code)}`} className="lg:col-span-2">
          {m.loading ? <ListSkeleton n={2} /> : !m.data?.length ? <Empty title="No matching properties yet" text="New properties are matched automatically." /> :
            <div className="space-y-3">{m.data.map((x) => {
              const transactionKind = ({ BUY_LOOKING: 'SALE', SELL_OFFERING: 'SALE', RENT_LOOKING: 'RENT', RENT_OFFERING: 'RENT', LEASE_LOOKING: 'LEASE', LEASE_OFFERING: 'LEASE' } as any)[r.type];
              const price = x.property.transactions.find((transaction: any) => transaction.kind === transactionKind);
              const matchPrice = x.matchedOffer?.amount ?? (price ? price.salePrice ?? price.rentAmount ?? price.leaseAmount : null);
              return (
                <Card key={x.property.id} className="flex flex-col gap-3 p-4 sm:flex-row" data-testid={`match-${x.property.code}`}>
                  {looking
                    ? <div className="h-24 w-full shrink-0 overflow-hidden rounded-xl bg-slate-100 sm:w-32">{x.property.photos[0] && <img src={fileUrl(x.property.photos[0].url)} alt="" className="h-full w-full object-cover" />}</div>
                    : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-navy text-lg font-extrabold text-white">{(x.matchedClient?.name || '?').split(' ').map((part: string) => part[0]).slice(0, 2).join('').toUpperCase()}</div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2"><div>{looking ? <><Link to={`/properties/${x.property.id}/manage`} className="font-bold hover:text-brand">{x.property.subtype} · {x.property.location}</Link><p className="text-xs"><Mono>{x.property.code}</Mono>{x.property.transactions.length ? ` · ${x.property.transactions.map(txLabel).join(' | ')}` : x.matchedOffer ? ` · ${x.matchedOffer.type === 'SELL_OFFERING' ? 'Expected sale price' : x.matchedOffer.type === 'RENT_OFFERING' ? 'Rent' : 'Lease'} ${inr(x.matchedOffer.amount)}${x.matchedOffer.type === 'RENT_OFFERING' ? '/mo' : ''}` : ''}</p></> : <><Link to={`/clients/${x.matchedClient.id}`} className="font-bold hover:text-brand">{x.matchedClient.name}</Link><p className="text-xs text-slate-500">{requirementLabel(x.matchedRequirement.type, x.matchedRequirement.code)} · +91 {x.matchedClient.phone}</p><p className="mt-1 text-xs text-slate-500">Prefers {(x.matchedRequirement.locations?.length ? x.matchedRequirement.locations : [x.matchedRequirement.location]).join(', ')} · Budget {inr(x.matchedRequirement.amount)} · {x.matchedRequirement.subtype}{x.matchedRequirement.bhk ? ` · ${x.matchedRequirement.bhk} BHK` : ''}{x.matchedRequirement.area ? ` · ${x.matchedRequirement.area} sqft` : ''}</p>{x.matchedRequirement.amenities?.length > 0 && <p className="mt-1 text-xs text-slate-500">Amenities: {x.matchedRequirement.amenities.join(', ')}</p>}<p className="mt-1 text-xs text-slate-500">Property: <Link to={`/properties/${x.property.id}/manage`} className="font-semibold text-brand">{x.property.code}</Link> · {x.property.subtype}, {x.property.location} · Offer {inr(x.matchedOffer?.amount)}</p></>}</div>
                      <span className={`whitespace-nowrap rounded-xl px-2.5 py-1 text-sm font-extrabold ${x.score >= 80 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`} data-testid={`match-score-${x.property.code}`}>{x.score}% MATCH</span></div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">{x.reasons.map((rs: any) => <span key={rs.factor} title={rs.detail} className={`flex items-center gap-0.5 text-xs font-semibold ${rs.matched ? 'text-emerald-700' : rs.partial ? 'text-amber-600' : 'text-slate-400'}`}>{rs.matched ? <Check className="h-3.5 w-3.5" /> : rs.partial ? <Minus className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{rs.detail}</span>)}</div>
                    <div className="mt-3 flex gap-2">{looking && (x.deal ? <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700" aria-disabled="true" data-testid={`match-in-pipeline-${x.property.code}`}>Deal in Pipeline<Mono className="text-xs">{x.deal.code}</Mono></span> : <Button size="sm" loading={busy === x.property.id} onClick={() => deal(x.property.id)} data-testid={`match-deal-${x.property.code}`}>Create Deal</Button>)}</div>
                  </div>
                </Card>);
            })}</div>}
        </Section>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Property Leads">{r.links.length ? <Card className="divide-y divide-slate-100">{r.links.map((l: any) => <div key={l.id} className="flex items-center justify-between gap-3 p-4 text-sm"><Link to={`/properties/${l.property.id}/manage`} className="min-w-0 flex-1"><Mono>{l.property.code}</Mono> · {l.property.subtype}, {l.property.location}</Link><Badge tone={STAGE_TONE[l.dealStage]}>{human(l.dealStage)}</Badge><Button size="sm" variant="ghost" loading={busy === l.propertyId} onClick={() => removeLead(l)} aria-label="Delete Lead" data-testid={`requirement-delete-lead-${l.property.code}`}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>)}</Card> : <p className="text-sm text-slate-500">No lead for {requirementLabel(r.type, r.code)} yet.</p>}</Section>
        <Section title="Deals">{r.deals.length ? <Card className="divide-y divide-slate-100">{r.deals.map((d: any) => <Link key={d.id} to={`/deals/${d.id}`} className="flex justify-between p-4 text-sm"><span><Mono>{d.code}</Mono> · {d.property.code} · {inr(d.dealValue)}</span><Badge tone={STAGE_TONE[d.stage]}>{human(d.stage)}</Badge></Link>)}</Card> : <p className="text-sm text-slate-500">No deals.</p>}</Section>
      </div>
      <Section title="Requirement Timeline"><Card className="p-5"><Timeline items={act.data ?? []} testid="requirement-timeline" /></Card></Section>
      <Sheet open={!!dealPreview} onClose={() => setDealPreview(null)} title="Confirm Deal" testid="deal-preview-sheet" footer={<Button className="w-full" onClick={confirmDeal} loading={busy === dealPreview?.property.id} data-testid="deal-confirm-btn">Create Deal</Button>}>
        {dealPreview && <div className="space-y-3 text-sm"><p><b>Looking client:</b> {dealPreview.client.name} · {requirementLabel(dealPreview.requirement.type, dealPreview.requirement.code)}</p><p><b>Property:</b> {dealPreview.property.code} · {dealPreview.property.subtype}, {dealPreview.property.location}</p><p><b>Offering client:</b> {dealPreview.offering.client.name}</p><p><b>Offering:</b> {requirementLabel(dealPreview.offering.requirement.type, dealPreview.offering.requirement.code)} · {inr(dealPreview.offering.requirement.amount)}{dealPreview.offering.requirement.deposit != null ? ` · Deposit ${inr(dealPreview.offering.requirement.deposit)}` : ''}</p></div>}
      </Sheet>
    </div>
  );
}
