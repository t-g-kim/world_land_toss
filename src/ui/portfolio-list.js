import { bus, Events } from '../lib/event-bus.js';
import { formatPrice } from '../game/price-engine.js';
import { getOwnedTerritories, getTotalTerritoryValue, getTotalIncomePerHour } from '../game/game-state.js';
import { getMap } from '../lib/mapbox-setup.js';
import { escapeHtml } from '../lib/escape.js';

const LEVEL_LABEL = { country: '국가', province: '시/도', district: '시군구', building: '건물', house: '집', floor: '층', landmark: '🏆 랜드마크' };
const LEVEL_ZOOM = { country: 4, province: 6, district: 9, building: 16, house: 16, floor: 16, landmark: 16 };

let sidebarEl, contentEl;

export function initPortfolio() {
  sidebarEl = document.getElementById('portfolio-sidebar');
  contentEl = document.getElementById('portfolio-content');
  document.getElementById('btn-portfolio').addEventListener('click', togglePortfolio);
  sidebarEl.querySelector('.sidebar-close').addEventListener('click', () => sidebarEl.classList.add('hidden'));

  bus.on(Events.TERRITORY_UPDATED, () => { if (!sidebarEl.classList.contains('hidden')) render(); });
  bus.on(Events.WORLD_UPDATED, () => { if (!sidebarEl.classList.contains('hidden')) render(); });
}

function togglePortfolio() {
  document.querySelectorAll('.sidebar').forEach((s) => s.classList.add('hidden'));
  sidebarEl.classList.toggle('hidden');
  if (!sidebarEl.classList.contains('hidden')) render();
}

// Best-effort coordinates for an owned asset.
function coordsFor(id, t) {
  const m = String(id).match(/^b:(-?[\d.]+),(-?[\d.]+)/);
  if (m) return [Number(m[1]), Number(m[2])];
  if (t.centerLng != null && t.centerLat != null) return [t.centerLng, t.centerLat];
  const g = t.geometry;
  const ring = g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0]?.[0] : null;
  if (ring?.length) {
    let lng = 0, lat = 0;
    for (const [x, y] of ring) { lng += x; lat += y; }
    return [lng / ring.length, lat / ring.length];
  }
  return null;
}

function flyTo(id, t) {
  const map = getMap();
  if (!map) return;
  const c = coordsFor(id, t);
  if (c) { map.flyTo({ center: c, zoom: LEVEL_ZOOM[t.level] || 12, duration: 1800, essential: true }); return; }
  // Territory without coords → look it up in the loaded source.
  const src = map.getSource(`${t.level}-source`);
  if (src) {
    const f = map.querySourceFeatures(`${t.level}-source`, { filter: ['==', ['get', 'id'], id] });
    if (f[0]?.geometry) {
      const cc = coordsFor(id, { geometry: f[0].geometry });
      if (cc) map.flyTo({ center: cc, zoom: LEVEL_ZOOM[t.level] || 6, duration: 1500 });
    }
  }
}

function render() {
  const owned = getOwnedTerritories();
  const entries = Object.entries(owned);

  if (entries.length === 0) {
    contentEl.innerHTML = `
      <div class="portfolio-empty">
        <div class="empty-icon">🗺️</div>
        <p>보유한 자산이 없습니다</p>
        <p class="muted">지도에서 건물·영토를 클릭해 구매하세요</p>
      </div>`;
    return;
  }

  const totalValue = getTotalTerritoryValue();
  const totalIncome = getTotalIncomePerHour();

  contentEl.innerHTML = `
    <div class="portfolio-summary">
      <div class="pf-stat"><span class="pf-label">자산 ${entries.length}개 · 총 가치</span><span class="pf-value">${formatPrice(totalValue)}</span></div>
      <div class="pf-stat"><span class="pf-label">시간당 수입</span><span class="pf-value income">+${formatPrice(totalIncome)}/h</span></div>
    </div>
    <div class="portfolio-list">
      ${entries.map(([id, t]) => `
        <div class="pf-item" data-id="${escapeHtml(id)}">
          <div class="pf-item-info">
            <span class="pf-item-level">${LEVEL_LABEL[t.level] || t.level}${t.sharePct != null ? ` · 👥${t.sharePct}%` : ''}${t.forSale ? ' · 💹판매중' : ''}</span>
            <span class="pf-item-name">${escapeHtml(t.name || '자산')}</span>
          </div>
          <div class="pf-item-stats">
            <span class="pf-item-price">${formatPrice(t.currentPrice)}</span>
            <span class="pf-item-income">+${formatPrice(t.incomePerHour)}/h</span>
          </div>
        </div>`).join('')}
    </div>`;

  contentEl.querySelectorAll('.pf-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const t = owned[id];
      if (!t) return;
      sidebarEl.classList.add('hidden');
      flyTo(id, t);
    });
  });
}
