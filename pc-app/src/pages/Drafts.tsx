import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FilePenLine, Trash2 } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { human, requirementLabel } from '../lib/format';
import { Button, Card, Empty } from '../components/ui';

type Draft = { key: string; kind: 'property' | 'requirement'; recordId?: string; clientId?: string; form: any; updatedAt: number };

export default function Drafts() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const kindFilter = searchParams.get('kind');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const refresh = useCallback(() => {
    if (!user) return setDrafts([]);
    const prefixes = [`propdesk:property:${user.id}:`, `propdesk:requirement:${user.id}:`];
    const found: Draft[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      const prefix = prefixes.find((value) => key.startsWith(value));
      if (!prefix) continue;
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (!saved?.form) continue;
        const kind = prefix.includes(':property:') ? 'property' : 'requirement';
        const form = saved.form;
        const meaningful = kind === 'property'
          ? [form.category, form.subtype, form.location, form.title, form.bhk, form.area].some(Boolean)
          : [form.clientId, form.type, form.category, form.locations?.length, form.location, form.amount].some(Boolean);
        if (!meaningful) continue;
        const suffix = key.slice(prefix.length);
        const newRequirement = kind === 'requirement' && (suffix === 'new' || suffix.startsWith('new:'));
        found.push({ key, kind, recordId: saved.recordId || (suffix === 'new' || newRequirement ? undefined : suffix), clientId: saved.clientId || form.clientId || undefined, form, updatedAt: Number(saved.updatedAt) || 0 });
      } catch { localStorage.removeItem(key); }
    }
    setDrafts(found.sort((a, b) => b.updatedAt - a.updatedAt));
  }, [user]);
  useEffect(() => {
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); };
  }, [refresh]);
  const continueEditing = (draft: Draft) => nav(draft.kind === 'property'
    ? draft.recordId ? `/properties/${draft.recordId}/edit` : '/properties/new'
    : draft.recordId ? `/requirements/${draft.recordId}/edit` : `/requirements/new${draft.clientId ? `?clientId=${encodeURIComponent(draft.clientId)}` : ''}`);
  const remove = (draft: Draft) => {
    const label = draft.kind === 'property' ? 'property' : 'requirement';
    if (!window.confirm(`Delete this ${label} draft? This cannot be undone.`)) return;
    localStorage.removeItem(draft.key);
    refresh();
  };
  const title = (draft: Draft) => draft.kind === 'property'
    ? draft.form.title || [draft.form.subtype, draft.form.location].filter(Boolean).join(' · ') || 'Untitled property'
    : [draft.form.type && requirementLabel(draft.form.type, draft.form.code), (draft.form.locations || [draft.form.location]).filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Untitled requirement';
  const visibleDrafts = drafts.filter((draft) => kindFilter !== 'property' || draft.kind === 'property').filter((draft) => kindFilter !== 'requirement' || draft.kind === 'requirement');
  const heading = kindFilter === 'property' ? 'Property Drafts' : kindFilter === 'requirement' ? 'Requirement Drafts' : 'Drafts';
  return <div className="space-y-5" data-testid="drafts-page">
    <div><h1 className="text-3xl font-extrabold">{heading}</h1><p className="text-sm text-slate-500">Unfinished properties and requirements saved on this device.</p></div>
    {!visibleDrafts.length ? <Empty title={`No ${kindFilter || ''} drafts`.replace(/\s+/g, ' ').trim()} icon={<FilePenLine className="h-6 w-6" />} /> : <Card className="divide-y divide-slate-100">
      {visibleDrafts.map((draft) => <div key={draft.key} className="flex flex-wrap items-center justify-between gap-3 p-4" data-testid={`draft-${draft.kind}-${draft.recordId || 'new'}`}>
        <div className="min-w-0"><p className="text-[11px] font-bold uppercase text-slate-400">{draft.recordId ? `Edit ${draft.kind}` : `New ${draft.kind}`}{draft.kind === 'requirement' && draft.recordId && draft.form.code ? ` · ${requirementLabel(draft.form.type, draft.form.code)}` : ''}</p><p className="truncate font-semibold">{title(draft)}</p><p className="text-xs text-slate-500">Updated {draft.updatedAt ? new Date(draft.updatedAt).toLocaleString() : 'just now'}</p></div>
        <div className="flex gap-2"><Button size="sm" onClick={() => continueEditing(draft)} data-testid={`draft-continue-${draft.kind}-${draft.recordId || 'new'}`}>Continue Editing</Button><Button size="sm" variant="ghost" onClick={() => remove(draft)} aria-label="Delete draft" data-testid={`draft-delete-${draft.kind}-${draft.recordId || 'new'}`}><Trash2 className="h-4 w-4 text-red-600" /></Button></div>
      </div>)}
    </Card>}
  </div>;
}