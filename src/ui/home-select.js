import { CITIES } from './place-nav.js';
import { MAPBOX_TOKEN } from '../config.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../lib/escape.js';

/** Pick a starting home (current location). Resolves to { lng, lat, name }. */
export function showHomeSelect() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('auth-overlay');
    const container = document.getElementById('auth-container');
    overlay.classList.remove('hidden');
    let selected = null;

    container.innerHTML = `
      <h1 class="auth-title">someday</h1>
      <p class="auth-subtitle">시작할 홈(현재 위치)을 정하세요<br/>이 근처에서만 부동산을 살 수 있어요 — 멀리 가려면 비행기로 이동!</p>
      <form id="home-search" class="place-search" autocomplete="off" style="display:flex;justify-content:center;">
        <input id="home-search-input" type="text" placeholder="🔍 도시·지역 검색" />
      </form>
      <div class="place-chips" style="justify-content:center;margin-top:12px;">
        ${CITIES.map(c => `<button type="button" class="place-chip" data-lng="${c.lng}" data-lat="${c.lat}" data-name="${c.name}">${c.name}</button>`).join('')}
      </div>
      <p id="home-selected" class="nick-hint" style="margin-top:14px;"></p>
      <button id="home-confirm" class="nick-submit" disabled>여기를 홈으로 시작</button>
    `;

    const selEl = container.querySelector('#home-selected');
    const confirm = container.querySelector('#home-confirm');
    const chips = container.querySelectorAll('.place-chip');

    function pick(lng, lat, name, fromEl) {
      selected = { lng: +lng, lat: +lat, name };
      selEl.textContent = `선택: 📍 ${name}`;
      confirm.disabled = false;
      chips.forEach(c => c.classList.toggle('place-chip-active', c === fromEl));
    }

    chips.forEach((b) => {
      b.addEventListener('click', () => pick(b.dataset.lng, b.dataset.lat, b.dataset.name, b));
    });

    container.querySelector('#home-search').addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = container.querySelector('#home-search-input').value.trim();
      if (!q) return;
      const loc = await geocode(q);
      if (loc) pick(loc.lng, loc.lat, loc.name, null);
      else showToast('검색 결과가 없습니다', 'error');
    });

    confirm.addEventListener('click', () => {
      if (!selected) return;
      overlay.classList.add('hidden');
      resolve(selected);
    });
  });
}

async function geocode(query) {
  if (!MAPBOX_TOKEN) return null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?limit=1&language=ko&access_token=${MAPBOX_TOKEN}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const f = d.features?.[0];
    if (!f) return null;
    return { lng: f.center[0], lat: f.center[1], name: escapeHtml(f.text || query) };
  } catch {
    return null;
  }
}
