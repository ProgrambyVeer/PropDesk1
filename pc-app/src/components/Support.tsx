import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LifeBuoy, Mail, Monitor, Moon, Phone, Sun, Ticket } from 'lucide-react';
import clsx from 'clsx';
import { ApiError, get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { date, time } from '../lib/format';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { Badge, Button, Card, Field, Input, Select, Sheet, Textarea } from './ui';

const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
];

export function AppearanceCard() {
  const [pref, setPref] = useState<ThemePref>(getThemePref);
  const choose = (p: ThemePref) => { setThemePref(p); setPref(p); };
  return (
    <Card className="space-y-3 p-5" data-testid="appearance-card">
      <div><h2 className="font-bold">Appearance</h2><p className="text-sm text-slate-500">Choose how Estate OS looks on this device.</p></div>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
        {THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={pref === t.id} onClick={() => choose(t.id)} data-testid={`theme-${t.id}`}
            className={clsx('flex min-h-[64px] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-semibold transition-colors', pref === t.id ? 'btn-primary border-navy bg-navy text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
            <t.icon className="h-5 w-5" strokeWidth={1.75} />{t.label}
          </button>
        ))}
      </div>
    </Card>
  );
}

const CATEGORIES = ['Login & Account', 'Profile & Settings', 'Clients', 'Properties', 'Requirements & Matching', 'Deals & Follow-ups', 'Sharing', 'Notifications', 'Technical Issue', 'Other'];
const MODULES = ['Home', 'Clients', 'Properties', 'Requirements', 'Deals', 'Follow Ups', 'Notifications', 'Drafts & Bin', 'Profile', 'Other'];
const URGENCIES = [['LOW', 'Low'], ['NORMAL', 'Normal'], ['HIGH', 'High'], ['URGENT', 'Urgent']];
const STATUS: Record<string, [string, string]> = { OPEN: ['Open', 'amber'], IN_PROGRESS: ['In Progress', 'blue'], RESOLVED: ['Resolved', 'green'], CLOSED: ['Closed', 'slate'] };

