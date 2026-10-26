import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { ApiError, get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useFetch } from '../lib/hooks';
import { AGES, AMOUNT_LABEL, CATEGORIES, COMMERCIAL_CATS, FACINGS, FURNISHING, human, inr, requirementLabel, REQ_TYPES, SUBTYPES } from '../lib/format';
import { Button, Card, Chips, Field, Input, Select, Skeleton, Textarea } from '../components/ui';
import { LocalityMultiSelect, LocalitySelect } from '../components/domain';

const num = (v: any) => (v === '' || v == null ? null : Number(v));
const NUMS = ['bhk', 'bathrooms', 'area', 'dimLength', 'dimWidth', 'amountMin', 'amount', 'deposit', 'leasePeriodMonths', 'floor', 'totalFloors'];
const DEFAULT_AMENITIES = ['Swimming Pool', 'Gym', 'Clubhouse', 'Security', 'Power Backup', 'Parking', 'Lift', "Children's Play Area", 'Garden', 'CCTV'];

export default function RequirementForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const parseFacing = (value: any) => Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',').map((x: string) => x.trim()).filter(Boolean) : []);
  const isLookingType = (type: string) => ['BUY_LOOKING', 'RENT_LOOKING', 'LEASE_LOOKING'].includes(type);
  const returnedPropertyId = sp.get('propertyId') || '';
  const draftKey = user ? `propdesk:requirement:${user.id}:${id || `new:${sp.get('clientId') || 'unassigned'}`}` : null;
  const [f, setF] = useState<any>({ clientId: sp.get('clientId') || '', type: sp.get('type') || '', propertyId: returnedPropertyId, linkedPropertyId: '', category: '', location: '', locations: [], dimUnit: 'FEET', amenities: [], facing: [] });
  const [client, setClient] = useState<any>(null);
  const [selectedProperty, setSelectedProperty] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | null>(null);
  const [amenities, setAmenities] = useState<any[]>([]);
  const [amenityDraft, setAmenityDraft] = useState('');
  const [facingDraft, setFacingDraft] = useState('');
  const propertyOptions = useFetch<any[]>(f.type.endsWith('_OFFERING') ? '/properties' : null, { scope: 'all', status: 'ACTIVE', pageSize: 100 });
  useEffect(() => {
    const fallback = DEFAULT_AMENITIES.map((name) => ({ id: `default-${name}`, name }));
    get<any[]>('/amenities').then((saved) => setAmenities(saved.length ? saved : fallback)).catch(() => setAmenities(fallback));
  }, []);
  useEffect(() => {
    if (!draftKey) return;
    const raw = localStorage.getItem(draftKey);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (!draft?.form) return;
      const locations = Array.isArray(draft.form.locations) && draft.form.locations.length ? draft.form.locations : (draft.form.location ? [draft.form.location] : []);
      const selectedLocations = isLookingType(draft.form.type) ? locations : locations.slice(0, 1);
      const next = { ...draft.form, propertyId: returnedPropertyId || draft.form.propertyId || '', locations: selectedLocations, location: selectedLocations[0] || '', facing: parseFacing(draft.form.facing), amenities: draft.form.amenities || [] };
      setF((prev: any) => ({ ...prev, ...next }));
    } catch {
      localStorage.removeItem(draftKey);
    }
  }, [draftKey, returnedPropertyId]);
  useEffect(() => {
    if (!id) return;
    get(`/requirements/${id}`).then((r) => {
      const next = { ...r, availableDate: r.availableDate?.slice(0, 10) ?? '', subCategory: r.subCategory || '', facing: parseFacing(r.facing) };
      const draft = draftKey ? (() => { try { return JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { return null; } })() : null;
      const draftBaseline = Date.parse(draft?.baseUpdatedAt || '');
      const stale = !!draft?.form && (!Number.isFinite(draftBaseline) || new Date(r.updatedAt).getTime() > draftBaseline);
      const restoreDraft = !!draft?.form && (!stale || window.confirm('This requirement changed on the server after this draft was saved. Restore the older draft anyway?'));
      if (stale && !restoreDraft) toast.warning('Loaded the latest saved requirement; the older draft was not applied.');
      const draftForm = restoreDraft ? draft.form : {};
      const serverLocations = Array.isArray(r.locations) && r.locations.length ? r.locations : (r.location ? [r.location] : []);
      const draftLocations = Array.isArray(draftForm.locations) && draftForm.locations.length ? draftForm.locations : (draftForm.location ? [draftForm.location] : []);
      const selectedLocations = draftLocations.length ? draftLocations : serverLocations;
      const locations = isLookingType(draftForm.type ?? r.type) ? selectedLocations : selectedLocations.slice(0, 1);
      setBaseUpdatedAt(r.updatedAt);
      const linkedPropertyId = r.links?.find((link: any) => link.status === 'ACTIVE')?.propertyId || '';
      setF({ ...next, ...draftForm, propertyId: returnedPropertyId || draftForm.propertyId || linkedPropertyId, linkedPropertyId, locations, location: locations[0] || '', availableDate: draftForm.availableDate ?? r.availableDate?.slice(0, 10) ?? '', subCategory: draftForm.subCategory ?? r.subCategory ?? '', facing: parseFacing(draftForm.facing ?? r.facing) });
      setClient(r.client); setLoading(false);
    }).catch(() => setLoading(false));
  }, [id, draftKey, returnedPropertyId]);
  useEffect(() => { if (f.clientId) get(`/clients/${f.clientId}`).then(setClient).catch(() => undefined); }, [f.clientId]);
  useEffect(() => {
    if (!f.type.endsWith('_OFFERING') || !f.propertyId) { setSelectedProperty(null); return; }
    get(`/properties/${f.propertyId}`).then((property) => {
      setSelectedProperty(property);
      setF((current: any) => current.propertyId !== property.id ? current : ({
        ...current,
        category: property.category,
        subCategory: property.subCategory || '',
        subtype: property.subtype,
        location: property.location,
        locations: [property.location],
        locality: property.locality || '',
        facing: parseFacing(property.facing),
        area: property.area ?? '',
        bhk: property.bhk ?? '',
        bathrooms: property.bathrooms ?? '',
        floor: property.floor ?? '',
        totalFloors: property.totalFloors ?? '',
        furnishing: property.furnishing || '',
        propertyAge: property.propertyAge || '',
        parking: property.parking || '',
        dimLength: property.dimLength ?? '',
        dimWidth: property.dimWidth ?? '',
        dimUnit: property.dimUnit || 'FEET',
        amenities: property.amenities || [],
      }));
    }).catch((error) => { setSelectedProperty(null); setErrors((current) => ({ ...current, propertyId: (error as Error).message })); });
  }, [f.propertyId, f.type]);
  useEffect(() => {
    if (!draftKey || loading) return;
    const payload = { form: { ...f, facing: parseFacing(f.facing), amenities: f.amenities || [] }, clientId: f.clientId || null, recordId: id || null, updatedAt: Date.now(), baseUpdatedAt };
    localStorage.setItem(draftKey, JSON.stringify(payload));
  }, [draftKey, f, loading, baseUpdatedAt]);
  useEffect(() => {
    const values = parseFacing(f.facing);
    if (isLookingType(f.type)) {
      if (values.length && !values.includes(facingDraft)) setFacingDraft(values[values.length - 1]);
      if (!values.length) setFacingDraft('');
    } else if (!values.length) {
      setFacingDraft('');
    } else if (facingDraft !== values[0]) {
      setFacingDraft(values[0]);
    }
  }, [f.type, f.facing]);
  const set = (k: string, v: any) => setF((x: any) => ({ ...x, [k]: v }));
  const facingValues = parseFacing(f.facing);
  const addFacing = () => {
    if (!facingDraft || facingValues.includes(facingDraft)) return;
    set('facing', [...facingValues, facingDraft]);
    setFacingDraft('');
  };
  const removeFacing = (value: string) => set('facing', facingValues.filter((v: string) => v !== value));
  const saveDraft = () => {
    if (!draftKey) return;
    localStorage.setItem(draftKey, JSON.stringify({ form: { ...f, facing: parseFacing(f.facing), amenities: f.amenities || [] }, clientId: f.clientId || null, recordId: id || null, updatedAt: Date.now(), baseUpdatedAt }));
    toast.success('Draft saved');
  };
  const clearDraft = () => { if (draftKey) localStorage.removeItem(draftKey); };
  const onTypeChange = (nextType: string) => {
    setF((x: any) => {
      const current = parseFacing(x.facing);
      const locations = Array.isArray(x.locations) && x.locations.length ? x.locations : (x.location ? [x.location] : []);
      const nextLocations = isLookingType(nextType) ? locations : locations.slice(0, 1);
      return { ...x, type: nextType, location: nextLocations[0] || '', locations: nextLocations, facing: isLookingType(nextType) ? current : current.slice(0, 1) };
    });
  };
  const inp = (k: string, label: string, type = 'number', req = false, ph = '') => (
    <Field label={label} required={req} error={errors[k]}><Input type={type} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} placeholder={ph} data-testid={`req-${k}-input`} invalid={!!errors[k]} />{type === 'number' && ['amount', 'amountMin', 'deposit'].includes(k) && f[k] ? <span className="mt-1 block text-xs font-semibold text-brand-600">{inr(Number(f[k]))}</span> : null}</Field>
  );
  const sel = (k: string, label: string, opts: string[]) => <Field label={label} error={errors[k]}><Select value={f[k] || ''} onChange={(e) => set(k, e.target.value)} data-testid={`req-${k}-select`}><option value="">Any</option>{opts.map((o) => <option key={o}>{o}</option>)}</Select></Field>;
  const t = f.type as string; const c = f.category as string;
  const looking = t.endsWith('LOOKING'); const rent = t.startsWith('RENT'); const lease = t.startsWith('LEASE');
  const offering = t.endsWith('_OFFERING');
  const ownedProperties = (propertyOptions.data || []).filter((property: any) => !!user && property.ownerId === user.id && property.status === 'ACTIVE');
  const hasLegacyOfferConflict = ownedProperties.some((property: any) => (property.linkedOffers || []).some((offer: any) => offer.clientId !== f.clientId));
  const save = async () => {
    if (busy) return;
    const e: Record<string, string> = {};
    if (!t) e.type = 'Choose a requirement type';
    if (offering && !f.propertyId) e.propertyId = 'Select an existing property or add a property';
    if (offering && f.propertyId && selectedProperty?.id !== f.propertyId) e.propertyId = 'Wait for the selected property to load';
    if (!offering && !c) e.category = 'Choose a category'; if (!offering && !f.location) e.location = 'Location is required';
    if (!offering && c && c !== 'COMMERCIAL' && !f.subtype) e.subtype = 'Choose a subtype'; if (!offering && c === 'COMMERCIAL' && (!f.subtype || !f.subCategory)) e.subtype = 'Choose commercial type and subtype';
    if (!f.amount) e.amount = `${AMOUNT_LABEL[t] || 'Amount'} is required`;
    if (offering && rent && !f.deposit) e.deposit = 'Security deposit is required';
    if (offering && (rent || lease) && !f.availableDate) e.availableDate = 'Effective-from date is required';
    if (offering && (rent || lease) && !f.leasePeriodMonths) e.leasePeriodMonths = rent ? 'Rental period is required' : 'Lease period is required';
    setErrors(e); if (Object.keys(e).length) return;
    setBusy(true);
    const body: any = { ...f, locations: f.locations || [], location: f.locations?.[0] || f.location }; NUMS.forEach((k) => { body[k] = num(f[k]); }); body.availableDate = f.availableDate || null; body.facing = facingValues;
    delete body.code; delete body.id; delete body.propertyId; delete body.linkedPropertyId;
    const atomicOffering = !id && offering && !!f.clientId && !!f.propertyId;
    try {
      let r: any;
      if (atomicOffering) {
        const linked = await post<any[]>(`/clients/${f.clientId}/offerings`, {
          propertyId: f.propertyId,
          offerings: [{
            type: t,
            amount: body.amount,
            deposit: body.deposit,
            leasePeriodMonths: body.leasePeriodMonths,
            availableDate: body.availableDate,
          }],
        });
        const saved = linked.find((item: any) => item.requirement?.type === t);
        r = saved?.requirement;
        if (!r || r.clientId !== f.clientId || saved.link?.clientId !== f.clientId || saved.link?.propertyId !== f.propertyId || saved.link?.requirementId !== r.id) {
          throw new Error('Offering requirement could not be confirmed as linked to the selected client and property');
        }
      } else {
        r = id ? await patch(`/requirements/${id}`, body) : await post('/requirements', body);
      }
      if (!atomicOffering && offering && f.propertyId && f.linkedPropertyId !== f.propertyId) {
        try {
          await post('/property-client-links', { clientId: r.clientId, requirementId: r.id, propertyId: f.propertyId });
        } catch (leadError) {
          if (user) {
            const editKey = `propdesk:requirement:${user.id}:${r.id}`;
            localStorage.setItem(editKey, JSON.stringify({ form: { ...f, id: r.id, code: r.code, linkedPropertyId: '', facing: facingValues, amenities: f.amenities || [] }, clientId: r.clientId, recordId: r.id, updatedAt: Date.now(), baseUpdatedAt: r.updatedAt }));
            if (draftKey && editKey !== draftKey) localStorage.removeItem(draftKey);
          }
          toast.error(`Requirement ${r.code} was saved, but its Lead could not be created: ${(leadError as Error).message}`);
          nav(`/requirements/${r.id}/edit`, { replace: true });
          return;
        }
      }
      if (draftKey) localStorage.removeItem(draftKey);
      toast.success(id ? `${requirementLabel(r.type, r.code)} updated` : `${requirementLabel(r.type, r.code)} created`); nav(`/clients/${r.clientId}`, { replace: true });
    } catch (err) { setErrors((err as ApiError).fieldErrors || {}); toast.error((err as Error).message); } finally { setBusy(false); }
  };
  if (loading) return <Skeleton className="h-96" />;
  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="requirement-form">
      <div><button onClick={() => nav(-1)} className="flex items-center gap-1 text-sm font-semibold text-slate-500"><ArrowLeft className="h-4 w-4" />Back</button>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">{id ? `Edit ${requirementLabel(f.type, f.code)}` : 'Add Requirement'}</h1>
        <p className="text-sm text-slate-500">{client ? `For ${client.name}` : ''}{id ? ' · The Requirement ID never changes' : ' · A unique Requirement ID will be generated'}</p></div>
      <Card className="space-y-5 p-5">
        <Field label="Requirement Type" required error={errors.type}><Chips options={REQ_TYPES} value={t} onChange={onTypeChange} label={human} testid="req-type" /></Field>
        {!offering && <Field label="Property Category" required error={errors.category}><Chips options={CATEGORIES} value={c} onChange={(v) => setF({ ...f, category: v, subtype: '', subCategory: '' })} label={human} testid="req-category" /></Field>}
        {!offering && c === 'COMMERCIAL' && <Field label="Commercial Type" required><Chips options={COMMERCIAL_CATS} value={f.subCategory} onChange={(v) => set('subCategory', v)} testid="req-subcategory" /></Field>}
        {!offering && c && <Field label="Property Subtype" required error={errors.subtype}><Chips options={SUBTYPES[c]} value={f.subtype} onChange={(v) => set('subtype', v)} label={human} testid="req-subtype" /></Field>}
        {offering && <Field label="Property" required error={errors.propertyId} hint={f.linkedPropertyId ? 'This saved property is already associated with the offering.' : 'Property details are taken from the saved property.'}>
          <Select value={f.propertyId || ''} disabled={!!f.linkedPropertyId} onChange={(e) => setF((current: any) => ({ ...current, propertyId: e.target.value, linkedPropertyId: '' }))} data-testid="req-offering-property-select"><option value="">Select existing property</option>{ownedProperties.map((property: any) => {           const conflict = (property.linkedOffers || []).some((offer: any) => offer.clientId !== f.clientId); return <option key={property.id} value={property.id} disabled={conflict}>{property.code} · {property.subtype} · {property.location}{conflict ? ' · already offered to another client' : ''}</option>; })}</Select>
          {hasLegacyOfferConflict && <p className="mt-2 text-xs text-amber-700">Properties with another client’s active offering are unavailable. Resolve the existing offering before creating a new one.</p>}
          {selectedProperty && <p className="mt-2 text-xs text-slate-500">{selectedProperty.code} · {human(selectedProperty.category)} · {selectedProperty.location}{selectedProperty.locality ? ` · ${selectedProperty.locality}` : ''}</p>}
        </Field>}
        {((offering && f.propertyId) || (!offering && c && t)) && <div className="grid gap-4 sm:grid-cols-2">
          {!offering && (looking
            ? <Field label="Locations" required error={errors.location}><LocalityMultiSelect values={f.locations || (f.location ? [f.location] : [])} onChange={(locations) => setF((current: any) => ({ ...current, locations, location: locations[0] || '' }))} testid="req-location-input" invalid={!!errors.location} /></Field>
            : <Field label="Location" required error={errors.location}><LocalitySelect value={f.location || f.locations?.[0] || ''} onChange={(location) => setF((current: any) => ({ ...current, location, locations: location ? [location] : [] }))} testid="req-location-input" invalid={!!errors.location} /></Field>)}
          {!offering && inp('locality', 'Locality', 'text')}
          {!offering && looking && inp('amountMin', `Minimum ${AMOUNT_LABEL[t]} (₹)`)}
          {inp('amount', offering ? (t === 'SELL_OFFERING' ? 'Expected Sale Price (₹)' : rent ? 'Monthly Rent (₹)' : 'Lease Amount (₹)') : `${looking ? 'Maximum ' : ''}${AMOUNT_LABEL[t]} (₹)`, 'number', true)}
          {(offering && (rent || lease)) && inp('deposit', 'Deposit (₹)', 'number', rent)}
          {(lease || (rent && offering)) && inp('leasePeriodMonths', rent ? 'Rental Period (months)' : 'Lease Period (months)', 'number', offering)}
          {offering && (rent || lease) ? inp('availableDate', 'Effective-from Date', 'date', true) : !offering && (rent || lease) && inp('availableDate', t === 'RENT_LOOKING' ? 'Available Date Preference' : 'Available Date', 'date')}
          {!offering && c === 'RESIDENTIAL' && <>{inp('bhk', 'BHK')}{inp('bathrooms', 'Bathrooms')}{inp('floor', 'Floor')}{inp('totalFloors', 'Total Floors')}{sel('furnishing', 'Furnishing', FURNISHING)}{sel('propertyAge', 'Property Age', AGES)}{sel('parking', 'Parking', ['None', 'Open', 'Covered', '2+ Covered'])}</>}
          {!offering && inp('area', 'Area (sqft)')}
          {!offering && (isLookingType(t) ? <Field label="Facing" error={errors.facing}>
            <div className="flex items-center gap-2">
              <Select value={facingDraft} onChange={(e) => setFacingDraft(e.target.value)} data-testid="req-facing-select"><option value="">Select direction</option>{FACINGS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</Select>
              <Button type="button" variant="secondary" onClick={addFacing} disabled={!facingDraft || facingValues.includes(facingDraft)} data-testid="req-facing-add-btn">{facingValues.length ? 'Add More' : 'Add'}</Button>
            </div>
            {facingValues.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{facingValues.map((option: string) => <button key={option} type="button" onClick={() => removeFacing(option)} className="inline-flex items-center gap-1 rounded-full border border-navy bg-navy px-2.5 py-1 text-xs font-bold text-white" data-testid={`req-facing-chip-${option.toLowerCase()}`}>{option} ×</button>)}</div>}
          </Field> : <Field label="Facing" error={errors.facing}><Select value={facingValues[0] || ''} onChange={(e) => set('facing', e.target.value ? [e.target.value] : [])} data-testid="req-facing-select"><option value="">Select direction</option>{FACINGS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}</Select></Field>)}
          {!offering && c === 'COMMERCIAL' && <>{sel('transactionType', 'Transaction Type', ['Outright', 'Pre-leased', 'Revenue Share'])}{sel('availability', 'Availability', ['Immediate', 'Within 1 month', 'Within 3 months', 'Under construction'])}</>}
          {!offering && c === 'LAND' && sel('khata', 'Khata', ['A Khata', 'B Khata', 'E Khata'])}
          {!offering && <div className="sm:col-span-2"><Field label="Dimensions (Length × Width)" error={errors.dimLength}>
            <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2"><Input type="number" value={f.dimLength ?? ''} onChange={(e) => set('dimLength', e.target.value)} placeholder="40" data-testid="req-dimLength-input" /><span className="font-bold text-slate-400">×</span><Input type="number" value={f.dimWidth ?? ''} onChange={(e) => set('dimWidth', e.target.value)} placeholder="60" data-testid="req-dimWidth-input" />
              <Select value={f.dimUnit} onChange={(e) => set('dimUnit', e.target.value)} className="w-24" data-testid="req-dimUnit-select"><option value="FEET">ft</option><option value="METERS">m</option></Select></div></Field></div>}
          {!offering && c === 'RESIDENTIAL' && <div className="sm:col-span-2"><Field label="Amenities"><div className="flex flex-wrap gap-2">{[...new Map([...amenities, ...(f.amenities || []).map((name: string) => ({ id: `selected-${name}`, name }))].map((a: any) => [a.name, a])).values()].map((a: any) => { const on = f.amenities?.includes(a.name); return <button key={a.id} type="button" onClick={() => set('amenities', on ? f.amenities.filter((x: string) => x !== a.name) : [...(f.amenities || []), a.name])} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? 'border-navy bg-navy text-white' : 'border-slate-200'}`} data-testid={`requirement-amenity-${a.name}`}>{a.name}</button>; })}</div><div className="mt-3 flex gap-2"><Input value={amenityDraft} onChange={(event) => setAmenityDraft(event.target.value)} placeholder="Add amenity" data-testid="requirement-amenity-input" /><Button type="button" variant="secondary" onClick={() => { const name = amenityDraft.trim(); if (name && !(f.amenities || []).includes(name)) set('amenities', [...(f.amenities || []), name]); setAmenityDraft(''); }} disabled={!amenityDraft.trim()} data-testid="requirement-amenity-add-btn">Add</Button></div></Field></div>}
          {!offering && <div className="sm:col-span-2"><Field label="Other Requirements"><Textarea value={f.otherRequirements || ''} onChange={(e) => set('otherRequirements', e.target.value)} data-testid="req-other-input" /></Field></div>}
          {id && sel('status', 'Status', ['ACTIVE', 'ON_HOLD', 'FULFILLED', 'CLOSED'])}
        </div>}
      </Card>
      <div className="flex gap-3 gap-fb-3"><Button variant="secondary" className="flex-1" onClick={() => { if (draftKey && localStorage.getItem(draftKey) && !window.confirm('Discard draft?')) return; clearDraft(); nav(-1); }}>Cancel</Button><Button variant="secondary" className="flex-1" onClick={saveDraft}>Save Draft</Button><Button className="flex-1" onClick={save} loading={busy} data-testid="req-save-btn">{id ? 'Save Changes' : offering ? 'Save Requirement' : 'Create Requirement'}</Button></div>
    </div>
  );
}
