/**
 * 👥 Friends + co-purchase.
 * - Friends: search by nickname, send/accept requests, list.
 * - Co-purchase: propose a shared buy (each pays their share); accept/decline
 *   pending proposals. Income splits by share (server-side).
 */
import { supabase } from '../lib/supabase.js';
import {
  getMarketUserId, findUser, sendFriendRequest, respondFriendRequest, listFriends,
  proposeCoPurchase, acceptCoPurchase, declineCoPurchase, listCoPurchases,
} from '../game/market.js';
import { getState } from '../game/game-state.js';
import { refreshWorld } from '../game/world.js';
import { formatPrice } from '../game/price-engine.js';
import { openModal, closeModal } from './modal.js';
import { escapeHtml } from '../lib/escape.js';
import { showToast } from './toast.js';

let sidebarEl, contentEl, btnEl, uid = null;
let friends = [], proposals = [];

export function initFriends() {
  uid = getMarketUserId();
  btnEl = document.getElementById('btn-friends');
  sidebarEl = document.getElementById('friends-sidebar');
  contentEl = document.getElementById('friends-content');
  if (!btnEl) return;
  if (!uid) { btnEl.style.display = 'none'; return; } // guests: no friends

  btnEl.addEventListener('click', toggle);
  sidebarEl.querySelector('.sidebar-close').addEventListener('click', () => sidebarEl.classList.add('hidden'));

  // Co-purchase changes (accept/complete/cancel) → refresh the panel + badge.
  if (supabase) {
    supabase.channel('my-social')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'toss_co_purchases' }, () => refresh())
      .subscribe();
  }
  refresh();
}

export function hasFriends() { return friends.length > 0; }
export function getFriendList() { return friends; }

async function refresh() {
  const [f, p] = await Promise.all([listFriends(), listCoPurchases()]);
  friends = (Array.isArray(f) ? f : []).filter((x) => x.kind === 'friend');
  const incoming = (Array.isArray(f) ? f : []).filter((x) => x.kind === 'incoming');
  const outgoing = (Array.isArray(f) ? f : []).filter((x) => x.kind === 'outgoing');
  proposals = Array.isArray(p) ? p : [];
  const pendingCount = incoming.length + proposals.filter((x) => !x.my_paid).length;
  btnEl.dataset.count = pendingCount > 0 ? String(pendingCount) : '';
  btnEl.classList.toggle('has-count', pendingCount > 0);
  if (!sidebarEl.classList.contains('hidden')) render(incoming, outgoing);
}

function toggle() {
  document.querySelectorAll('.sidebar').forEach((s) => s.classList.add('hidden'));
  sidebarEl.classList.toggle('hidden');
  if (!sidebarEl.classList.contains('hidden')) refresh();
}

function render(incoming = [], outgoing = []) {
  const propHtml = proposals.length ? `
    <div class="fr-section">공동구매 제안</div>
    ${proposals.map((c) => `
      <div class="fr-item">
        <div class="fr-info">
          <div class="fr-name">${escapeHtml(c.prop_name)}</div>
          <div class="fr-sub">${c.mine ? '내가 제안' : escapeHtml(c.initiator_name) + ' 제안'} · 내 지분 ${formatPrice(c.my_amount)} · ${c.paid_count}/${c.total_count} 결제</div>
        </div>
        <div class="fr-actions">
          ${c.my_paid ? '<span class="fr-tag">결제완료</span>'
            : `<button class="fr-btn ok" data-accept="${c.id}">₩ 결제</button>`}
          <button class="fr-btn no" data-decline="${c.id}">${c.mine ? '취소' : '거절'}</button>
        </div>
      </div>`).join('')}` : '';

  const reqHtml = incoming.length ? `
    <div class="fr-section">받은 친구요청</div>
    ${incoming.map((u) => `
      <div class="fr-item">
        <div class="fr-info"><div class="fr-name">${escapeHtml(u.username)}</div></div>
        <div class="fr-actions">
          <button class="fr-btn ok" data-acceptreq="${u.id}">수락</button>
          <button class="fr-btn no" data-declinereq="${u.id}">거절</button>
        </div>
      </div>`).join('')}` : '';

  const friendHtml = `
    <div class="fr-section">친구 ${friends.length}명</div>
    ${friends.length ? friends.map((u) => `<div class="fr-item"><div class="fr-info"><div class="fr-name">🙂 ${escapeHtml(u.username)}</div></div></div>`).join('')
      : '<p class="earn-empty">아직 친구가 없어요. 닉네임으로 추가해보세요!</p>'}
    ${outgoing.length ? `<div class="fr-sub" style="padding:8px 4px;">보낸 요청: ${outgoing.map((u) => escapeHtml(u.username)).join(', ')}</div>` : ''}`;

  contentEl.innerHTML = `
    <form id="fr-search" class="fr-search">
      <input id="fr-search-input" type="text" placeholder="닉네임으로 친구 추가" autocomplete="off" />
      <button class="fr-btn ok" type="submit">추가</button>
    </form>
    ${propHtml}${reqHtml}${friendHtml}`;

  contentEl.querySelector('#fr-search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = contentEl.querySelector('#fr-search-input').value.trim();
    if (name) await addFriend(name);
  });
  contentEl.querySelectorAll('[data-acceptreq]').forEach((b) => b.addEventListener('click', () => respond(b.dataset.acceptreq, true)));
  contentEl.querySelectorAll('[data-declinereq]').forEach((b) => b.addEventListener('click', () => respond(b.dataset.declinereq, false)));
  contentEl.querySelectorAll('[data-accept]').forEach((b) => b.addEventListener('click', () => accept(+b.dataset.accept)));
  contentEl.querySelectorAll('[data-decline]').forEach((b) => b.addEventListener('click', () => decline(+b.dataset.decline)));
}

