/**
 * Server-authoritative marketplace API. Ownership + money live in Supabase;
 * these wrap the RPCs and reads. All mutations go through SECURITY DEFINER RPCs.
 */
import { supabase } from '../lib/supabase.js';

let userId = null;
export function setMarketUser(id) { userId = id; }
export function getMarketUserId() { return userId; }

async function rpc(name, args) {
  if (!supabase) return { success: false, message: 'offline' };
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { success: false, message: error.message };
  return data;
}

// ── Mutations ──────────────────────────────────────────
export const buyProperty = (id, kind, name, price, income, meta) =>
  rpc('buy_property', { p_id: id, p_kind: kind, p_name: name, p_price: price, p_income: income, p_meta: meta || {} });

export const sellToBank = (id) => rpc('sell_to_bank', { p_id: id });
export const listProperty = (id, price) => rpc('list_property', { p_id: id, p_list_price: price });
export const unlistProperty = (id) => rpc('unlist_property', { p_id: id });
export const collectIncome = () => rpc('collect_income', {});
// Server-authoritative rewards / spend (replace the old mintable add_balance).
export const clickReward = (clicks) => rpc('click_reward', { p_clicks: clicks });
// 토스 보상형 광고 시청 완료 보상 (서버가 일일 한도 관리) — supabase/setup-toss.sql
export const watchTossAdRpc = () => rpc('watch_toss_ad', {});
export const claimGoalRpc = (goalId) => rpc('claim_goal', { p_goal: goalId });
export const spend = (amount, reason = 'spend') => rpc('spend', { p_amount: Math.round(amount), p_reason: reason });
export const getLeaderboard = (limit = 50) => rpc('get_leaderboard', { p_limit: limit });

// ── Friends ──
export const findUser = (name) => rpc('find_user', { p_name: name });
export const sendFriendRequest = (target) => rpc('send_friend_request', { p_target: target });
export const respondFriendRequest = (requester, accept) => rpc('respond_friend_request', { p_requester: requester, p_accept: accept });
export const listFriends = () => rpc('list_friends', {});

// ── Co-purchase ──
export const proposeCoPurchase = (id, kind, name, price, income, meta, participants) =>
  rpc('propose_co_purchase', { p_id: id, p_kind: kind, p_name: name, p_price: price, p_income: income, p_meta: meta || {}, p_participants: participants });
export const acceptCoPurchase = (coId) => rpc('accept_co_purchase', { p_co: coId });
export const declineCoPurchase = (coId) => rpc('decline_co_purchase', { p_co: coId });
export const listCoPurchases = () => rpc('list_co_purchases', {});

// ── Reads (RLS: properties are publicly readable) ──────
export async function fetchBalance() {
  if (!supabase || !userId) return null;
  const { data } = await supabase.from('profiles').select('balance').eq('id', userId).single();
  return data?.balance ?? null;
}

export async function fetchMyProperties() {
  if (!supabase || !userId) return [];
  const { data: owned } = await supabase.from('properties').select('*').eq('owner_id', userId);
  const list = owned || [];
  // Co-owned: properties where I hold a share (may be recorded under another owner_id).
  const { data: shares } = await supabase.from('property_shares').select('property_id,share_pct').eq('user_id', userId);
  const have = new Set(list.map((p) => p.id));
  for (const p of list) { const s = shares?.find((x) => x.property_id === p.id); if (s) p.share_pct = s.share_pct; }
  const missing = (shares || []).filter((s) => !have.has(s.property_id));
  if (missing.length) {
    const { data: extra } = await supabase.from('properties').select('*').in('id', missing.map((s) => s.property_id));
    for (const p of extra || []) { p.share_pct = missing.find((s) => s.property_id === p.id)?.share_pct; list.push(p); }
  }
  return list;
}

/** Ownership info for a set of property ids (to color the map). */
export async function fetchPropertiesByIds(ids) {
  if (!supabase || !ids.length) return [];
  const { data } = await supabase.from('properties').select('id,owner_id,for_sale,list_price,price,name').in('id', ids);
  return data || [];
}

/** Current for-sale listings (marketplace browse). */
export async function fetchMarket(limit = 50) {
  if (!supabase) return [];
  const { data } = await supabase
    .from('properties')
    .select('id,kind,name,price,list_price,owner_id')
    .eq('for_sale', true)
    .order('updated_at', { ascending: false })
    .limit(limit);
  return data || [];
}
