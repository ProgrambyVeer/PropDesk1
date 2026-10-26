import { Contact } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui';

type DeviceContact = { name?: string[]; tel?: string[] };
type ContactPickerNavigator = Navigator & { contacts?: { select?: (properties: string[], options?: { multiple?: boolean }) => Promise<DeviceContact[]> } };

export const contactPickerSupported = () => typeof navigator !== 'undefined'
  && typeof window !== 'undefined'
  && window.isSecureContext
  && typeof (navigator as ContactPickerNavigator).contacts?.select === 'function';

export function normalizeContactPhone(raw: string) {
  const d = String(raw || '').replace(/\D/g, '');
  const p = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  return p.slice(0, 10);
}

// Uses the Contact Picker API where available (Chrome on Android). iOS browsers (all WebKit) do not provide it,
// so the same button pastes a number the user copied from their Contacts app. Manual entry always remains.
// Nothing is requested until the button is tapped.
export function ContactPickButton({ onPick, testid = 'contact-pick-btn' }: { onPick: (contact: { name: string; phone: string }) => void; testid?: string }) {
  const native = contactPickerSupported();
  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const phone = (text.match(/(?:\+?91[\s-]?|0)?[6-9](?:[\s-]?\d){9}/g) || []).map(normalizeContactPhone).find((p) => /^[6-9]\d{9}$/.test(p));
      if (phone) onPick({ name: '', phone });
      else toast.info('Copy a number from your Contacts app, then tap this button again. Or type it manually.');
    } catch {
      toast.info('Paste is unavailable. Copy a number from Contacts and paste it into the field, or type it manually.');
    }
  };
  const pick = async () => {
    if (!native) return pasteFromClipboard();
    try {
      const contacts = (navigator as ContactPickerNavigator).contacts;
      if (!contacts?.select) return;
      const [contact] = await contacts.select(['name', 'tel'], { multiple: false });
      if (!contact) return;
      const phone = (contact.tel || []).map(normalizeContactPhone).find((p: string) => /^[6-9]\d{9}$/.test(p)) || '';
      if (!phone) toast.info('That contact has no valid Indian mobile number. Please type it manually.');
      onPick({ name: String(contact.name?.[0] || '').trim(), phone });
    } catch {
      toast.info('Contact access was not granted. You can type the number manually.');
    }
  };
  return <Button type="button" variant="secondary" onClick={pick} aria-label={native ? 'Pick from phone contacts' : 'Paste a copied phone number'} title={native ? 'Pick from phone contacts' : 'Paste a copied phone number'} data-testid={testid}><Contact className="h-4 w-4" /></Button>;
}
