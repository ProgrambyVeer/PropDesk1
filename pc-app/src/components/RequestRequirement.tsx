import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Copy, MessageCircle, Share2 } from 'lucide-react';
import { post } from '../lib/api';
import { Button, Field, Input, Sheet } from './ui';
import { ContactPickButton } from './ContactPicker';

export function RequestRequirementSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [phone, setPhone] = useState('');
  const phoneRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setUrl(''); setError('');
    post<{ token: string }>('/requirement-requests')
      .then((r) => !cancelled && setUrl(`${window.location.origin}/r/${r.token}`))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => { cancelled = true; };
  }, [open]);
  const message = `Hello! Please share your property requirements with me using this secure EstateOS form: ${url}`;
  const phoneOk = /^[6-9]\d{9}$/.test(phone);
  const whatsapp = () => window.open(`https://wa.me/${phoneOk ? `91${phone}` : ''}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast.success('Link copied'); } catch { toast.error('Could not copy. Select and copy the link manually.'); }
  };
  const share = () => navigator.share({ title: 'EstateOS requirement form', text: message, url }).catch(() => undefined);
  return (
    <Sheet open={open} onClose={onClose} title="Request Requirement" testid="request-requirement-sheet">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">Send this one-time EstateOS form to your client. They don't need an account, and what they submit is added to your CRM.</p>
        {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <Field label="Secure link"><Input readOnly value={url || 'Generating…'} onFocus={(e) => e.currentTarget.select()} data-testid="request-link-input" /></Field>}
        <Field label="Client phone (optional)" hint="Used only to open the WhatsApp chat.">
          <div className="flex gap-2"><Input ref={phoneRef} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" placeholder="98765 43210" data-testid="request-phone-input" /><ContactPickButton focusRef={phoneRef} onPick={(c) => c.phone && setPhone(c.phone)} testid="request-contact-pick-btn" /></div>
        </Field>
        <div className="grid gap-2">
          <Button variant="success" onClick={whatsapp} disabled={!url} data-testid="request-whatsapp-btn"><MessageCircle className="h-4 w-4" />Share on WhatsApp</Button>
          {typeof navigator !== 'undefined' && 'share' in navigator && <Button variant="secondary" onClick={share} disabled={!url} data-testid="request-share-btn"><Share2 className="h-4 w-4" />Share…</Button>}
          <Button variant="secondary" onClick={copy} disabled={!url} data-testid="request-copy-btn"><Copy className="h-4 w-4" />Copy link</Button>
        </div>
      </div>
    </Sheet>
  );
}
