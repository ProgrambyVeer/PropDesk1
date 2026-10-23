import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Pencil, Plus, Trash2 } from 'lucide-react';
import { ApiError, get, post } from '../lib/api';
import { AGES, AMOUNT_LABEL, CATEGORIES, COMMERCIAL_CATS, FACINGS, FURNISHING, human, inr, REQ_TYPES, SUBTYPES } from '../lib/format';
import { Button, Card, Chips, Field, Input, Select, Skeleton, Textarea } from '../components/ui';
import { LocalityMultiSelect } from '../components/domain';
import { ContactPickButton } from '../components/ContactPicker';

// Only "looking" types are offered: offering requirements must be tied to one of the PC's saved properties,
// which a public client can never select.
const TYPES = REQ_TYPES.filter((t) => t.endsWith('_LOOKING'));
const NUMS = ['bhk', 'bathrooms', 'area', 'dimLength', 'dimWidth', 'amountMin', 'amount', 'deposit', 'leasePeriodMonths', 'floor', 'totalFloors'];
const num = (v: any) => (v === '' || v == null ? null : Number(v));
const blank = () => ({ type: '', category: '', location: '', locations: [] as string[], dimUnit: 'FEET', amenities: [] as string[], facing: [] as string[] });
const keyFor = (token: string) => `estateos:public-requirement:${token}`;

function validate(f: any) {
  const e: Record<string, string> = {};
  if (!f.type) e.type = 'Choose a requirement type';
  if (!f.category) e.category = 'Choose a category';
  if (!f.locations?.length) e.location = 'Select at least one location';
  if (f.category && f.category !== 'COMMERCIAL' && !f.subtype) e.subtype = 'Choose a subtype';
  if (f.category === 'COMMERCIAL' && (!f.subtype || !f.subCategory)) e.subtype = 'Choose commercial type and subtype';
  if (!f.amount) e.amount = `${AMOUNT_LABEL[f.type] || 'Amount'} is required`;
  if (f.amountMin && f.amount && Number(f.amountMin) > Number(f.amount)) e.amountMin = 'Minimum cannot exceed maximum';
  if (f.type?.startsWith('LEASE') && !f.leasePeriodMonths) e.leasePeriodMonths = 'Lease period is required';
  return e;
}

function toPayload(f: any) {
  const body: any = { ...f, location: f.locations[0], locations: f.locations };
  NUMS.forEach((k) => { body[k] = num(f[k]); });
  body.availableDate = f.availableDate || null;
  const { uid: _uid, ...rest } = body;
  return rest;
}

function describe(f: any) {
  return [human(f.category), f.subCategory, f.subtype, f.bhk ? `${f.bhk} BHK` : ''].filter(Boolean).join(' · ');
}

