import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Building2, MapPin, Ruler, Share2, Link2, Pencil, Trash2, Eye, MessageCircle, Plus, X, LayoutDashboard } from 'lucide-react';
import { ApiError, del, fileUrl, get, patch, post } from '../lib/api';
import { useAction, useDebounced, useFetch } from '../lib/hooks';
import { ago, dims, human, inr, requirementLabel, toLocalInput, txLabel, FU_TYPES, STAGE_TONE } from '../lib/format';
import { BANGALORE_LOCALITIES, type BangaloreLocality } from '../lib/bangaloreLocalities';
import { Badge, Button, Card, Chips, Field, Input, Mono, Select, Sheet, Textarea } from './ui';
import { ContactPickButton } from './ContactPicker';

export function SharedBadge({ label = 'Shared' }: { label?: string }) {
  return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10.5px] font-extrabold text-white shadow-sm" data-testid="shared-indicator"><span className="h-1.5 w-1.5 rounded-full bg-white" />{label}</span>;
}

export function propertyShareLabel(property: any, owner: boolean) {
  const shares = (property.shares || []).filter((share: any) => share.status !== 'REVOKED');
  if (!shares.length) return null;
  if (!owner) {
    const sender = shares.find((share: any) => share.sender)?.sender?.name || property.owner?.name;
    return `Shared by PC: ${sender || 'PC'}`;
  }
  const clientNames = [...new Set(shares.filter((share: any) => share.targetType === 'CLIENT').map((share: any) => share.client?.name).filter(Boolean))];
  const pcNames = [...new Set(shares.filter((share: any) => share.targetType === 'PC').map((share: any) => share.receiver?.name).filter(Boolean))];
  const labels = [
    shares.some((share: any) => share.targetType === 'CLIENT') ? `Shared with Client: ${clientNames.join(', ') || 'Client'}` : '',
    shares.some((share: any) => share.targetType === 'PC') ? `Shared with PC: ${pcNames.join(', ') || 'PC'}` : '',
  ].filter(Boolean);
  return labels.length ? labels.join(' · ') : null;
}

