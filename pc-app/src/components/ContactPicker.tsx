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

// Progressive enhancement: renders nothing where the Contact Picker API is unavailable (desktop, iOS, etc.),
// so manual entry always remains the baseline. The permission prompt only appears when the button is tapped.
export function ContactPickButton({ onPick, testid = 'contact-pick-btn' }: { onPick: (contact: { name: string; phone: string }) => void; testid?: string }) {
  if (!contactPickerSupported()) return null;
  const pick = async () => {
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
  return <Button type="button" variant="secondary" onClick={pick} aria-label="Pick from phone contacts" title="Pick from phone contacts" data-testid={testid}><Contact className="h-4 w-4" /></Button>;
}