function TicketDetail({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [t, setT] = useState<any>(null);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const load = () => get(`/support/tickets/${id}`).then((d) => { setT(d); setErr(''); }).catch((e) => setErr((e as Error).message || 'Could not load this ticket.'));
  useEffect(() => { setT(null); setErr(''); setText(''); setConfirmClose(false); if (id) load(); }, [id]);
  const send = async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try { setT(await post(`/support/tickets/${id}/messages`, { body: text.trim() })); setText(''); onChanged(); }
    catch (e) { toast.error((e as Error).message || 'Could not send your message.'); }
    finally { setBusy(false); }
  };
  const closeTicket = async () => {
    if (busy) return;
    setBusy(true);
    try { setT(await post(`/support/tickets/${id}/close`)); setConfirmClose(false); onChanged(); toast.success('Ticket closed'); }
    catch (e) { toast.error((e as Error).message || 'Could not close the ticket.'); }
    finally { setBusy(false); }
  };
  const isClosed = t?.status === 'CLOSED';
  return (
    <Sheet open={!!id} onClose={onClose} title={t ? t.code : 'Ticket'} testid="ticket-detail"
      footer={t && !isClosed ? (
        <div className="w-full space-y-2">
          <div className="flex gap-2">
            <Textarea value={text} onChange={(e: any) => setText(e.target.value)} maxLength={2000} rows={2} placeholder="Write a reply…" aria-label="Reply" data-testid="ticket-reply-input" />
            <Button onClick={send} loading={busy} disabled={!text.trim()} data-testid="ticket-reply-send">Send</Button>
          </div>
          {confirmClose ? (
            <div className="flex items-center justify-between gap-2 text-sm"><span className="text-slate-600">Close this ticket? You can't reply afterwards.</span><span className="flex gap-2"><Button variant="secondary" onClick={() => setConfirmClose(false)} disabled={busy}>Cancel</Button><Button onClick={closeTicket} loading={busy} data-testid="ticket-close-confirm">Close</Button></span></div>
          ) : <button type="button" onClick={() => setConfirmClose(true)} className="text-sm font-semibold text-slate-500 underline" data-testid="ticket-close-btn">Close Ticket</button>}
        </div>
      ) : undefined}>
      {err ? <p className="py-4 text-center text-sm text-red-600" data-testid="ticket-detail-error">{err}</p> : !t ? <p className="py-4 text-center text-sm text-slate-500">Loading…</p> : (
        <div className="space-y-4">
          <div>
            <div className="flex items-start justify-between gap-2"><h3 className="font-bold">{t.summary}</h3><Badge tone={STATUS[t.status]?.[1] || 'slate'} className="shrink-0" data-testid="ticket-detail-status">{STATUS[t.status]?.[0] || t.status}</Badge></div>
            <p className="mt-1 text-xs text-slate-500">{t.category}{t.module ? ` · ${t.module}` : ''} · {date(t.createdAt)} {time(t.createdAt)}{t.closedAt ? ` · Closed ${date(t.closedAt)}` : ''}</p>
            <p className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-slate-50 px-3 py-2.5 text-sm">{t.description}</p>
          </div>
          <div className="space-y-2" data-testid="ticket-messages">
            {!t.messages.length ? <p className="text-center text-sm text-slate-500">No replies yet. Our team will respond here.</p> : t.messages.map((m: any) => (
              <div key={m.id} className={clsx('flex', m.sender === 'PC' ? 'justify-end' : 'justify-start')}>
                <div className={clsx('max-w-[85%] rounded-2xl px-3 py-2 text-sm', m.sender === 'PC' ? 'bg-navy text-white' : 'bg-slate-100')}>
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className="mt-1 text-[11px] opacity-70">{m.sender === 'PC' ? 'You' : 'Support'} · {date(m.createdAt)} {time(m.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
          {isClosed && <p className="text-center text-xs text-slate-500">This ticket is closed.</p>}
        </div>
      )}
    </Sheet>
  );
}

export function HelpSupportCard() {
  const { user } = useAuth();
  const blank = { category: '', module: '', summary: '', description: '', urgency: 'NORMAL', contactEmail: (user && user.email) || '' };
  const [info, setInfo] = useState<{ email: string | null; phone: string | null } | null>(null);
  const [tickets, setTickets] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<any>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadTickets = () => get('/support/tickets').then(setTickets).catch(() => setTickets([]));
  useEffect(() => { get('/support/info').then(setInfo).catch(() => setInfo({ email: null, phone: null })); loadTickets(); }, []);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.category) e.category = 'Select an issue category';
    if (f.summary.trim().length < 3) e.summary = 'Summary is required';
    if (f.description.trim().length < 10) e.description = 'Please describe the issue (at least 10 characters)';
    if (!/^\S+@\S+\.\S+$/.test(f.contactEmail.trim())) e.contactEmail = 'Enter a valid email address';
    return e;
  };
  const submit = async () => {
    if (busy) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const t = await post('/support/tickets', { ...f, contactEmail: f.contactEmail.trim() });
      setCreated(t); setF(blank); loadTickets();
    } catch (err) {
      setErrors((err as ApiError).fieldErrors || {});
      toast.error((err as Error).message || 'Could not submit the ticket. Please try again.');
    } finally { setBusy(false); }
  };
  const close = () => { setOpen(false); setCreated(null); setErrors({}); };
  const set = (k: string) => (ev: { target: { value: string } }) => setF({ ...f, [k]: ev.target.value });

  return (
    <Card className="space-y-4 p-5" data-testid="help-support-card">
      <div className="flex items-start gap-3"><LifeBuoy className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" strokeWidth={1.75} /><div><h2 className="font-bold">Help &amp; Support</h2><p className="text-sm text-slate-500">Reach the support team or raise a ticket.</p></div></div>
      {info && (info.email || info.phone ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {info.email && <a href={`mailto:${info.email}`} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50" data-testid="support-email-link"><Mail className="h-4 w-4 shrink-0" strokeWidth={1.75} /><span className="min-w-0 truncate">Email Support<span className="block truncate text-xs font-medium text-slate-500">{info.email}</span></span></a>}
          {info.phone && <a href={`tel:${info.phone.replace(/[^\d+]/g, '')}`} className="flex min-h-[44px] items-center gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold hover:bg-slate-50" data-testid="support-phone-link"><Phone className="h-4 w-4 shrink-0" strokeWidth={1.75} /><span className="min-w-0 truncate">Call Support<span className="block truncate text-xs font-medium text-slate-500">{info.phone}</span></span></a>}
        </div>
      ) : <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm text-slate-500" data-testid="support-contact-missing">Support contact details are not configured yet. You can still raise a ticket below.</p>)}
      <Button onClick={() => setOpen(true)} className="w-full sm:w-auto" data-testid="raise-ticket-btn"><Ticket className="h-4 w-4" strokeWidth={1.75} />Raise a Ticket</Button>
      <div className="space-y-2" data-testid="my-tickets">
        <h3 className="text-[13px] font-semibold text-slate-700">My Tickets</h3>
        {tickets === null ? <p className="text-sm text-slate-500">Loading…</p> : !tickets.length ? <p className="text-sm text-slate-500">You haven't raised any tickets yet.</p> : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {tickets.map((t) => (
              <li key={t.id} data-testid={`ticket-${t.code}`}><button type="button" onClick={() => setOpenId(t.id)} className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{t.summary}</p><p className="truncate text-xs text-slate-500"><span className="font-mono">{t.code}</span> · {t.category} · {date(t.createdAt)}</p></div>
                <Badge tone={STATUS[t.status]?.[1] || 'slate'} className="shrink-0">{STATUS[t.status]?.[0] || t.status}</Badge>
              </button></li>
            ))}
          </ul>
        )}
      </div>
      <TicketDetail id={openId} onClose={() => setOpenId(null)} onChanged={loadTickets} />
      <Sheet open={open} onClose={close} title={created ? 'Ticket submitted' : 'Raise a Ticket'} testid="ticket-sheet"
        footer={created ? <Button className="w-full" onClick={close}>Done</Button> : <><Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button><Button className="flex-1" onClick={submit} loading={busy} data-testid="ticket-submit-btn">Submit Ticket</Button></>}>
        {created ? (
          <div className="space-y-2 py-2 text-center" data-testid="ticket-success"><p className="text-sm text-slate-600">Your ticket has been recorded.</p><p className="font-mono text-lg font-bold" data-testid="ticket-code">{created.code}</p><p className="text-xs text-slate-500">Keep this reference ID when contacting support.</p></div>
        ) : (
          <div className="space-y-4">
            <Field label="Issue Category" required error={errors.category}><Select value={f.category} onChange={set('category')} invalid={!!errors.category} data-testid="ticket-category"><option value="">Select a category</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Affected Screen / Module"><Select value={f.module} onChange={set('module')} data-testid="ticket-module"><option value="">Not sure</option>{MODULES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Issue Summary" required error={errors.summary}><Input value={f.summary} maxLength={120} onChange={set('summary')} invalid={!!errors.summary} placeholder="Short title of the problem" data-testid="ticket-summary" /></Field>
            <Field label="Describe the Issue" required error={errors.description} hint="What happened, and what did you expect to happen?"><Textarea rows={5} value={f.description} onChange={set('description')} invalid={!!errors.description} data-testid="ticket-description" /></Field>
            <Field label="Urgency"><Select value={f.urgency} onChange={set('urgency')} data-testid="ticket-urgency">{URGENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="Contact Email" required error={errors.contactEmail} hint="Used for this ticket only. Your account email is not changed."><Input type="email" inputMode="email" value={f.contactEmail} onChange={set('contactEmail')} invalid={!!errors.contactEmail} data-testid="ticket-email" /></Field>
          </div>
        )}
      </Sheet>
    </Card>
  );
}
