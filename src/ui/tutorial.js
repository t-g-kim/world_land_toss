/**
 * First-time onboarding — a short, dismissible guide shown once to new players.
 */
import { openModal, closeModal } from './modal.js';
import { t } from '../lib/i18n.js';

const DONE_KEY = 'wl_tutorial_done';

const STEPS = [
  { icon: '🗺️', title: 'tut.1.t', body: 'tut.1.b' },
  { icon: '🏢', title: 'tut.2.t', body: 'tut.2.b' },
  { icon: '💰', title: 'tut.3.t', body: 'tut.3.b' },
  { icon: '🏷️', title: 'tut.4.t', body: 'tut.4.b' },
  { icon: '🏆', title: 'tut.5.t', body: 'tut.5.b' },
];

export function maybeShowTutorial(isNewPlayer) {
  let done = false;
  try { done = !!localStorage.getItem(DONE_KEY); } catch {}
  if (done && !isNewPlayer) return;
  show(0);
}

function show(i) {
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  openModal(`
    <div class="tut">
      <div class="tut-icon">${s.icon}</div>
      <h2 class="tut-title">${t(s.title)}</h2>
      <p class="tut-body">${t(s.body)}</p>
      <div class="tut-dots">${STEPS.map((_, n) => `<span class="tut-dot ${n === i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="tut-actions">
        ${i > 0 ? `<button class="btn btn-secondary" id="tut-prev">${t('tut.prev')}</button>` : `<button class="btn btn-secondary" id="tut-skip">${t('tut.skip')}</button>`}
        <button class="btn btn-primary" id="tut-next">${last ? t('tut.start') : t('tut.next')}</button>
      </div>
    </div>
  `);
  document.getElementById('tut-next').addEventListener('click', () => { if (last) finish(); else show(i + 1); });
  document.getElementById('tut-prev')?.addEventListener('click', () => show(i - 1));
  document.getElementById('tut-skip')?.addEventListener('click', finish);
}

function finish() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch {}
  closeModal();
}
