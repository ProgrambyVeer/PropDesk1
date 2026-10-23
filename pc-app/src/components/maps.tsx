import { useEffect, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, X } from 'lucide-react';
import { Button } from './ui';

// Leaflet + OpenStreetMap tiles (free, no API key). Loaded on demand from a pinned, integrity-checked CDN build
// so the map code is only downloaded on screens that show a map.
const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
const CSS_SRI = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
const JS_SRI = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
const DEFAULT_CENTER: [number, number] = [12.9716, 77.5946]; // Bengaluru
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let leafletPromise: Promise<any> | null = null;
function loadLeaflet(): Promise<any> {
  if ((window as any).L) return Promise.resolve((window as any).L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = `${LEAFLET}leaflet.css`; css.integrity = CSS_SRI; css.crossOrigin = '';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = `${LEAFLET}leaflet.js`; js.integrity = JS_SRI; js.crossOrigin = '';
    js.onload = () => resolve((window as any).L);
    js.onerror = () => { leafletPromise = null; reject(new Error('The map could not be loaded. Check your connection.')); };
    document.head.appendChild(js);
  });
  return leafletPromise;
}

export const hasPin = (p: { latitude?: number | null; longitude?: number | null }) => typeof p?.latitude === 'number' && typeof p?.longitude === 'number';
export const googleMapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

export function OpenInGoogleMaps({ latitude, longitude, className = '' }: { latitude: number; longitude: number; className?: string }) {
  return <a href={googleMapsUrl(latitude, longitude)} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 text-sm font-semibold text-brand ${className}`} data-testid="open-in-google-maps"><ExternalLink className="h-4 w-4" />Open in Google Maps</a>;
}

const pinIcon = (L: any) => L.divIcon({
  className: '', iconSize: [28, 28], iconAnchor: [14, 28],
  html: '<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#0F172A;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
});

function useLeafletMap(onReady: (L: any, map: any) => void | (() => void), deps: unknown[] = []) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let map: any; let cleanup: void | (() => void); let cancelled = false;
    loadLeaflet().then((L) => {
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: false }).setView(DEFAULT_CENTER, 11);
      L.tileLayer(TILES, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
      cleanup = onReady(L, map);
    }).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; if (typeof cleanup === 'function') cleanup(); map?.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { ref, error };
}

export function LocationPicker({ latitude, longitude, onChange }: { latitude?: number | null; longitude?: number | null; onChange: (lat: number | null, lng: number | null) => void }) {
  const initial = useRef({ latitude, longitude });
  const markerRef = useRef<{ set: (lat: number | null, lng: number | null) => void } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const { ref, error } = useLeafletMap((L, map) => {
    let marker: any = null;
    const place = (lat: number, lng: number, emit: boolean) => {
      if (!marker) {
        marker = L.marker([lat, lng], { icon: pinIcon(L), draggable: true }).addTo(map);
        marker.on('dragend', () => { const p = marker.getLatLng(); onChangeRef.current(+p.lat.toFixed(6), +p.lng.toFixed(6)); });
      } else marker.setLatLng([lat, lng]);
      if (emit) onChangeRef.current(+lat.toFixed(6), +lng.toFixed(6));
    };
    markerRef.current = {
      set: (lat, lng) => {
        if (lat == null || lng == null) { if (marker) { marker.remove(); marker = null; } return; }
        place(lat, lng, false); map.setView([lat, lng], Math.max(map.getZoom(), 16));
      },
    };
    map.on('click', (e: any) => place(e.latlng.lat, e.latlng.lng, true));
    if (initial.current.latitude != null && initial.current.longitude != null) { place(initial.current.latitude, initial.current.longitude, false); map.setView([initial.current.latitude, initial.current.longitude], 16); }
    setTimeout(() => map.invalidateSize(), 0);
    return () => { markerRef.current = null; };
  });
  // Keep the marker in sync if the form value changes from outside (e.g. draft restore).
  useEffect(() => { markerRef.current?.set(latitude ?? null, longitude ?? null); }, [latitude, longitude]);
  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => onChange(+pos.coords.latitude.toFixed(6), +pos.coords.longitude.toFixed(6)), () => undefined, { enableHighAccuracy: true, timeout: 10000 });
  };
  const pinned = latitude != null && longitude != null;
  return (
    <div className="space-y-2" data-testid="location-picker">
      {error ? <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : <div ref={ref} className="h-64 w-full overflow-hidden rounded-2xl border border-slate-200" data-testid="location-picker-map" />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={locate} data-testid="pin-use-my-location"><LocateFixed className="h-4 w-4" />Use my location</Button>
        {pinned && <Button type="button" variant="ghost" onClick={() => onChange(null, null)} data-testid="pin-clear"><X className="h-4 w-4" />Remove pin</Button>}
        {pinned && <OpenInGoogleMaps latitude={latitude!} longitude={longitude!} />}
      </div>
      <p className="text-xs text-slate-500">{pinned ? `Pinned at ${latitude!.toFixed(5)}, ${longitude!.toFixed(5)}. Drag the pin or tap the map to adjust.` : 'Tap the map to drop a pin on the exact spot.'}</p>
    </div>
  );
}

export function PropertiesMap({ properties, onOpen }: { properties: any[]; onOpen: (property: any) => void }) {
  const pinned = properties.filter(hasPin);
  const { ref, error } = useLeafletMap((L, map) => {
    const group = L.featureGroup();
    for (const p of pinned) {
      const box = document.createElement('div');
      box.style.minWidth = '180px';
      const title = document.createElement('b'); title.textContent = `${p.code} · ${p.subtype}`; box.appendChild(title);
      const line = document.createElement('div'); line.textContent = [p.locality, p.location].filter(Boolean).join(', '); line.style.margin = '2px 0 8px'; box.appendChild(line);
      const open = document.createElement('button'); open.type = 'button'; open.textContent = 'View details'; open.style.cssText = 'font-weight:700;color:#2563eb;margin-right:12px';
      open.onclick = () => onOpen(p); box.appendChild(open);
      const g = document.createElement('a'); g.href = googleMapsUrl(p.latitude, p.longitude); g.target = '_blank'; g.rel = 'noreferrer'; g.textContent = 'Open in Google Maps'; g.style.cssText = 'font-weight:700;color:#2563eb'; box.appendChild(g);
      L.marker([p.latitude, p.longitude], { icon: pinIcon(L), title: p.code }).bindPopup(box).addTo(group);
    }
    group.addTo(map);
    if (pinned.length) map.fitBounds(group.getBounds().pad(0.2), { maxZoom: 15 });
    setTimeout(() => map.invalidateSize(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned.map((p) => `${p.id}:${p.latitude}:${p.longitude}`).join('|')]);
  if (error) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>;
  return (
    <div className="space-y-2" data-testid="properties-map">
      <div ref={ref} className="h-[60vh] w-full overflow-hidden rounded-2xl border border-slate-200" />
      <p className="text-xs text-slate-500">{pinned.length} of {properties.length} propert{properties.length === 1 ? 'y' : 'ies'} pinned{properties.length - pinned.length > 0 ? ` · ${properties.length - pinned.length} without a pin appear only in List view` : ''}.</p>
    </div>
  );
}
