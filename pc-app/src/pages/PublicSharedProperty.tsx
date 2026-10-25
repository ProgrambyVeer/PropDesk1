import { Link, useParams } from 'react-router-dom';
import { Building2, MapPin } from 'lucide-react';
import { useFetch } from '../lib/hooks';
import { fileUrl } from '../lib/api';
import { human, txLabel } from '../lib/format';
import { Badge, Card, ErrorState, ListSkeleton } from '../components/ui';

export default function PublicSharedProperty() {
  const { token } = useParams();
  const { data: property, loading, error } = useFetch<any>(`/public/properties/${token}`);
  if (loading) return <div className="mx-auto max-w-3xl p-6"><ListSkeleton n={2} /></div>;
  if (error || !property) return <div className="mx-auto max-w-3xl p-6"><ErrorState message={error || 'Shared property not found'} /></div>;
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-navy sm:py-12" data-testid="public-shared-property">
      <div className="mx-auto max-w-3xl space-y-5">
        <header><p className="text-sm font-bold text-brand">Estate OS Professional</p><p className="text-xs text-slate-500">Shared by {property.owner?.name || 'a property consultant'}</p></header>
        {property.photos?.[0] ? <img src={fileUrl(property.photos[0].url)} alt="" className="max-h-[440px] w-full rounded-2xl object-cover" /> : <div className="flex h-56 items-center justify-center rounded-2xl bg-white text-slate-300"><Building2 className="h-12 w-12" /></div>}
        <Card className="space-y-4 p-5 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono text-sm">{property.code}</p><h1 className="mt-1 text-2xl font-extrabold">{property.title || `${property.bhk ? `${property.bhk} BHK ` : ''}${property.subtype}`}</h1></div><Badge tone={property.status === 'ACTIVE' ? 'green' : 'slate'}>{human(property.status)}</Badge></div>
          <p className="flex items-center gap-1 text-sm text-slate-500"><MapPin className="h-4 w-4" />{property.location}{property.locality ? `, ${property.locality}` : ''}</p>
          <div className="flex flex-wrap gap-2">{property.transactions?.map((transaction: any) => <Badge key={transaction.kind} tone="navy">{txLabel(transaction)}</Badge>)}</div>
          <div className="grid grid-cols-2 gap-3 text-sm">{property.area != null && <p>Area <b>{Math.round(property.area).toLocaleString('en-IN')} sqft</b></p>}{property.bhk != null && <p>Bedrooms <b>{property.bhk} BHK</b></p>}{property.bathrooms != null && <p>Bathrooms <b>{property.bathrooms}</b></p>}</div>
          {property.amenities?.length > 0 && <div><p className="mb-2 text-xs font-bold uppercase text-slate-500">Amenities</p><div className="flex flex-wrap gap-2">{property.amenities.map((item: string) => <Badge key={item} tone="slate">{item}</Badge>)}</div></div>}
          {property.status !== 'ACTIVE' && <p className="text-sm font-semibold text-amber-700">This property is currently inactive.</p>}
        </Card>
        <p className="text-center text-xs text-slate-500">This public link shows approved listing information only.</p>
        <p className="text-center text-sm"><Link to="/login" className="font-semibold text-brand">Sign in to Estate OS Professional</Link></p>
      </div>
    </main>
  );
}
