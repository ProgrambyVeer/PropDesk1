import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ApiError, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button } from '../components/ui';
import { Logo } from '../components/Shell';

const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';

export default function Login() {
  const { login } = useAuth();
  const button = useRef<HTMLDivElement>(null);
  const credentialHandler = useRef<(credential: string) => void>(() => undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const clientId = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || '').trim();

  credentialHandler.current = (credential) => {
    setBusy(true); setError('');
    void post('/auth/google', { credential }).then((result) => login(result.token, result.user))
      .catch((e) => setError((e as ApiError).message || 'Google sign-in failed. Please try again.'))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let resize: (() => void) | undefined;
    const render = () => {
      const googleId = (window as any).google?.accounts?.id;
      if (cancelled || !googleId || !button.current) return;
      googleId.initialize({
        client_id: clientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response: any) => {
          if (response?.credential) credentialHandler.current(response.credential);
          else setError('Google sign-in was cancelled. You can try again.');
        },
      });
      const draw = () => {
        if (!button.current) return;
        button.current.replaceChildren();
        googleId.renderButton(button.current, {
          type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rect',
          width: String(Math.min(360, button.current.clientWidth || 360)),
        });
      };
      draw();
      resize = draw;
      window.addEventListener('resize', resize);
    };
    const failed = () => { if (!cancelled) setError('Google sign-in could not load. Check your connection and try again.'); };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT}"]`);
    if ((window as any).google?.accounts?.id) render();
    else if (existing) { existing.addEventListener('load', render); existing.addEventListener('error', failed); }
    else {
      const script = document.createElement('script');
      script.src = GOOGLE_SCRIPT; script.async = true; script.defer = true;
      script.addEventListener('load', render); script.addEventListener('error', failed);
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      if (resize) window.removeEventListener('resize', resize);
    };
  }, [clientId]);

  return (
    <div className="flex min-h-screen flex-col bg-white lg:flex-row">
      <div className="relative hidden flex-1 overflow-hidden bg-navy lg:block">
        <img src="https://images.unsplash.com/photo-1600555179901-107bf80d25cf?w=1400&q=80" alt="" className="absolute inset-0 h-full w-full object-cover opacity-40 max-w-full w-full" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-blue-200">For property consultants</p>
          <h1 className="mt-3 max-w-md text-5xl font-extrabold leading-tight tracking-tight">Your properties. Your clients. One place.</h1>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm animate-up">
          <Logo />
          <h1 className="mt-10 text-3xl font-extrabold tracking-tight ">Explore</h1>
          <p className="mt-2 text-sm text-slate-500">Continue with your Google account.</p>
          <div className={`mt-8 min-h-11 w-full ${busy ? 'pointer-events-none opacity-60' : ''}`} ref={button} data-testid="login-google-btn-container" />
          {!clientId && <Button size="lg" className="mt-8 w-full" disabled data-testid="login-google-unconfigured-btn">Continue with Google</Button>}
          {busy && <p className="mt-3 text-center text-sm text-slate-500" role="status">Signing in…</p>}
          {error && <p className="mt-3 text-sm font-medium text-red-600" role="alert" data-testid="login-error">{error}</p>}
          {!clientId && <p className="mt-2 text-xs text-slate-500">Google sign-in is not configured for this environment.</p>}
          <p className="mt-10 flex items-center gap-2 text-xs text-slate-400"><ShieldCheck className="h-4 w-4" />Your identity is verified securely by Google.</p>
        </div>
      </div>
    </div>
  );
}