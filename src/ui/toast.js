import { bus, Events } from '../lib/event-bus.js';

const container = () => document.getElementById('toast-container');

export function initToast() {
  bus.on(Events.TOAST, ({ message, type = 'info', duration = 3000 }) => {
    showToast(message, type, duration);
  });
}

export function showToast(message, type = 'info', duration = 3000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  container().appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove());
    // Fallback removal if transitionend doesn't fire
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 500);
  }, duration);
}