async function addFriend(name) {
  const u = await findUser(name);
  if (!u || !u.id) { showToast('그런 닉네임의 유저가 없어요.', 'error'); return; }
  if (u.id === uid) { showToast('자기 자신은 추가할 수 없어요.', 'info'); return; }
  const r = await sendFriendRequest(u.id);
  showToast(r?.success ? `${name}님에게 친구 요청을 보냈어요 👋` : (r?.message || '실패'), r?.success ? 'success' : 'error');
  refresh();
}

async function respond(requester, accept) {
  await respondFriendRequest(requester, accept);
  refresh();
}

async function accept(coId) {
  const r = await acceptCoPurchase(coId);
  if (r?.success) { showToast(r.done ? '공동구매 완료! 🎉' : '내 지분 결제 완료', 'success'); await refreshWorld(); }
  else showToast(r?.message || '결제 실패', 'error');
  refresh();
}

async function decline(coId) {
  await declineCoPurchase(coId);
  showToast('공동구매를 취소했어요.', 'info');
  refresh();
}

// ── Co-purchase proposal modal (opened from the property panel) ──
export function openCoPurchaseModal(prop) {
  if (!friends.length) { showToast('먼저 친구를 추가하세요.', 'info'); return; }
  const rows = friends.map((f) => `
    <label class="cp-friend">
      <input type="checkbox" class="cp-check" data-id="${f.id}" />
      <span>${escapeHtml(f.username)}</span>
    </label>`).join('');

  openModal(`
    <div class="cp-modal">
      <h2>👥 공동구매</h2>
      <div class="confirm-territory">${escapeHtml(prop.name)}</div>
      <div class="confirm-row"><span>총 가격</span><span class="price">${formatPrice(prop.price)}</span></div>
      <p class="fr-sub" style="margin:10px 0 4px;">함께할 친구를 고르면 <b>1/N 균등 분할</b>됩니다. 금액은 수정 가능(합계 = 총가격).</p>
      <div class="cp-friends">${rows}</div>
      <div id="cp-splits"></div>
      <div class="cp-sum" id="cp-sum"></div>
      <div class="confirm-actions">
        <button class="btn btn-primary" id="cp-propose">제안하기</button>
        <button class="btn btn-secondary" id="cp-cancel">취소</button>
      </div>
    </div>
  `);

  const modal = document.querySelector('.cp-modal');
  const splitsEl = modal.querySelector('#cp-splits');
  const sumEl = modal.querySelector('#cp-sum');

  function selected() { return [...modal.querySelectorAll('.cp-check:checked')].map((c) => c.dataset.id); }

  function rebuildSplits() {
    const ids = [uid, ...selected()];
    const n = ids.length;
    const base = Math.floor(prop.price / n);
    const names = { [uid]: '나', ...Object.fromEntries(friends.map((f) => [f.id, f.username])) };
    splitsEl.innerHTML = ids.map((id, i) => {
      const amt = i === 0 ? prop.price - base * (n - 1) : base; // remainder to me
      return `<div class="cp-split"><span>${escapeHtml(names[id])}</span>
        <input type="number" class="cp-amt" data-id="${id}" value="${amt}" min="0" /></div>`;
    }).join('');
    updateSum();
    splitsEl.querySelectorAll('.cp-amt').forEach((inp) => inp.addEventListener('input', updateSum));
  }

  function updateSum() {
    const total = [...modal.querySelectorAll('.cp-amt')].reduce((s, i) => s + (Number(i.value) || 0), 0);
    const ok = total === prop.price;
    sumEl.innerHTML = `합계 ${formatPrice(total)} / ${formatPrice(prop.price)} ${ok ? '✅' : '⚠️ 총가격과 맞춰주세요'}`;
    sumEl.className = 'cp-sum ' + (ok ? 'ok' : 'bad');
  }

  modal.querySelectorAll('.cp-check').forEach((c) => c.addEventListener('change', rebuildSplits));
  rebuildSplits();

  modal.querySelector('#cp-cancel').addEventListener('click', () => closeModal());
  modal.querySelector('#cp-propose').addEventListener('click', async () => {
    const participants = [...modal.querySelectorAll('.cp-amt')]
      .map((i) => ({ user_id: i.dataset.id, amount: Number(i.value) || 0 }))
      .filter((p) => p.amount > 0);
    const total = participants.reduce((s, p) => s + p.amount, 0);
    if (total !== prop.price) { showToast('지분 합계가 총가격과 달라요.', 'error'); return; }
    const mine = participants.find((p) => p.user_id === uid);
    if (!mine) { showToast('내 지분이 필요해요.', 'error'); return; }
    if (getState().balance < mine.amount) { showToast('내 지분만큼의 잔액이 부족해요.', 'error'); return; }
    closeModal();
    const r = await proposeCoPurchase(prop.id, prop.kind, prop.name, prop.price, prop.income, prop.meta, participants);
    if (r?.success) showToast('공동구매를 제안했어요! 친구가 결제하면 완료됩니다.', 'success');
    else showToast(r?.message || '제안 실패', 'error');
    refresh();
  });
}
