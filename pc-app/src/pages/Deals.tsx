import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useFetch } from '../lib/hooks';
import { human, inr, requirementLabel, STAGES, STAGE_TONE } from '../lib/format';
import { Badge, Card, Empty, ErrorState, ListSkeleton, Mono } from '../components/ui';

export default function Deals() {
  const [sp] = useSearchParams();
  const focus = sp.get('stage');
  const { data, loading, error, reload } = useFetch<any[]>('/deals', { pageSize: 100 });
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (error) return <ErrorState message={error} retry={reload} />;
  const total = (s: string) => (data || []).filter((d) => d.stage === s);
  const isOpen = (s: string) => toggled[s] ?? (focus === s || (s !== 'CLOSED' && s !== 'LOST'));
  return (
    <div className="space-y-5" data-testid="deals-page">
      <div><h1 className="text-3xl font-extrabold tracking-tight">Deals</h1><p className="text-sm text-slate-500">Every deal = Client + Requirement + Property. Create deals from a requirement's matches.</p></div>
      {loading && !data ? <ListSkeleton /> : !data?.length ? <Empty title="No deals yet" text="Open a requirement and create a deal from a matching property." /> :
        <div className="space-y-3">
          {STAGES.map((s) => {
            const list = total(s);
            const open = isOpen(s) && list.length > 0;
            return (
              <section key={s} className={`rounded-2xl p-2 ${focus === s ? 'bg-brand-50 ring-2 ring-brand/30' : 'bg-slate-100/70'}`} data-testid={`deal-column-${s}`}>
                <button type="button" disabled={!list.length} aria-expanded={open} onClick={() => setToggled((t) => ({ ...t, [s]: !isOpen(s) }))} className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left disabled:cursor-default" data-testid={`deal-stage-toggle-${s}`}>
                  <span className="flex items-center gap-2"><Badge tone={STAGE_TONE[s]}>{human(s)}</Badge><span className="text-xs font-bold text-slate-500">{list.length} {list.length === 1 ? 'deal' : 'deals'}</span></span>
                  <span className="flex items-center gap-2 text-xs font-bold text-slate-500">{inr(list.reduce((a, d) => a + (d.dealValue || 0), 0))}{list.length > 0 && <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />}</span>
                </button>
                {open && <div className="mt-1 grid gap-2 px-1 pb-1 sm:grid-cols-2 xl:grid-cols-3">{list.map((d) => (
                  <Link key={d.id} to={`/deals/${d.id}`} data-testid={`deal-card-${d.code}`}>
                    <Card className="h-full p-3 transition-shadow hover:shadow-lift">
                      <div className="flex items-center justify-between gap-2"><Mono>{d.code}</Mono><Badge tone={STAGE_TONE[d.stage]}>{human(d.stage)} · {d.probability}%</Badge></div>
                      <p className="mt-1 truncate text-sm font-bold">{d.client.name}</p>
                      <p className="truncate text-xs text-slate-500">{d.property.subtype} · {d.property.location}</p>
                      <p className="mt-1 truncate text-[11px]"><Mono>{requirementLabel(d.requirement.type, d.requirement.code)}</Mono> · <Mono>{d.property.code}</Mono></p>
                      <div className="mt-2 flex justify-between text-sm"><b>{inr(d.dealValue)}</b><span className="text-xs font-semibold text-emerald-700">{inr(d.stage === 'CLOSED' ? d.finalCommission : d.expectedCommission)}</span></div>
                    </Card>
                  </Link>))}</div>}
              </section>);
          })}
        </div>}
    </div>
  );
}