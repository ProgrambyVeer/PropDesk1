import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera } from 'lucide-react';
import { ApiError, fileUrl, get, patch, post, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { initials } from '../lib/format';
import { Badge, Button, Card, Field, Input, Sheet, Textarea } from '../components/ui';
import { AppearanceCard, AppPermissions } from '../components/Support';

export default function Profile({ section = 'profile' }: { section?: 'profile' | 'company' | 'settings' }) {
  const { user, setUser } = useAuth();
  const [f, setF] = useState<any>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(section !== 'profile');
  const file = useRef<HTMLInputElement>(null);
  const [req, setReq] = useState<any>(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [reqF, setReqF] = useState({ newEmail: '', reason: '' });
  const [reqErr, setReqErr] = useState<Record<string, string>>({});
  const [reqBusy, setReqBusy] = useState(false);
  useEffect(() => { if (section === 'profile') get('/profile/email-change').then(setReq).catch(() => undefined); }, [section]);
  const sendReq = async () => {
    const e: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reqF.newEmail.trim())) e.newEmail = 'Enter a valid email address';
    if (reqF.reason.trim().length < 5) e.reason = 'Please give a short reason';
    setReqErr(e); if (Object.keys(e).length) return;
    setReqBusy(true);
    try { setReq(await post('/profile/email-change', reqF)); setReqOpen(false); setReqF({ newEmail: '', reason: '' }); toast.success('Request sent for admin approval'); }
    catch (err) { setReqErr((err as ApiError).fieldErrors || {}); toast.error((err as Error).message); } finally { setReqBusy(false); }
  };
  const pending = req?.status === 'PENDING';
  useEffect(() => { if (user) setF({ name: user.name, email: user.email || '', ...(user.profile || {}), areas: (user.profile?.areasOfOperation || []).join(', ') }); }, [user]);
  useEffect(() => { setEditing(section !== 'profile'); }, [section]);
  if (!user) return null;
  const editable = section !== 'profile' || editing;
  const cancel = () => {
    setF({ name: user.name, email: user.email || '', ...(user.profile || {}), areas: (user.profile?.areasOfOperation || []).join(', ') });
    setErrors({}); setEditing(false);
  };
  const save = async () => {
    setBusy(true); setErrors({});
    try {
      const u = await patch('/profile', { name: f.name, companyName: f.companyName, reraNumber: f.reraNumber, officeAddress: f.officeAddress, whatsappNumber: f.whatsappNumber, companyWebsite: f.companyWebsite, gstNumber: f.gstNumber, areasOfOperation: String(f.areas || '').split(',').map((s) => s.trim()).filter(Boolean) });
      setUser(u); setEditing(false); toast.success('Profile saved');
    } catch (e) { setErrors((e as ApiError).fieldErrors); toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const photo = async (files: FileList | null) => { if (!files?.[0]) return; try { const r = await upload('/profile/photo', 'photo', [files[0]]); setUser({ ...user, profile: { ...user.profile, photoUrl: r.photoUrl } }); toast.success('Photo updated'); } catch (e) { toast.error((e as Error).message); } };
  const inp = (k: string, label: string, ph = '') => <Field label={label} error={errors[k]}><Input value={f[k] || ''} disabled={!editable} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={ph} data-testid={`profile-${k}-input`} /></Field>;
  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid={`${section}-page`}>
      <div className="flex items-center justify-between gap-3"><h1 className="text-3xl font-extrabold tracking-tight">{section === 'company' ? 'Company Details' : section === 'settings' ? 'Settings' : 'My Profile'}</h1>{section === 'profile' && !editing && <Button variant="secondary" onClick={() => setEditing(true)} data-testid="profile-edit-btn">Edit Profile</Button>}</div>
      {section === 'settings' ? <AppPermissions /> : <Card className="space-y-4 p-5">
        {section === 'profile' && <>
          <div className="flex items-center gap-4"><button onClick={() => editing && file.current?.click()} disabled={!editing} className="relative h-20 w-20 overflow-hidden rounded-2xl bg-navy text-xl font-bold text-white disabled:cursor-default" data-testid="profile-photo-btn">{user.profile?.photoUrl ? <img src={fileUrl(user.profile.photoUrl)} alt="" className="h-full w-full object-cover" /> : initials(user.name || user.email || user.phone || 'PC')}{editing && <span className="absolute bottom-1 right-1 rounded-full bg-white p-1 text-navy"><Camera className="h-3 w-3" /></span>}</button>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => photo(e.target.files)} /><div><p className="font-bold">{user.name || 'Add your name'}</p><p className="text-sm text-slate-500">{user.phone ? `+91 ${user.phone}` : user.email}</p></div></div>
          {inp('name', 'Name')}
          <Field label="Role"><Input value="Property Consultant" disabled readOnly className="bg-slate-100 text-slate-500" /></Field>
          <Field label="Account Status"><div className="flex h-11 items-center"><Badge tone={(user as any).status === 'ACTIVE' || !(user as any).status ? 'green' : 'amber'}>{String((user as any).status || 'ACTIVE')}</Badge></div></Field>
          <Field label="Email Address" hint="Email cannot be edited. To change your email, request an update and our admin team will review and approve it.">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={user.email || ''} disabled readOnly className="min-w-0 flex-1 bg-slate-100 text-slate-500" data-testid="profile-email-input" />
              <Button type="button" onClick={() => setReqOpen(true)} disabled={pending} className="shrink-0 !bg-blue-600 !text-white hover:!bg-blue-700" data-testid="profile-email-request-btn">Request Email Change</Button>
            </div>
            {pending && <p className="mt-1.5 text-xs font-semibold text-amber-600" data-testid="profile-email-pending">Pending admin approval: change to {req.newEmail}</p>}
            {req?.status === 'REJECTED' && <p className="mt-1.5 text-xs text-slate-500">Last request was not approved{req.decisionNote ? `: ${req.decisionNote}` : '.'}</p>}
          </Field>
          <Field label="Phone Number" hint="Phone number will be enabled in a future update."><Input value={user.phone ? `+91 ${user.phone}` : 'Not linked'} disabled readOnly className="bg-slate-100 text-slate-500" data-testid="profile-phone-input" /></Field>
          {inp('whatsappNumber', 'WhatsApp Number')}
          <Field label="Areas of Operation" hint="Comma separated"><Input disabled={!editable} value={f.areas || ''} onChange={(e) => setF({ ...f, areas: e.target.value })} placeholder="Whitefield, Varthur" data-testid="profile-areas-input" /></Field>
        </>}
        {inp('companyName', 'Company Name')}{inp('reraNumber', 'RERA Number')}
        <Field label="Office Address"><Textarea disabled={!editable} value={f.officeAddress || ''} onChange={(e) => setF({ ...f, officeAddress: e.target.value })} data-testid="profile-officeAddress-input" /></Field>
        {section === 'company' && <>{inp('companyWebsite', 'Website')}{inp('gstNumber', 'GST Number')}</>}
        {section === 'profile' ? editing && <div className="flex gap-2"><Button variant="secondary" onClick={cancel} disabled={busy} data-testid="profile-cancel-btn">Cancel</Button><Button onClick={save} loading={busy} data-testid="profile-save-btn">Save</Button></div> : <Button onClick={save} loading={busy} data-testid="profile-save-btn">Save</Button>}
      </Card>}
      {section === 'profile' && !editing && <AppearanceCard />}
      <Sheet open={reqOpen} onClose={() => setReqOpen(false)} title="Request Email Change" testid="email-request-sheet" footer={<Button onClick={sendReq} loading={reqBusy} data-testid="email-request-submit">Submit Request</Button>}>
        <div className="space-y-4">
          <Field label="New Email Address" error={reqErr.newEmail}><Input type="email" value={reqF.newEmail} onChange={(e) => setReqF({ ...reqF, newEmail: e.target.value })} placeholder="you@company.com" data-testid="email-request-new" /></Field>
          <Field label="Reason for change" error={reqErr.reason}><Textarea value={reqF.reason} onChange={(e) => setReqF({ ...reqF, reason: e.target.value })} data-testid="email-request-reason" /></Field>
          <p className="text-xs text-slate-500">Your email stays unchanged until an admin approves and verifies your request.</p>
        </div>
      </Sheet>
    </div>
  );
}
