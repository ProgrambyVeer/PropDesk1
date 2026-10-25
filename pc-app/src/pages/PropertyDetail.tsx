import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, CalendarClock, Check, Pencil, Plus, Share2, Trash2, Unlink, X } from 'lucide-react';
import { del, fileUrl, post } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { date, dims, human, inr, requirementLabel, txLabel, STAGE_TONE } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorState, Field, KV, ListSkeleton, Mono, Section, Select, Sheet, Tabs } from '../components/ui';
import { FollowUpSheet, propertyShareLabel, SharedBadge, ShareSheet, Stat, Timeline } from '../components/domain';
import { hasPin, OpenInGoogleMaps } from '../components/maps';

export default function PropertyDetail({ commandCenter = false }: { commandCenter?: boolean }) {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const { data: p, loading, error, reload } = useFetch<any>(`/properties/${id}`);
  const owner = p?.access === 'OWNER';
  const an = useFetch<any>(owner ? `/properties/${id}/analytics` : null);
  const interestedCandidates = useFetch<any[]>(commandCenter || p?.access === 'VIEW_ONLY' ? `/properties/${id}/interested-buyer-candidates` : null);
  const followUps = useFetch<any[]>(commandCenter || p?.access === 'VIEW_ONLY' ? '/follow-ups' : null, { propertyId: id, pageSize: 100 });
  const [tab, setTab] = useState<'overview' | 'clients' | 'analytics' | 'activity'>('overview');
  const [share, setShare] = useState(false); const [photo, setPhoto] = useState(0); const [followUpForm, setFollowUpForm] = useState<any>(null); const [interestedForm, setInterestedForm] = useState(false); const [interestedClientId, setInterestedClientId] = useState(''); const [interestedRequirementId, setInterestedRequirementId] = useState(''); const [interestedBusy, setInterestedBusy] = useState(false);
  if (error) return <ErrorState message={error} />;
  if (loading || !p) return <ListSkeleton />;
  const remove = async () => { if (!confirm(`Move ${p.code} to Bin?`)) return; await del(`/properties/${p.id}`); toast.success(`${p.code} moved to Bin`); nav('/properties'); };
  const unlink = async (l: any) => {
    if (!confirm(`Delete Lead for ${requirementLabel(l.requirement.type, l.requirement.code)}? Any Deals created from this Lead will be archived. The property and client will remain.`)) return;
    try { await del(`/property-client-links/${l.id}`); toast.success('Lead deleted'); reload(); an.reload(); } catch (e) { toast.error((e as Error).message); }
  };
  const completeFollowUp = async (f: any) => { await post(`/follow-ups/${f.id}/complete`, { outcome: 'Completed from Property Command Center' }); toast.success('Follow-up completed'); followUps.reload(); an.reload(); };
  const cancelFollowUp = async (f: any) => { if (!confirm(`Cancel ${f.code}?`)) return; await post(`/follow-ups/${f.id}/cancel`, {}); toast.success('Follow-up cancelled'); followUps.reload(); an.reload(); };
  const deleteFollowUp = async (f: any) => { if (!confirm(`Delete ${f.code}?`)) return; await del(`/follow-ups/${f.id}`); toast.success('Follow-up deleted'); followUps.reload(); an.reload(); };
  const addInterestedBuyer = async () => {
    setInterestedBusy(true);
    try {
      await post(`/properties/${p.id}/interested-buyers`, { clientId: interestedClientId, requirementId: interestedRequirementId });
      toast.success('Interested buyer added'); setInterestedForm(false); setInterestedClientId(''); setInterestedRequirementId(''); reload(); an.reload(); interestedCandidates.reload();
    } catch (e) { toast.error((e as Error).message); } finally { setInterestedBusy(false); }
  };
  const acceptSharedProperty = async () => {
    const share = p.shares?.[0];
    if (!share) { toast.error('This property share is no longer available'); return; }
    try { await post(`/property-shares/${share.id}/accept`, {}); toast.success('Property added to your shared workspace'); reload(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const back = () => {
    const state = location.state as any;
    nav(state?.returnTo || '/properties', { replace: true, state: state?.propertyListState ? { propertyListState: state.propertyListState } : undefined });
  };
  const shareLabel = p.isShared ? propertyShareLabel(p, owner) : null;
  const a = an.data;
  const matchingBuyers = a?.matchingBuyers || [];
  const interestedLinks = p.links.filter((link: any) => link.requirement.type.endsWith('_LOOKING'));
  const interestedClientCount = new Set(interestedLinks.map((link: any) => link.client.id)).size;
  const interestedClients = [...new Map((interestedCandidates.data || []).map((item: any) => [item.client.id, item.client])).values()];
  const selectedInterestedRequirements = (interestedCandidates.data || []).filter((item: any) => item.client.id === interestedClientId);
  const sellerLinks = p.links.filter((link: any) => link.requirement.type.endsWith('_OFFERING'));
  return (
    <div className="space-y-6" data-testid="property-detail">
      {shareLabel && <SharedBadge label={shareLabel} />}
      <div className="overflow-hidden rounded-3xl bg-slate-100">
        <div className="aspect-[16/9] max-h-[420px] w-full">{p.photos[photo] ? <img src={fileUrl(p.photos[photo].url)} alt="" className="h-full w-full object-cover" data-testid="property-main-photo" /> : <div className="flex h-full items-center justify-center text-slate-400">No photos</div>}</div>
        {p.photos.length > 1 && <div className="no-scrollbar flex gap-2 overflow-x-auto bg-white p-2">{p.photos.map((ph: any, i: number) => <button key={ph.id} onClick={() => setPhoto(i)} className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg ring-2 ${i === photo ? 'ring-navy' : 'ring-transparent'}`}><img src={fileUrl(ph.url)} alt="" className="h-full w-full object-cover" /></button>)}</div>}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>{commandCenter && <button onClick={back} className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-500" data-testid="property-command-back-btn"><ArrowLeft className="h-4 w-4" />Back</button>}<Mono>{p.code}</Mono><h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{commandCenter ? 'Property Command Center' : p.title || `${p.bhk ? `${p.bhk} BHK ` : ''}${p.subtype} in ${p.location}`}</h1>
          <p className="mt-1 text-sm text-slate-500">{human(p.category)} · {p.subCategory ? `${p.subCategory} · ` : ''}{p.subtype} · {p.location}{p.locality ? `, ${p.locality}` : ''}{hasPin(p) && <> · <OpenInGoogleMaps latitude={p.latitude} longitude={p.longitude} /></>}</p>
          <div className="mt-3 flex flex-wrap gap-2">{p.transactions.map((t: any) => <Badge key={t.kind} tone="navy" className="text-xs normal-case">{txLabel(t)}</Badge>)}<Badge tone={p.status === 'ACTIVE' ? 'green' : 'slate'}>{human(p.status)}</Badge></div>
          {!owner && <p className="mt-3 text-sm font-semibold text-emerald-700" data-testid="view-only-note">Shared by {p.owner.name} · View only</p>}
        </div>
        {owner && <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => nav(`/properties/${p.id}/edit`)} data-testid="property-edit-btn"><Pencil className="h-4 w-4" />Edit</Button>
          <Button variant="secondary" onClick={() => setShare(true)} data-testid="property-share-btn"><Share2 className="h-4 w-4" />Share</Button>
          <Button variant="ghost" onClick={remove} data-testid="property-delete-btn"><Trash2 className="h-4 w-4 text-red-600" /></Button>
        </div>}
      </div>
      {commandCenter && owner && <div className="grid gap-6 lg:grid-cols-2" data-testid="property-command-center">
        <Section title="Offering Client">
          <Card className="divide-y divide-slate-100">
            {sellerLinks.length ? <Link to={`/clients/${sellerLinks[0].client.id}`} className="block p-4 hover:bg-slate-50"><p className="font-semibold">{sellerLinks[0].client.name}</p><div className="mt-2 space-y-1">{sellerLinks.map((item: any) => <p key={item.id} className="text-xs text-slate-500"><Badge tone="amber">{human(item.requirement.type)}</Badge> <span className="ml-1">{requirementLabel(item.requirement.type, item.requirement.code)} · {inr(item.requirement.amount)}</span></p>)}</div></Link> : <p className="p-4 text-sm text-slate-500">No offering linked.</p>}
          </Card>
        </Section>
        <Section title={`Interested Buyers · ${interestedClientCount}`} action={<Button size="sm" variant="secondary" onClick={() => setInterestedForm(true)} data-testid="add-interested-buyer-btn"><Plus className="h-4 w-4" />Add Interested Buyer</Button>}>
          {interestedLinks.length ? <Card className="divide-y divide-slate-100">{interestedLinks.map((item: any) => <div key={item.id} className="flex items-center gap-3 p-4"><Link to={`/clients/${item.client.id}`} className="min-w-0 flex-1 hover:text-brand"><p className="font-semibold">{item.client.name}</p><p className="text-xs text-slate-500">{requirementLabel(item.requirement.type, item.requirement.code)} · {human(item.interestLevel)} interest</p></Link><Button size="sm" variant="ghost" onClick={() => unlink(item)} aria-label="Remove interested buyer"><Trash2 className="h-4 w-4 text-red-600" /></Button></div>)}</Card> : <Empty title="No interested buyers yet" text="Add an eligible looking requirement to record manual interest." />}
        </Section>
        <Section title={`Matches · ${matchingBuyers.length}`} className="lg:col-span-2">
          {an.loading ? <ListSkeleton n={2} /> : matchingBuyers.length ? <div className="grid gap-3 md:grid-cols-2">{matchingBuyers.map((match: any) => <Card key={match.requirementId} className="p-4" data-testid={`command-match-${match.requirementCode}`}>
            <div className="flex items-start justify-between gap-3"><div><Link to={`/clients/${match.clientId}`} className="font-semibold hover:text-brand">{match.clientName}</Link><p className="text-xs text-slate-500"><Link to={`/requirements/${match.requirementId}`} className="font-mono text-brand-600">{requirementLabel(match.type, match.requirementCode)}</Link></p></div><Badge tone="green">{match.score}%</Badge></div>
            <div className="mt-2 space-y-1">{match.reasons.map((reason: any) => <p key={reason.factor} className="text-xs text-slate-600"><b>{reason.factor}:</b> {reason.detail}</p>)}</div>
          </Card>)}</div> : <Empty title="No matches yet" text="No active eligible looking requirements match this property right now." />}
        </Section>
        <Section title={`Deals · ${p.deals.length}`}>
          {p.deals.length ? <Card className="divide-y divide-slate-100">{p.deals.map((deal: any) => <Link key={deal.id} to={`/deals/${deal.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div><p className="font-semibold">{deal.client.name}</p><p className="text-xs text-slate-500">{deal.code} · {requirementLabel(deal.requirement.type, deal.requirement.code)} · {inr(deal.dealValue)}</p></div><Badge tone={STAGE_TONE[deal.stage]}>{human(deal.stage)}</Badge></Link>)}</Card> : <Empty title="No deals for this property" />}
        </Section>
        <Section title="Site Visits" action={owner && <Button size="sm" variant="secondary" onClick={() => setFollowUpForm({ propertyId: p.id, type: 'SITE_VISIT' })}><Plus className="h-4 w-4" />Schedule</Button>}>
          <FollowUpList rows={(followUps.data || []).filter((item: any) => item.type === 'SITE_VISIT')} loading={followUps.loading} onEdit={setFollowUpForm} onComplete={completeFollowUp} onCancel={cancelFollowUp} onDelete={deleteFollowUp} />
        </Section>
        <Section title="Follow-ups" action={owner && <Button size="sm" variant="secondary" onClick={() => setFollowUpForm({ propertyId: p.id })}><Plus className="h-4 w-4" />Add</Button>}>
          <FollowUpList rows={(followUps.data || []).filter((item: any) => item.type !== 'SITE_VISIT')} loading={followUps.loading} onEdit={setFollowUpForm} onComplete={completeFollowUp} onCancel={cancelFollowUp} onDelete={deleteFollowUp} />
        </Section>
        <Section title="Recent Activity" className="lg:col-span-2" action={<Link to="/activity" className="text-sm font-semibold text-brand">Activity Logs</Link>}>
          {a?.timeline?.length ? <Card className="divide-y divide-slate-100">{a.timeline.slice(0, 10).map((item: any) => <ActivityRow key={item.id} item={item} propertyId={p.id} />)}</Card> : <Empty title="No recent activity" />}
        </Section>
      </div>}
      {!owner && <div className="space-y-5 animate-up" data-testid="shared-property-workspace">
        <Card className="space-y-3 p-4" data-testid="shared-property-command-center">
          <KV k="Shared by" v={p.owner?.name || 'Property Consultant'} />
          <KV k="Property" v={`${human(p.category)} · ${p.subCategory ? `${p.subCategory} · ` : ''}${p.subtype}`} />
          <KV k="Location" v={p.location} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={acceptSharedProperty} disabled={!!p.shares?.[0]?.acceptedAt} data-testid="shared-property-accept-btn">{p.shares?.[0]?.acceptedAt ? 'Added to My Properties' : 'Add to My Properties'}</Button>
            <Button size="sm" onClick={() => interestedCandidates.data?.length ? document.getElementById('shared-matching-clients')?.scrollIntoView({ behavior: 'smooth' }) : toast.info('No matching clients found yet')} data-testid="shared-property-find-clients-btn">Find Matching Clients</Button>
          </div>
          <p className="text-xs text-slate-500">Your clients, follow-ups and deals remain private to your workspace.</p>
        </Card>
        <Section title={`Matching Clients · ${interestedCandidates.data?.length || 0}`} >
          {interestedCandidates.loading ? <ListSkeleton n={2} /> : interestedCandidates.data?.length ? <div id="shared-matching-clients" className="grid gap-3 md:grid-cols-2">{interestedCandidates.data.map((item: any) => <Card key={item.requirement.id} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><Link to={`/clients/${item.client.id}`} className="font-semibold hover:text-brand">{item.client.name}</Link><p className="text-xs text-slate-500">{requirementLabel(item.requirement.type, item.requirement.code)}</p></div><Button size="sm" variant="secondary" onClick={() => { setInterestedClientId(item.client.id); setInterestedRequirementId(item.requirement.id); setInterestedForm(true); }}>Add</Button></Card>)}</div> : <Empty title="No matching clients yet" text="Add a looking requirement for one of your clients to match this shared property." />}
        </Section>
        <Section title="Site Visits" action={<Button size="sm" variant="secondary" onClick={() => setFollowUpForm({ propertyId: p.id, type: 'SITE_VISIT' })}><Plus className="h-4 w-4" />Schedule</Button>}>
          <FollowUpList rows={(followUps.data || []).filter((item: any) => item.type === 'SITE_VISIT')} loading={followUps.loading} onEdit={setFollowUpForm} onComplete={completeFollowUp} onCancel={cancelFollowUp} onDelete={deleteFollowUp} />
        </Section>
        <Section title="Follow-ups" action={<Button size="sm" variant="secondary" onClick={() => setFollowUpForm({ propertyId: p.id })}><Plus className="h-4 w-4" />Add</Button>}>
          <FollowUpList rows={(followUps.data || []).filter((item: any) => item.type !== 'SITE_VISIT')} loading={followUps.loading} onEdit={setFollowUpForm} onComplete={completeFollowUp} onCancel={cancelFollowUp} onDelete={deleteFollowUp} />
        </Section>
      </div>}
      {owner && <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'clients', label: 'Leads & Deals', count: p.links.length }, { id: 'analytics', label: 'Analytics' }, { id: 'activity', label: 'Activity' }]} value={tab} onChange={setTab} testid="property-tab" />}
      {tab === 'overview' && <div className="grid gap-6 lg:grid-cols-2">
        <Card className="divide-y divide-slate-100 px-5 py-2">
          <KV k="Dimensions" v={dims(p)} /><KV k="Area" v={p.area ? `${Math.round(p.area).toLocaleString('en-IN')} sqft` : '—'} /><KV k="Facing" v={p.facing} />
          {p.category === 'RESIDENTIAL' && <><KV k="BHK / Bath / Balcony" v={`${p.bhk ?? '—'} / ${p.bathrooms ?? '—'} / ${p.balcony ?? '—'}`} /><KV k="Built-up / Carpet / Plot" v={`${p.builtUpArea ?? '—'} / ${p.carpetArea ?? '—'} / ${p.plotArea ?? '—'} sqft`} /><KV k="Floor" v={p.floor != null ? `${p.floor} of ${p.totalFloors ?? '—'}` : '—'} /><KV k="Furnishing" v={p.furnishing} /><KV k="Property Age" v={p.propertyAge} /><KV k="Parking" v={p.parking} /></>}
          {p.category === 'LAND' && <KV k="Khata" v={p.khata} />}
          <KV k="Listed" v={date(p.createdAt)} />
        </Card>
        <div className="space-y-4">
          {p.transactions.map((t: any) => <Card key={t.kind} className="p-5"><p className="text-xs font-bold uppercase tracking-wider text-slate-500">{human(t.kind)}</p><p className="mt-1 text-2xl font-extrabold">{txLabel(t)}</p>
            {t.kind !== 'SALE' && <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-slate-600"><span>Deposit: <b>{inr(t.depositAmount)}</b></span><span>Available: <b>{date(t.availableDate)}</b></span>{t.kind === 'LEASE' && <span>Period: <b>{t.leasePeriodMonths} months</b></span>}</div>}</Card>)}
          {p.amenities.length > 0 && <Card className="p-5"><p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Amenities</p><div className="flex flex-wrap gap-2">{p.amenities.map((x: string) => <Badge key={x} tone="blue" className="normal-case tracking-normal">{x}</Badge>)}</div></Card>}
          {p.otherFeatures && <Card className="p-5 text-sm">{p.otherFeatures}</Card>}
        </div>
      </div>}
      {tab === 'clients' && <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Leads">{p.links.length ? <Card className="divide-y divide-slate-100">{p.links.map((l: any) => (
          <div key={l.id} className="flex items-center justify-between p-4" data-testid={`property-link-${l.requirement.code}`}><Link to={`/clients/${l.client.id}`}><p className="font-semibold">{l.client.name}</p><p className="text-xs"><Mono>{requirementLabel(l.requirement.type, l.requirement.code)}</Mono> · {human(l.interestLevel)} interest</p></Link>
            <button onClick={() => unlink(l)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" data-testid={`unlink-${l.requirement.code}`} aria-label="Delete Lead"><Trash2 className="h-4 w-4 text-red-600" /></button></div>))}</Card> : <p className="text-sm text-slate-500">No leads yet.</p>}</Section>
        <Section title="Deals">{p.deals.length ? <Card className="divide-y divide-slate-100">{p.deals.map((d: any) => <Link key={d.id} to={`/deals/${d.id}`} className="flex items-center justify-between p-4"><div><p className="font-semibold">{d.client.name}</p><p className="text-xs"><Mono>{d.code}</Mono> · {requirementLabel(d.requirement.type, d.requirement.code)} · {inr(d.dealValue)}</p></div><Badge tone={STAGE_TONE[d.stage]}>{human(d.stage)}</Badge></Link>)}</Card> : <p className="text-sm text-slate-500">No deals yet.</p>}</Section>
        <Section title="Shares" className="lg:col-span-2">{p.shares.length ? <Card className="divide-y divide-slate-100">{p.shares.map((s: any) => <div key={s.id} className="flex justify-between p-4 text-sm"><span>{owner ? s.targetType === 'CLIENT' ? `Shared with Client: ${s.client?.name || 'Client'}` : `Shared with PC: ${s.receiver?.name || 'PC'}` : `Shared by PC: ${s.sender?.name || p.owner?.name || 'PC'}`} · {s.channel === 'IN_APP' ? 'In-app' : 'WhatsApp'}</span><span className="text-slate-500">{human(s.permission)} · {human(s.status)} · {date(s.createdAt)}</span></div>)}</Card> : <p className="text-sm text-slate-500">Not shared yet.</p>}</Section>
      </div>}
      {tab === 'analytics' && (a ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="property-analytics">
        <Stat label="Days Listed" value={a.daysListed} /><Stat label="Matched Clients" value={a.matchedClients} /><Stat label="Leads" value={a.linkedClients} /><Stat label="Contacts" value={a.contacts} />
        <Stat label="Site Visits" value={a.siteVisits} /><Stat label="Follow-ups" value={a.followUps} /><Stat label="Shares" value={a.shares} /><Stat label="PCs Shared With" value={a.pcsSharedWith} />
        <Stat label="Deal Stage" value={a.dealStage ? human(a.dealStage) : '—'} /><Stat label="Deal Probability" value={`${a.dealProbability}%`} /><Stat label="Deal Value" value={inr(a.dealValue)} accent /><Stat label="Expected Commission" value={inr(a.expectedCommission)} accent />
        <Stat label="Final Commission" value={inr(a.finalCommission)} accent />
      </div> : <ListSkeleton n={2} />)}
      {tab === 'activity' && <Card className="p-5"><Timeline items={a?.timeline} testid="property-timeline" /></Card>}
      <ShareSheet open={share} onClose={() => setShare(false)} property={p} onDone={reload} />
      <FollowUpSheet open={!!followUpForm} onClose={() => setFollowUpForm(null)} initial={followUpForm} onDone={() => { followUps.reload(); an.reload(); }} />
      <Sheet open={interestedForm} onClose={() => setInterestedForm(false)} title="Add Interested Buyer" testid="interested-buyer-sheet" footer={<Button className="w-full" onClick={addInterestedBuyer} loading={interestedBusy} disabled={!interestedClientId || !interestedRequirementId}>Add Interested Buyer</Button>}>
        <div className="space-y-4"><Field label="Interested client" required><Select value={interestedClientId} onChange={(event) => { setInterestedClientId(event.target.value); setInterestedRequirementId(''); }}><option value="">Select client</option>{interestedClients.map((client: any) => <option key={client.id} value={client.id}>{client.name} · {client.code}</option>)}</Select></Field><Field label="Looking requirement" required><Select value={interestedRequirementId} disabled={!interestedClientId} onChange={(event) => setInterestedRequirementId(event.target.value)}><option value="">Select requirement</option>{selectedInterestedRequirements.map((item: any) => <option key={item.requirement.id} value={item.requirement.id}>{requirementLabel(item.requirement.type, item.requirement.code)}</option>)}</Select></Field></div>
      </Sheet>
    </div>
  );
}

function FollowUpList({ rows, loading, onEdit, onComplete, onCancel, onDelete }: { rows: any[]; loading: boolean; onEdit: (row: any) => void; onComplete: (row: any) => void; onCancel: (row: any) => void; onDelete: (row: any) => void }) {
  if (loading) return <ListSkeleton n={2} />;
  if (!rows.length) return <Empty title="No associated records" />;
  return <Card className="divide-y divide-slate-100">{rows.map((row) => <div key={row.id} className="p-4" data-testid={`command-followup-${row.code}`}>
    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{row.client.name} · {human(row.status)}</p><p className="text-xs text-slate-500">{row.code} · {date(row.scheduledAt)} {row.requirement?.code ? `· ${requirementLabel(row.requirement.type, row.requirement.code)}` : ''}</p></div><div className="flex gap-1"><Button size="sm" variant="ghost" aria-label="Edit follow-up" onClick={() => onEdit(row)}><Pencil className="h-4 w-4" /></Button>{['SCHEDULED', 'RESCHEDULED', 'MISSED'].includes(row.status) && <><Button size="sm" variant="ghost" aria-label="Complete follow-up" onClick={() => onComplete(row)}><Check className="h-4 w-4 text-emerald-600" /></Button><Button size="sm" variant="ghost" aria-label="Cancel follow-up" onClick={() => onCancel(row)}><X className="h-4 w-4" /></Button></>}<Button size="sm" variant="ghost" aria-label="Delete follow-up" onClick={() => onDelete(row)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div></div>
  </div>)}</Card>;
}

function ActivityRow({ item, propertyId }: { item: any; propertyId: string }) {
  const target = item.dealId ? `/deals/${item.dealId}` : item.requirementId ? `/requirements/${item.requirementId}` : item.clientId ? `/clients/${item.clientId}` : item.entityType === 'PROPERTY' && item.action === 'PROPERTY_EDITED' ? `/properties/${propertyId}/edit` : `/properties/${propertyId}`;
  return <Link to={target} className="block p-4 hover:bg-slate-50"><p className="text-sm font-medium">{item.description}</p><p className="mt-1 text-xs text-slate-500">{human(item.action)} · {date(item.createdAt)}</p></Link>;
}
