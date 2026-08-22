import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, MAP_CONFIG } from '../config.js';
import { bus, Events } from './event-bus.js';

let map = null;

export function getMap() {
  return map;
}

export function initMap(container = 'map') {
  if (!MAPBOX_TOKEN) {
    throw new Error('VITE_MAPBOX_TOKEN이 설정되지 않았습니다. .env 파일을 확인하세요.');
  }

  mapboxgl.accessToken = MAPBOX_TOKEN;

  map = new mapboxgl.Map({
    container,
    style: MAP_CONFIG.style,
    center: MAP_CONFIG.center,
    zoom: MAP_CONFIG.zoom,
    minZoom: MAP_CONFIG.minZoom,
    maxZoom: MAP_CONFIG.maxZoom,
    projection: 'globe',
    attributionControl: false,
    antialias: true,
  });

  map.on('style.load', () => {
    map.setFog({
      color: 'rgb(8, 8, 16)',
      'high-color': 'rgb(16, 16, 48)',
      'horizon-blend': 0.06,
      'space-color': 'rgb(3, 3, 10)',
      'star-intensity': 0.7,
    });

    // Dim base map layers so territory colors pop
    for (const layer of map.getStyle().layers) {
      const id = layer.id;
      // Dim fill-type base layers
      if (layer.type === 'fill' && !id.includes('countries') && !id.includes('provinces')) {
        try { map.setPaintProperty(id, 'fill-color', '#0a0a14'); } catch {}
        try { map.setPaintProperty(id, 'fill-opacity', 0.6); } catch {}
      }
      // Hide default labels so our labels take priority
      if (layer.type === 'symbol' && !id.includes('countries-') && !id.includes('provinces-')) {
        try { map.setLayoutProperty(id, 'visibility', 'none'); } catch {}
      }
    }
  });

  map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'bottom-right');

  map.on('load', () => {
    bus.emit(Events.MAP_LOADED, map);
  });

  // zoom-controller.js handles MAP_ZOOM_CHANGED — no duplicate emit here

  return map;
}
