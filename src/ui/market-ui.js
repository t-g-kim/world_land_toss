/**
 * Marketplace sidebar (🏷️): browse for-sale listings.
 * - Filter bar: search by name, filter by kind, sort by price.
 * - With no filter: drill-down tree 나라 → 지역 → 매물.
 * - With a filter/search: flat filtered list.
 */
import { bus, Events } from '../lib/event-bus.js';
import { getForSaleList } from '../game/world.js';
import { getMarketUserId } from '../game/market.js';
import { purchaseTerritory, getState } from '../game/game-state.js';
import { LANDMARKS } from '../game/landmarks.js';
import { flyToPlace } from './place-nav.js';
import { formatPrice } from '../game/price-engine.js';
import { escapeHtml } from '../lib/escape.js';
import { showToast } from './toast.js';
import { MAPBOX_TOKEN } from '../config.js';

const KIND_LABEL = { building: '건물', house: '집', floor: '층', district: '시군구', province: '시/도', country: '국가', landmark: '랜드마크' };
const KIND_GROUP = { building: 'building', house: 'building', floor: 'building', landmark: 'landmark', district: 'territory', province: 'territory', country: 'territory' };
const OTHER = '기타';

let sidebarEl, contentEl, btnEl;
let view = 'countries', selCountry = null, selRegion = null;
let search = '', kindFilter = 'all', sortOrder = 'low';
const geoCache = new Map();

export function initMarketUI() {
  sidebarEl = document.getElementById('market-sidebar');
  contentEl = document.getElementById('market-content');
  btnEl = document.getElementById('btn-market');
  btnEl?.addEventListener('click', toggle);
  bus.on(Events.WORLD_UPDATED, () => {
    const listings = getForSaleList();
    btnEl?.classList.toggle('has-badge', listings.some((p) => p.owner_id !== getMarketUserId()));
    if (sidebarEl && !sidebarEl.classList.contains('hidden')) renderList();
  });
}

function toggle() {
  document.querySelectorAll('.sidebar').forEach((s) => s.classList.add('hidden'));
  sidebarEl.classList.toggle('hidden');
  if (!sidebarEl.classList.contains('hidden')) { view = 'countries'; selCountry = selRegion = null; render(); }
}

