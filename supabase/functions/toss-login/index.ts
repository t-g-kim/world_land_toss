// Supabase Edge Function: 앱인토스 게임 사용자 식별키(hash) → Supabase 계정 교환.
//
// 클라이언트가 getUserKeyForGame()으로 받은 hash를 보내면, hash에서 결정적으로
// 유도한 (email, password) 자격증명을 만들어 계정을 찾거나 생성한 뒤 돌려준다.
// 클라이언트는 signInWithPassword로 로그인 → 기존 RLS/RPC(auth.uid()) 그대로 동작.
//
// password는 HMAC(hash, TOSS_LOGIN_SECRET)라서 이 함수(=hash 보유자)를 거치지
// 않으면 알 수 없다. 배포 전 시크릿 설정 필수:
//   supabase secrets set TOSS_LOGIN_SECRET=$(openssl rand -hex 32)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const { hash } = await req.json().catch(() => ({}));
    if (typeof hash !== 'string' || hash.length < 8 || hash.length > 512) {
      return json({ message: '잘못된 요청' }, 400);
    }

    const secret = Deno.env.get('TOSS_LOGIN_SECRET');
    if (!secret) return json({ message: '서버 설정 오류 (TOSS_LOGIN_SECRET 미설정)' }, 500);

    // hash → 결정적 자격증명 (같은 토스 유저는 항상 같은 계정)
    const emailLocal = (await sha256Hex(`someday:${hash}`)).slice(0, 32);
    const email = `${emailLocal}@toss.someday.land`;
    const password = await hmacHex(secret, hash);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 계정이 없으면 생성 (이미 있으면 그대로 사용 — 자격증명이 결정적이라 로그인 가능)
    const { error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { provider: 'toss' },
    });
    if (createErr && !`${createErr.message}`.toLowerCase().includes('already')) {
      console.error('createUser failed:', createErr.message);
      return json({ message: '계정 생성 실패' }, 500);
    }

    return json({ email, password });
  } catch (e) {
    console.error('toss-login error:', e);
    return json({ message: '서버 오류' }, 500);
  }
});
