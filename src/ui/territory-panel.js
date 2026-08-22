import { bus, Events } from '../lib/event-bus.js';
import { formatPrice, calculateIncomePerHour } from '../game/price-engine.js';
import { GAME_CONFIG } from '../config.js';
import {
  getState, isOwned, estimatePrice, getTerritoryPrice,
  setTerritoryPrice, purchaseTerritory, sellTerritory,
  getOwnedTerritories, listOwnedProperty, unlistOwnedProperty,
  canBuyAt, isInTransit, getTravelQuote, startTravel, getLocation, distanceToKm, isGuest,
} from '../game/game-state.js';
import { getProperty } from '../game/world.js';
import { getMarketUserId } from '../game/market.js';
import { hasFriends, openCoPurchaseModal } from './friends.js';
import { t as tr } from '../lib/i18n.js';
import { showToast } from './toast.js';
import { openModal, closeModal } from './modal.js';

let panelEl, contentEl, closeBtn;
let currentTerritory = null;

export function initTerritoryPanel() {
  panelEl = document.getElementById('territory-panel');
  contentEl = document.getElementById('panel-content');
  closeBtn = document.getElementById('panel-close');

  closeBtn.addEventListener('click', () => {
    closePanel();
    bus.emit(Events.TERRITORY_DESELECTED);
  });

  bus.on(Events.TERRITORY_SELECTED, t => openPanel(t));
  bus.on(Events.TERRITORY_DESELECTED, () => closePanel());
  // Travel changes whether the selected place is buyable → re-render.
  bus.on(Events.TRAVEL_STARTED, () => refreshPanel());
  bus.on(Events.TRAVEL_ARRIVED, () => refreshPanel());
  bus.on(Events.TERRITORY_UPDATED, t => {
    if (currentTerritory?.id === t.id) refreshPanel();
  });
  let balanceRenderTimer = null;
  bus.on(Events.BALANCE_UPDATED, () => {
    if (!currentTerritory) return;
    if (balanceRenderTimer) return;
    balanceRenderTimer = setTimeout(() => { balanceRenderTimer = null; refreshPanel(); }, 500);
  });
}

function openPanel(territory) {
  currentTerritory = territory;
  panelEl.classList.remove('hidden');
  renderPanel();
}

function closePanel() {
  panelEl.classList.add('hidden');
  currentTerritory = null;
}

function refreshPanel() {
  if (currentTerritory) renderPanel();
}

function getPrice(territory) {
  const props = territory.properties || {};
  let price = getTerritoryPrice(territory.id);
  if (!price) {
    price = Number(props.current_price) || Number(props.base_price) || estimatePrice(props, territory.level);
    setTerritoryPrice(territory.id, price);
  }
  return price;
}

