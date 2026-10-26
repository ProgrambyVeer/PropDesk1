import type { RefObject } from 'react';
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
// so the same button guides the user to paste a number copied from Contacts. Manual entry always remains.
// Nothing is requested until the button is tapped.
export function ContactPickButton({ onPick, testid = 'contact-pick-btn', focusRef }: { onPick: (contact: { name: string; phone: string }) => void; testid?: string; focusRef?: RefObject<HTMLInputElement> }) {
  const native = contactPickerSupported();
  // iOS only allows pasting through its own Paste action, so we never read the clipboard ourselves:
  // focus the phone field and explain the steps.
  const showPasteInstructions = () => {
    focusRef?.current?.focus();
    toast.info('Open Contacts, copy the number, return here, tap the phone field and choose Paste. You can also type it.', { duration: 8000 });
  };
  const pick = async () => {
    if (!native) return showPasteInstructions();
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
  return <Button type="button" variant="secondary" onClick={pick} aria-label={native ? 'Pick from phone contacts' : 'How to paste a copied phone number'} title={native ? 'Pick from phone contacts' : 'How to paste a copied phone number'} data-testid={testid}><Contact className="h-4 w-4" /></Button>;
}
