/**
 * 3D building layer.
 *
 * When the user zooms in past the building threshold, real building footprints
 * from Mapbox's `composite` vector source are extruded into 3D and become
 * purchasable. Ownership is rendered from our own GeoJSON source (gold) so it
 * survives vector-tile reloads and page reloads — the footprint geometry is
 * persisted into the player's game state on purchase.
 */
import mapboxgl from 'mapbox-gl';
import { ADMIN_LEVELS, GAME_CONFIG, PREMIUM_ZONES } from '../config.js';
import { bus, Events } from '../lib/event-bus.js';
import { getCurrentAdminLevel } from './zoom-controller.js';
import { getOwnedTerritories, setTerritoryPrice, isOwned } from '../game/game-state.js';
import { formatPrice } from '../game/price-engine.js';
import { LANDMARKS, landmarkPropId } from '../game/landmarks.js';

const BASE_LAYER = 'wl-buildings-3d';
const OWNED_SOURCE = 'wl-owned-buildings';
const OWNED_LAYER = 'wl-owned-buildings-3d';

let map = null;
let pitched = false;
let tooltip = null;
let hoverId = null; // composite vector feature id currently highlighted

export function initBuildingLayer(mapInstance) {
  map = mapInstance;
  tooltip = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'territory-tooltip',
    offset: 14,
    maxWidth: '220px',
  });
  addBaseBuildings();
  addOwnedBuildings();
  bindInteraction();

  bus.on(Events.MAP_ZOOM_CHANGED, ({ level }) => updateForLevel(level));
  bus.on(Events.TERRITORY_UPDATED, () => refreshOwned());

  updateForLevel(getCurrentAdminLevel());
}

const isBuildingLevel = (level) => level === ADMIN_LEVELS.BUILDING;

// ── Layers ─────────────────────────────────────────────
function addBaseBuildings() {
  if (map.getLayer(BASE_LAYER)) return;
  // The `composite` source + `building` source-layer ship with Mapbox Streets
  // styles (dark-v11). Guard in case a custom style omits them.
  try {
    map.addLayer({
      id: BASE_LAYER,
      source: 'composite',
      'source-layer': 'building',
      type: 'fill-extrusion',
      minzoom: 14,
      filter: ['==', ['get', 'extrude'], 'true'],
      paint: {
        'fill-extrusion-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], '#eaf2ff',
          // Taller buildings → deeper, richer tone so dense downtowns read solid.
          ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 10],
            0, '#33425c',
            30, '#33456e',
            120, '#324a80',
            300, '#3c5aa0'],
        ],
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          14, 0,
          15.2, ['coalesce', ['get', 'height'], 8],
        ],
        'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
        // Darken crevices where buildings cluster → dense areas look deeper.
        'fill-extrusion-ambient-occlusion-intensity': 0.55,
        'fill-extrusion-ambient-occlusion-radius': 3,
      },
      layout: { visibility: 'none' },
    });
  } catch (e) {
    console.warn('3D 건물 레이어를 추가할 수 없습니다:', e.message);
  }
}

function addOwnedBuildings() {
  if (!map.getSource(OWNED_SOURCE)) {
    map.addSource(OWNED_SOURCE, { type: 'geojson', data: ownedFeatureCollection() });
  }
  if (!map.getLayer(OWNED_LAYER)) {
    map.addLayer({
      id: OWNED_LAYER,
      source: OWNED_SOURCE,
      type: 'fill-extrusion',
      minzoom: 14,
      paint: {
        'fill-extrusion-color': '#FFD700',
        // Each feature carries its own base/top (a floor band, or a whole building).
        'fill-extrusion-base': ['get', 'base'],
        'fill-extrusion-height': [
          'interpolate', ['linear'], ['zoom'],
          14, ['get', 'base'],
          15.2, ['get', 'top'],
        ],
        'fill-extrusion-opacity': 1,
        'fill-extrusion-vertical-gradient': true,
      },
      layout: { visibility: 'none' },
    });
  }
}

function ownedFeatureCollection() {
  const owned = getOwnedTerritories();
  const floorH = GAME_CONFIG.BUILDING.FLOOR_HEIGHT;
  const features = [];
  for (const [id, t] of Object.entries(owned)) {
    if (!t.geometry) continue;
    const minH = t.minHeight || 0;
    if (t.level === ADMIN_LEVELS.BUILDING || t.level === 'landmark') {
      // Whole building / landmark → full-height gold.
      features.push(goldFeature(id, t.geometry, minH, t.height || 12));
    } else if (t.level === 'floor') {
      // Only the owned floor → a gold band at that floor's height, nudged just
      // outside the wall so it reads as a band and doesn't z-fight.
      const n = t.floor || 1;
      features.push(goldFeature(id, scaleGeom(t.geometry, 1.03), minH + (n - 1) * floorH, minH + n * floorH));
    }
  }
  return { type: 'FeatureCollection', features };
}

