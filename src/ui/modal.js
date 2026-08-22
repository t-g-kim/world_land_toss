import { bus, Events } from '../lib/event-bus.js';

let overlayEl, containerEl, contentEl;

export function initModal() {
  overlayEl = document.getElementById('modal-overlay');
  containerEl = document.getElementById('modal-container');
  contentEl = document.getElementById('modal-content');

  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeModal();
  });

  // ESC to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlayEl.classList.contains('hidden')) {
      closeModal();
    }
  });

  bus.on(Events.MODAL_OPEN, ({ html, onClose }) => openModal(html, onClose));
  bus.on(Events.MODAL_CLOSE, () => closeModal());
}

export function openModal(html, onClose) {
  contentEl.innerHTML = html;
  overlayEl.classList.remove('hidden');
  overlayEl._onClose = onClose;
  // Focus first button for keyboard accessibility
  requestAnimationFrame(() => {
    const btn = contentEl.querySelector('button');
    if (btn) btn.focus();
  });
}

export function closeModal() {
  overlayEl.classList.add('hidden');
  if (overlayEl._onClose) {
    overlayEl._onClose();
    overlayEl._onClose = null;
  }
  contentEl.innerHTML = '';
}