function RequirementEditor({ initial, onSave, onCancel }: { initial: any; onSave: (f: any) => void; onCancel: () => void }) {
  const [f, setF] = useState<any>(initial);
  const [errors, setErrors] = useState<Record<string, string>>(initial.__errors || {});
  const [facingDraft, setFacingDraft] = useState('');
  const [amenityDraft, setAmenityDraft] = useState('');
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const t: string = f.type; const c: string = f.category;
  const rent = t.startsWith('RENT'); const lease = t.startsWith('LEASE');
  const inp = (k: string, label: string, type = 'number', req = false) => (
    <Field label={label} required={req} error={errors[k]}><Input type={type} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} invalid={!!errors[k]} data-testid={`pub-req-${k}-input`} />
      {type === 'number' && ['amount', 'amountMin', 'deposit'].includes(k) && f[k] ? <span className="mt-1 block text-xs font-semibold text-brand-600">{inr(Number(f[k]))}</span> : null}</Field>
  );
  const sel = (k: string, label: string, opts: string[]) => <Field label={label}><Select value={f[k] || ''} onChange={(e) => set(k, e.target.value)}><option value="">Any</option>{opts.map((o) => <option key={o}>{o}</option>)}</Select></Field>;
  const save = () => { const e = validate(f); setErrors(e); if (!Object.keys(e).length) { const { __errors: _x, ...clean } = f; onSave(clean); } };
  return (
    <Card className="space-y-5 p-5" data-testid="pub-req-editor">
      <Field label="What is the client looking for?" required error={errors.type}><Chips options={TYPES} value={t} onChange={(v) => setF((x: any) => ({ ...x, type: v }))} label={human} testid="pub-req-type" /></Field>
      <Field label="Property Category" required error={errors.category}><Chips options={CATEGORIES} value={c} onChange={(v) => setF((x: any) => ({ ...x, category: v, subtype: '', subCategory: '' }))} label={human} testid="pub-req-category" /></Field>
      {c === 'COMMERCIAL' && <Field label="Commercial Type" required><Chips options={COMMERCIAL_CATS} value={f.subCategory} onChange={(v) => set('subCategory', v)} testid="pub-req-subcategory" /></Field>}
      {c && <Field label="Property Subtype" required error={errors.subtype}><Chips options={SUBTYPES[c]} value={f.subtype} onChange={(v) => set('subtype', v)} label={human} testid="pub-req-subtype" /></Field>}
      {c && t && <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Locations" required error={errors.location}><LocalityMultiSelect values={f.locations} onChange={(locations) => setF((x: any) => ({ ...x, locations, location: locations[0] || '' }))} testid="pub-req-location-input" invalid={!!errors.location} /></Field>
        {inp('locality', 'Locality', 'text')}
        {inp('amountMin', `Minimum ${AMOUNT_LABEL[t]} (₹)`)}
        {inp('amount', `Maximum ${AMOUNT_LABEL[t]} (₹)`, 'number', true)}
        {(rent || lease) && inp('deposit', 'Deposit (₹)')}
        {lease && inp('leasePeriodMonths', 'Lease Period (months)', 'number', true)}
        {(rent || lease) && inp('availableDate', t === 'RENT_LOOKING' ? 'Available Date Preference' : 'Available Date', 'date')}
        {c === 'RESIDENTIAL' && <>{inp('bhk', 'BHK')}{inp('bathrooms', 'Bathrooms')}{inp('floor', 'Floor')}{inp('totalFloors', 'Total Floors')}{sel('furnishing', 'Furnishing', FURNISHING)}{sel('propertyAge', 'Property Age', AGES)}{sel('parking', 'Parking', ['None', 'Open', 'Covered', '2+ Covered'])}</>}
        {inp('area', 'Area (sqft)')}
        <Field label="Facing">
          <div className="flex items-center gap-2"><Select value={facingDraft} onChange={(e) => setFacingDraft(e.target.value)}><option value="">Select direction</option>{FACINGS.map((o) => <option key={o}>{o}</option>)}</Select>
            <Button type="button" variant="secondary" disabled={!facingDraft || f.facing.includes(facingDraft)} onClick={() => { set('facing', [...f.facing, facingDraft]); setFacingDraft(''); }}>Add</Button></div>
          {f.facing.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{f.facing.map((o: string) => <button key={o} type="button" onClick={() => set('facing', f.facing.filter((x: string) => x !== o))} className="rounded-full border border-navy bg-navy px-2.5 py-1 text-xs font-bold text-white">{o} ×</button>)}</div>}
        </Field>
        {c === 'COMMERCIAL' && <>{sel('transactionType', 'Transaction Type', ['Outright', 'Pre-leased', 'Revenue Share'])}{sel('availability', 'Availability', ['Immediate', 'Within 1 month', 'Within 3 months', 'Under construction'])}</>}
        {c === 'LAND' && sel('khata', 'Khata', ['A Khata', 'B Khata', 'E Khata'])}
        <div className="sm:col-span-2"><Field label="Dimensions (Length × Width)">
          <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2"><Input type="number" value={f.dimLength ?? ''} onChange={(e) => set('dimLength', e.target.value)} placeholder="40" /><span className="font-bold text-slate-400">×</span><Input type="number" value={f.dimWidth ?? ''} onChange={(e) => set('dimWidth', e.target.value)} placeholder="60" />
            <Select value={f.dimUnit} onChange={(e) => set('dimUnit', e.target.value)} className="w-24"><option value="FEET">ft</option><option value="METERS">m</option></Select></div></Field></div>
        {c === 'RESIDENTIAL' && <div className="sm:col-span-2"><Field label="Amenities">
          <div className="flex flex-wrap gap-2">{['Swimming Pool', 'Gym', 'Clubhouse', 'Security', 'Power Backup', 'Parking', 'Lift', "Children's Play Area", 'Garden', 'CCTV', ...f.amenities.filter((a: string) => !['Swimming Pool', 'Gym', 'Clubhouse', 'Security', 'Power Backup', 'Parking', 'Lift', "Children's Play Area", 'Garden', 'CCTV'].includes(a))].map((a) => { const on = f.amenities.includes(a); return <button key={a} type="button" onClick={() => set('amenities', on ? f.amenities.filter((x: string) => x !== a) : [...f.amenities, a])} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? 'border-navy bg-navy text-white' : 'border-slate-200'}`}>{a}</button>; })}</div>
          <div className="mt-3 flex gap-2"><Input value={amenityDraft} onChange={(e) => setAmenityDraft(e.target.value)} placeholder="Add amenity" /><Button type="button" variant="secondary" disabled={!amenityDraft.trim()} onClick={() => { const n = amenityDraft.trim(); if (n && !f.amenities.includes(n)) set('amenities', [...f.amenities, n]); setAmenityDraft(''); }}>Add</Button></div></Field></div>}
        <div className="sm:col-span-2"><Field label="Other Requirements"><Textarea value={f.otherRequirements || ''} onChange={(e) => set('otherRequirements', e.target.value)} /></Field></div>
      </div>}
      <div className="flex gap-3"><Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button><Button className="flex-1" onClick={save} data-testid="pub-req-save-btn">Save Requirement</Button></div>
    </Card>
  );
}

export default function PublicRequirement() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<any>(null);
  const [loadError, setLoadError] = useState('');
  const [client, setClient] = useState({ name: '', phone: '' });
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<{ index: number; draft: any } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const uid = useRef(0);
  const idempotencyKey = useRef('');
  if (!idempotencyKey.current) {
    const stored = sessionStorage.getItem(keyFor(token));
    idempotencyKey.current = stored || (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    sessionStorage.setItem(keyFor(token), idempotencyKey.current);
  }
  useEffect(() => {
    get(`/public/requirement-requests/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setLoadError((e as Error).message));
  }, [token]);

  const startAdd = () => setEditing({ index: -1, draft: { ...blank(), uid: ++uid.current } });
  const saveItem = (f: any) => {
    setItems((list) => (editing && editing.index >= 0 ? list.map((x, i) => (i === editing.index ? f : x)) : [...list, f]));
    setEditing(null); setErrors({});
  };
  const removeItem = (i: number) => { setItems((list) => list.filter((_, j) => j !== i)); setErrors({}); };

  const submit = async () => {
    if (busy) return;
    const e: Record<string, string> = {};
    if (client.name.trim().length < 2) e.name = 'Enter your full name';
    if (!/^[6-9]\d{9}$/.test(client.phone)) e.phone = 'Enter a valid 10-digit Indian mobile number';
    if (!items.length) e.requirements = 'Add at least one requirement';
    setErrors(e); if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await post(`/public/requirement-requests/${encodeURIComponent(token)}`, { idempotencyKey: idempotencyKey.current, client: { name: client.name.trim(), phone: client.phone }, requirements: items.map(toPayload) });
      sessionStorage.removeItem(keyFor(token));
      setDone(r);
    } catch (err) {
      const fe = (err as ApiError).fieldErrors || {};
      const mapped: Record<string, string> = {};
      for (const [k, v] of Object.entries(fe)) mapped[k.startsWith('client.') ? k.slice(7) : k] = v;
      mapped.form = (err as Error).message;
      setErrors(mapped);
      const bad = Object.keys(fe).map((k) => /^requirements\.(\d+)\./.exec(k)?.[1]).find((x) => x != null);
      if (bad != null) setEditing({ index: Number(bad), draft: { ...items[Number(bad)], __errors: Object.fromEntries(Object.entries(fe).filter(([k]) => k.startsWith(`requirements.${bad}.`)).map(([k, v]) => [k.split('.').slice(2).join('.'), v])) } });
    } finally { setBusy(false); }
  };

  const shell = (body: React.ReactNode) => (
    <div className="mx-auto min-h-screen max-w-2xl space-y-6 p-4 pb-16" data-testid="public-requirement-page">
      <div className="flex items-center gap-3 pt-2"><img src="/logo-mark.png" alt="" className="h-10 w-10 rounded-xl" onError={(e) => { e.currentTarget.style.display = 'none'; }} /><div><p className="text-lg font-extrabold tracking-tight">EstateOS</p><p className="text-xs text-slate-500">Property requirement form</p></div></div>
      {body}
    </div>
  );
  if (loadError) return shell(<Card className="p-6 text-center"><p className="font-bold">This link isn't valid</p><p className="mt-1 text-sm text-slate-500">Please ask your property consultant to send you a new link.</p></Card>);
  if (!info) return shell(<Skeleton className="h-64" />);
  if (done) return shell(
    <Card className="space-y-3 p-6 text-center" data-testid="public-requirement-success"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
      <p className="text-xl font-extrabold">Thank you!</p>
      <p className="text-sm text-slate-600">{info.agentName} has received your {done.requirements.length} requirement{done.requirements.length === 1 ? '' : 's'} and will be in touch.</p>
      <div className="flex flex-wrap justify-center gap-2">{done.requirements.map((r: any) => <span key={r.code} className="rounded-full bg-slate-100 px-3 py-1 font-mono text-xs font-semibold">{r.code}</span>)}</div></Card>);
  if (info.status !== 'OPEN') return shell(<Card className="p-6 text-center"><p className="font-bold">{info.status === 'USED' ? 'This form has already been submitted' : 'This link has expired'}</p><p className="mt-1 text-sm text-slate-500">Please ask {info.agentName} to send you a new link.</p></Card>);

  return shell(<>
    <p className="text-sm text-slate-600"><b>{info.agentName}</b>{info.companyName ? ` (${info.companyName})` : ''} has asked you to share your property requirements. No account is needed.</p>
    <Card className="space-y-4 p-5">
      <h2 className="font-bold">Your details</h2>
      <Field label="Full name" required error={errors.name}><Input value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} placeholder="Rahul Sharma" autoComplete="name" invalid={!!errors.name} data-testid="pub-client-name" /></Field>
      <Field label="Phone number" required error={errors.phone}><div className="flex gap-2"><Input value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" invalid={!!errors.phone} data-testid="pub-client-phone" /><ContactPickButton onPick={(c) => setClient((x) => ({ name: x.name || c.name, phone: c.phone || x.phone }))} testid="pub-contact-pick-btn" /></div></Field>
    </Card>
    <div className="space-y-3">
      <h2 className="font-bold">Requirements ({items.length})</h2>
      {errors.requirements && <p className="text-sm font-semibold text-red-600">{errors.requirements}</p>}
      {items.map((f, i) => (
        <Card key={f.uid} className="flex items-start justify-between gap-3 p-4" data-testid={`pub-req-summary-${i}`}>
          <div className="min-w-0"><p className="font-semibold">{i + 1}. {human(f.type)}</p><p className="text-sm text-slate-600">{describe(f)}</p><p className="text-xs text-slate-500">{f.locations.join(', ')} · up to {inr(Number(f.amount))}</p></div>
          <div className="flex shrink-0 gap-1"><Button variant="ghost" size="sm" onClick={() => setEditing({ index: i, draft: f })} aria-label={`Edit requirement ${i + 1}`} data-testid={`pub-req-edit-${i}`}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="sm" onClick={() => removeItem(i)} aria-label={`Delete requirement ${i + 1}`} data-testid={`pub-req-delete-${i}`}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>
        </Card>))}
      {editing ? <RequirementEditor key={editing.draft.uid} initial={editing.draft} onSave={saveItem} onCancel={() => setEditing(null)} /> : <Button variant="secondary" className="w-full" onClick={startAdd} data-testid="pub-add-requirement-btn"><Plus className="h-4 w-4" />{items.length ? 'Add Another Requirement' : 'Add Requirement'}</Button>}
    </div>
    {errors.form && !editing && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{errors.form}</p>}
    <Button className="w-full" size="lg" onClick={submit} loading={busy} disabled={!!editing || !items.length} data-testid="pub-submit-btn">Submit {items.length || ''} Requirement{items.length === 1 ? '' : 's'}</Button>
  </>);
}