function coordsOf(p) {
  const m = String(p.id).match(/^b:(-?[\d.]+),(-?[\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  if (String(p.id).startsWith('landmark:')) {
    const lm = LANDMARKS.find((l) => `landmark:${l.id}` === p.id);
    if (lm) return [lm.lng, lm.lat];
  }
  return null;
}

async function ensureGeo(p) {
  if (geoCache.has(p.id)) return;
  const c = coordsOf(p);
  if (!c || !MAPBOX_TOKEN) { geoCache.set(p.id, { country: OTHER, region: OTHER }); return; }
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${c[0]},${c[1]}.json?types=region&language=ko&limit=1&access_token=${MAPBOX_TOKEN}`;
    const d = await (await fetch(url)).json();
    const f = d.features?.[0];
    const cc = (f?.context || []).find((x) => String(x.id).startsWith('country'));
    geoCache.set(p.id, { country: cc?.text || OTHER, region: f?.text || OTHER });
  } catch { geoCache.set(p.id, { country: OTHER, region: OTHER }); }
}

// Full render: filter bar + list container (filter bar persists across list updates).
function render() {
  contentEl.innerHTML = `
    <div class="mk-filters">
      <input id="mk-search" type="text" placeholder="🔍 이름 검색" value="${escapeHtml(search)}" />
      <div class="mk-filter-row">
        <select id="mk-kind">
          <option value="all">전체 종류</option>
          <option value="building">건물/층</option>
          <option value="landmark">랜드마크</option>
          <option value="territory">영토</option>
        </select>
        <select id="mk-sort">
          <option value="low">가격 낮은순</option>
          <option value="high">가격 높은순</option>
        </select>
      </div>
    </div>
    <div id="mk-list"></div>`;
  const s = contentEl.querySelector('#mk-search');
  s.addEventListener('input', () => { search = s.value; renderList(); });
  const k = contentEl.querySelector('#mk-kind'); k.value = kindFilter;
  k.addEventListener('change', () => { kindFilter = k.value; renderList(); });
  const so = contentEl.querySelector('#mk-sort'); so.value = sortOrder;
  so.addEventListener('change', () => { sortOrder = so.value; renderList(); });
  renderList();
}

async function renderList() {
  const listArea = contentEl.querySelector('#mk-list');
  if (!listArea) return;
  let listings = getForSaleList();
  if (!listings.length) { listArea.innerHTML = '<p class="earn-empty">현재 판매중인 매물이 없어요.</p>'; return; }

  listArea.innerHTML = '<p class="earn-empty">불러오는 중…</p>';
  await Promise.all(listings.map(ensureGeo));

  const filtering = search.trim() || kindFilter !== 'all';
  if (kindFilter !== 'all') listings = listings.filter((p) => KIND_GROUP[p.kind] === kindFilter);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    listings = listings.filter((p) => (p.name || '').toLowerCase().includes(q));
  }
  const sortFn = (a, b) => (sortOrder === 'low' ? a.list_price - b.list_price : b.list_price - a.list_price);

  if (filtering) { drawListings(listArea, [...listings].sort(sortFn), true); return; }

  // Drill-down tree
  const tree = {};
  for (const p of listings) {
    const g = geoCache.get(p.id) || { country: OTHER, region: OTHER };
    (tree[g.country] ??= {});
    (tree[g.country][g.region] ??= []).push(p);
  }
  if (view === 'listings' && selCountry && selRegion) drawListings(listArea, (tree[selCountry]?.[selRegion] || []).sort(sortFn));
  else if (view === 'regions' && selCountry) drawRegions(listArea, tree[selCountry] || {});
  else drawCountries(listArea, tree);
}

const countOf = (obj) => Object.values(obj).reduce((s, v) => s + (Array.isArray(v) ? v.length : v), 0);

function crumb() {
  const parts = ['<span class="mk-crumb" data-to="countries">전체</span>'];
  if (selCountry) parts.push(`<span class="mk-crumb" data-to="regions">${escapeHtml(selCountry)}</span>`);
  if (view === 'listings' && selRegion) parts.push(`<span>${escapeHtml(selRegion)}</span>`);
  return `<div class="mk-breadcrumb">${parts.join(' › ')}</div>`;
}

function drawCountries(el, tree) {
  const entries = Object.entries(tree).sort((a, b) => countOf(b[1]) - countOf(a[1]));
  el.innerHTML = crumb() + `<div class="market-list">${entries.map(([c, r]) =>
    `<div class="market-group" data-country="${escapeHtml(c)}"><span class="mk-group-name">🌍 ${escapeHtml(c)}</span><span class="mk-group-count">${countOf(r)}개 ›</span></div>`).join('')}</div>`;
  el.querySelectorAll('.market-group').forEach((g) => g.addEventListener('click', () => { selCountry = g.dataset.country; view = 'regions'; renderList(); }));
  bindCrumbs(el);
}

function drawRegions(el, regions) {
  const entries = Object.entries(regions).sort((a, b) => b[1].length - a[1].length);
  el.innerHTML = crumb() + `<div class="market-list">${entries.map(([r, list]) =>
    `<div class="market-group" data-region="${escapeHtml(r)}"><span class="mk-group-name">📍 ${escapeHtml(r)}</span><span class="mk-group-count">${list.length}개 ›</span></div>`).join('')}</div>`;
  el.querySelectorAll('.market-group').forEach((g) => g.addEventListener('click', () => { selRegion = g.dataset.region; view = 'listings'; renderList(); }));
  bindCrumbs(el);
}

function drawListings(el, list, flat = false) {
  const me = getMarketUserId();
  const bal = getState().balance;
  el.innerHTML = (flat ? '' : crumb()) + (list.length ? `<div class="market-list">${list.map((p) => {
    const mine = p.owner_id === me;
    const c = coordsOf(p);
    return `
      <div class="market-card" data-id="${p.id}">
        <div class="market-body">
          <div class="market-title">${escapeHtml(p.name || '자산')}</div>
          <div class="market-sub">${KIND_LABEL[p.kind] || p.kind}${mine ? ' · 내 매물' : ''}</div>
          <div class="market-price">💹 ${formatPrice(p.list_price)}</div>
        </div>
        <div class="market-actions">
          ${c ? `<button class="market-btn go" data-lng="${c[0]}" data-lat="${c[1]}">이동</button>` : ''}
          ${mine ? '' : `<button class="market-btn buy" data-id="${p.id}" ${bal < p.list_price ? 'disabled' : ''}>구매</button>`}
        </div>
      </div>`;
  }).join('')}</div>` : '<p class="earn-empty">조건에 맞는 매물이 없어요.</p>');
  el.querySelectorAll('.market-btn.go').forEach((b) => b.addEventListener('click', () => flyToPlace(+b.dataset.lng, +b.dataset.lat, '매물')));
  el.querySelectorAll('.market-btn.buy').forEach((b) => b.addEventListener('click', () => buy(b.dataset.id)));
  bindCrumbs(el);
}

function bindCrumbs(el) {
  el.querySelectorAll('.mk-crumb').forEach((c) => c.addEventListener('click', () => {
    const to = c.dataset.to;
    if (to === 'countries') { view = 'countries'; selCountry = selRegion = null; }
    else if (to === 'regions') { view = 'regions'; selRegion = null; }
    renderList();
  }));
}

async function buy(id) {
  const p = getForSaleList().find((x) => x.id === id);
  if (!p) return;
  const r = await purchaseTerritory(p.id, p.name, p.kind, p.list_price, p.meta || {});
  if (r.success) showToast('매물 구매 완료! 🎉', 'success');
  else showToast(r.message, 'error');
  renderList();
}
