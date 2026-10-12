import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Funnel, FunnelChart, LabelList, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { request } from '../lib/api';
import { useFetch } from '../lib/hooks';
import { human, inr, requirementLabel, txLabel } from '../lib/format';
import { Badge, Button, Card, Empty, ErrorState, ListSkeleton, Section } from '../components/ui';
import { Stat } from '../components/domain';

const COLORS = ['#0F172A', '#2563EB', '#60A5FA', '#10B981', '#F59E0B', '#94A3B8', '#6366F1', '#EF4444', '#0EA5E9'];
const ChartCard = ({ title, children }: { title: string; children: React.ReactElement }) => <Card className="p-4"><p className="mb-3 text-sm font-bold">{title}</p><div className="h-56"><ResponsiveContainer>{children}</ResponsiveContainer></div></Card>;
const PieC = ({ data }: { data: any[] }) => <PieChart><Pie data={data.map((d) => ({ ...d, name: human(d.name) }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>{data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /></PieChart>;

async function allRows<T>(path: string, query: Record<string, unknown> = {}) {
  const first = await request<T[]>(path, { query: { ...query, page: 1, pageSize: 100 } });
  const rows = [...first.data];
  for (let page = 2; page <= (first.meta?.totalPages || 1); page += 1) {
    const next = await request<T[]>(path, { query: { ...query, page, pageSize: 100 } });
    rows.push(...next.data);
  }
  return rows;
}

async function metricRows(metric: string) {
  if (['total-properties', 'active-properties', 'sold', 'rented', 'leased'].includes(metric)) {
    const status = metric === 'active-properties' ? 'ACTIVE' : metric === 'sold' ? 'SOLD' : metric === 'rented' ? 'RENTED' : metric === 'leased' ? 'LEASED' : undefined;
    return allRows<any>('/properties', status ? { status } : {});
  }
  if (metric === 'total-clients' || metric === 'new-clients-30d') {
    const clients = await allRows<any>('/clients');
    return metric === 'new-clients-30d' ? clients.filter((client) => Date.now() - new Date(client.createdAt).getTime() <= 30 * 86400e3) : clients;
  }
  if (metric === 'active-requirements') return allRows<any>('/requirements', { status: 'ACTIVE' });
  if (metric === 'matches') {
    const requirements = await allRows<any>('/requirements', { status: 'ACTIVE' });
    const groups = await Promise.all(requirements.filter((requirement) => requirement.type.endsWith('_LOOKING')).map(async (requirement) => {
      const result = await request<any[]>(`/requirements/${requirement.id}/matches`);
      return result.data.map((match) => ({ ...match, requirement }));
    }));
    return groups.flat();
  }
  if (metric === 'site-visits') return allRows<any>('/follow-ups', { type: 'SITE_VISIT' });
  if (metric === 'deals' || metric === 'closed-deals' || metric === 'deal-value' || metric === 'expected-commission' || metric === 'earned-commission') {
    const deals = await allRows<any>('/deals');
    if (metric === 'closed-deals' || metric === 'earned-commission') return deals.filter((deal) => deal.stage === 'CLOSED');
    if (metric === 'expected-commission') return deals.filter((deal) => !['CLOSED', 'LOST'].includes(deal.stage));
    return deals.filter((deal) => deal.stage !== 'LOST');
  }
  return [];
}

function MetricRow({ metric, row }: { metric: string; row: any }) {
  if (metric === 'matches') return <Link to={`/requirements/${row.requirement.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-semibold">{row.property.subtype} · {row.property.location}</p><p className="truncate text-xs text-slate-500">{row.requirement.client?.name} · {requirementLabel(row.requirement.type, row.requirement.code)} · {row.score}% match</p></div><MonoCode>{row.property.code}</MonoCode></Link>;
  if (row.code?.startsWith('PROP-')) return <Link to={`/properties/${row.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-semibold">{row.title || `${human(row.category)} · ${row.subtype}`}</p><p className="truncate text-xs text-slate-500">{row.location} · {human(row.status)}{row.transactions?.length ? ` · ${row.transactions.map(txLabel).join(' | ')}` : ''}</p></div><MonoCode>{row.code}</MonoCode></Link>;
  if (row.code?.startsWith('CLI-')) return <Link to={`/clients/${row.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-semibold">{row.name}</p><p className="truncate text-xs text-slate-500">+91 {row.phone} · {row.location}</p></div><MonoCode>{row.code}</MonoCode></Link>;
  if (row.code?.startsWith('REQ-')) return <Link to={`/requirements/${row.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-semibold">{human(row.type)} · {row.subtype || human(row.category)}</p><p className="truncate text-xs text-slate-500">{row.client?.name} · {(row.locations?.length ? row.locations : [row.location]).join(', ')} · {inr(row.amount)}</p></div><MonoCode>{row.code}</MonoCode></Link>;
  if (row.code?.startsWith('FU-')) return <Link to="/follow-ups" className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div className="min-w-0"><p className="truncate font-semibold">{human(row.type)} · {row.client.name}</p><p className="truncate text-xs text-slate-500">{new Date(row.scheduledAt).toLocaleString()} · {human(row.status)}</p></div><MonoCode>{row.code}</MonoCode></Link>;
  if (row.code?.startsWith('DEAL-')) return <Link to={`/deals/${row.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-slate-50"><div className="min-w-0"><p className="truncate text-sm text-slate-500">{requirementLabel(row.requirement.type, row.requirement.code)}</p><p className="truncate font-semibold">{row.client.name} · {row.property.code}</p><p className="truncate text-xs text-slate-500">{human(row.stage)} · {inr(row.dealValue)}</p></div><MonoCode>{row.code}</MonoCode></Link>;
  return null;
}

const MonoCode = ({ children }: { children: React.ReactNode }) => <span className="shrink-0 font-mono text-xs font-semibold text-brand-600">{children}</span>;

export default function Analytics() {
  const { data: a, loading, error } = useFetch<any>('/analytics');
  const [selected, setSelected] = useState<{ key: string; label: string } | null>(null);
  const [detail, setDetail] = useState<any[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const openMetric = async (key: string, label: string) => {
    setSelected({ key, label }); setDetail(null); setDetailError(''); setDetailLoading(true);
    try { setDetail(await metricRows(key)); } catch (e) { setDetailError((e as Error).message); }
    finally { setDetailLoading(false); }
  };
  if (error) return <ErrorState message={error} />;
  if (loading || !a) return <ListSkeleton n={6} />;
  const t = a.totals;
  return (
    <div className="space-y-8" data-testid="analytics-page">
      <h1 className="text-3xl font-extrabold tracking-tight">Analytics</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["total-properties", 'Total Properties', t.totalProperties], ['active-properties', 'Active Properties', t.activeProperties], ['sold', 'Sold', t.sold], ['rented', 'Rented', t.rented], ['leased', 'Leased', t.leased], ['total-clients', 'Total Clients', t.totalClients], ['new-clients-30d', 'New Clients (30d)', t.newClients], ['active-requirements', 'Active Requirements', t.activeRequirements], ['matches', 'Matches', t.matches], ['site-visits', 'Site Visits', t.siteVisits], ['deals', 'Deals', t.deals], ['closed-deals', 'Closed Deals', t.closedDeals], ['deal-value', 'Deal Value', inr(t.dealValue)], ['expected-commission', 'Expected Commission', inr(t.expectedCommission)], ['earned-commission', 'Earned Commission', inr(t.earnedCommission)]].map(([key, label, value]) => <button key={key} type="button" onClick={() => openMetric(String(key), String(label))} className="rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand" data-testid={`analytics-card-${key}`}><Stat label={String(label)} value={value as any} accent={['deal-value', 'expected-commission', 'earned-commission'].includes(String(key))} testid={`analytics-${key}`} /></button>)}
      </div>
      {selected && <Section title={`${selected.label} · ${detail?.length ?? 0} records`} action={<Button size="sm" variant="ghost" onClick={() => { setSelected(null); setDetail(null); }} data-testid="analytics-detail-close">Close</Button>}>
        {detailLoading ? <ListSkeleton n={3} /> : detailError ? <ErrorState message={detailError} /> : !detail?.length ? <Empty title={`No ${selected.label.toLowerCase()} records`} /> : <Card className="divide-y divide-slate-100">{detail.map((row: any, index) => <MetricRow key={row.id || `${row.requirement?.id}-${row.property?.id}` || index} metric={selected.key} row={row} />)}</Card>}
      </Section>}
      <Section title="Performance"><div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Monthly Deals"><BarChart data={a.monthlyDeals}><CartesianGrid strokeDasharray="3 3" stroke="#EEF2F7" /><XAxis dataKey="month" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="created" fill="#94A3B8" radius={[6, 6, 0, 0]} /><Bar dataKey="closed" fill="#0F172A" radius={[6, 6, 0, 0]} /></BarChart></ChartCard>
        <ChartCard title="Monthly Commission"><LineChart data={a.monthlyCommission}><CartesianGrid strokeDasharray="3 3" stroke="#EEF2F7" /><XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} tickFormatter={(v) => inr(v)} width={70} /><Tooltip formatter={(v: any) => inr(v)} /><Line dataKey="earned" stroke="#10B981" strokeWidth={2.5} /><Line dataKey="expected" stroke="#2563EB" strokeWidth={2} strokeDasharray="4 4" /></LineChart></ChartCard>
        <ChartCard title="Deal Funnel"><FunnelChart><Tooltip /><Funnel dataKey="count" data={a.dealFunnel.filter((x: any) => x.count).map((x: any, i: number) => ({ ...x, name: human(x.stage), fill: COLORS[i % COLORS.length] }))} isAnimationActive><LabelList position="right" fill="#0F172A" stroke="none" dataKey="name" fontSize={11} /></Funnel></FunnelChart></ChartCard>
        <ChartCard title="Follow-up Completion"><PieC data={a.followUpCompletion} /></ChartCard>
        <ChartCard title="Property Distribution"><PieC data={a.propertyDistribution} /></ChartCard>
        <ChartCard title="Client Distribution (by requirement type)"><PieC data={a.clientDistribution} /></ChartCard>
        <ChartCard title="Locations"><BarChart data={a.locations} layout="vertical"><XAxis type="number" allowDecimals={false} fontSize={11} /><YAxis type="category" dataKey="name" width={110} fontSize={11} /><Tooltip /><Bar dataKey="value" fill="#2563EB" radius={[0, 6, 6, 0]} /></BarChart></ChartCard>
        <ChartCard title="Property Types"><BarChart data={a.propertyTypes}><XAxis dataKey="name" fontSize={11} /><YAxis allowDecimals={false} fontSize={11} /><Tooltip /><Bar dataKey="value" fill="#0F172A" radius={[6, 6, 0, 0]} /></BarChart></ChartCard>
      </div></Section>
    </div>
  );
}