export function PropertyCard({ p, onChanged, propertyListState }: { p: any; onChanged?: () => void; propertyListState?: any }) {
  const nav = useNavigate();
  const location = useLocation();
  const [share, setShare] = useState(false);
  const [link, setLink] = useState(false);
  const owner = p.access !== 'VIEW_ONLY';
  const commandState = { returnTo: location.pathname, propertyListState };
  const commandPath = `/properties/${p.id}/manage`;
  const remove = async () => {
    if (!confirm(`Move ${p.code} to Bin?`)) return;
    await del(`/properties/${p.id}`); toast.success(`${p.code} moved to Bin`); onChanged?.();
  };
  const sharedLabel = p.isShared ? propertyShareLabel(p, owner) : null;
  return (
    <div className="animate-up" data-testid={`property-card-${p.code}`}>
      {sharedLabel && <div className="mb-1.5"><SharedBadge label={sharedLabel} /></div>}
      <Card className="overflow-hidden transition-shadow hover:shadow-lift">
        <Link to={commandPath} state={commandState} className="block">
          <div className="relative aspect-[16/9] bg-slate-100">
            {p.photos?.[0] ? <img src={fileUrl(p.photos[0].url)} alt="" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center text-slate-300"><Building2 className="h-10 w-10" /></div>}
            <div className="absolute left-3 top-3 rounded-lg bg-white/95 px-2 py-1 backdrop-blur"><Mono>{p.code}</Mono></div>
            {p.dealStatus && <Badge tone={STAGE_TONE[p.dealStatus]} className="absolute right-3 top-3 bg-white/95">{human(p.dealStatus)}</Badge>}
          </div>
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <span>{human(p.category)}</span>·<span>{p.subCategory ? `${p.subCategory} · ` : ''}{p.subtype}</span>{p.bhk ? <>·<span>{p.bhk} BHK</span></> : null}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">{p.transactions?.map((t: any) => <span key={t.kind} className="text-lg font-extrabold tracking-tight">{txLabel(t)}{t.kind === 'RENT' && t.depositAmount ? ` · Deposit ${inr(t.depositAmount)}` : ''}{t.kind === 'LEASE' ? `${t.depositAmount ? ` · Deposit ${inr(t.depositAmount)}` : ''}${t.leasePeriodMonths ? ` · ${t.leasePeriodMonths} months` : ''}` : ''}</span>)}</div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">{(p.linkedOffers || []).filter((offer: any) => {
              const kind = offer.type === 'SELL_OFFERING' ? 'SALE' : offer.type === 'RENT_OFFERING' ? 'RENT' : 'LEASE';
              const transaction = p.transactions?.find((item: any) => item.kind === kind && item.status === 'ACTIVE');
              const transactionPrice = transaction?.salePrice ?? transaction?.rentAmount ?? transaction?.leaseAmount;
              return transactionPrice == null || transactionPrice !== offer.amount;
            }).map((offer: any) => <span key={offer.id} className="text-lg font-extrabold tracking-tight" data-testid={`property-offer-price-${offer.code}`}>
              {offer.type === 'SELL_OFFERING' ? 'Expected sale price' : offer.type === 'RENT_OFFERING' ? 'Rent' : 'Lease'} {inr(offer.amount)}{offer.type === 'RENT_OFFERING' ? '/mo' : ''}
              {offer.type !== 'SELL_OFFERING' && offer.deposit != null ? ` · Deposit ${inr(offer.deposit)}` : ''}
              {offer.type === 'LEASE_OFFERING' && offer.leasePeriodMonths ? ` · ${offer.leasePeriodMonths} months` : ''}
              {offer.availableDate ? ` · Available ${new Date(offer.availableDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
            </span>)}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-slate-500">
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{p.location}</span>
              {p.area ? <span>{Math.round(p.area).toLocaleString('en-IN')} sqft</span> : null}
              <span className="flex items-center gap-1"><Ruler className="h-3.5 w-3.5" />{dims(p)}</span>
            </div>
            <div className="flex items-center justify-between pt-1 text-xs text-slate-500">
              <span>{p.interestedClients ?? 0} interested client{p.interestedClients === 1 ? '' : 's'}</span>
              <span>{p.transactions?.find((t: any) => t.availableDate) ? `Available ${new Date(p.transactions.find((t: any) => t.availableDate).availableDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : p.status === 'ACTIVE' ? 'Available now' : human(p.status)}</span>
            </div>
            <div className="text-[11px] font-semibold text-slate-600">Won: {p.wonDeals ?? 0} | Lost: {p.lostDeals ?? 0}</div>
          </div>
        </Link>
        <div className="grid grid-cols-6 border-t border-slate-100 text-slate-500">
          <IconAct icon={Eye} label="View" onClick={() => nav(`/properties/${p.id}`)} id={`view-${p.code}`} />
          <IconAct icon={Pencil} label="Edit" onClick={() => nav(`/properties/${p.id}/edit`)} disabled={!owner} id={`edit-${p.code}`} />
          <IconAct icon={Share2} label="Share" onClick={() => setShare(true)} disabled={!owner} id={`share-${p.code}`} />
          <IconAct icon={Link2} label="Lead" onClick={() => setLink(true)} id={`link-${p.code}`} />
          <IconAct icon={LayoutDashboard} label="Manage Property" onClick={() => nav(commandPath, { state: commandState })} id={`manage-${p.code}`} />
          <IconAct icon={Trash2} label="Delete" onClick={remove} disabled={!owner} id={`delete-${p.code}`} />
        </div>
      </Card>
      <ShareSheet open={share} onClose={() => setShare(false)} property={p} onDone={onChanged} />
      <LinkSheet open={link} onClose={() => setLink(false)} propertyId={p.id} onDone={onChanged} />
    </div>
  );
}
const IconAct = ({ icon: I, label, onClick, disabled, id }: any) => (
  <button onClick={onClick} disabled={disabled} data-testid={`property-action-${id}`} className="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors hover:bg-slate-50 hover:text-navy disabled:opacity-30"><I className="h-4 w-4" />{label}</button>
);

export function ShareSheet({ open, onClose, property, onDone }: { open: boolean; onClose: () => void; property: any; onDone?: () => void }) {
  const [target, setTarget] = useState<'CLIENT' | 'PC'>('CLIENT');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any>(null);
  const { busy, errors, run } = useAction();
  useEffect(() => { if (open) { setResult(null); setPhone(''); } }, [open]);
  const submit = (channel: 'IN_APP' | 'WHATSAPP') => run(async () => {
    const r = await post('/property-shares', { propertyId: property.id, targetType: target, phone, message, channel });
    setResult(r);
    if (r.share) {
      toast.success(r.message);
      if (channel === 'WHATSAPP') window.open(r.whatsappUrl, '_blank');
      onDone?.(); if (channel === 'IN_APP') onClose();
    }
  }).catch((e) => !(e as ApiError).fieldErrors?.phone && toast.error((e as Error).message));
  return (
    <Sheet open={open} onClose={onClose} title={`Share ${property.code}`} testid="share-sheet"
      footer={result && !result.registered ? <Button variant="success" className="w-full" onClick={() => submit('WHATSAPP')} loading={busy} data-testid="share-whatsapp-btn"><MessageCircle className="h-4 w-4" />Share via WhatsApp</Button>
        : <Button className="w-full" onClick={() => submit('IN_APP')} loading={busy} data-testid="share-submit-btn">Share</Button>}>
      <div className="space-y-4">
        <Chips options={['CLIENT', 'PC'] as const} value={target} onChange={(v) => { setTarget(v); setResult(null); }} label={(v) => (v === 'CLIENT' ? 'Share with Client' : 'Share with Property Consultant')} testid="share-target" />
        <Field label="Phone Number" required error={errors.phone}>
          <Input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setResult(null); }} placeholder="10-digit mobile" inputMode="numeric" data-testid="share-phone-input" invalid={!!errors.phone} />
        </Field>
        <Field label="Message (optional)"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi, sharing a property you may like" data-testid="share-message-input" /></Field>
        {result && !result.registered && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800" data-testid="share-not-registered">Number not registered. You can share via WhatsApp instead.</div>}
        <p className="text-xs text-slate-500">Consultants receive an in-app notification with <b>view-only</b> access.</p>
      </div>
    </Sheet>
  );
}

export function LinkSheet({ open, onClose, propertyId, clientId, requirementId, onDone }: { open: boolean; onClose: () => void; propertyId?: string; clientId?: string; requirementId?: string; onDone?: () => void }) {
  const offeringWorkflow = !!clientId && !propertyId && !requirementId;
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [client, setClient] = useState<string>(clientId || '');
  const [req, setReq] = useState<string>(requirementId || '');
  const [prop, setProp] = useState<string>(propertyId || '');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [terms, setTerms] = useState<Record<string, any>>({});
  const [interest, setInterest] = useState<'LOW' | 'MEDIUM' | 'HIGH'>('MEDIUM');
  const [notes, setNotes] = useState('');
  const { busy, run } = useAction();
  const clients = useFetch(open && !clientId ? '/clients' : null, { q: dq, pageSize: 30 });
  const reqs = useFetch(open && client ? '/requirements' : null, { clientId: client, pageSize: 50 });
  const props = useFetch(open && !propertyId ? '/properties' : null, { q: offeringWorkflow ? undefined : dq, pageSize: offeringWorkflow ? 100 : 30, scope: offeringWorkflow ? 'mine' : 'all' });
  const clientProfile = useFetch(open && offeringWorkflow ? `/clients/${clientId}` : null);
  useEffect(() => {
    if (open) {
      setClient(clientId || ''); setReq(requirementId || ''); setProp(propertyId || ''); setQ('');
      setSelectedTypes([]); setTerms({});
    }
  }, [open, clientId, requirementId, propertyId]);
  useEffect(() => {
    if (!offeringWorkflow || !prop || !clientProfile.data?.links) return;
    const existing = clientProfile.data.links.filter((link: any) => link.property.id === prop && String(link.requirement.type).endsWith('_OFFERING'));
    setSelectedTypes(existing.map((link: any) => link.requirement.type));
    setTerms(Object.fromEntries(existing.map((link: any) => [link.requirement.type, {
      amount: link.requirement.amount ?? '', availableDate: link.requirement.availableDate?.slice(0, 10) || '',
      deposit: link.requirement.deposit ?? '', leasePeriodMonths: link.requirement.leasePeriodMonths ?? '',
    }])));
  }, [offeringWorkflow, prop, clientProfile.data]);
  const toggleType = (type: string) => {
    setSelectedTypes((current) => current.includes(type) ? current.filter((x) => x !== type) : [...current, type]);
    setTerms((current) => ({ ...current, [type]: current[type] || { amount: '', deposit: '', availableDate: '', leasePeriodMonths: '' } }));
  };
  const setTerm = (type: string, key: string, value: string) => setTerms((current) => ({ ...current, [type]: { ...(current[type] || {}), [key]: value } }));
  const submit = () => run(async () => {
    if (offeringWorkflow) {
      await post(`/clients/${clientId}/offerings`, {
        propertyId: prop,
        offerings: selectedTypes.map((type) => {
          const timed = type !== 'SELL_OFFERING';
          return {
            type, amount: Number(terms[type]?.amount),
            deposit: timed && terms[type]?.deposit !== '' ? Number(terms[type]?.deposit) : null,
            availableDate: timed ? terms[type]?.availableDate || null : null,
            leasePeriodMonths: timed && terms[type]?.leasePeriodMonths !== '' ? Number(terms[type]?.leasePeriodMonths) : null,
          };
        }),
      });
      toast.success(`${selectedTypes.length} offering requirement${selectedTypes.length === 1 ? '' : 's'} linked`);
    } else {
      await post('/property-client-links', { clientId: client, requirementId: req, propertyId: prop, interestLevel: interest, notes });
      toast.success('Lead created');
    }
    onDone?.(); onClose();
  }).catch((e) => toast.error(e.message));
  const offeringValid = !!prop && selectedTypes.length > 0 && selectedTypes.every((type) => terms[type]?.amount && (type === 'SELL_OFFERING' || (terms[type]?.availableDate && terms[type]?.leasePeriodMonths && (type !== 'RENT_OFFERING' || terms[type]?.deposit))));
  return (
    <Sheet open={open} onClose={onClose} title={offeringWorkflow ? 'Link Property' : 'Create Lead'} testid="link-sheet" footer={<Button className="w-full" disabled={offeringWorkflow ? !offeringValid : !client || !req || !prop} loading={busy} onClick={submit} data-testid="link-submit-btn">{offeringWorkflow ? 'Link selected offerings' : 'Create Lead'}</Button>}>
      <div className="space-y-4">
        {offeringWorkflow && <>
          <Field label="Property" required><Select value={prop} onChange={(e) => setProp(e.target.value)} data-testid="link-offering-property-select"><option value="">Select existing property</option>{props.data?.map((p: any) => {
            const unavailable = p.linkedOffers?.some((offer: any) => offer.clientId !== clientId);
            return <option key={p.id} value={p.id} disabled={unavailable}>{p.code} · {p.subtype} · {p.location}{unavailable ? ' · offered to another client' : ''}</option>;
          })}</Select></Field>
          <Field label="Offering types" required><div className="flex flex-wrap gap-2">{['SELL_OFFERING', 'RENT_OFFERING', 'LEASE_OFFERING'].map((type) => <button type="button" key={type} onClick={() => toggleType(type)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${selectedTypes.includes(type) ? 'border-navy bg-navy text-white' : 'border-slate-200'}`} data-testid={`link-offering-type-${type}`}>{human(type)}</button>)}</div></Field>
          {selectedTypes.map((type) => {
            const rent = type === 'RENT_OFFERING'; const lease = type === 'LEASE_OFFERING'; const term = terms[type] || {};
            return <Card key={type} className="space-y-3 p-4"><p className="font-bold text-navy">{human(type)} terms</p>
              <Field label={type === 'SELL_OFFERING' ? 'Selling amount' : type === 'RENT_OFFERING' ? 'Rent amount' : 'Lease amount'} required><Input type="number" value={term.amount} onChange={(e) => setTerm(type, 'amount', e.target.value)} data-testid={`link-${type}-amount`} /></Field>
              {(rent || lease) && <Field label="Security deposit" required={rent}><Input type="number" value={term.deposit} onChange={(e) => setTerm(type, 'deposit', e.target.value)} data-testid={`link-${type}-deposit`} /></Field>}
              {(rent || lease) && <><Field label="Effective from" required><Input type="date" value={term.availableDate} onChange={(e) => setTerm(type, 'availableDate', e.target.value)} data-testid={`link-${type}-date`} /></Field><Field label={rent ? 'Rental period (months)' : 'Lease period (months)'} required><Input type="number" value={term.leasePeriodMonths} onChange={(e) => setTerm(type, 'leasePeriodMonths', e.target.value)} data-testid={`link-${type}-period`} /></Field></>}
            </Card>;
          })}
        </>}
        {!offeringWorkflow && (!clientId || !propertyId) && <Input placeholder={!propertyId ? 'Search properties' : 'Search clients'} value={q} onChange={(e) => setQ(e.target.value)} data-testid="link-search-input" />}
        {!offeringWorkflow && <>{!clientId && <Field label="Client" required><Select value={client} onChange={(e) => { setClient(e.target.value); setReq(''); }} data-testid="link-client-select"><option value="">Select client</option>{clients.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}</Select></Field>}
          {!requirementId && <Field label="Requirement" required hint="This lead connects the property to one specific requirement"><Select value={req} onChange={(e) => setReq(e.target.value)} data-testid="link-requirement-select"><option value="">Select requirement</option>{reqs.data?.filter((r: any) => String(r.type).endsWith('_LOOKING')).map((r: any) => <option key={r.id} value={r.id}>{requirementLabel(r.type, r.code)} · {r.location}</option>)}</Select></Field>}
          {!propertyId && <Field label="Property" required><Select value={prop} onChange={(e) => setProp(e.target.value)} data-testid="link-property-select"><option value="">Select property</option>{props.data?.map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.subtype} · {p.location}</option>)}</Select></Field>}
          <Field label="Interest Level"><Chips options={['LOW', 'MEDIUM', 'HIGH'] as const} value={interest} onChange={setInterest} label={human} testid="link-interest" /></Field>
          <Field label="Notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="link-notes-input" /></Field>
        </>}
      </div>
    </Sheet>
  );
}

export function FollowUpSheet({ open, onClose, initial, onDone }: { open: boolean; onClose: () => void; initial?: any; onDone?: () => void }) {
  const editing = !!initial?.id;
  const [f, setF] = useState<any>({});
  const { busy, errors, run } = useAction();
  useEffect(() => {
    if (open) setF({ clientId: initial?.clientId || '', requirementId: initial?.requirementId || '', propertyId: initial?.propertyId || '', dealId: initial?.dealId || '', type: initial?.type || 'CALL', notes: initial?.notes || '', reminderMinutes: initial?.reminderMinutes ?? 30, scheduledAt: toLocalInput(initial?.scheduledAt ? new Date(initial.scheduledAt) : new Date(Date.now() + 3600e3)) });
  }, [open, initial]);
  const clients = useFetch(open ? '/clients' : null, { pageSize: 100, sort: 'name', order: 'asc' });
  const reqs = useFetch(open && f.clientId ? '/requirements' : null, { clientId: f.clientId, pageSize: 50 });
  const props = useFetch(open ? '/properties' : null, { pageSize: 100, scope: 'all' });
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target ? e.target.value : e });
  const submit = () => run(async () => {
    const body = { ...f, scheduledAt: new Date(f.scheduledAt).toISOString(), reminderMinutes: Number(f.reminderMinutes) };
    if (editing) await (await import('../lib/api')).patch(`/follow-ups/${initial.id}`, body); else await post('/follow-ups', body);
    toast.success(editing ? 'Follow-up updated' : 'Follow-up scheduled'); window.dispatchEvent(new Event('notifications:changed')); onDone?.(); onClose();
  }).catch((e) => toast.error(e.message));
  return (
    <Sheet open={open} onClose={onClose} title={editing ? `Edit ${initial.code}` : 'New Follow-up'} testid="followup-sheet" footer={<Button className="w-full" onClick={submit} loading={busy} data-testid="followup-save-btn">{editing ? 'Save' : 'Schedule'}</Button>}>
      <div className="space-y-4">
        <Field label="Client" required error={errors.clientId}><Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value, requirementId: '' })} data-testid="followup-client-select"><option value="">Select client</option>{clients.data?.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Requirement" error={errors.requirementId}><Select value={f.requirementId} onChange={set('requirementId')} data-testid="followup-requirement-select"><option value="">None</option>{reqs.data?.map((r: any) => <option key={r.id} value={r.id}>{requirementLabel(r.type, r.code)}</option>)}</Select></Field>
        <Field label="Property" error={errors.propertyId}><Select value={f.propertyId} onChange={set('propertyId')} data-testid="followup-property-select"><option value="">None</option>{props.data?.map((p: any) => <option key={p.id} value={p.id}>{p.code} · {p.location}</option>)}</Select></Field>
        <Field label="Type" required><Chips options={FU_TYPES} value={f.type} onChange={set('type')} label={human} testid="followup-type" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date & Time" required error={errors.scheduledAt}><Input type="datetime-local" value={f.scheduledAt} onChange={set('scheduledAt')} data-testid="followup-datetime-input" /></Field>
          <Field label="Reminder"><Select value={f.reminderMinutes} onChange={set('reminderMinutes')} data-testid="followup-reminder-select">{[0, 10, 15, 30, 60, 120, 1440].map((m) => <option key={m} value={m}>{m === 0 ? 'At time' : m < 60 ? `${m} min before` : m === 1440 ? '1 day before' : `${m / 60} hr before`}</option>)}</Select></Field>
        </div>
        <Field label="Notes"><Textarea value={f.notes} onChange={set('notes')} data-testid="followup-notes-input" /></Field>
      </div>
    </Sheet>
  );
}

export function ClientSheet({ open, onClose, initial, onSaved }: { open: boolean; onClose: () => void; initial?: any; onSaved: (c: any) => void }) {
  const [f, setF] = useState<any>({ name: '', phone: '', location: '', email: '', isHot: false });
  const { busy, errors, run } = useAction();
  useEffect(() => {
    if (!open) return;
    setF({ name: initial?.name || '', phone: initial?.phone || '', location: initial?.location || '', email: initial?.email || '', isHot: initial?.isHot || false });
  }, [open, initial]);
  const submit = () => run(async () => {
    const c = initial?.id ? await patch(`/clients/${initial.id}`, f) : await post('/clients', f);
    onSaved(c);
  }).catch((e) => !Object.keys((e as ApiError).fieldErrors || {}).length && toast.error(e.message));
  return (
    <Sheet open={open} onClose={onClose} title={initial?.id ? 'Edit Client' : 'Add Client'} testid="client-sheet" footer={<><Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button><Button className="flex-1" onClick={submit} loading={busy} data-testid="client-save-btn">Save</Button></>}>
      <div className="space-y-4">
        <Field label="Name" required error={errors.name}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Rahul Sharma" data-testid="client-name-input" invalid={!!errors.name} /></Field>
        <Field label="Phone Number" required error={errors.phone}><div className="flex gap-2"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" placeholder="98765 43210" data-testid="client-phone-input" invalid={!!errors.phone} /><ContactPickButton onPick={(c) => setF((x: any) => ({ ...x, phone: c.phone || x.phone, name: x.name || c.name }))} /></div></Field>
        <Field label="Location" required error={errors.location}><LocalitySelect value={f.location} onChange={(v) => setF({ ...f, location: v })} testid="client-location-input" invalid={!!errors.location} /></Field>
        <Field label="Gmail / Email" error={errors.email}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@gmail.com" data-testid="client-email-input" /></Field>
        <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={f.isHot} onChange={(e) => setF({ ...f, isHot: e.target.checked })} data-testid="client-hot-checkbox" className="h-4 w-4 accent-red-500" />Mark as hot client</label>
      </div>
    </Sheet>
  );
}

export function LocalitySelect({ value, onChange, testid, invalid, exclude = [], clearAfterSelect = false }: { value: string; onChange: (v: string) => void; testid: string; invalid?: boolean; exclude?: string[]; clearAfterSelect?: boolean }) {
  const [query, setQuery] = useState(value || '');
  const [options, setOptions] = useState<BangaloreLocality[]>(BANGALORE_LOCALITIES);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (value && value !== query) setQuery(value); }, [value]);
  useEffect(() => {
    const timer = setTimeout(() => get<BangaloreLocality[]>('/locations', { q: query, city: 'Bengaluru' }).then((saved) => {
      const byName = new Map([...BANGALORE_LOCALITIES, ...saved].map((option) => [option.area.trim().toLowerCase(), option]));
      setOptions([...byName.values()]);
    }).catch(() => setOptions(BANGALORE_LOCALITIES)), 180);
    return () => clearTimeout(timer);
  }, [query]);
  const search = (query || '').trim().toLowerCase();
  const filtered = options.filter((option) =>
    (!search || `${option.area} ${option.city} ${option.pincode}`.toLowerCase().includes(search)) &&
    !exclude.some((item) => item.trim().toLowerCase() === option.area.trim().toLowerCase()),
  );
  return <div className="relative">
    <Input value={query} onFocus={() => setOpen(true)} onChange={(event) => { const next = event.target.value; setQuery(next); setOpen(true); if (next !== value) onChange(''); }} placeholder="Search Bengaluru localities" data-testid={testid} invalid={invalid} role="combobox" aria-expanded={open} aria-autocomplete="list" />
    {open && filtered.length > 0 && <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lift" role="listbox">{filtered.map((option) => <button type="button" key={option.id} role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.area); setQuery(clearAfterSelect ? '' : option.area); setOpen(false); }} className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"><span>{option.area}</span><span className="text-xs text-slate-400">{option.city}</span></button>)}</div>}
  </div>;
}

export function LocalityMultiSelect({ values, onChange, testid, invalid }: { values: string[]; onChange: (v: string[]) => void; testid: string; invalid?: boolean }) {
  const [selectors, setSelectors] = useState<number[]>([]);
  const [queries, setQueries] = useState<Record<number, string>>({ 0: '' });
  const [nextId, setNextId] = useState(1);
  const choose = (id: number, value: string) => {
    if (!value || values.some((item) => item.trim().toLowerCase() === value.trim().toLowerCase())) return;
    onChange([...values, value]);
    setSelectors((current) => current.filter((selector) => selector !== id));
    setQueries((current) => { const next = { ...current }; delete next[id]; return next; });
  };
  const addSelector = () => {
    if (selectors.length) return;
    setSelectors([nextId]);
    setQueries((current) => ({ ...current, [nextId]: '' }));
    setNextId((id) => id + 1);
  };
  const visibleSelectors = selectors.length ? selectors : values.length === 0 ? [0] : [];
  return <div className="space-y-2">
    {values.length > 0 && <div className="flex flex-wrap gap-2">{values.map((value) => <span key={value.toLowerCase()} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold" data-testid={`${testid}-selected-${value.toLowerCase().replace(/\W+/g, '-')}`}>{value}<button type="button" onClick={() => onChange(values.filter((item) => item !== value))} aria-label={`Remove ${value}`} className="text-slate-500 hover:text-red-600"><X className="h-3.5 w-3.5" /></button></span>)}</div>}
    {visibleSelectors.map((id) => <LocalitySelect key={id} value={queries[id] || ''} onChange={(value) => { setQueries((current) => ({ ...current, [id]: value })); if (value) choose(id, value); }} testid={id === 0 ? testid : `${testid}-${id + 1}`} invalid={invalid && values.length === 0} exclude={values} clearAfterSelect />)}
    {values.length > 0 && !selectors.length && <button type="button" onClick={addSelector} className="inline-flex items-center gap-1 text-sm font-semibold text-brand" data-testid={`${testid}-add-btn`}><Plus className="h-4 w-4" />Add another locality</button>}
  </div>;
}

export function Timeline({ items, testid = 'timeline' }: { items?: any[]; testid?: string }) {
  if (!items?.length) return <p className="text-sm text-slate-500">No activity yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-5" data-testid={testid}>
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand ring-2 ring-brand-100" />
          <p className="text-sm font-medium">{a.description}</p>
          <p className="mt-0.5 text-xs text-slate-400">{human(a.action)} · {ago(a.createdAt)}{a.requirementCode ? ` · ${a.requirementCode}` : ''}</p>
        </li>
      ))}
    </ol>
  );
}

export const Stat = ({ label, value, testid, accent, to }: { label: string; value: React.ReactNode; testid?: string; accent?: boolean; to?: string }) => {
  const card = (
    <div className={`rounded-2xl p-4 ${accent ? 'bg-navy text-white' : 'border border-slate-200/80 bg-white shadow-card'} ${to ? 'transition-shadow hover:shadow-lift' : ''}`} data-testid={testid}>
      <p className={`text-[11px] font-bold uppercase tracking-wider ${accent ? 'text-blue-200' : 'text-slate-500'}`}>{label}</p>
      <p className="mt-1.5 text-2xl font-extrabold tracking-tight">{value}</p>
    </div>
  );
  return to ? <Link to={to} className="block rounded-2xl" aria-label={`Open ${label}`}>{card}</Link> : card;
};
export { inr };
