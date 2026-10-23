import { useId } from 'react';
import type { ReactNode } from 'react';

type P = { className?: string };

// Layered 3D icon: solid currentColor body + light/shade gradient overlay + soft drop shadow.
function Base({ className, children, id, defs }: P & { children: ReactNode; id: string; defs?: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false" style={{ filter: 'drop-shadow(0 1.2px 1px rgba(0,0,0,.38))' }}>
      <defs>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".4" />
        </linearGradient>
        {defs}
      </defs>
      {children}
    </svg>
  );
}

export function HomeIcon({ className }: P) {
  const id = useId();
  const d = 'M12 2.8 2.6 11.2c-.5.5-.2 1.3.5 1.3H4.6V20a1.2 1.2 0 0 0 1.2 1.2h3.7v-5.6a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v5.6h3.7A1.2 1.2 0 0 0 19.4 20v-7.5h1.5c.7 0 1-.8.5-1.3z';
  return (
    <Base className={className} id={id}>
      <path d={d} fill="currentColor" />
      <path d={d} fill={`url(#${id}s)`} />
      <path d="M12 2.8 2.6 11.2c-.5.5-.2 1.3.5 1.3h.9L12 5.4z" fill="#fff" opacity=".22" />
      <path d="M12 2.8l9.4 8.4c.5.5.2 1.3-.5 1.3h-.9L12 5.4z" fill="#000" opacity=".2" />
    </Base>
  );
}

export function ClientsIcon({ className }: P) {
  const id = useId();
  const front = 'M2.6 20.4c0-3.5 2.6-5.9 6.4-5.9s6.4 2.4 6.4 5.9z';
  const back = 'M15.6 14.7c.4-.1.9-.2 1.4-.2 3 0 4.8 1.9 4.8 4.7 0 .7-.3 1.2-1 1.2h-4.4c.2-.4.2-.8.2-1.2 0-1.9-.4-3.4-1-4.5z';
  return (
    <Base className={className} id={id}>
      <circle cx="16.8" cy="8" r="2.7" fill="currentColor" opacity=".7" />
      <path d={back} fill="currentColor" opacity=".7" />
      <circle cx="9" cy="8.2" r="3.4" fill="currentColor" />
      <circle cx="9" cy="8.2" r="3.4" fill={`url(#${id}s)`} />
      <path d={front} fill="currentColor" />
      <path d={front} fill={`url(#${id}s)`} />
    </Base>
  );
}

export function PropertiesIcon({ className }: P) {
  const id = useId();
  const tower = 'M5.2 21.2V4.6c0-.9.7-1.6 1.6-1.6h6.2c.9 0 1.6.7 1.6 1.6v16.6zM7.4 6.2h1.9v1.9H7.4zm3.3 0h1.9v1.9h-1.9zM7.4 10.2h1.9v1.9H7.4zm3.3 0h1.9v1.9h-1.9zM7.4 14.2h1.9v1.9H7.4zm3.3 0h1.9v1.9h-1.9z';
  const wing = 'M15.2 9.4h2.7c.9 0 1.6.7 1.6 1.6v10.2h-4.3zM16.9 12.3h.9v1.7h-.9zm0 3.3h.9v1.7h-.9z';
  return (
    <Base className={className} id={id}>
      <path d={wing} fill="currentColor" opacity=".78" fillRule="evenodd" />
      <path d={tower} fill="currentColor" fillRule="evenodd" />
      <path d={tower} fill={`url(#${id}s)`} fillRule="evenodd" />
      <path d="M3.2 21.2h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </Base>
  );
}

export function FollowUpsIcon({ className }: P) {
  const id = useId();
  const body = 'M6.9 4.8h10.2a3.4 3.4 0 0 1 3.4 3.4v9.4a3.4 3.4 0 0 1-3.4 3.4H6.9a3.4 3.4 0 0 1-3.4-3.4V8.2a3.4 3.4 0 0 1 3.4-3.4z';
  return (
    <Base className={className} id={id} defs={<mask id={`${id}m`}><rect width="24" height="24" fill="#fff" /><path d="m8.3 14.3 2.6 2.6 4.9-5.2" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></mask>}>
      <rect x="7.2" y="2.4" width="2" height="4.2" rx="1" fill="currentColor" />
      <rect x="14.8" y="2.4" width="2" height="4.2" rx="1" fill="currentColor" />
      <g mask={`url(#${id}m)`}>
        <path d={body} fill="currentColor" />
        <path d={body} fill={`url(#${id}s)`} />
        <path d="M3.5 8.2a3.4 3.4 0 0 1 3.4-3.4h10.2a3.4 3.4 0 0 1 3.4 3.4v1.3h-17z" fill="#fff" opacity=".18" />
        <path d="M3.5 9.5h17" stroke="#000" strokeOpacity=".3" strokeWidth=".7" />
      </g>
    </Base>
  );
}

export function DealsIcon({ className }: P) {
  const id = useId();
  return (
    <Base className={className} id={id}>
      <path d="M7.2 3.6h9.6l4.7 5.3H2.5z" fill="currentColor" />
      <path d="M2.5 8.9h19L12 21z" fill="currentColor" />
      <path d="M2.5 8.9 7.2 3.6l2.2 5.3z" fill="#fff" opacity=".35" />
      <path d="M7.2 3.6h9.6l-2.2 5.3H9.4z" fill="#fff" opacity=".12" />
      <path d="M16.8 3.6l4.7 5.3h-6.9z" fill="#000" opacity=".12" />
      <path d="M2.5 8.9h6.9L12 21z" fill="#fff" opacity=".2" />
      <path d="M14.6 8.9h6.9L12 21z" fill="#000" opacity=".38" />
      <path d="M9.4 8.9h5.2L12 21z" fill="#000" opacity=".1" />
      <path d="M2.5 8.9h19" stroke="#fff" strokeOpacity=".35" strokeWidth=".5" />
    </Base>
  );
}
