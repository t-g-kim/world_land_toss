import mapboxgl from 'mapbox-gl';
import { ADMIN_LEVELS } from '../config.js';
import { bus, Events } from '../lib/event-bus.js';
import { getLayerIds, getSourceIds } from './territory-layers.js';
import { getCurrentAdminLevel } from './zoom-controller.js';
import { formatPrice } from '../game/price-engine.js';
import { isOwned, getTerritoryPrice, estimatePrice, setTerritoryPrice } from '../game/game-state.js';

let map = null;
let hoveredFeatureId = null;
let hoveredLevel = null;
let selectedFeatureId = null;
let selectedLevel = null;
let tooltip = null;
const boundLevels = new Set();

const LEVEL_LABELS = {
  [ADMIN_LEVELS.COUNTRY]: '국가',
  [ADMIN_LEVELS.PROVINCE]: '시도',
  [ADMIN_LEVELS.DISTRICT]: '시군구',
};

const PARENT_LEVELS = {
  [ADMIN_LEVELS.DISTRICT]: [ADMIN_LEVELS.PROVINCE, ADMIN_LEVELS.COUNTRY],
  [ADMIN_LEVELS.PROVINCE]: [ADMIN_LEVELS.COUNTRY],
  [ADMIN_LEVELS.COUNTRY]: [],
};

export function initTerritoryInteraction(mapInstance) {
  map = mapInstance;

  tooltip = new mapboxgl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'territory-tooltip',
    offset: 12,
    maxWidth: '240px',
  });

  bindAllLayers();
  // Only listen for sourcedata until all levels are bound, then stop
  const onSourceData = () => {
    bindAllLayers();
    // Only count levels that actually get rendered layers (building has none).
    if (boundLevels.size >= Object.keys(getLayerIds()).length) {
      map.off('sourcedata', onSourceData);
    }
  };
  map.on('sourcedata', onSourceData);

  // Global click: fallback to parent layers when clicking gaps
  map.on('click', (e) => {
    const currentLevel = getCurrentAdminLevel();
    const fillId = getLayerIds()[currentLevel]?.fill;
    if (!fillId || !map.getLayer(fillId)) return;

    const features = map.queryRenderedFeatures(e.point, { layers: [fillId] });
    if (features.length > 0) return; // handled by layer click

    // Try parent levels
    const fallback = findFallbackFeature(e.point, currentLevel);
    if (fallback) {
      handleClick(e, fallback.level, fallback.feature);
      return;
    }
    deselectTerritory();
  });

  // Global mousemove: tooltip on gaps → show parent territory
  map.on('mousemove', (e) => {
    const currentLevel = getCurrentAdminLevel();
    const fillId = getLayerIds()[currentLevel]?.fill;
    if (!fillId || !map.getLayer(fillId)) return;

    const features = map.queryRenderedFeatures(e.point, { layers: [fillId] });
    if (features.length > 0) return; // active layer handles it

    const fallback = findFallbackFeature(e.point, currentLevel);
    if (fallback) {
      showFallbackHover(e, fallback.level, fallback.feature);
    } else {
      clearFallbackHover();
    }
  });
}

function findFallbackFeature(point, currentLevel) {
  const parents = PARENT_LEVELS[currentLevel] || [];
  for (const parentLevel of parents) {
    const parentFillId = getLayerIds()[parentLevel]?.fill;
    if (parentFillId && map.getLayer(parentFillId)) {
      const hits = map.queryRenderedFeatures(point, { layers: [parentFillId] });
      if (hits.length > 0) return { level: parentLevel, feature: hits[0] };
    }
  }
  return null;
}

