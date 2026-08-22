import { ADMIN_LEVELS } from '../config.js';
import { getCurrentAdminLevel } from './zoom-controller.js';
import { bus, Events } from '../lib/event-bus.js';
import { isOwned } from '../game/game-state.js';

const layerIds = {
  [ADMIN_LEVELS.COUNTRY]: { fill: 'countries-fill', line: 'countries-line', label: 'countries-label' },
  [ADMIN_LEVELS.PROVINCE]: { fill: 'provinces-fill', line: 'provinces-line', label: 'provinces-label' },
  [ADMIN_LEVELS.DISTRICT]: { fill: 'districts-fill', line: 'districts-line', label: 'districts-label' },
};

const sourceIds = {
  [ADMIN_LEVELS.COUNTRY]: 'countries-source',
  [ADMIN_LEVELS.PROVINCE]: 'provinces-source',
  [ADMIN_LEVELS.DISTRICT]: 'districts-source',
};

// Muted, low-saturation palette for graph coloring — keeps neighbors
// distinguishable without the rainbow clutter. Owned territories pop in gold.
const PALETTE = [
  '#5b7a9d', // muted blue
  '#6d9773', // muted green
  '#a3866a', // muted tan
  '#8a7ca8', // muted purple
  '#c08a7d', // muted terracotta
  '#6fa3a0', // muted teal
  '#9a9d6b', // muted olive
  '#a88a9d', // muted mauve
];

const OWNED_COLOR = '#FFD700';

let map = null;
let geojsonData = {};

export function getLayerIds() { return layerIds; }
export function getSourceIds() { return sourceIds; }

export function initTerritoryLayers(mapInstance) {
  map = mapInstance;
  bus.on(Events.MAP_ZOOM_CHANGED, ({ level, prevLevel }) => {
    setLayerVisibility(prevLevel, false);
    setLayerVisibility(level, true);
  });
  bus.on(Events.TERRITORY_UPDATED, (e) => refreshColors(e));
}

/**
 * Greedy graph-coloring with grid-based spatial index for fast adjacency detection.
 * Ensures no two touching territories share the same color.
 */
function assignColors(geojson) {
  geojson.features = geojson.features.filter(f => f.geometry && f.geometry.coordinates);
  const features = geojson.features;
  const n = features.length;

  // Graph coloring with grid spatial index
  assignColorsGraph(features, n);
  return geojson;
}

function assignColorsGraph(features, n) {
  const bboxes = new Array(n);
  for (let i = 0; i < n; i++) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const geom = features[i].geometry;
    const coordSets = geom.type === 'MultiPolygon'
      ? geom.coordinates.flat()
      : geom.coordinates;
    for (const ring of coordSets) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    bboxes[i] = [minX, minY, maxX, maxY];
  }

  const CELL = 2;
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const [x0, y0, x1, y1] = bboxes[i];
    const cx0 = Math.floor(x0 / CELL), cy0 = Math.floor(y0 / CELL);
    const cx1 = Math.floor(x1 / CELL), cy1 = Math.floor(y1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = cx * 10000 + cy;
        let cell = grid.get(key);
        if (!cell) { cell = []; grid.set(key, cell); }
        cell.push(i);
      }
    }
  }

  const adj = new Array(n);
  for (let i = 0; i < n; i++) adj[i] = [];
  const checked = new Set();
  const BUF = 0.05;

  for (const cell of grid.values()) {
    for (let a = 0; a < cell.length; a++) {
      for (let b = a + 1; b < cell.length; b++) {
        const i = cell[a], j = cell[b];
        const pairKey = i < j ? i * n + j : j * n + i;
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);
        const [ax0, ay0, ax1, ay1] = bboxes[i];
        const [bx0, by0, bx1, by1] = bboxes[j];
        if (ax0 - BUF <= bx1 && ax1 + BUF >= bx0 && ay0 - BUF <= by1 && ay1 + BUF >= by0) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }
  }

  const colorAssign = new Int8Array(n).fill(-1);
  const order = Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => adj[b].length - adj[a].length);

  for (const idx of order) {
    const usedColors = new Set();
    for (const nb of adj[idx]) {
      if (colorAssign[nb] >= 0) usedColors.add(colorAssign[nb]);
    }
    let c = 0;
    while (usedColors.has(c)) c++;
    colorAssign[idx] = c;
  }

  for (let i = 0; i < n; i++) {
    const f = features[i];
    const id = f.properties.id;
    if (isOwned(id)) {
      f.properties.fill_color = OWNED_COLOR;
      f.properties.is_owned = true;
    } else {
      f.properties.fill_color = PALETTE[colorAssign[i] % PALETTE.length];
      f.properties.is_owned = false;
    }
  }
}

export function setGeoJSON(level, geojson) {
  assignColors(geojson);
  geojsonData[level] = geojson;
  if (!map) return;

  const srcId = sourceIds[level];
  const source = map.getSource(srcId);
  if (source) {
    source.setData(geojson);
  } else {
    addLayerGroup(level, geojson);
  }
}

