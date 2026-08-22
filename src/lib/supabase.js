import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

/**
 * Shared Supabase client.
 *
 * If the env vars are missing (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY),
 * `supabase` is null and the app falls back to guest mode (localStorage) instead
 * of crashing at import time. Fill those in `.env` and restart the dev server to
 * enable Toss login + cloud save.
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

if (!isSupabaseConfigured) {
  console.warn(
    '[someday] Supabase 환경변수가 없어 게스트(localStorage) 모드로만 동작합니다. ' +
    '.env의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 설정 후 dev 서버를 재시작하세요.'
  );
}
