/**
 * 🔔 Notifications — "your property sold" (server-written, works offline) +
 * ambient "nearby trade" toasts. Live via Supabase Realtime, unread badge,
 * dropdown list.
 */
import { supabase } from '../lib/supabase.js';
import { getMarketUserId } from '../game/market.js';
import { bus, Events } from '../lib/event-bus.js';
import { showToast } from './toast.js';
import { escapeHtml } from '../lib/escape.js';

let btnEl, panelEl, uid = null;
let items = [];
let unread = 0;
let channel = null;

export function initNotifications() {
  uid = getMarketUserId();
  btnEl = document.getElementById('btn-notif');

  // Ambient nearby-trade toasts (both guests and users).
  bus.on(Events.NEARBY_TRADE, ({ message }) => showToast(message, 'info', 3500));

  if (!btnEl) return;
  if (!uid) { btnEl.style.display = 'none'; return; } // guests: no personal notifications

  panelEl = document.createElement('div');
  panelEl.id = 'notif-panel';
  panelEl.className = 'notif-panel hidden';
  document.getElementById('app').appendChild(panelEl);

  btnEl.addEventListener('click', toggle);
  document.addEventListener('click', (e) => {
    if (panelEl.classList.contains('hidden')) return;
    if (!panelEl.contains(e.target) && e.target !== btnEl) panelEl.classList.add('hidden');
  });

  loadRecent();
  subscribe();
}

async function loadRecent() {
  if (!supabase) return;
  const { data } = await supabase.from('notifications_toss')
    .select('id,type,message,read,created_at')
    .order('created_at', { ascending: false }).limit(30);
  items = data || [];
  unread = items.filter((n) => !n.read).length;
  updateBadge();
}

function subscribe() {
  if (!supabase || channel) return;
  channel = supabase.channel('my-notifications')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications_toss', filter: `user_id=eq.${uid}` },
      (payload) => {
        const n = payload.new;
        items.unshift({ id: n.id, type: n.type, message: n.message, read: false, created_at: n.created_at });
        unread += 1;
        updateBadge();
        showToast(`🔔 ${n.message}`, 'success', 6000);
        if (!panelEl.classList.contains('hidden')) renderPanel();
      })
    .subscribe();
}

function updateBadge() {
  if (!btnEl) return;
  btnEl.dataset.count = unread > 0 ? (unread > 9 ? '9+' : String(unread)) : '';
  btnEl.classList.toggle('has-count', unread > 0);
}

function toggle() {
  document.querySelectorAll('.sidebar').forEach((s) => s.classList.add('hidden'));
  const willOpen = panelEl.classList.contains('hidden');
  panelEl.classList.toggle('hidden');
  if (willOpen) { renderPanel(); markRead(); }
}

function renderPanel() {
  if (!items.length) {
    panelEl.innerHTML = '<div class="notif-empty">알림이 없어요.</div>';
    return;
  }
  panelEl.innerHTML = `<div class="notif-head">🔔 알림</div>` + items.map((n) => `
    <div class="notif-item ${n.read ? '' : 'unread'}">
      <div class="notif-msg">${escapeHtml(n.message)}</div>
      <div class="notif-time">${timeAgo(n.created_at)}</div>
    </div>`).join('');
}

async function markRead() {
  if (!unread || !supabase) return;
  unread = 0;
  updateBadge();
  items = items.map((n) => ({ ...n, read: true }));
  try { await supabase.rpc('mark_notifications_read_toss'); } catch { /* ignore */ }
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - Date.parse(ts)) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
