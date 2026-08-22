// Styles
import './styles/main.css';
import './styles/map.css';
import './styles/panel.css';
import './styles/dashboard.css';
import './styles/auth.css';
import './styles/components.css';
import './styles/clicker.css';
import './styles/place-nav.css';
import './styles/earn.css';
import './styles/missions.css';
import './styles/responsive.css';

// Lib
import { initMap, getMap } from './lib/mapbox-setup.js';
import { bus, Events } from './lib/event-bus.js';

// Map
import { initTerritoryLayers, setGeoJSON } from './map/territory-layers.js';
import { initTerritoryInteraction } from './map/territory-interaction.js';
import { initBuildingLayer } from './map/building-layer.js';
import { initTravelPlane } from './map/travel-plane.js';
import { initWorldOwnership } from './map/world-ownership.js';
import { startWorldSync, syncViewport } from './game/world.js';
import { initZoomController, getCurrentAdminLevel } from './map/zoom-controller.js';

// UI
import { initToast, showToast } from './ui/toast.js';
import { initModal, openModal } from './ui/modal.js';
import { initTerritoryPanel } from './ui/territory-panel.js';
import { initDashboard } from './ui/dashboard.js';
import { initLeaderboard } from './ui/leaderboard.js';
import { initPortfolio } from './ui/portfolio-list.js';
import { showNicknameSetup } from './ui/nickname-setup.js';
import { showHomeSelect } from './ui/home-select.js';
import { initClickerUI } from './ui/clicker-ui.js';
import { initPlaceNav, flyToPlace } from './ui/place-nav.js';
import { initTravelStatus } from './ui/travel-status.js';
import { initEarn } from './ui/earn.js';
import { initMissions } from './ui/missions.js';
import { initMarketUI } from './ui/market-ui.js';
import { maybeShowTutorial } from './ui/tutorial.js';
import { initNotifications } from './ui/notifications.js';
import { initFriends } from './ui/friends.js';
import { applyStaticI18n, getLang, setLang, t } from './lib/i18n.js';

// Auth
import { getSession, showAuthScreen, signOut, signInWithToss } from './ui/auth.js';
import { escapeHtml } from './lib/escape.js';

// Game
import { formatPrice } from './game/price-engine.js';
import { initGameState, getState, grantStartingBalance, isHomeSet, setHome, getLocation, isInTransit } from './game/game-state.js';

import { ADMIN_LEVELS } from './config.js';

// ─────────────────────────────────────────────────

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
  return `${Math.max(1, m)}분`;
}

async function init() {
  // Localize static HTML (top bar, sidebars, auth).
  applyStaticI18n();
  document.documentElement.lang = getLang();

  // Core UI
  initToast();
  initModal();

  // Auth gate — 앱인토스: 토스 사용자 식별키로 자동 로그인 (로그인 화면 없음).
  const session = await getSession();
  if (session) {
    await startGame(session.user);
    return;
  }

  showAuthScreen(); // "연결 중..." 화면
  try {
    const tossSession = await signInWithToss();
    if (tossSession) {
      await startGame(tossSession.user);
      return;
    }
    // 토스 앱 밖: dev에서만 게스트(로컬) 모드 허용, 프로덕션은 안내만.
    if (import.meta.env.DEV) {
      showAuthScreen({ onGuest: () => startGame(null) });
    } else {
      showAuthScreen({ error: t('auth.tossOnly') });
    }
  } catch (err) {
    console.error('Toss login failed:', err);
    showAuthScreen({ error: t('auth.error') + (err?.message || '') });
  }
}

