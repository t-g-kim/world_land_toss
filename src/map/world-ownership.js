/**
 * Renders OTHER players' buildings on the map: purple = owned by someone else,
 * green = for sale (available to buy). My own buildings stay gold (building-layer).
 */
import { ADMIN_LEVELS } from '../config.js';
import { bus, Events } from '../lib/event-bus.js';
import { getAllProps } from '../game/world.js';
import { getMarketUserId } from '../game/market.js';
import { getCurrentAdminLevel } from './zoom-controller.js';

const OTHERS_SRC = 'wl-others', OTHERS_LAYER = 'wl-others-3d';
const SALE_SRC = 'wl-forsale', SALE_LAYER = 'wl-forsale-3d';

let map = null;
const empty = () => ({ type: 'FeatureCollection', features: [] });

export function initWorldOwnership(mapInstance) {
  map = mapInstance;
  addLayer(OTHERS_SRC, OTHERS_LAYER, '#a855f7'); // purple
  addLayer(SALE_SRC, SALE_LAYER, '#22c55e');     // green
  bus.on(Events.WORLD_UPDATED, render);
  bus.on(Events.MAP_ZOOM_CHANGED, render);
}

function addLayer(src, id, color) {
  if (map.getLayer(id)) return;
  map.addSource(src, { type: 'geojson', data: empty() });
  map.addLayer({
    id, source: src, type: 'fill-extrusion', minzoom: 14,
    paint: {
      'fill-extrusion-color': color,
      'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, ['coalesce', ['get', 'height'], 12]],
      'fill-extrusion-opacity': 0.9,
      'fill-extrusion-vertical-gradient': true,
    },
    layout: { visibility: 'none' },
  });
}

function render() {
  const show = getCurrentAdminLevel() === ADMIN_LEVELS.BUILDING;
  for (const l of [OTHERS_LAYER, SALE_LAYER]) {
    if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', show ? 'visible' : 'none');
  }
  if (!show) return;

  const me = getMarketUserId();
  const byBuilding = new Map();
  for (const p of getAllProps()) {
    if (!['building', 'floor', 'house', 'landmark'].includes(p.kind)) continue;
    const geom = p.meta?.geometry;
    if (!geom) continue;
    const bId = p.meta?.buildingId || String(p.id).split('#')[0];
    let e = byBuilding.get(bId);
    if (!e) { e = { geom, height: p.meta?.height || 12, minHeight: p.meta?.minHeight || 0, mine: false, others: false, sale: false }; byBuilding.set(bId, e); }
    if (p.owner_id === me) e.mine = true; else e.others = true;
    if (p.for_sale) e.sale = true;
  }

  const others = [], sale = [];
  for (const e of byBuilding.values()) {
    if (e.mine) continue; // mine = gold (building-layer)
    const f = { type: 'Feature', properties: { height: e.height, min_height: e.minHeight }, geometry: e.geom };
    if (e.sale) sale.push(f);
    else if (e.others) others.push(f);
  }
  map.getSource(OTHERS_SRC)?.setData({ type: 'FeatureCollection', features: others });
  map.getSource(SALE_SRC)?.setData({ type: 'FeatureCollection', features: sale });
}
