import { bus, Events } from '../lib/event-bus.js';
import {
  getState, doClick, getOwnedCount, getTotalIncomePerHour,
  getDailyClicksLeft, getDailyClickLimit, getClickReward, isGuest,
} from '../game/game-state.js';
import { formatPrice } from '../game/price-engine.js';
import { t } from '../lib/i18n.js';
import { showToast } from './toast.js';

let clickerEl;
let limitToastAt = 0;

export function initClickerUI() {
  clickerEl = document.createElement('div');
  clickerEl.id = 'clicker-container';
  document.getElementById('app').appendChild(clickerEl);

  render();
  bus.on(Events.BALANCE_UPDATED, updateStats);
}

function render() {
  clickerEl.innerHTML = `
    <div class="clicker-wrapper">
      <div class="clicker-info">
        <span class="clicker-per-click">+${t('clicker.perClick', { v: formatPrice(getClickReward()) })}</span>
        ${getTotalIncomePerHour() > 0 ? `<span class="clicker-territory-income">${t('clicker.perMin', { v: formatPrice(Math.round(getTotalIncomePerHour() / 60)) })}</span>` : ''}
      </div>
      <button id="clicker-character" class="clicker-btn" title="${t('clicker.btnTitle')}">
        <span class="clicker-emoji">💰</span>
      </button>
      <div class="clicker-stats">
        <span id="clicker-clicks-left">${t('clicker.clicksLeft', { n: getDailyClicksLeft(), max: getDailyClickLimit() })}</span>
      </div>
    </div>
  `;
  bindClicker();
  updateStats();
}

function bindClicker() {
  const btn = clickerEl.querySelector('#clicker-character');
  // touchend with preventDefault avoids double-tap zoom + double firing on mobile
  let touchHandled = false;
  btn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchHandled = true;
    handleClick();
  }, { passive: false });
  btn.addEventListener('click', () => {
    if (touchHandled) { touchHandled = false; return; }
    handleClick();
  });
}

const MAX_FLOATERS = 15;
let guestToastAt = 0;
function handleClick() {
  if (isGuest()) {
    if (Date.now() - guestToastAt > 3000) {
      guestToastAt = Date.now();
      showToast(t('clicker.guest'), 'info', 3000);
    }
    return;
  }
  const amount = doClick();
  const btn = clickerEl.querySelector('#clicker-character');

  if (amount <= 0) {
    // Daily limit reached — nudge toward the "돈벌기" (ad) menu, throttled.
    if (Date.now() - limitToastAt > 3000) {
      limitToastAt = Date.now();
      showToast(t('clicker.usedUp'), 'info', 3500);
    }
    btn.classList.add('clicker-disabled');
    return;
  }

  const rect = btn.getBoundingClientRect();
  const floaters = document.querySelectorAll('.click-floater');
  if (floaters.length >= MAX_FLOATERS) floaters[0].remove();

  const floater = document.createElement('div');
  floater.className = 'click-floater';
  floater.textContent = `+${formatPrice(amount)}`;
  floater.style.left = `${rect.left + rect.width / 2 + (Math.random() - 0.5) * 50}px`;
  floater.style.top = `${rect.top - 10}px`;
  document.body.appendChild(floater);
  setTimeout(() => floater.remove(), 800);

  btn.classList.add('clicker-bounce');
  setTimeout(() => btn.classList.remove('clicker-bounce'), 150);

  updateStats();
}

function updateStats() {
  if (!clickerEl) return;
  const left = getDailyClicksLeft();
  const el = clickerEl.querySelector('#clicker-clicks-left');
  if (el) el.textContent = t('clicker.clicksLeft', { n: left, max: getDailyClickLimit() });
  const btn = clickerEl.querySelector('#clicker-character');
  if (btn) btn.classList.toggle('clicker-disabled', left <= 0);
}
