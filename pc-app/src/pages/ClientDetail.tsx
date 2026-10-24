import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy, Eye, Link2, MessageCircle, Pencil, Phone, Plus, Sparkles, Trash2 } from 'lucide-react';
import { del, post } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { date, dt, human, inr, AMOUNT_LABEL, requirementLabel, STAGE_TONE } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorState, ListSkeleton, Mono, Section, Tabs } from '../components/ui';
import { ClientSheet, LinkSheet, Stat, Timeline } from '../components/domain';

export function RequirementCard({ r, onChanged }: { r: any; onChanged: () => void }) {
  const nav = useNavigate();
  const remove = async () => { if (!confirm(`Move ${requirementLabel(r.type, r.code)} to Bin? Its associated Leads will be removed and dependent Deals archived. Other requirements are not affected.`)) return; await del(`/requirements/${r.id}`); toast.success(`${requirementLabel(r.type, r.code)} moved to Bin with its Leads and Deals archived`); onChanged(); };
  const dup = async () => { const c = await post(`/requirements/${r.id}/duplicate`); toast.success(`Duplicated as ${c.code}`); onChanged(); };
  return (
    <Card className="p-4" data-testid={`requirement-card-${r.code}`}>
      <div className="flex items-start justify-between gap-2">
        <div><Mono className="text-[13px]">{requirementLabel(r.type, r.code)}</Mono><div className="mt-1"><Badge tone={String(r.type).endsWith('_LOOKING') ? 'blue' : 'amber'}>{String(r.type).endsWith('_LOOKING') ? `Looking · ${human(String(r.type).replace('_LOOKING', ''))}` : `Offering · ${human(String(r.type).replace('_OFFERING', ''))}`}</Badge></div>
          <p className="text-xs text-slate-500">{human(r.category)} · {r.subCategory ? `${r.subCategory} · ` : ''}{r.subtype ?? '—'}{r.bhk ? ` · ${r.bhk} BHK` : ''}</p></div>
        <Badge tone={r.status === 'ACTIVE' ? 'green' : 'slate'}>{human(r.status)}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div><p className="text-[11px] font-bold uppercase text-slate-400">Location</p><p className="font-semibold">{(r.locations?.length ? r.locations : [r.location]).join(', ')}</p></div>
        <div><p className="text-[11px] font-bold uppercase text-slate-400">{AMOUNT_LABEL[r.type]}</p><p className="font-semibold" data-testid={`requirement-amount-${r.code}`}>{r.amountMin ? `${inr(r.amountMin)} – ` : ''}{inr(r.amount)}</p></div>
      </div>
      {(r.deposit != null || r.availableDate || r.leasePeriodMonths) && <p className="mt-2 text-xs text-slate-500">{[r.deposit != null ? `Deposit ${inr(r.deposit)}` : '', r.leasePeriodMonths ? `${r.leasePeriodMonths} month lease` : '', r.availableDate ? `Available ${date(r.availableDate)}` : ''].filter(Boolean).join(' · ')}</p>}
      <p className="mt-2 text-[11px] text-slate-400">Created {date(r.createdAt)} · Updated {date(r.updatedAt)}</p>
      <div className="mt-3 grid grid-cols-5 gap-1 border-t border-slate-100 pt-2 text-[10.5px] font-semibold text-slate-500">
        {[[Eye, 'View', () => nav(`/requirements/${r.id}`)], [Pencil, 'Edit', () => nav(`/requirements/${r.id}/edit`)], [Sparkles, 'Matches', () => nav(`/requirements/${r.id}`)], [Copy, 'Copy', dup], [Trash2, 'Delete', remove]].map(([I, l, fn]: any) => (
          <button key={l} onClick={fn} className="flex flex-col items-center gap-0.5 rounded-lg py-1.5 hover:bg-slate-50 hover:text-navy" data-testid={`req-${l.toLowerCase()}-${r.code}`}><I className="h-4 w-4" />{l}</button>))}
      </div>
    </Card>
  );
}

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { data: c, loading, error, reload } = useFetch<any>(`/clients/${id}`);
  const an = useFetch<any>(`/clients/${id}/analytics`);
  const [tab, setTab] = useState<string>('requirements');
  const [edit, setEdit] = useState(false);
  const [link, setLink] = useState(false);
  useEffect(() => { if (sp.get('link')) setLink(true); }, [sp]);
  if (error) return <ErrorState message={error} />;
  if (loading || !c) return <ListSkeleton />;
  const refresh = () => { reload(); an.reload(); };
  const remove = async () => { if (!confirm(`Move ${c.name} to Bin?`)) return; await del(`/clients/${c.id}`); toast.success('Client moved to Bin'); nav('/clients'); };
  const removeLead = async (lead: any) => {
    if (!confirm(`Delete Lead for ${lead.requirement.code}? Any Deals created from this Lead will be archived. The property and client will remain.`)) return;
    try { await del(`/property-client-links/${lead.id}`); toast.success('Lead deleted'); refresh(); } catch (e) { toast.error((e as Error).message); }
  };
  const a = an.data;
  return (
    <div className="space-y-6" data-testid="client-detail">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-navy text-xl font-bold text-white">{c.name[0]}</div>
          <div><h1 className="text-2xl font-extrabold tracking-tight" data-testid="client-name">{c.name}</h1><p className="text-sm text-slate-500">+91 {c.phone} · {c.location}{c.email ? ` · ${c.email}` : ''}</p><Mono>{c.code}</Mono></div></div>
        <div className="flex flex-wrap gap-2">
          <a href={`tel:+91${c.phone}`}><Button variant="secondary" data-testid="client-call-btn"><Phone className="h-4 w-4" />Call</Button></a>
          <a href={`https://wa.me/91${c.phone}?text=${encodeURIComponent(`Hi ${c.name},`)}`} target="_blank" rel="noreferrer"><Button variant="success" data-testid="client-whatsapp-btn"><MessageCircle className="h-4 w-4" />WhatsApp</Button></a>
          <Button variant="secondary" onClick={() => setEdit(true)} data-testid="client-edit-btn"><Pencil className="h-4 w-4" />Edit</Button>
          <Button variant="ghost" onClick={remove} data-testid="client-delete-btn"><Trash2 className="h-4 w-4 text-red-600" /></Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => nav(`/requirements/new?clientId=${c.id}`)} data-testid="client-add-requirement-btn"><Plus className="h-4 w-4" />Add Requirement</Button>
        {c.requirements.some((r: any) => String(r.type).endsWith('_OFFERING')) && <Button variant="secondary" onClick={() => setLink(true)} data-testid="client-link-property-btn"><Link2 className="h-4 w-4" />Link Property</Button>}
        <Button variant="ghost" onClick={() => nav('/clients')} data-testid="client-done-btn">Done</Button>
      </div>
      <Tabs tabs={[{ id: 'requirements', label: 'Requirements', count: c.requirements.length }, { id: 'properties', label: 'Leads', count: c.links.length }, { id: 'deals', label: 'Deals', count: c.deals.length }, { id: 'followups', label: 'Follow-ups', count: c.followUps.length }, { id: 'activity', label: 'Activity' }, { id: 'analytics', label: 'Analytics' }]} value={tab} onChange={setTab} testid="client-tab" />
      {tab === 'requirements' && (c.requirements.length ? <div className="grid gap-4 md:grid-cols-2" data-testid="requirements-list">{c.requirements.map((r: any) => <RequirementCard key={r.id} r={r} onChanged={refresh} />)}</div> : <Empty title="No requirements yet" action={<Button onClick={() => nav(`/requirements/new?clientId=${c.id}`)}>Add Requirement</Button>} />)}
      {tab === 'properties' && (c.links.length ? <Card className="divide-y divide-slate-100">{c.links.map((l: any) => <div key={l.id} className="flex items-center justify-between gap-3 p-4"><Link to={`/properties/${l.property.id}/manage`} className="min-w-0 flex-1 hover:text-brand"><p className="font-semibold">{l.property.subtype} · {l.property.location}</p><p className="text-xs"><Mono>{l.property.code}</Mono> → <Mono>{requirementLabel(l.requirement.type, l.requirement.code)}</Mono> · {human(l.interestLevel)} interest</p></Link><Badge tone={STAGE_TONE[l.dealStage]}>{human(l.dealStage)}</Badge><Button size="sm" variant="ghost" onClick={() => removeLead(l)} aria-label="Delete Lead" data-testid={`client-delete-lead-${l.requirement.code}`}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>)}</Card> : <Empty title="No leads yet" />)}
      {tab === 'deals' && (c.deals.length ? <Card className="divide-y divide-slate-100">{c.deals.map((d: any) => <Link key={d.id} to={`/deals/${d.id}`} className="flex items-center justify-between p-4 hover:bg-slate-50"><div><p className="font-semibold">{d.property.subtype} · {d.property.location}</p><p className="text-xs"><Mono>{d.code}</Mono> · <Mono>{requirementLabel(d.requirement.type, d.requirement.code)}</Mono> · {inr(d.dealValue)}</p></div><Badge tone={STAGE_TONE[d.stage]}>{human(d.stage)}</Badge></Link>)}</Card> : <Empty title="No deals yet" />)}
      {tab === 'followups' && (c.followUps.length ? <Card className="divide-y divide-slate-100">{c.followUps.map((f: any) => <div key={f.id} className="flex justify-between p-4 text-sm"><span><b>{human(f.type)}</b> · {dt(f.scheduledAt)}{f.requirement ? ` · ${requirementLabel(f.requirement.type, f.requirement.code)}` : ''}</span><Badge tone={f.status === 'COMPLETED' ? 'green' : f.status === 'MISSED' ? 'red' : 'blue'}>{human(f.status)}</Badge></div>)}</Card> : <Empty title="No follow-ups" />)}
      {tab === 'activity' && <Card className="p-5"><Timeline items={a?.timeline} testid="client-timeline" /></Card>}
      {tab === 'analytics' && a && <div className="space-y-4" data-testid="client-analytics">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5"><Stat label="Requirements" value={`${a.activeRequirements}/${a.totalRequirements}`} /><Stat label="Matched Properties" value={a.matchedProperties} /><Stat label="Leads" value={a.linkedProperties} /><Stat label="Site Visits" value={a.siteVisits} /><Stat label="Follow-ups" value={a.followUps} /><Stat label="Active Deals" value={a.activeDeals} /><Stat label="Closed Deals" value={a.closedDeals} /><Stat label="Deal Value" value={inr(a.dealValue)} accent /><Stat label="Potential Commission" value={inr(a.potentialCommission)} accent /></div>
        <Section title="By Requirement"><Card className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{['Requirement', 'Type', 'Matches', 'Leads', 'Follow-ups', 'Deals', 'Value'].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr></thead>
          <tbody>{a.byRequirement.map((r: any) => <tr key={r.id} className="border-t border-slate-100"><td className="px-4 py-2"><Mono>{requirementLabel(r.type, r.code)}</Mono></td><td className="px-4 py-2">{human(r.type)}</td><td className="px-4 py-2">{r.matches}</td><td className="px-4 py-2">{r.links}</td><td className="px-4 py-2">{r.followUps}</td><td className="px-4 py-2">{r.deals}</td><td className="px-4 py-2">{inr(r.dealValue)}</td></tr>)}</tbody></table></Card></Section>
      </div>}
      <ClientSheet open={edit} onClose={() => setEdit(false)} initial={c} onSaved={() => { setEdit(false); toast.success('Client updated'); refresh(); }} />
      <LinkSheet open={link} onClose={() => setLink(false)} clientId={c.id} onDone={refresh} />
    </div>
  );
}
