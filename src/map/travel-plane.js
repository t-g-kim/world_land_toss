/**
 * Animated airplane shown on the map while the player is in transit. Draws the
 * flight route (origin → optional hub → destination) and moves a ✈️ marker
 * along it in sync with the travel countdown.
 */
import mapboxgl from 'mapbox-gl';
import { bus, Events } from '../lib/event-bus.js';
import { getTransit, isInTransit } from '../game/game-state.js';

const ROUTE_SRC = 'wl-flight-route';
const ROUTE_LAYER = 'wl-flight-route-line';

let map = null;
let marker = null;
let raf = null;

export function initTravelPlane(mapInstance) {
  map = mapInstance;
  bus.on(Events.TRAVEL_STARTED, (t) => startFlight(t));
  bus.on(Events.TRAVEL_ARRIVED, () => endFlight());
  if (isInTransit()) startFlight(getTransit()); // resume after reload
}

function waypoints(t) {
  const pts = [[t.originLng, t.originLat]];
  if (t.viaLng != null && t.viaLat != null) pts.push([t.viaLng, t.viaLat]);
  pts.push([t.destLng, t.destLat]);
  return pts;
}

function startFlight(t) {
  if (!map || !t) return;
  endFlight();

  const pts = waypoints(t);

  // Route line
  const gj = { type: 'Feature', geometry: { type: 'LineString', coordinates: pts } };
  if (map.getSource(ROUTE_SRC)) {
    map.getSource(ROUTE_SRC).setData(gj);
  } else {
    map.addSource(ROUTE_SRC, { type: 'geojson', data: gj });
    map.addLayer({
      id: ROUTE_LAYER,
      type: 'line',
      source: ROUTE_SRC,
      paint: {
        'line-color': '#38bdf8',
        'line-width': 2,
        'line-dasharray': [2, 2],
        'line-opacity': 0.85,
      },
    });
  }

  // Vehicle marker (train for ground trips, plane otherwise)
  const isTrain = t.mode === 'train';
  const elc = document.createElement('div');
  elc.className = 'flight-plane';
  elc.textContent = isTrain ? '🚆' : '✈️';
  marker = new mapboxgl.Marker({ element: elc, rotationAlignment: isTrain ? 'viewport' : 'map' })
    .setLngLat(pts[0]).addTo(map);

  // Frame the whole route so the flight is visible
  const bounds = pts.reduce((b, p) => b.extend(p), new mapboxgl.LngLatBounds(pts[0], pts[0]));
  map.fitBounds(bounds, { padding: 120, pitch: 0, duration: 1500, maxZoom: 7 });

  const segs = buildSegments(pts);
  const tick = () => {
    const cur = getTransit();
    if (!cur || !marker) { endFlight(); return; }
    const span = cur.arrivalTime - cur.departAt;
    const f = span > 0 ? Math.min(1, Math.max(0, (Date.now() - cur.departAt) / span)) : 1;
    const { lng, lat, bearing } = pointAlong(segs, f);
    marker.setLngLat([lng, lat]);
    if (!isTrain) marker.setRotation(bearing - 45); // ✈️ glyph points NE by default
    if (f >= 1) { endFlight(); return; }
    raf = requestAnimationFrame(tick);
  };
  tick();
}

function endFlight() {
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  if (marker) { marker.remove(); marker = null; }
  if (map?.getLayer(ROUTE_LAYER)) map.removeLayer(ROUTE_LAYER);
  if (map?.getSource(ROUTE_SRC)) map.removeSource(ROUTE_SRC);
}

// ── Geometry along a multi-segment path ────────────────
function buildSegments(pts) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [aLng, aLat] = pts[i];
    const [bLng, bLat] = pts[i + 1];
    const len = dist(aLng, aLat, bLng, bLat) || 0.0001;
    segs.push({ aLng, aLat, bLng, bLat, len, bearing: bearingDeg(aLng, aLat, bLng, bLat) });
    total += len;
  }
  return { segs, total };
}

function pointAlong({ segs, total }, frac) {
  let target = frac * total;
  for (const s of segs) {
    if (target <= s.len) {
      const r = target / s.len;
      return { lng: s.aLng + (s.bLng - s.aLng) * r, lat: s.aLat + (s.bLat - s.aLat) * r, bearing: s.bearing };
    }
    target -= s.len;
  }
  const last = segs[segs.length - 1];
  return { lng: last.bLng, lat: last.bLat, bearing: last.bearing };
}

function dist(aLng, aLat, bLng, bLat) {
  const dx = (bLng - aLng) * Math.cos((aLat + bLat) * Math.PI / 360);
  const dy = bLat - aLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function bearingDeg(aLng, aLat, bLng, bLat) {
  const y = Math.sin((bLng - aLng) * Math.PI / 180) * Math.cos(bLat * Math.PI / 180);
  const x = Math.cos(aLat * Math.PI / 180) * Math.sin(bLat * Math.PI / 180) -
    Math.sin(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.cos((bLng - aLng) * Math.PI / 180);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
