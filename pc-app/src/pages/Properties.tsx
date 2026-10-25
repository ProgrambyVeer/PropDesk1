import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Copy, FilePenLine, LayoutDashboard, Plus, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { useDebounced, useFetch } from '../lib/hooks';
import { post } from '../lib/api';
import { AMOUNT_LABEL, CATEGORIES, date, human, inr, requirementLabel } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorState, Input, ListSkeleton, Mono, Select, Tabs } from '../components/ui';
import { PropertyCard } from '../components/domain';
import { PropertiesMap } from '../components/maps';

const PRICE_STEPS = [0, 25000, 50000, 100000, 500000, 2500000, 5000000, 10000000, 20000000, 50000000, 100000000, 200000000, 500000000];

export default function Properties() {
  const nav = useNavigate();
  const location = useLocation();
  const restored = (location.state as any)?.propertyListState;
  const [scope, setScope] = useState<'mine' | 'inactive' | 'shared' | 'sent' | 'offers'>(restored?.scope || 'mine');
  const [q, setQ] = useState(restored?.q || '');
  const [filters, setFilters] = useState<any>(restored?.filters || { category: '', kind: '', sort: 'createdAt', bhk: '', max: PRICE_STEPS.length - 1 });
  const [open, setOpen] = useState(!!restored?.open);
  const [view, setView] = useState<'list' | 'map'>(restored?.view || 'list');
  const [sharePage, setSharePage] = useState(1);
  const [shareStatus, setShareStatus] = useState('');
  const [sharedPropertyStatus, setSharedPropertyStatus] = useState('');
  const dq = useDebounced(q);
  const { data, meta, loading, error, reload } = useFetch<any[]>(scope === 'offers' || scope === 'sent' ? null : '/properties', { scope, q: dq, category: filters.category, kind: filters.kind, sort: filters.sort, bhk: filters.bhk, maxPrice: filters.max < PRICE_STEPS.length - 1 ? PRICE_STEPS[filters.max] : '', pageSize: 50 });
  const sentShares = useFetch<any[]>(scope === 'sent' ? '/property-shares' : null, { direction: 'sent', q: dq, shareStatus, propertyStatus: sharedPropertyStatus, page: sharePage, pageSize: 30 });
  const offers = useFetch<any[]>(scope === 'offers' ? '/requirements' : null, { status: 'ACTIVE', pageSize: 100 });
  const offerLeads = useFetch<any[]>(scope === 'offers' ? '/property-client-links' : null, { pageSize: 100 });
  useEffect(() => {
    const refreshProperties = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', refreshProperties);
    document.addEventListener('visibilitychange', refreshProperties);
    return () => {
      window.removeEventListener('focus', refreshProperties);
      document.removeEventListener('visibilitychange', refreshProperties);
    };
  }, [reload]);
  const clientOffers = (offers.data || []).filter((requirement) => requirement.type.endsWith('_OFFERING'));
  const set = (k: string) => (e: any) => setFilters({ ...filters, [k]: e.target.value });
  const copyShareLink = async (propertyId: string) => {
    try {
      const { url } = await post<{ url: string }>(`/properties/${propertyId}/share-link`);
      await navigator.clipboard.writeText(url);
      toast.success('Property link copied');
    } catch (e) { toast.error((e as Error).message || 'Could not copy the property link'); }
  };
  const outgoingShares = (sentShares.data || []).filter((share) => share.targetType === 'PC');
  return (
    <div className="space-y-5" data-testid="properties-page">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-3"><div className="min-w-0"><h1 className="text-3xl font-extrabold tracking-tight">Properties</h1><p className="text-sm text-slate-500">{scope === 'offers' ? `${clientOffers.length} client offering${clientOffers.length === 1 ? '' : 's'}` : scope === 'sent' ? `${sentShares.meta?.total ?? '…'} consultant share${sentShares.meta?.total === 1 ? '' : 's'}` : `${meta?.total ?? '…'} listings`}</p></div>
        <div className="flex shrink-0 items-center gap-2"><Button variant="secondary" onClick={() => nav('/drafts?kind=property')} data-testid="property-drafts-btn"><FilePenLine className="h-4 w-4" />Drafts</Button><Button onClick={() => nav('/properties/new')} data-testid="add-property-btn"><Plus className="h-4 w-4" />Add Property</Button></div></div>
      <Tabs tabs={[{ id: 'mine', label: 'My Active Properties' }, { id: 'inactive', label: 'Inactive Properties' }, { id: 'shared', label: 'Shared with me' }, { id: 'sent', label: 'Shared by Me' }, { id: 'offers', label: 'Client Offerings' }]} value={scope} onChange={(v) => { setScope(v as typeof scope); setSharePage(1); }} testid="properties-scope" />
      {scope !== 'offers' && scope !== 'sent' && <Tabs tabs={[{ id: 'list', label: 'List View' }, { id: 'map', label: 'Map View' }]} value={view} onChange={setView} testid="properties-view" />}
      <div className="flex gap-2"><Input value={q} onChange={(e) => { setQ(e.target.value); setSharePage(1); }} placeholder={scope === 'sent' ? 'Search property or consultant' : 'Search by ID, location, type'} className="min-w-0 flex-1" data-testid="properties-search-input" />
        {scope !== 'sent' && <Button variant="secondary" className="shrink-0" onClick={() => setOpen(!open)} data-testid="properties-filter-btn" aria-label="Filters"><SlidersHorizontal className="h-4 w-4" /></Button>}</div>
      {scope === 'sent' && <div className="grid gap-2 sm:grid-cols-2"><Select value={shareStatus} onChange={(e) => { setShareStatus(e.target.value); setSharePage(1); }} aria-label="Sharing status"><option value="">All sharing statuses</option>{['SENT', 'VIEWED', 'REVOKED'].map((status) => <option key={status} value={status}>{human(status)}</option>)}</Select><Select value={sharedPropertyStatus} onChange={(e) => { setSharedPropertyStatus(e.target.value); setSharePage(1); }} aria-label="Property status"><option value="">All property statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></div>}
      {open && scope !== 'sent' && (
        <div className="grid animate-up gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="properties-filters">
          <Select value={filters.category} onChange={set('category')} data-testid="filter-category"><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{human(c)}</option>)}</Select>
          <Select value={filters.kind} onChange={set('kind')} data-testid="filter-kind"><option value="">Sale, Rent & Lease</option><option value="SALE">Sale</option><option value="RENT">Rent</option><option value="LEASE">Lease</option></Select>
          <Select value={filters.bhk} onChange={set('bhk')} data-testid="filter-bhk"><option value="">Any BHK</option>{[1, 2, 3, 4, 5].map((b) => <option key={b} value={b}>{b} BHK</option>)}</Select>
          <Select value={filters.sort} onChange={set('sort')} data-testid="filter-sort"><option value="createdAt">Newest</option><option value="updatedAt">Recently updated</option><option value="area">Largest area</option></Select>
          <label className="sm:col-span-2 lg:col-span-4"><span className="text-xs font-semibold text-slate-500">Max price: <b className="text-navy">{filters.max === PRICE_STEPS.length - 1 ? '₹50 Cr+' : inr(PRICE_STEPS[filters.max])}</b></span>
            <input type="range" min={0} max={PRICE_STEPS.length - 1} value={filters.max} onChange={(e) => setFilters({ ...filters, max: Number(e.target.value) })} className="mt-2 w-full accent-navy" data-testid="filter-price-slider" /></label>
        </div>
      )}
      {scope === 'sent'
        ? sentShares.error ? <ErrorState message={sentShares.error} retry={sentShares.reload} /> : sentShares.loading && !sentShares.data ? <ListSkeleton /> : !outgoingShares.length ? <Empty title="No consultant shares yet" text="Properties you share with other consultants will appear here." /> :
          <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{outgoingShares.map((share) => <Card key={share.id} className="space-y-3 p-4" data-testid={`shared-by-me-${share.id}`}>
            <Link to={`/properties/${share.property.id}`} className="block">
              <div className="flex items-start justify-between gap-2"><div><Mono>{share.property.code}</Mono><p className="mt-1 font-semibold">{share.property.title || share.property.subtype}</p><p className="text-xs text-slate-500">{share.property.location}</p></div><Badge tone={share.property.status === 'ACTIVE' ? 'green' : 'slate'}>{human(share.property.status)}</Badge></div>
            </Link>
            <p className="text-sm">Shared with <b>{share.receiver?.name || share.receiver?.phone || 'Consultant'}</b></p>
            <p className="text-xs text-slate-500">{human(share.channel)} · {human(share.status)} · {date(share.createdAt)}</p>
            <div className="flex gap-2"><Button size="sm" variant="secondary" className="flex-1" onClick={() => nav(`/properties/${share.property.id}`)}>View Property</Button><Button size="sm" variant="secondary" onClick={() => copyShareLink(share.property.id)} aria-label="Copy property link"><Copy className="h-4 w-4" /></Button></div>
          </Card>)}</div>
          {sentShares.meta?.totalPages > 1 && <div className="flex items-center justify-center gap-3"><Button variant="secondary" size="sm" disabled={sharePage <= 1} onClick={() => setSharePage(sharePage - 1)}>Previous</Button><span className="text-xs text-slate-500">Page {sharePage} of {sentShares.meta.totalPages}</span><Button variant="secondary" size="sm" disabled={sharePage >= sentShares.meta.totalPages} onClick={() => setSharePage(sharePage + 1)}>Next</Button></div>}
          </div>
        : scope === 'offers'
        ? offers.error ? <ErrorState message={offers.error} retry={offers.reload} /> : offers.loading && !offers.data ? <ListSkeleton /> : !clientOffers.length ? <Empty title="No active client offerings" text="Client sale, rent, and lease offers remain associated with their requirements; they are not converted into owned properties." /> :
          <div className="grid gap-3 sm:grid-cols-2">{clientOffers.map((offer) => {
            const associated = (offerLeads.data || []).filter((lead) => lead.requirementId === offer.id);
            return <Card key={offer.id} className="h-full p-4" data-testid={`client-offering-${offer.code}`}>
              <Link to={`/requirements/${offer.id}`} className="block hover:text-brand">
                <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{offer.client?.name || 'Client'} · {human(offer.category)} {offer.subtype || ''}</p><p className="text-xs text-slate-500">{(offer.locations?.length ? offer.locations : [offer.location]).join(', ')}</p></div><Badge tone="amber">{human(offer.type)}</Badge></div>
                <p className="mt-3 text-lg font-extrabold">{offer.type === 'RENT_OFFERING' ? 'Rent / month' : AMOUNT_LABEL[offer.type]} · {inr(offer.amount)}</p>
                {(offer.deposit != null || offer.leasePeriodMonths || offer.availableDate) && <p className="mt-1 text-xs text-slate-500">{[offer.deposit != null ? `Deposit ${inr(offer.deposit)}` : '', offer.leasePeriodMonths ? `${offer.leasePeriodMonths} months` : '', offer.availableDate ? `Available ${date(offer.availableDate)}` : ''].filter(Boolean).join(' · ')}</p>}
                <p className="mt-2 text-xs"><span className="font-mono text-brand-600">{requirementLabel(offer.type, offer.code)}</span> · View requirement</p>
              </Link>
              {associated.map((lead) => <Link key={lead.id} to={`/properties/${lead.propertyId}/manage`} state={{ returnTo: location.pathname, propertyListState: { scope, q, filters, open } }} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand" data-testid={`offer-manage-property-${offer.code}-${lead.property.code}`}><LayoutDashboard className="h-4 w-4" />Manage Property · {lead.property.code}</Link>)}
            </Card>;
          })}</div>
        : error ? <ErrorState message={error} retry={reload} /> : loading && !data ? <ListSkeleton /> : !data?.length ? <Empty title={scope === 'shared' ? 'Nothing shared with you yet' : scope === 'inactive' ? 'No inactive properties' : 'No properties found'} action={scope === 'mine' && <Button onClick={() => nav('/properties/new')}>Add your first property</Button>} /> :
          view === 'map' ? <PropertiesMap properties={data} onOpen={(p) => nav(`/properties/${p.id}`, { state: { returnTo: location.pathname, propertyListState: { scope, q, filters, open, view } } })} /> :
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{data.map((p) => <PropertyCard key={p.id} p={p} onChanged={reload} propertyListState={{ scope, q, filters, open, view }} />)}</div>}
    </div>
  );
}
