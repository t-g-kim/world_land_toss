import { ZOOM_LEVELS, ADMIN_LEVELS } from '../config.js';
import { bus, Events } from '../lib/event-bus.js';

let currentLevel = ADMIN_LEVELS.COUNTRY;

export function getCurrentAdminLevel() {
  return currentLevel;
}

export function getAdminLevelForZoom(zoom) {
  if (zoom >= ZOOM_LEVELS.BUILDING.min) return ADMIN_LEVELS.BUILDING;
  if (zoom >= ZOOM_LEVELS.DISTRICT.min) return ADMIN_LEVELS.DISTRICT;
  if (zoom >= ZOOM_LEVELS.PROVINCE.min) return ADMIN_LEVELS.PROVINCE;
  return ADMIN_LEVELS.COUNTRY;
}

export function initZoomController(map) {
  function onZoom() {
    const zoom = map.getZoom();
    const newLevel = getAdminLevelForZoom(zoom);

    if (newLevel !== currentLevel) {
      const prev = currentLevel;
      currentLevel = newLevel;
      bus.emit(Events.MAP_ZOOM_CHANGED, { zoom, level: newLevel, prevLevel: prev });
    }
  }

  map.on('zoom', onZoom);
  currentLevel = getAdminLevelForZoom(map.getZoom());
}
