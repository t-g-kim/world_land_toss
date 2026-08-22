import { supabase } from '../lib/supabase.js';
import { bus, Events } from '../lib/event-bus.js';
import { t } from '../lib/i18n.js';
import { getTossUserKey } from '../lib/toss.js';

/** Returns the current session, or null if signed out / Supabase not configured. */
export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * 앱인토스 로그인: 토스 게임 사용자 식별키(hash)를 받아 Edge Function에서
 * Supabase 계정으로 교환하고 세션을 연다. 기존 RLS/RPC(auth.uid())는 그대로 동작.
 * 토스 앱 밖이면 null 반환 (dev는 게스트 폴백).
 */
export async function signInWithToss() {
  if (!supabase) return null;

  const hash = await getTossUserKey();
  if (!hash) return null; // 토스 앱이 아님

  const { data, error } = await supabase.functions.invoke('toss-login', {
    body: { hash },
  });
  if (error || !data?.email || !data?.password) {
    throw new Error(error?.message || data?.message || '토스 로그인 교환 실패');
  }

  const { data: signed, error: signErr } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });
  if (signErr) throw signErr;
  return signed.session;
}

/** Signs out and reloads so the app returns to the auth gate. */
export async function signOut() {
  if (supabase) await supabase.auth.signOut();
  bus.emit(Events.AUTH_SIGNED_OUT);
  location.reload();
}

/** 로딩/오류 화면 (토스 로그인은 자동이라 별도 로그인 UI가 없다). */
export function showAuthScreen({ message, error, onGuest } = {}) {
  const overlay = document.getElementById('auth-overlay');
  const container = document.getElementById('auth-container');
  overlay.classList.remove('hidden');

  container.innerHTML = `
    <h1 class="auth-title">someday</h1>
    <p class="auth-subtitle">${t('app.subtitle')}</p>
    <div class="auth-login">
      ${error
        ? `<p class="auth-error">${error}</p>`
        : `<p class="auth-hint">${message || t('auth.connecting')}</p>`}
      ${onGuest ? `
        <button id="guest-start" class="guest-btn">${t('auth.guest')}</button>
        <p class="auth-hint">${t('auth.guestHint')}</p>` : ''}
    </div>
  `;
  container.querySelector('#guest-start')?.addEventListener('click', () => onGuest?.());
}
