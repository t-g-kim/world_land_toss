import { bus, Events } from '../lib/event-bus.js';
import { formatPrice } from '../game/price-engine.js';
import {
  getState, getOwnedCount, getTotalIncomePerHour,
  getTotalTerritoryValue, getNetWorth, resetGame,
} from '../game/game-state.js';
import { escapeHtml } from '../lib/escape.js';

let sidebarEl, contentEl;
let renderTimer = null;

export function initDashboard() {
  sidebarEl = document.getElementById('dashboard-sidebar');
  contentEl = document.getElementById('dashboard-content');

  document.getElementById('btn-dashboard').addEventListener('click', toggleDashboard);
  sidebarEl.querySelector('.sidebar-close').addEventListener('click', () => sidebarEl.classList.add('hidden'));

  bus.on(Events.BALANCE_UPDATED, () => {
    if (sidebarEl.classList.contains('hidden')) return;
    // Throttle renders to max 1/sec
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 500);
  });
}

function toggleDashboard() {
  document.querySelectorAll('.sidebar').forEach(s => s.classList.add('hidden'));
  sidebarEl.classList.toggle('hidden');
  if (!sidebarEl.classList.contains('hidden')) render();
}

function render() {
  const s = getState();
  const hourlyIncome = getTotalIncomePerHour();
  const autoIncome = s.autoPerSec * 3600;
  const totalHourly = hourlyIncome + autoIncome;

  contentEl.innerHTML = `
    <div class="dashboard-stats">
      <div class="dash-card dash-highlight">
        <div class="dash-label">잔액</div>
        <div class="dash-value">${formatPrice(s.balance)}</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">순자산</div>
        <div class="dash-value">${formatPrice(getNetWorth())}</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">보유 영토</div>
        <div class="dash-value">${getOwnedCount()}개</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">영토 가치</div>
        <div class="dash-value">${formatPrice(getTotalTerritoryValue())}</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">시간당 수입</div>
        <div class="dash-value income">+${formatPrice(totalHourly)}/h</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">총 수입</div>
        <div class="dash-value income">+${formatPrice(s.totalIncome)}</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">총 클릭</div>
        <div class="dash-value">${s.totalClicks.toLocaleString()}회</div>
      </div>
      <div class="dash-card">
        <div class="dash-label">총 지출</div>
        <div class="dash-value spent">${formatPrice(s.totalSpent)}</div>
      </div>
    </div>

    <div class="dash-section">
      <h3>플레이어</h3>
      <div class="dash-character">
        <span class="dash-char-emoji">👤</span>
        <div>
          <div class="dash-char-name">${escapeHtml(s.nickname || '게스트')}</div>
        </div>
      </div>
    </div>

    <div class="dash-section">
      <h3>최근 거래</h3>
      ${renderTransactions()}
    </div>

    <div class="dash-section">
      <button class="btn btn-danger btn-full" id="btn-reset-game" style="opacity:0.7;font-size:12px;">
        게임 초기화
      </button>
    </div>
  `;

  document.getElementById('btn-reset-game')?.addEventListener('click', () => {
    if (confirm('정말 게임을 초기화하시겠습니까? 모든 데이터가 삭제됩니다.')) {
      resetGame();
    }
  });
}

function renderTransactions() {
  const txs = getState().transactions.slice(0, 10);
  if (txs.length === 0) return '<p class="muted">거래 내역이 없습니다</p>';

  return `<div class="tx-list">
    ${txs.map(t => `
      <div class="tx-item">
        <span class="tx-type ${t.type}">${t.type === 'purchase' ? '구매' : '판매'}</span>
        <span class="tx-name">${t.territoryName}</span>
        <span class="tx-price">${t.type === 'purchase' ? '-' : '+'}${formatPrice(t.price)}</span>
      </div>
    `).join('')}
  </div>`;
}
