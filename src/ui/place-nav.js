/**
 * Place navigation: lets new users reach the buyable 3D-building view in one
 * action instead of scrolling from the world view all the way to zoom 15+.
 *
 * - Quick-jump city chips
 * - 📍 geolocation ("my location")
 * - free-text place search (Mapbox geocoding)
 * - an onboarding hint that fades once the player reaches building level
 * - faster double-click zoom toward building level
 */
import { MAPBOX_TOKEN, ADMIN_LEVELS } from '../config.js';
import { LANDMARKS } from '../game/landmarks.js';
import { bus, Events } from '../lib/event-bus.js';
import { getMap } from '../lib/mapbox-setup.js';
import { t } from '../lib/i18n.js';
import { showToast } from './toast.js';
import { getTossCurrentLocation } from '../lib/toss.js';

const BUILDING_ZOOM = 16;
const HINT_DISMISS_KEY = 'wl_hint_dismissed';

// Major cities (lng, lat) with notable 3D building coverage.
export const CITIES = [
  { name: '서울', lng: 126.9780, lat: 37.5665 },
  { name: '부산', lng: 129.0756, lat: 35.1796 },
  { name: '도쿄', lng: 139.7671, lat: 35.6812 },
  { name: '뉴욕', lng: -73.9857, lat: 40.7484 },
  { name: '런던', lng: -0.1276, lat: 51.5074 },
  { name: '파리', lng: 2.3522, lat: 48.8566 },
];
const DEFAULT_CITY = CITIES[0];

// Exploration destinations = cities + iconic landmarks (with their icons).
const DESTINATIONS = [
  ...CITIES,
  ...LANDMARKS.map((l) => ({ name: `${l.icon} ${l.name}`, lng: l.lng, lat: l.lat })),
];

let map = null;

export function initPlaceNav(mapInstance) {
  map = mapInstance;
  renderNav();
  renderHint();
  enableFastDoubleClickZoom();
  bus.on(Events.MAP_ZOOM_CHANGED, ({ level }) => updateHint(level));
}

// ── UI ─────────────────────────────────────────────────
function renderNav() {
  if (document.getElementById('place-nav')) return;
  const nav = document.createElement('div');
  nav.id = 'place-nav';
  nav.className = 'place-nav';
  nav.innerHTML = `
    <form id="place-search" class="place-search" autocomplete="off">
      <input id="place-search-input" type="text" placeholder="${t('nav.searchPh')}" />
    </form>
    <div class="place-chips">
      <button type="button" class="place-chip place-chip-loc" data-loc="me">${t('nav.myloc')}</button>
      <button type="button" class="place-chip place-chip-random" data-loc="random">${t('nav.random')}</button>
      ${DESTINATIONS.map(c =>
        `<button type="button" class="place-chip" data-lng="${c.lng}" data-lat="${c.lat}" data-name="${c.name}">${c.name}</button>`
      ).join('')}
    </div>
  `;
  document.getElementById('app').appendChild(nav);

  nav.querySelector('#place-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = nav.querySelector('#place-search-input').value.trim();
    if (q) searchPlace(q);
  });

  nav.querySelectorAll('.place-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.loc === 'me') return goToMyLocation();
      if (btn.dataset.loc === 'random') return randomExplore();
      flyToPlace(+btn.dataset.lng, +btn.dataset.lat, btn.dataset.name);
    });
  });
}

// Fly to a random iconic destination (excluding roughly where we already are).
function randomExplore() {
  const m = map || getMap();
  const here = m ? m.getCenter() : null;
  const far = DESTINATIONS.filter((d) => !here || Math.hypot(d.lng - here.lng, d.lat - here.lat) > 5);
  const pool = far.length ? far : DESTINATIONS;
  const d = pool[Math.floor(Math.random() * pool.length)];
  flyToPlace(d.lng, d.lat, d.name);
}

function renderHint() {
  if (document.getElementById('onboard-hint')) return;
  const hint = document.createElement('div');
  hint.id = 'onboard-hint';
  hint.className = 'onboard-hint';
  hint.innerHTML = `
    <span>${t('nav.hint')}</span>
    <button class="onboard-close" title="닫기" aria-label="닫기">&times;</button>
  `;
  document.getElementById('app').appendChild(hint);

  hint.querySelector('.onboard-close').addEventListener('click', () => {
    hint.classList.add('hidden');
    try { localStorage.setItem(HINT_DISMISS_KEY, '1'); } catch {}
  });

  if (isHintDismissed()) hint.classList.add('hidden');
}

function updateHint(level) {
  const hint = document.getElementById('onboard-hint');
  if (!hint) return;
  if (isHintDismissed() || level === ADMIN_LEVELS.BUILDING) {
    hint.classList.add('hidden');
  } else {
    hint.classList.remove('hidden');
  }
}

function isHintDismissed() {
  try { return !!localStorage.getItem(HINT_DISMISS_KEY); } catch { return false; }
}

// ── Navigation ─────────────────────────────────────────
export function flyToPlace(lng, lat, name, announce = true) {
  const m = map || getMap();
  if (!m) return;
  m.flyTo({
    center: [lng, lat],
    zoom: BUILDING_ZOOM,
    pitch: 55,
    bearing: 0,
    duration: 2600,
    essential: true,
  });
  if (name && announce) showToast(`📍 ${name}(으)로 이동합니다`, 'info', 1800);
}

/** Fly a brand-new player straight into a 3D city after character select. */
export function flyToDefaultCity() {
  whenMapReady(() => flyToPlace(DEFAULT_CITY.lng, DEFAULT_CITY.lat, DEFAULT_CITY.name));
}

async function goToMyLocation() {
  showToast('내 위치를 확인하는 중...', 'info', 1500);
  // 토스 SDK 위치 우선, 실패 시 브라우저 geolocation 폴백 (래퍼 내부 처리).
  const loc = await getTossCurrentLocation();
  if (loc) flyToPlace(loc.lng, loc.lat, '내 위치');
  else showToast('위치 권한이 거부되었습니다', 'error');
}

async function searchPlace(query) {
  if (!MAPBOX_TOKEN) {
    showToast('검색을 사용할 수 없습니다 (지도 토큰 없음)', 'error');
    return;
  }
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?limit=1&language=ko&access_token=${MAPBOX_TOKEN}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('geocoding request failed');
    const data = await resp.json();
    const feat = data.features?.[0];
    if (!feat) {
      showToast(`'${query}' 검색 결과가 없습니다`, 'error');
      return;
    }
    const [lng, lat] = feat.center;
    flyToPlace(lng, lat, feat.text || query);
  } catch (e) {
    console.warn('place search failed:', e.message);
    showToast('검색 중 오류가 발생했습니다', 'error');
  }
}

// ── Helpers ────────────────────────────────────────────
function enableFastDoubleClickZoom() {
  // Replace the default +1 double-click with a bigger jump toward buildings.
  map.doubleClickZoom.disable();
  map.on('dblclick', (e) => {
    const target = Math.min(map.getZoom() + 3, BUILDING_ZOOM);
    map.flyTo({ center: e.lngLat, zoom: target, duration: 800, essential: true });
  });
}

function whenMapReady(cb) {
  const m = map || getMap();
  if (!m) { setTimeout(() => whenMapReady(cb), 300); return; }
  if (m.loaded()) cb();
  else m.once('load', cb);
}