/** Refresh only the changed territory's color, not the entire dataset */
function refreshColors(event) {
  if (event?.id) {
    // Update single territory
    for (const level of Object.values(ADMIN_LEVELS)) {
      const data = geojsonData[level];
      if (!data) continue;
      const f = data.features.find(feat => feat.properties.id === event.id);
      if (!f) continue;
      f.properties.is_owned = isOwned(event.id);
      f.properties.fill_color = f.properties.is_owned ? OWNED_COLOR : (f.properties._original_color || f.properties.fill_color);
      if (!f.properties.is_owned && !f.properties._original_color) {
        // Store original so we can restore on sell
        f.properties._original_color = f.properties.fill_color;
      }
      if (f.properties.is_owned) {
        f.properties._original_color = f.properties._original_color || f.properties.fill_color;
        f.properties.fill_color = OWNED_COLOR;
      }
      const source = map?.getSource(sourceIds[level]);
      if (source) source.setData(data);
      return;
    }
  }
  // Full refresh fallback
  for (const level of Object.values(ADMIN_LEVELS)) {
    const data = geojsonData[level];
    if (!data) continue;
    for (const f of data.features) {
      const owned = isOwned(f.properties.id);
      if (owned && !f.properties.is_owned) {
        f.properties._original_color = f.properties.fill_color;
        f.properties.fill_color = OWNED_COLOR;
      } else if (!owned && f.properties.is_owned && f.properties._original_color) {
        f.properties.fill_color = f.properties._original_color;
      }
      f.properties.is_owned = owned;
    }
    const source = map?.getSource(sourceIds[level]);
    if (source) source.setData(data);
  }
}

function addLayerGroup(level, geojson) {
  const srcId = sourceIds[level];
  const ids = layerIds[level];
  const isVisible = level === getCurrentAdminLevel();
  const isCountry = level === ADMIN_LEVELS.COUNTRY;

  map.addSource(srcId, { type: 'geojson', data: geojson, generateId: true });

  // ── Fill layer ──────────────────────────────
  map.addLayer({
    id: ids.fill,
    type: 'fill',
    source: srcId,
    paint: {
      'fill-color': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        ['case', ['get', 'is_owned'], '#fff8dc', 'rgba(255,255,255,0.45)'],
        ['get', 'fill_color'],
      ],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 0.6,
        ['boolean', ['feature-state', 'hover'], false], 0.45,
        ['case', ['get', 'is_owned'], 0.7, isCountry ? 0.22 : 0.2],
      ],
    },
    layout: { visibility: isVisible ? 'visible' : 'none' },
  });

  // ── Border line (crisp white) ───────────────
  map.addLayer({
    id: ids.line,
    type: 'line',
    source: srcId,
    paint: {
      'line-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], '#FFD700',
        ['boolean', ['feature-state', 'hover'], false], '#ffffff',
        ['case',
          ['get', 'is_owned'], '#FFD700',
          'rgba(255, 255, 255, 0.32)',
        ],
      ],
      'line-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 3,
        ['boolean', ['feature-state', 'hover'], false], 2.5,
        ['case',
          ['get', 'is_owned'], 2,
          isCountry ? 1 : 0.7,
        ],
      ],
    },
    layout: {
      visibility: isVisible ? 'visible' : 'none',
      'line-join': 'round',
      'line-cap': 'round',
    },
  });

  // ── Label ───────────────────────────────────
  map.addLayer({
    id: ids.label,
    type: 'symbol',
    source: srcId,
    layout: {
      'text-field': ['get', 'name'],
      'text-size': isCountry
        ? ['interpolate', ['linear'], ['zoom'], 1, 10, 3, 14, 5, 16]
        : ['interpolate', ['linear'], ['zoom'], 4, 10, 5, 12, 7, 14],
      'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
      'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
      'text-radial-offset': 0.3,
      'text-justify': 'auto',
      'text-allow-overlap': false,
      'text-optional': true,
      'text-padding': isCountry ? 4 : 2,
      'text-max-width': 8,
      visibility: isVisible ? 'visible' : 'none',
    },
    paint: {
      'text-color': ['case', ['get', 'is_owned'], '#FFD700', '#ffffff'],
      'text-halo-color': 'rgba(0, 0, 0, 0.9)',
      'text-halo-width': 2,
      'text-opacity': ['interpolate', ['linear'], ['zoom'],
        ...(isCountry ? [1, 0.7, 3, 1] : [4, 0.7, 5.5, 1]),
      ],
    },
  });
}

function setLayerVisibility(level, visible) {
  if (!map || !level) return;
  const ids = layerIds[level];
  if (!ids) return;

  if (level === ADMIN_LEVELS.COUNTRY && !visible) {
    // Province active — keep country fill as dim background
    if (map.getLayer(ids.fill)) {
      map.setLayoutProperty(ids.fill, 'visibility', 'visible');
      map.setPaintProperty(ids.fill, 'fill-opacity', 0.12);
    }
    if (map.getLayer(ids.line)) map.setLayoutProperty(ids.line, 'visibility', 'none');
    if (map.getLayer(ids.label)) map.setLayoutProperty(ids.label, 'visibility', 'none');
    return;
  }

  if (level === ADMIN_LEVELS.COUNTRY && visible) {
    if (map.getLayer(ids.fill)) {
      map.setLayoutProperty(ids.fill, 'visibility', 'visible');
      map.setPaintProperty(ids.fill, 'fill-opacity', [
        'case',
        ['boolean', ['feature-state', 'selected'], false], 0.6,
        ['boolean', ['feature-state', 'hover'], false], 0.45,
        ['case', ['get', 'is_owned'], 0.7, 0.22],
      ]);
    }
    if (map.getLayer(ids.line)) map.setLayoutProperty(ids.line, 'visibility', 'visible');
    if (map.getLayer(ids.label)) map.setLayoutProperty(ids.label, 'visibility', 'visible');
    return;
  }

  const v = visible ? 'visible' : 'none';
  for (const id of Object.values(ids)) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v);
  }
}

export function updateTerritoryStyle(level, territoryId, properties) {
  const data = geojsonData[level];
  if (!data || !map) return;
  const feature = data.features.find(f => f.properties.id === territoryId);
  if (feature) {
    Object.assign(feature.properties, properties);
    const source = map.getSource(sourceIds[level]);
    if (source) source.setData(data);
  }
}
