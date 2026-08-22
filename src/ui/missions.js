import { GOALS, buildStats } from '../game/goals.js';
import { claimGoal, isGoalClaimed } from '../game/game-state.js';
import { bus, Events } from '../lib/event-bus.js';
import { formatPrice } from '../game/price-engine.js';
import { showToast } from './toast.js';

let sidebarEl, contentEl, btnEl;
const notified = new Set();

export function initMissions() {
  sidebarEl = document.getElementById('missions-sidebar');
  contentEl = document.getElementById('missions-content');
  btnEl = document.getElementById('btn-missions');
  btnEl?.addEventListener('click', toggle);

  // Re-check goals whenever something relevant changes.
  let t = null;
  const ping = () => { if (t) return; t = setTimeout(() => { t = null; refresh(); }, 400); };
  [Events.BALANCE_UPDATED, Events.TERRITORY_UPDATED, Events.TRAVEL_ARRIVED].forEach((e) => bus.on(e, ping));
  refresh();
}

function toggle() {
  document.querySelectorAll('.sidebar').forEach((s) => s.classList.add('hidden'));
  sidebarEl.classList.toggle('hidden');
  if (!sidebarEl.classList.contains('hidden')) render();
}

function claimable(stats) {
  return GOALS.filter((g) => g.done(stats) && !isGoalClaimed(g.id));
}

// Update badge + toast for newly-completed goals.
function refresh() {
  const stats = buildStats();
  const ready = claimable(stats);
  for (const g of ready) {
    if (!notified.has(g.id)) {
      notified.add(g.id);
      showToast(`🎯 목표 달성: ${g.title}! 🎯 메뉴에서 ${formatPrice(g.reward)} 받기`, 'success', 4000);
    }
  }
  btnEl?.classList.toggle('has-badge', ready.length > 0);
  if (sidebarEl && !sidebarEl.classList.contains('hidden')) render();
}

function render() {
  const s = buildStats();
  const done = GOALS.filter((g) => isGoalClaimed(g.id)).length;

  contentEl.innerHTML = `
    <p class="missions-summary">${done}/${GOALS.length} 완료</p>
    <div class="missions-list">
      ${GOALS.map((g) => {
        const claimed = isGoalClaimed(g.id);
        const isDone = g.done(s);
        const bar = g.bar ? g.bar(s) : null;
        const pct = bar ? Math.min(100, Math.round(bar[0] / bar[1] * 100)) : (isDone ? 100 : 0);
        return `
          <div class="mission ${claimed ? 'is-claimed' : isDone ? 'is-done' : ''}">
            <div class="mission-icon">${g.icon}</div>
            <div class="mission-body">
              <div class="mission-title">${g.title}</div>
              <div class="mission-desc">${g.desc}</div>
              ${bar && !claimed ? `
                <div class="mission-bar"><div style="width:${pct}%"></div></div>
                <div class="mission-prog">${fmt(bar[0])} / ${fmt(bar[1])}</div>` : ''}
            </div>
            <div class="mission-action">
              ${claimed
                ? '<span class="mission-check">✓</span>'
                : isDone
                  ? `<button class="mission-claim" data-id="${g.id}">받기<br><b>${formatPrice(g.reward)}</b></button>`
                  : `<span class="mission-reward">${formatPrice(g.reward)}</span>`}
            </div>
          </div>`;
      }).join('')}
    </div>`;

  contentEl.querySelectorAll('.mission-claim').forEach((b) => {
    b.addEventListener('click', () => claim(b.dataset.id));
  });
}

async function claim(id) {
  const g = GOALS.find((x) => x.id === id);
  if (!g) return;
  const r = await claimGoal(id);
  if (r.success) showToast(`🎁 보상 획득 +${formatPrice(r.reward ?? g.reward)}!`, 'success');
  else if (r.message) showToast(r.message, 'error');
  refresh();
  render();
}

function fmt(n) {
  return n >= 1000 ? formatPrice(n) : String(n);
}