function showFallbackHover(e, level, feature) {
  const srcId = getSourceIds()[level];
  map.getCanvas().style.cursor = 'pointer';

  if (hoveredFeatureId !== null && hoveredLevel) {
    map.setFeatureState({ source: getSourceIds()[hoveredLevel], id: hoveredFeatureId }, { hover: false });
  }
  hoveredFeatureId = feature.id;
  hoveredLevel = level;
  map.setFeatureState({ source: srcId, id: hoveredFeatureId }, { hover: true });

  const props = feature.properties;
  const id = props.id;
  const name = props.name || '알 수 없음';
  let price = getTerritoryPrice(id);
  if (!price) {
    price = estimatePrice(props, level);
    setTerritoryPrice(id, price);
  }
  const owned = isOwned(id);

  tooltip.setLngLat(e.lngLat).setHTML(`
    <div class="tt-name">${name}</div>
    <div class="tt-level">${LEVEL_LABELS[level]} 영토</div>
    <div class="tt-price">${formatPrice(price)}</div>
    ${owned ? '<div class="tt-owned">내 영토</div>' : '<div class="tt-buy">클릭하여 구매</div>'}
  `).addTo(map);
}

function clearFallbackHover() {
  if (hoveredFeatureId !== null && hoveredLevel) {
    map.setFeatureState({ source: getSourceIds()[hoveredLevel], id: hoveredFeatureId }, { hover: false });
    hoveredFeatureId = null;
    hoveredLevel = null;
    map.getCanvas().style.cursor = '';
    tooltip.remove();
  }
}

function bindAllLayers() {
  for (const level of Object.values(ADMIN_LEVELS)) {
    if (boundLevels.has(level)) continue;
    const ids = getLayerIds()[level];
    if (!ids || !map.getLayer(ids.fill)) continue;
    boundLevels.add(level);

    map.on('mousemove', ids.fill, e => handleMouseMove(e, level));
    map.on('mouseleave', ids.fill, () => handleMouseLeave(level));
    map.on('click', ids.fill, e => {
      if (level !== getCurrentAdminLevel()) return;
      if (e.features.length === 0) return;
      handleClick(e, level, e.features[0]);
    });
  }
}

function handleMouseMove(e, level) {
  if (level !== getCurrentAdminLevel()) return;
  if (e.features.length === 0) return;
  map.getCanvas().style.cursor = 'pointer';

  const feature = e.features[0];
  const srcId = getSourceIds()[level];

  if (hoveredFeatureId !== null && hoveredLevel) {
    map.setFeatureState({ source: getSourceIds()[hoveredLevel], id: hoveredFeatureId }, { hover: false });
  }
  hoveredFeatureId = feature.id;
  hoveredLevel = level;
  map.setFeatureState({ source: srcId, id: hoveredFeatureId }, { hover: true });

  const props = feature.properties;
  const id = props.id;
  const name = props.name || '알 수 없음';
  let price = getTerritoryPrice(id);
  if (!price) {
    price = estimatePrice(props, level);
    setTerritoryPrice(id, price);
  }
  const owned = isOwned(id);

  tooltip.setLngLat(e.lngLat).setHTML(`
    <div class="tt-name">${name}</div>
    <div class="tt-price">${formatPrice(price)}</div>
    ${owned ? '<div class="tt-owned">내 영토</div>' : '<div class="tt-buy">클릭하여 구매</div>'}
  `).addTo(map);
}

function handleMouseLeave(level) {
  if (hoveredFeatureId !== null && hoveredLevel === level) {
    map.setFeatureState({ source: getSourceIds()[level], id: hoveredFeatureId }, { hover: false });
    hoveredFeatureId = null;
    hoveredLevel = null;
    map.getCanvas().style.cursor = '';
    tooltip.remove();
  }
}

function handleClick(e, level, feature) {
  const props = feature.properties;

  deselectTerritory();

  selectedFeatureId = feature.id;
  selectedLevel = level;
  map.setFeatureState({ source: getSourceIds()[level], id: selectedFeatureId }, { selected: true });

  bus.emit(Events.TERRITORY_SELECTED, {
    id: props.id,
    name: props.name || props.NAME,
    level,
    properties: props,
    lngLat: e.lngLat,
  });
}

function deselectTerritory() {
  if (selectedFeatureId !== null && selectedLevel) {
    map.setFeatureState({ source: getSourceIds()[selectedLevel], id: selectedFeatureId }, { selected: false });
    selectedFeatureId = null;
    selectedLevel = null;
    bus.emit(Events.TERRITORY_DESELECTED);
  }
}