function goldFeature(id, geometry, base, top) {
  return { type: 'Feature', id, properties: { base, top }, geometry };
}

// Scale a polygon outward from its centroid (subtle, so the band protrudes).
function scaleGeom(geom, f) {
  const ring = outerRing(geom);
  if (!ring) return geom;
  const [cx, cy] = centroid(ring);
  const s = ([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f];
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map((r) => r.map(s)) };
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map((r) => r.map(s))) };
  return geom;
}

function refreshOwned() {
  const src = map.getSource(OWNED_SOURCE);
  if (src) src.setData(ownedFeatureCollection());
}

// ── Visibility / camera ────────────────────────────────
function updateForLevel(level) {
  const show = isBuildingLevel(level);
  for (const id of [BASE_LAYER, OWNED_LAYER]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
  }
  if (show && !pitched) {
    pitched = true;
    map.easeTo({ pitch: 55, duration: 800 });
  } else if (!show && pitched) {
    pitched = false;
    clearHover();
    map.easeTo({ pitch: 0, duration: 600 });
  }
}

// ── Interaction ────────────────────────────────────────
function bindInteraction() {
  for (const layer of [BASE_LAYER, OWNED_LAYER]) {
    map.on('mousemove', layer, (e) => onHover(e, layer));
    map.on('mouseleave', layer, clearHover);
    map.on('click', layer, (e) => {
      if (!isBuildingLevel(getCurrentAdminLevel())) return;
      if (!e.features?.length) return;
      selectBuilding(e.features[0], e.lngLat);
    });
  }

  // Clicking empty ground at building level clears the selection.
  map.on('click', (e) => {
    if (!isBuildingLevel(getCurrentAdminLevel())) return;
    const layers = [BASE_LAYER, OWNED_LAYER].filter((l) => map.getLayer(l));
    if (!layers.length) return;
    const hits = map.queryRenderedFeatures(e.point, { layers });
    if (hits.length === 0) {
      clearHover();
      bus.emit(Events.TERRITORY_DESELECTED);
    }
  });
}

/** Highlight the building under the cursor and show its price in a tooltip. */
function onHover(e, layer) {
  if (!isBuildingLevel(getCurrentAdminLevel())) return;
  if (!e.features?.length) return;
  map.getCanvas().style.cursor = 'pointer';

  const feature = e.features[0];

  // Highlight via feature-state on the composite base layer (the owned layer is
  // our own gold source and already stands out).
  if (layer === BASE_LAYER && feature.id != null && feature.id !== hoverId) {
    if (hoverId != null) {
      map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: hoverId }, { hover: false });
    }
    hoverId = feature.id;
    map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: hoverId }, { hover: true });
  }

  const info = buildingInfo(feature);
  const lm = info.landmark;
  const id = lm ? landmarkPropId(lm.id) : info.id;
  const price = lm ? lm.price : info.price;
  setTerritoryPrice(id, price);
  const owned = isOwned(id);

  tooltip.setLngLat(e.lngLat).setHTML(`
    <div class="tt-name">${lm ? `${lm.icon} ${lm.name}` : `🏢 건물 · ${info.floors}층`}</div>
    ${lm ? '<div class="tt-level">🏆 랜드마크</div>' : (info.zone ? `<div class="tt-level">📈 ${info.zone.name} 프리미엄 ×${info.zone.multiplier}</div>` : '')}
    <div class="tt-price">${formatPrice(price)}</div>
    ${owned ? '<div class="tt-owned">내 소유</div>' : '<div class="tt-buy">클릭하여 구매</div>'}
  `).addTo(map);
}

function clearHover() {
  if (hoverId != null) {
    map.setFeatureState({ source: 'composite', sourceLayer: 'building', id: hoverId }, { hover: false });
    hoverId = null;
  }
  map.getCanvas().style.cursor = '';
  tooltip?.remove();
}