// user === null means guest mode (no auth; state persists to localStorage).
async function startGame(user) {
  // Leaving the login/character overlay behind.
  document.getElementById('auth-overlay')?.classList.add('hidden');

  // Game state — real users persist to Supabase, guests to localStorage.
  const offline = await initGameState(user);
  startWorldSync(); // shared-world ownership + listings

  // Map
  const map = initMap();

  bus.on(Events.MAP_LOADED, async () => {
    initZoomController(map);
    initTerritoryLayers(map);
    initTerritoryInteraction(map);
    initBuildingLayer(map);
    initWorldOwnership(map);
    initTravelPlane(map);
    initTerritoryPanel();
    initPlaceNav(map);

    await loadTerritories();

    // Preload province data in background after countries are loaded
    preloadNextLevel();

    bus.on(Events.MAP_ZOOM_CHANGED, async ({ level, prevLevel }) => {
      updateZoomIndicator(level);
      if (level !== prevLevel) await loadTerritories(level);
      if (level === ADMIN_LEVELS.DISTRICT) scheduleDistrictLoad();
      if (level === ADMIN_LEVELS.BUILDING) syncViewport(map.getBounds());
    });

    // On-demand per-viewport loading: districts + shared-world ownership.
    map.on('moveend', () => {
      const level = getCurrentAdminLevel();
      if (level === ADMIN_LEVELS.DISTRICT) scheduleDistrictLoad();
      if (level === ADMIN_LEVELS.BUILDING) syncViewport(map.getBounds());
    });
  });

  const gameState = getState();

  if (user) {
    // ── Logged-in: nickname + home setup, then land on home ──
    const isNewPlayer = !gameState.nickname;
    if (isNewPlayer) {
      await showNicknameSetup();
      grantStartingBalance();
    }
    if (!isHomeSet()) {
      const home = await showHomeSelect();
      setHome(home);
    }
    document.getElementById('auth-overlay')?.classList.add('hidden');
    const loc = getLocation();
    if (loc && !isInTransit()) flyToPlace(loc.lng, loc.lat, loc.name, false);

    initClickerUI();

    if (isNewPlayer) {
      showToast(t('toast.welcome', { name: getState().nickname, bal: formatPrice(getState().balance) }), 'success', 5000);
    } else if (offline?.earned > 0) {
      showToast(t('toast.idle', { dur: formatDuration(offline.seconds), earned: formatPrice(offline.earned) }), 'success', 6000);
    }
    maybeShowTutorial(isNewPlayer);
  } else {
    // ── Guest (dev 전용): explore only. ──
    document.getElementById('auth-overlay')?.classList.add('hidden');
    flyToPlace(126.9780, 37.5665, '서울', false);
    initClickerUI();
    showToast(t('toast.guestBrowse'), 'info', 6000);
  }

  // Sidebars
  initDashboard();
  initLeaderboard();
  initPortfolio();

  // Location / transit indicator in the top bar
  initTravelStatus();

  // 돈벌기 (rewarded ads) menu
  initEarn();

  // 목표 / 미션
  initMissions();

  // 마켓 (매물 거래)
  initMarketUI();

  // 🔔 알림 (내 매물 판매 + 근처 거래)
  initNotifications();

  // 👥 친구 + 공동구매
  initFriends();

  // Balance display
  updateBalanceDisplay(gameState.balance);
  bus.on(Events.BALANCE_UPDATED, balance => updateBalanceDisplay(balance));

  // Close sidebars on clicking outside
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.close);
      if (target) target.classList.add('hidden');
    });
  });

  // Account (토스 자동 로그인 — 계정 화면에는 닉네임/언어만 노출)
  document.getElementById('btn-account')?.addEventListener('click', () => {
    const isGuest = !user;
    const name = escapeHtml(getState().nickname || (isGuest ? t('acct.guest') : 'Player'));
    openModal(`
      <div style="text-align:center; padding:24px;">
        <div style="font-size:2rem; margin-bottom:8px;">${isGuest ? '🙂' : '👤'}</div>
        <h2 style="margin:0 0 4px; font-size:1.25rem;">${name}</h2>
        <p style="margin:0 0 20px; color:#888; font-size:0.85rem;">
          ${isGuest ? t('acct.guestNote') : t('acct.tossNote')}
        </p>
        <div class="lang-switch" style="margin-bottom:16px;">
          <button type="button" data-lang="ko" class="${getLang() === 'ko' ? 'on' : ''}">한국어</button>
          <button type="button" data-lang="en" class="${getLang() === 'en' ? 'on' : ''}">English</button>
        </div>
        ${isGuest ? '' : `<button id="account-action-btn" style="
          padding:10px 32px; border:none; border-radius:8px;
          background:#ef4444; color:#fff; font-size:1rem; cursor:pointer;
        ">${t('acct.logout')}</button>`}
      </div>
    `);
    document.querySelectorAll('.lang-switch button').forEach((b) =>
      b.addEventListener('click', () => setLang(b.dataset.lang)));
    document.getElementById('account-action-btn')?.addEventListener('click', () => signOut());
  });
}

const loadedLevels = new Set();
async function loadTerritories(level) {
  level = level || getCurrentAdminLevel();
  if (loadedLevels.has(level)) return; // already loaded

  const files = {
    [ADMIN_LEVELS.COUNTRY]: '/data/countries.geojson',
    [ADMIN_LEVELS.PROVINCE]: '/data/provinces.geojson',
  };
  const file = files[level];
  if (!file) return;

  try {
    showToast(`${level === ADMIN_LEVELS.PROVINCE ? '시도' : '국가'} 데이터 로딩중...`, 'info', 2000);
    const resp = await fetch(file);
    if (!resp.ok) return;
    const geojson = await resp.json();
    setGeoJSON(level, geojson);
    loadedLevels.add(level);
  } catch (err) {
    console.warn('Failed to load GeoJSON:', file, err);
  }
}

// ── Districts (ADM2) — per-country, loaded on demand for the current view ──
const loadedDistrictCountries = new Set();   // iso codes fetched (incl. 404s)
const districtFeaturesByCountry = new Map(); // iso → feature[]
let districtLoadTimer = null;

function scheduleDistrictLoad() {
  if (districtLoadTimer) return;
  districtLoadTimer = setTimeout(() => {
    districtLoadTimer = null;
    loadDistrictsInView();
  }, 400);
}

async function loadDistrictsInView() {
  const map = getMap();
  if (!map || getCurrentAdminLevel() !== ADMIN_LEVELS.DISTRICT) return;
  if (!map.getLayer('countries-fill')) return;

  // Which countries are visible? (country features carry id = ISO3)
  const isos = new Set();
  for (const f of map.queryRenderedFeatures({ layers: ['countries-fill'] })) {
    const iso = f.properties?.id;
    if (iso) isos.add(iso);
  }

  let changed = false;
  for (const iso of isos) {
    if (loadedDistrictCountries.has(iso)) continue;
    loadedDistrictCountries.add(iso); // mark first so we never refetch (incl. 404s)
    try {
      const resp = await fetch(`/data/districts/${iso}.json`);
      if (!resp.ok) continue; // no district file for this country
      const fc = await resp.json();
      districtFeaturesByCountry.set(iso, fc.features || []);
      changed = true;
    } catch (err) {
      console.warn('district load failed:', iso, err);
    }
  }

  if (changed) {
    const merged = { type: 'FeatureCollection', features: [] };
    for (const arr of districtFeaturesByCountry.values()) merged.features.push(...arr);
    setGeoJSON(ADMIN_LEVELS.DISTRICT, merged);
  }
}

// Zoom indicator
const LEVEL_NAMES = {
  [ADMIN_LEVELS.COUNTRY]: '국가 보기',
  [ADMIN_LEVELS.PROVINCE]: '시/도 보기',
  [ADMIN_LEVELS.DISTRICT]: '시군구 보기',
  [ADMIN_LEVELS.BUILDING]: '건물 보기 🏙️',
};
let zoomIndicatorTimeout = null;
function updateZoomIndicator(level) {
  const el = document.getElementById('zoom-indicator');
  if (!el) return;
  el.textContent = LEVEL_NAMES[level] || level;
  el.style.opacity = '1';
  clearTimeout(zoomIndicatorTimeout);
  zoomIndicatorTimeout = setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// Preload next level data in background
function preloadNextLevel() {
  const current = getCurrentAdminLevel();
  const levels = Object.values(ADMIN_LEVELS);
  for (const level of levels) {
    if (level !== current && !loadedLevels.has(level)) {
      // Use requestIdleCallback or setTimeout to avoid blocking
      const load = () => loadTerritories(level);
      if ('requestIdleCallback' in window) {
        requestIdleCallback(load, { timeout: 5000 });
      } else {
        setTimeout(load, 2000);
      }
      break;
    }
  }
}

let lastBalance = 0;
function updateBalanceDisplay(balance) {
  const el = document.getElementById('balance-value');
  if (!el) return;
  el.textContent = formatPrice(balance);

  // Pulse animation on change
  if (balance !== lastBalance) {
    el.classList.remove('balance-pulse-up', 'balance-pulse-down');
    void el.offsetWidth; // force reflow
    el.classList.add(balance > lastBalance ? 'balance-pulse-up' : 'balance-pulse-down');
    lastBalance = balance;
  }
}

init().catch(err => console.error('Init failed:', err));
