/**
 * Top-bar location/transit indicator. Shows your current city, and during a
 * flight a live countdown to arrival.
 */
import { bus, Events } from '../lib/event-bus.js';
import { getLocation, getTransit, isInTransit } from '../game/game-state.js';
import { showToast } from './toast.js';
import { flyToPlace } from './place-nav.js';
import { escapeHtml } from '../lib/escape.js';

let el = null;
let tick = null;

export function initTravelStatus() {
  el = document.getElementById('travel-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'travel-status';
    el.className = 'travel-status';
    document.querySelector('.top-bar-left')?.appendChild(el);
  }

  render();
  bus.on(Events.LOCATION_CHANGED, render);
  bus.on(Events.TRAVEL_STARTED, () => { render(); startTick(); });
  bus.on(Events.TRAVEL_ARRIVED, (loc) => {
    stopTick();
    render();
    showToast(`✈️ ${escapeHtml(loc.name)} 도착! 이제 이 지역에서 거래할 수 있어요.`, 'success', 4000);
    flyToPlace(loc.lng, loc.lat, loc.name, false);
  });

  if (isInTransit()) startTick();
}

function render() {
  if (!el) return;
  const t = getTransit();
  if (t) {
    const left = Math.max(0, Math.ceil((t.arrivalTime - Date.now()) / 1000));
    const icon = t.mode === 'train' ? '🚆' : '✈️';
    el.className = 'travel-status flying';
    el.innerHTML = `${icon} ${escapeHtml(t.destName)} 이동 중 · ${left}s${t.viaName ? ` <span class="via">경유 ${escapeHtml(t.viaName)}</span>` : ''}`;
  } else {
    const loc = getLocation();
    el.className = 'travel-status';
    el.innerHTML = loc ? `📍 ${escapeHtml(loc.name)}` : '';
  }
}

function startTick() { stopTick(); tick = setInterval(render, 1000); }
function stopTick() { if (tick) { clearInterval(tick); tick = null; } }