function renderPanel() {
  const t = currentTerritory;
  const props = t.properties || {};
  const name = props.name || t.name || '알 수 없음';
  const level = t.level || props.admin_level || '';
  const levelLabel = { country: tr('panel.level.country'), province: tr('panel.level.province'), district: tr('panel.level.district'), building: tr('panel.level.building'), floor: tr('panel.level.floor'), landmark: tr('panel.level.landmark') }[level] || level;
  const price = getPrice(t);
  const income = calculateIncomePerHour(price);
  const population = Number(props.population) || 0;
  const continent = props.continent || '';
  const countryName = props.country_name || '';
  const isoCode = props.iso_code || '';
  const owned = isOwned(t.id);
  const balance = getState().balance;

  // Get ownership info
  const ownedData = owned ? getOwnedTerritories()[t.id] : null;

  contentEl.innerHTML = `
    <div class="panel-territory">
      <div class="panel-header-row">
        <div class="panel-level-badge">${levelLabel}</div>
        ${isoCode ? `<span class="panel-iso">${isoCode}</span>` : ''}
        ${owned ? '<span class="panel-owned-badge">내 영토</span>' : ''}
      </div>
      <h2 class="panel-title">${name}</h2>
      ${countryName ? `<div class="panel-subtitle">${countryName}</div>` : ''}
      ${continent ? `<div class="panel-subtitle">${continent}</div>` : ''}

      <div class="panel-stats">
        <div class="stat-row">
          <span class="stat-label">현재 가격</span>
          <span class="stat-value price">${formatPrice(price)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">시간당 수입</span>
          <span class="stat-value income">+${formatPrice(income)}/h</span>
        </div>
        ${population ? `
        <div class="stat-row">
          <span class="stat-label">인구</span>
          <span class="stat-value">${formatPopulation(population)}</span>
        </div>` : ''}
        ${owned && ownedData ? `
        <div class="stat-row">
          <span class="stat-label">매입가</span>
          <span class="stat-value">${formatPrice(ownedData.purchasePrice)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">수익률</span>
          <span class="stat-value ${price > ownedData.purchasePrice ? 'income' : 'spent'}">
            ${price > ownedData.purchasePrice ? '+' : ''}${((price / ownedData.purchasePrice - 1) * 100).toFixed(1)}%
          </span>
        </div>
        ` : ''}
      </div>

      <div class="panel-actions" id="panel-actions">
        ${renderActions(t, owned, price, income, name)}
      </div>

      ${renderTransactionHistory(t.id)}
    </div>
  `;

  // Bind buy/sell/travel
  document.getElementById('btn-buy')?.addEventListener('click', () => confirmPurchase(t, name, level, price, income));
  document.getElementById('btn-copurchase')?.addEventListener('click', () => {
    const props = t.properties || {};
    openCoPurchaseModal({
      id: t.id, kind: level, name, price, income,
      meta: { geometry: props.geometry, height: props.height, minHeight: props.min_height, centerLng: props.centerLng, centerLat: props.centerLat },
    });
  });
  document.getElementById('btn-sell')?.addEventListener('click', () => confirmSell(t, name, price));
  document.getElementById('btn-fly-direct')?.addEventListener('click', () => doTravel(t, name, 'direct'));
  document.getElementById('btn-fly-connect')?.addEventListener('click', () => doTravel(t, name, 'connecting'));
  document.getElementById('btn-fly-train')?.addEventListener('click', () => doTravel(t, name, 'train'));
  document.getElementById('btn-login-cta')?.addEventListener('click', () =>
    showToast(tr('auth.tossOnly'), 'info'));
  document.getElementById('btn-list')?.addEventListener('click', () => promptList(t.id));
  document.getElementById('btn-unlist')?.addEventListener('click', () => doUnlist(t.id));
  document.getElementById('btn-buy-listing')?.addEventListener('click', (e) => buyListing(t, +e.currentTarget.dataset.price));
  contentEl.querySelectorAll('.floor-btn.buy').forEach((b) =>
    b.addEventListener('click', () => confirmBuyFloor(t, +b.dataset.n, +b.dataset.price)));
  contentEl.querySelectorAll('.floor-btn.sell').forEach((b) =>
    b.addEventListener('click', () => confirmSellFloor(t, b.dataset.fid)));
  contentEl.querySelectorAll('.floor-btn.list').forEach((b) =>
    b.addEventListener('click', () => promptList(b.dataset.fid)));
  contentEl.querySelectorAll('.floor-btn.unlist').forEach((b) =>
    b.addEventListener('click', () => doUnlist(b.dataset.fid)));
  contentEl.querySelectorAll('.floor-btn.buy-listing').forEach((b) =>
    b.addEventListener('click', () => buyListingFloor(t, b.dataset.fid, +b.dataset.price)));
}

/** Buy / sell / travel actions depending on ownership and whether you're nearby. */
function renderActions(t, owned, price, income, name) {
  const balance = getState().balance;

  // Browsing without login → invite sign-in instead of any action.
  if (isGuest()) {
    return `
      <p class="action-note">${tr('panel.browsing')}</p>
      <button class="btn btn-primary btn-full" id="btn-login-cta">${tr('panel.loginToBuy')}</button>`;
  }

  // Mine → sell to bank + list/unlist on the market.
  if (owned) {
    // Co-owned (shared) property → no solo selling/listing for now.
    const share = getOwnedTerritories()[t.id]?.sharePct;
    if (share != null && share < 100) {
      return `<p class="action-note">${tr('panel.coOwned', { v: share })}</p>
              <p class="action-note">${tr('panel.coOwnedNote')}</p>`;
    }
    const sp = getProperty(t.id);
    const refund = Math.round(price * GAME_CONFIG.BANK_SALE_RATIO);
    const listRow = sp?.for_sale
      ? `<p class="action-note">${tr('panel.listed')} · ${formatPrice(sp.list_price)}</p>
         <button class="btn btn-secondary btn-full" id="btn-unlist" data-id="${t.id}" style="margin-top:6px;">${tr('panel.unlist')}</button>`
      : `<button class="btn btn-secondary btn-full" id="btn-list" data-id="${t.id}" style="margin-top:6px;">${tr('panel.list')}</button>`;
    return `
      <button class="btn btn-danger btn-full" id="btn-sell">${tr('panel.sellBank')} · ${formatPrice(refund)} ${tr('panel.refund')}</button>
      ${listRow}`;
  }

  const target = t.lngLat;

  // Near your current location → buy directly (works even while a flight is in progress).
  if (!target || canBuyAt(target.lng, target.lat)) {
    // Tall buildings are traded floor-by-floor; houses/territories are whole.
    const props = t.properties || {};
    const floors = Number(props.floors) || 1;
    if (t.level === 'building' && floors > GAME_CONFIG.BUILDING.HOUSE_MAX_FLOORS) {
      return renderFloorList(props, price, floors);
    }

    // Owned by another player?
    const sp = getProperty(t.id);
    const me = getMarketUserId();
    if (sp && sp.owner_id && sp.owner_id !== me) {
      if (sp.for_sale) {
        return `
          <p class="action-note">${tr('panel.othersListing')}</p>
          <button class="btn btn-primary btn-full ${balance < sp.list_price ? 'btn-disabled' : ''}" id="btn-buy-listing" data-id="${t.id}" data-price="${sp.list_price}" ${balance < sp.list_price ? 'disabled' : ''}>${tr('panel.buyListing')} (${formatPrice(sp.list_price)})</button>`;
      }
      return `<p class="action-note action-warn">${tr('panel.locked')}</p>`;
    }

    // Unowned → buy from the bank, or pool with friends.
    return `
      <button class="btn btn-primary btn-full ${balance < price ? 'btn-disabled' : ''}" id="btn-buy" ${balance < price ? 'disabled' : ''}>
        ${tr('panel.buy')} (${formatPrice(price)})
      </button>
      ${hasFriends() ? `<button class="btn btn-secondary btn-full" id="btn-copurchase" style="margin-top:6px;">${tr('panel.coBuy')}</button>` : ''}
      ${balance < price
        ? `<p class="action-note action-warn">${tr('panel.notEnough', { v: formatPrice(price - balance) })}</p>`
        : `<p class="action-note">${tr('panel.incomePerH', { v: formatPrice(income) })}</p>`}`;
  }

  // Far away → must travel. Can't start a new flight while already in transit.
  const dist = Math.round(distanceToKm(target.lng, target.lat));
  const here = getLocation()?.name || '현재 위치';
  if (isInTransit()) {
    return `<p class="action-note action-warn">${tr('panel.inTransitBuy', { here, km: dist })}</p>`;
  }

  const q = getTravelQuote(target.lng, target.lat);
  let html = `
    <p class="action-note action-warn">${tr('panel.needTravel', { here, km: dist })}</p>
    <button class="btn btn-primary btn-full" id="btn-fly-direct">${tr('panel.flyDirect')} — ${formatPrice(q.direct.fare)} · ${q.direct.durationSec}s</button>`;
  if (q.connecting) {
    html += `
    <button class="btn btn-secondary btn-full" id="btn-fly-connect" style="margin-top:6px;">${tr('panel.flyConnect')} ${q.connecting.via.name} — ${formatPrice(q.connecting.fare)} · ${q.connecting.durationSec}s</button>`;
  }
  if (q.train) {
    html += `
    <button class="btn btn-secondary btn-full" id="btn-fly-train" style="margin-top:6px;">${tr('panel.train')} — ${formatPrice(q.train.fare)} · ${q.train.durationSec}s</button>`;
  }
  return html;
}

// ── Floor-by-floor trading for tall buildings ──────────
function floorPrice(perFloor, n, floors) {
  // Higher floors cost a bit more (penthouse premium): 0.85× → 1.15×.
  return Math.round(perFloor * (0.85 + 0.3 * n / floors));
}

function renderFloorList(props, buildingPrice, floors) {
  const buildingId = props.id;
  const perFloor = buildingPrice / floors;
  const balance = getState().balance;
  const me = getMarketUserId();

  let rows = '';
  for (let n = floors; n >= 1; n--) {
    const fid = `${buildingId}#f${n}`;
    const bankPrice = floorPrice(perFloor, n, floors);
    const sp = getProperty(fid);
    const mine = isOwned(fid);

    let cls = '', priceLabel = formatPrice(bankPrice), action;
    if (mine) {
      cls = 'owned';
      priceLabel = formatPrice(getOwnedTerritories()[fid]?.currentPrice || bankPrice);
      action = sp?.for_sale
        ? `<button class="floor-btn unlist" data-fid="${fid}">등록취소</button>`
        : `<button class="floor-btn list" data-fid="${fid}">💹</button><button class="floor-btn sell" data-fid="${fid}">판매</button>`;
    } else if (sp && sp.owner_id) {
      if (sp.for_sale) {
        cls = 'sale';
        priceLabel = `💹 ${formatPrice(sp.list_price)}`;
        action = `<button class="floor-btn buy-listing" data-fid="${fid}" data-price="${sp.list_price}" ${balance < sp.list_price ? 'disabled' : ''}>구매</button>`;
      } else {
        cls = 'taken';
        priceLabel = '<span class="floor-taken">타인 소유</span>';
        action = '';
      }
    } else {
      action = `<button class="floor-btn buy" data-n="${n}" data-price="${bankPrice}" ${balance < bankPrice ? 'disabled' : ''}>구매</button>`;
    }

    rows += `
      <div class="floor-row ${cls}">
        <span class="floor-n">${n}층</span>
        <span class="floor-price">${priceLabel}</span>
        ${action}
      </div>`;
  }
  return `
    <div class="floor-head">🏢 층별 거래 · 총 ${floors}층 · <span style="color:#22c55e">💹 매물</span></div>
    <div class="floor-list">${rows}</div>`;
}

// ── Marketplace: list / unlist / buy listing ───────────
function promptList(id) {
  const suggested = getOwnedTerritories()[id]?.currentPrice || 0;
  openModal(`
    <div class="confirm-modal">
      <h2>💹 판매 등록</h2>
      <p class="action-note">판매 가격을 정하세요. 다른 플레이어가 이 가격에 살 수 있어요.</p>
      <input id="list-price-input" type="number" min="1" value="${Math.round(suggested)}"
        style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border);background:#1a1a26;color:#fff;box-sizing:border-box;margin:10px 0;font-size:15px;" />
      <div class="confirm-actions">
        <button class="btn btn-primary" id="confirm-yes">등록</button>
        <button class="btn btn-secondary" id="confirm-no">취소</button>
      </div>
    </div>`);
  document.getElementById('confirm-yes').addEventListener('click', async () => {
    const v = Math.round(Number(document.getElementById('list-price-input').value));
    closeModal();
    if (!v || v <= 0) { showToast('가격이 올바르지 않습니다', 'error'); return; }
    const r = await listOwnedProperty(id, v);
    if (r?.success) showToast(`💹 판매 등록! · ${formatPrice(v)}`, 'success');
    else showToast(r?.message || '등록 실패', 'error');
    refreshPanel();
  });
  document.getElementById('confirm-no').addEventListener('click', () => closeModal());
}

async function doUnlist(id) {
  const r = await unlistOwnedProperty(id);
  if (r?.success) showToast('판매 등록을 취소했어요', 'info');
  else showToast(r?.message || '취소 실패', 'error');
  refreshPanel();
}

async function buyListing(t, listPrice) {
  const props = t.properties || {};
  const r = await purchaseTerritory(t.id, t.name || props.name || '자산', t.level, listPrice, {
    geometry: props.geometry, height: props.height, minHeight: props.min_height,
  });
  if (r.success) showToast(tr('toast.buyOk'), 'success');
  else showToast(r.message, 'error');
  refreshPanel();
}

async function buyListingFloor(t, fid, listPrice) {
  const props = t.properties || {};
  const n = fid.split('#f')[1];
  const r = await purchaseTerritory(fid, `${props.name || '건물'} ${n}층`, 'floor', listPrice, {
    geometry: props.geometry, floor: +n, buildingId: props.id, height: props.height, minHeight: props.min_height,
  });
  if (r.success) showToast(tr('toast.buyOk'), 'success');
  else showToast(r.message, 'error');
  refreshPanel();
}

function confirmBuyFloor(t, n, price) {
  const props = t.properties || {};
  const income = calculateIncomePerHour(price);
  const bal = getState().balance;
  openModal(`
    <div class="confirm-modal">
      <h2>층 구매 확인</h2>
      <div class="confirm-territory">🏢 ${props.name || '건물'} · <b>${n}층</b></div>
      <div class="confirm-details">
        <div class="confirm-row"><span>구매 가격</span><span class="price">${formatPrice(price)}</span></div>
        <div class="confirm-row"><span>시간당 수입</span><span class="income">+${formatPrice(income)}/h</span></div>
        <div class="confirm-row"><span>현재 잔액</span><span>${formatPrice(bal)}</span></div>
        <div class="confirm-row"><span>구매 후 잔액</span><span class="${bal < price ? 'spent' : ''}">${formatPrice(bal - price)}</span></div>
      </div>
      <div class="confirm-actions">
        <button class="btn btn-primary ${bal < price ? 'btn-disabled' : ''}" id="confirm-yes" ${bal < price ? 'disabled' : ''}>구매</button>
        <button class="btn btn-secondary" id="confirm-no">취소</button>
      </div>
    </div>`);
  document.getElementById('confirm-yes')?.addEventListener('click', async () => {
    closeModal();
    const r = await purchaseTerritory(`${props.id}#f${n}`, `${props.name || '건물'} ${n}층`, 'floor', price, {
      geometry: props.geometry, floor: n, buildingId: props.id,
      height: props.height, minHeight: props.min_height,
    });
    if (r.success) showToast(tr('toast.buyOk'), 'success');
    else showToast(r.message, 'error');
    refreshPanel();
  });
  document.getElementById('confirm-no').addEventListener('click', () => closeModal());
}

function confirmSellFloor(t, fid) {
  const n = fid.split('#f')[1] || '';
  const owned = getOwnedTerritories()[fid];
  const refund = owned ? Math.round(owned.currentPrice * GAME_CONFIG.BANK_SALE_RATIO) : 0;
  openModal(`
    <div class="confirm-modal">
      <h2>층 판매 확인</h2>
      <div class="confirm-territory">🏢 ${n}층 판매</div>
      <div class="confirm-details">
        <div class="confirm-row"><span>환급액 (70%)</span><span class="income">${formatPrice(refund)}</span></div>
        <div class="confirm-row"><span>판매 후 잔액</span><span>${formatPrice(getState().balance + refund)}</span></div>
      </div>
      <div class="confirm-actions">
        <button class="btn btn-danger" id="confirm-yes">판매</button>
        <button class="btn btn-secondary" id="confirm-no">취소</button>
      </div>
    </div>`);
  document.getElementById('confirm-yes').addEventListener('click', async () => {
    closeModal();
    const r = await sellTerritory(fid);
    if (r.success) showToast(`${tr('toast.sellOk')} +${formatPrice(r.refund)}`, 'success');
    else showToast(r.message, 'error');
    refreshPanel();
  });
  document.getElementById('confirm-no').addEventListener('click', () => closeModal());
}

async function doTravel(t, name, mode) {
  const target = t.lngLat;
  if (!target) return;
  const r = await startTravel(target.lng, target.lat, name, mode);
  if (r.success) {
    const label = mode === 'train' ? '🚄 기차' : mode === 'connecting' ? '🛫 경유' : '✈️ 직항';
    showToast(`${label} · ${name}(으)로 출발!`, 'success');
    refreshPanel();
  } else {
    showToast(r.message, 'error');
  }
}

function confirmPurchase(territory, name, level, price, income) {
  openModal(`
    <div class="confirm-modal">
      <h2>영토 구매 확인</h2>
      <div class="confirm-territory">${name}</div>
      <div class="confirm-details">
        <div class="confirm-row"><span>구매 가격</span><span class="price">${formatPrice(price)}</span></div>
        <div class="confirm-row"><span>시간당 수입</span><span class="income">+${formatPrice(income)}/h</span></div>
        <div class="confirm-row"><span>구매 후 가격</span><span>${formatPrice(Math.round(price * 1.1))}</span></div>
        <div class="confirm-row"><span>현재 잔액</span><span>${formatPrice(getState().balance)}</span></div>
        <div class="confirm-row"><span>구매 후 잔액</span><span>${formatPrice(getState().balance - price)}</span></div>
      </div>
      <div class="confirm-actions">
        <button class="btn btn-primary" id="confirm-yes">구매</button>
        <button class="btn btn-secondary" id="confirm-no">취소</button>
      </div>
    </div>
  `);

  document.getElementById('confirm-yes').addEventListener('click', async () => {
    const props = territory.properties || {};
    closeModal();
    const result = await purchaseTerritory(territory.id, name, level, price, {
      geometry: props.geometry,
      height: props.height,
      minHeight: props.min_height,
      centerLng: props.centerLng,
      centerLat: props.centerLat,
    });
    if (result.success) {
      showToast(tr('toast.buyOk'), 'success');
    } else {
      showToast(result.message, 'error');
    }
  });
  document.getElementById('confirm-no').addEventListener('click', () => closeModal());
}

function confirmSell(territory, name, price) {
  const refund = Math.round(price * GAME_CONFIG.BANK_SALE_RATIO);
  openModal(`
    <div class="confirm-modal">
      <h2>영토 판매 확인</h2>
      <div class="confirm-territory">${name}</div>
      <div class="confirm-details">
        <div class="confirm-row"><span>현재 가격</span><span>${formatPrice(price)}</span></div>
        <div class="confirm-row"><span>환급액 (70%)</span><span class="income">${formatPrice(refund)}</span></div>
        <div class="confirm-row"><span>판매 후 잔액</span><span>${formatPrice(getState().balance + refund)}</span></div>
      </div>
      <div class="confirm-actions">
        <button class="btn btn-danger" id="confirm-yes">판매</button>
        <button class="btn btn-secondary" id="confirm-no">취소</button>
      </div>
    </div>
  `);

  document.getElementById('confirm-yes').addEventListener('click', async () => {
    closeModal();
    const result = await sellTerritory(territory.id);
    if (result.success) {
      showToast(`${tr('toast.sellOk')} +${formatPrice(result.refund)}`, 'success');
    } else {
      showToast(result.message, 'error');
    }
  });
  document.getElementById('confirm-no').addEventListener('click', () => closeModal());
}

function renderTransactionHistory(territoryId) {
  const { transactions } = getState();
  const history = transactions.filter(t => t.territoryId === territoryId).slice(0, 5);
  if (history.length === 0) return '';

  return `
    <div class="panel-history">
      <h3>거래 내역</h3>
      <div class="history-list">
        ${history.map(t => `
          <div class="history-item">
            <span class="history-type ${t.type}">${t.type === 'purchase' ? '구매' : '판매'}</span>
            <span class="history-price">${formatPrice(t.price)}</span>
            <span class="history-date">${new Date(t.timestamp).toLocaleDateString('ko-KR')}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function formatPopulation(pop) {
  if (pop >= 1_000_000_000) return `${(pop / 1_000_000_000).toFixed(1)}B`;
  if (pop >= 1_000_000) return `${(pop / 1_000_000).toFixed(1)}M`;
  if (pop >= 1_000) return `${(pop / 1_000).toFixed(0)}K`;
  return pop.toString();
}
