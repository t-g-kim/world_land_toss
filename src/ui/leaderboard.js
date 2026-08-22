/**
 * Real-player leaderboard: ranks everyone by net worth = balance + total value
 * of owned properties. Data comes from profiles (balance) + the shared-world
 * property cache (ownership values).
 */
import { bus, Events } from '../lib/event-bus.js';
import { formatPrice } from '../game/price-engine.js';
import { getMarketUserId, getLeaderboard } from '../game/market.js';
import { escapeHtml } from '../lib/escape.js';

let sidebarEl, contentEl;

export function initLeaderboard() {
  sidebarEl = document.getElementById('leaderboard-sidebar');
  contentEl = document.getElementById('leaderboard-content');
  document.getElementById('btn-leaderboard').addEventListener('click', toggle);
  sidebarEl.querySelector('.sidebar-close').addEventListener('click', () => sidebarEl.classList.add('hidden'));
  bus.on(Events.WORLD_UPDATED, () => {
    if (sidebarEl && !sidebarEl.classList.contains('hidden')) render();
  });
}

function toggle() {
  document.querySelectorAll('.sidebar').forEach((s) => s.classList.add('hidden'));
  sidebarEl.classList.toggle('hidden');
  if (!sidebarEl.classList.contains('hidden')) render();
}

async function render() {
  contentEl.innerHTML = '<p class="earn-empty">불러오는 중…</p>';
  const me = getMarketUserId();

  // Server-side aggregation (net worth = balance + owned property value).
  const data = await getLeaderboard(50);
  const rows = (Array.isArray(data) ? data : []).map((r) => ({
    id: r.id, name: r.username, net: r.net_worth, count: r.count, isMe: r.id === me,
  }));

  if (!rows.length) {
    contentEl.innerHTML = '<p class="earn-empty">아직 플레이어가 없어요.</p>';
    return;
  }

  const myRank = rows.findIndex((r) => r.isMe) + 1;
  const myRow = rows.find((r) => r.isMe);

  contentEl.innerHTML = `
    ${myRow ? `
      <div class="lb-my-rank">
        <span class="lb-my-emoji">👑</span>
        <div>
          <div class="lb-my-name">${escapeHtml(myRow.name || '나')}</div>
          <div class="lb-my-info">${myRank}위 · ${formatPrice(myRow.net)} · ${myRow.count}개</div>
        </div>
      </div>` : ''}
    <div class="leaderboard-list">
      ${rows.slice(0, 50).map((r, i) => `
        <div class="lb-row ${r.isMe ? 'lb-me' : ''}">
          <span class="lb-rank">${rankDisplay(i + 1)}</span>
          <span class="lb-name">${escapeHtml(r.name || '익명')}</span>
          <span class="lb-territories">${r.count}개</span>
          <span class="lb-networth">${formatPrice(r.net)}</span>
        </div>`).join('')}
    </div>`;
}

function rankDisplay(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return rank;
}