function selectBuilding(feature, lngLat) {
  if (!outerRing(feature.geometry)) return;

  const info = buildingInfo(feature);

  // Landmark building → a single, very expensive trophy (not sold by floor).
  if (info.landmark) {
    const lm = info.landmark;
    const id = landmarkPropId(lm.id);
    setTerritoryPrice(id, lm.price);
    bus.emit(Events.TERRITORY_SELECTED, {
      id,
      name: `${lm.icon} ${lm.name}`,
      level: 'landmark',
      properties: {
        id, name: lm.name, admin_level: 'landmark', current_price: lm.price,
        height: info.height, min_height: info.minHeight, geometry: feature.geometry, landmark: true,
        centerLng: lm.lng, centerLat: lm.lat,
      },
      lngLat,
    });
    return;
  }

  setTerritoryPrice(info.id, info.price);
  const name = `건물 ${info.cLat.toFixed(4)}, ${info.cLng.toFixed(4)}`;
  bus.emit(Events.TERRITORY_SELECTED, {
    id: info.id,
    name,
    level: ADMIN_LEVELS.BUILDING,
    properties: {
      id: info.id,
      name,
      admin_level: ADMIN_LEVELS.BUILDING,
      current_price: info.price,
      height: info.height,
      min_height: info.minHeight,
      floors: info.floors,
      // Show the premium district (if any) as the panel subtitle.
      country_name: info.zone ? `📈 ${info.zone.name} 프리미엄 ×${info.zone.multiplier}` : undefined,
      // Carried through to purchaseTerritory() so ownership can be re-rendered.
      geometry: feature.geometry,
    },
    lngLat,
  });
}

/** Stable id + price/height derived from a building footprint feature. */
function buildingInfo(feature) {
  const ring = outerRing(feature.geometry);
  const [cLng, cLat] = ring ? centroid(ring) : [0, 0];
  const height = Number(feature.properties?.height) || Number(feature.properties?.render_height) || 12;
  const minHeight = Number(feature.properties?.min_height) || 0;
  const zone = zoneFor(cLng, cLat); // premium district, or null
  const price = ring
    ? estimateBuildingPrice(ring, height, zone ? zone.multiplier : 1)
    : GAME_CONFIG.BUILDING.MIN_PRICE;
  const floors = Math.max(1, Math.round(height / GAME_CONFIG.BUILDING.FLOOR_HEIGHT));
  return {
    id: `b:${cLng.toFixed(5)},${cLat.toFixed(5)}`,
    cLng, cLat, height, minHeight, price, floors, zone,
    landmark: nearbyLandmark(cLng, cLat),
  };
}

// A landmark within ~150m of this point (makes that building a trophy asset).
function nearbyLandmark(lng, lat) {
  for (const l of LANDMARKS) {
    const dLat = (l.lat - lat) * 111000;
    const dLng = (l.lng - lng) * 111000 * Math.cos(lat * Math.PI / 180);
    if (Math.hypot(dLat, dLng) < 150) return l;
  }
  return null;
}

/** Highest-multiplier premium zone containing the point, or null. */
function zoneFor(lng, lat) {
  let best = null;
  for (const z of PREMIUM_ZONES) {
    if (distanceKm(lat, lng, z.lat, z.lng) <= z.radiusKm) {
      if (!best || z.multiplier > best.multiplier) best = z;
    }
  }
  return best;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ── Geometry helpers ───────────────────────────────────
function outerRing(geom) {
  if (!geom) return null;
  if (geom.type === 'Polygon') return geom.coordinates[0];
  if (geom.type === 'MultiPolygon') return geom.coordinates[0]?.[0];
  return null;
}

function centroid(ring) {
  let sx = 0, sy = 0, n = 0;
  for (const [x, y] of ring) { sx += x; sy += y; n++; }
  return [sx / n, sy / n];
}

/** Approximate polygon area in square meters (equirectangular projection). */
function polygonAreaM2(ring) {
  const R = 6378137; // earth radius, meters
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * Math.PI / 180;
  const cos0 = Math.cos(lat0);
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = R * (ring[i][0] * Math.PI / 180) * cos0;
    const yi = R * (ring[i][1] * Math.PI / 180);
    const xj = R * (ring[j][0] * Math.PI / 180) * cos0;
    const yj = R * (ring[j][1] * Math.PI / 180);
    area += xj * yi - xi * yj;
  }
  return Math.abs(area) / 2;
}

function estimateBuildingPrice(ring, height, multiplier = 1) {
  const area = polygonAreaM2(ring);
  const floors = Math.max(1, Math.round(height / GAME_CONFIG.BUILDING.FLOOR_HEIGHT));
  const price = Math.round(area * floors * GAME_CONFIG.BUILDING.PRICE_PER_M2_FLOOR * multiplier);
  return Math.max(GAME_CONFIG.BUILDING.MIN_PRICE, price);
}
