/**
 * Unified game state manager.
 * Persists to the authenticated user's Supabase profile (profiles.game_state).
 */
import { bus, Events } from '../lib/event-bus.js';
import { GAME_CONFIG } from '../config.js';
import { calculateIncomePerHour } from './price-engine.js';
import { travelOptions, distanceKm } from './travel.js';
import { supabase } from '../lib/supabase.js';
import {
  setMarketUser, buyProperty, sellToBank, collectIncome,
  clickReward, watchTossAdRpc, claimGoalRpc, spend,
  fetchBalance, fetchMyProperties, listProperty, unlistProperty,
} from './market.js';
import { refreshWorld } from './world.js';

// Set once the user is authenticated. Money + property ownership live server-side
// (Supabase); the local `state` is a cache. Client prefs persist to game_state.
let userId = null;
const SAVE_KEY = 'someday_game';

// Clicks are batched and redeemed via the server (which enforces the daily cap).
let pendingClicks = 0;
let flushTimer = null;
function queueClicks(n) {
  pendingClicks += n;
  if (flushTimer) return;
  flushTimer = setTimeout(flushClicks, 2000);
}
async function flushClicks() {
  flushTimer = null;
  const n = pendingClicks;
  pendingClicks = 0;
  if (!n || !userId) return;
  const r = await clickReward(n);
  if (r?.success) { state.balance = r.balance; bus.emit(Events.BALANCE_UPDATED, state.balance); }
}

// ── State ──────────────────────────────────────────────
let state = {
  nickname: null,
  location: null, // { lng, lat, name } — current position; buying is gated to nearby
  transit: null,  // active flight: { destLng, destLat, destName, arrivalTime, fare, mode, viaName }
  character: null,
  balance: 0,
  dailyClicks: 0,        // clicks used today (resets daily)
  clickDay: null,        // local date string the counters belong to
  adWatchedToday: [],    // ad ids already watched today
  claimedGoals: [],      // goal ids whose reward has been claimed
  totalClicks: 0,
  perClick: 1,
  autoPerSec: 0,
  clickUpgradeIndex: 0,
  autoUpgradeIndex: 0,
  ownedTerritories: {},
  transactions: [],
  totalIncome: 0,
  totalSpent: 0,
};

// ── Characters (with gameplay bonuses) ──────────────────
const CHARACTERS = [
  { id: 'explorer',  name: '탐험가',  emoji: '🧭', desc: '클릭 보너스 +20%',     clickBonus: 1.2, incomeBonus: 1.0 },
  { id: 'merchant',  name: '상인',    emoji: '💰', desc: '구매가 5% 할인',        clickBonus: 1.0, incomeBonus: 1.0, discount: 0.05 },
  { id: 'general',   name: '장군',    emoji: '⚔️',  desc: '영토 수입 +20%',       clickBonus: 1.0, incomeBonus: 1.2 },
  { id: 'scientist', name: '과학자',  emoji: '🔬', desc: '자동 수입 +30%',        clickBonus: 1.0, incomeBonus: 1.0, autoBonus: 1.3 },
  { id: 'pirate',    name: '해적',    emoji: '🏴‍☠️', desc: '판매 환급 +10%',       clickBonus: 1.0, incomeBonus: 1.0, sellBonus: 0.1 },
  { id: 'queen',     name: '여왕',    emoji: '👑', desc: '모든 보너스 +10%',       clickBonus: 1.1, incomeBonus: 1.1 },
];

// ── Upgrades ───────────────────────────────────────────
const CLICK_UPGRADES = [
  { cost: 100,       perClick: 2,   label: '클릭당 ₩2' },
  { cost: 500,       perClick: 5,   label: '클릭당 ₩5' },
  { cost: 2_000,     perClick: 10,  label: '클릭당 ₩10' },
  { cost: 10_000,    perClick: 25,  label: '클릭당 ₩25' },
  { cost: 50_000,    perClick: 50,  label: '클릭당 ₩50' },
  { cost: 200_000,   perClick: 100, label: '클릭당 ₩100' },
  { cost: 1_000_000, perClick: 500, label: '클릭당 ₩500' },
];

const AUTO_UPGRADES = [
  { cost: 500,       perSec: 1,   label: '자동 ₩1/초' },
  { cost: 5_000,     perSec: 5,   label: '자동 ₩5/초' },
  { cost: 50_000,    perSec: 20,  label: '자동 ₩20/초' },
  { cost: 500_000,   perSec: 100, label: '자동 ₩100/초' },
  { cost: 5_000_000, perSec: 500, label: '자동 ₩500/초' },
];

let priceCache = {};
let loadedLastSeen = null; // timestamp from the last save, for offline earnings
let autoInterval = null;
let transitInterval = null;
let incomeInterval = null;
let saveTimer = null;

// ── Throttled save (coalesce frequent ticks into one write) ──
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save();
  }, 3000);
}

// ═══════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════

export function getCharacters() { return CHARACTERS; }
export function getClickUpgrades() { return CLICK_UPGRADES; }
export function getAutoUpgrades() { return AUTO_UPGRADES; }
export function getState() { return state; }

export async function initGameState(user) {
  userId = user?.id || null;
  setMarketUser(userId);
  await loadState();          // client prefs (nickname, location, transit, clicker, goals)
  rolloverDayIfNeeded();

  // Money + property ownership are server-authoritative.
  await refreshFromServer();
  const income = await collectIncome();
  let offline = { earned: 0, seconds: 0 };
  if (income?.success) {
    state.balance = income.balance;
    offline = { earned: income.earned || 0, seconds: 0 };
  }

  // Resume an in-progress flight (may already have landed while away).
  if (state.transit) {
    if (Date.now() >= state.transit.arrivalTime) arriveNow();
    else startTransitTicker();
  }
  startIncomePoll();
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  return offline; // { earned, seconds } so the UI can show a "welcome back" message
}

// Load authoritative balance + my properties from the server into the cache.
async function refreshFromServer() {
  if (userId && supabase) {
    const { data } = await supabase.from('profiles').select('balance,claimed_goals').eq('id', userId).single();
    if (data) {
      if (data.balance != null) state.balance = data.balance;
      state.claimedGoals = data.claimed_goals || [];
    }
  } else {
    const bal = await fetchBalance();
    if (bal != null) state.balance = bal;
  }
  const props = await fetchMyProperties();
  const owned = {};
  for (const p of props) {
    const share = p.share_pct != null ? p.share_pct / 100 : 1;
    owned[p.id] = {
      name: p.name,
      level: p.kind,
      currentPrice: Math.round(p.price * share),
      purchasePrice: Math.round(p.price * share),
      incomePerHour: Math.round(p.income_per_hour * share),
      sharePct: p.share_pct ?? null, // null = sole owner
      forSale: p.for_sale,
      listPrice: p.list_price,
      boughtAt: p.purchased_at ? Date.parse(p.purchased_at) : Date.now(),
      ...(p.meta || {}), // geometry, floor, buildingId, height, minHeight, ...
    };
  }
  state.ownedTerritories = owned;
}

// Poll server income accrual (server credits based on time since last collect).
function startIncomePoll() {
  if (incomeInterval) clearInterval(incomeInterval);
  incomeInterval = setInterval(async () => {
    const r = await collectIncome();
    if (r?.success && r.earned > 0) {
      state.balance = r.balance;
      bus.emit(Events.BALANCE_UPDATED, state.balance);
    }
  }, 60_000);
}

// No longer used (server sets the starting balance); kept as a no-op.
export function grantStartingBalance() {}

// Guest = browsing without login (read-only; actions prompt sign-in).
export function isGuest() { return !userId; }

// ── Nickname (player display name) ─────────────────────
export function getNickname() { return state.nickname; }

export async function setNickname(name) {
  state.nickname = name;
  // For logged-in players, the nickname is also their public profile name.
  if (userId) {
    try {
      await supabase.from('profiles').update({ username: name }).eq('id', userId);
    } catch (e) {
      console.warn('닉네임 저장 실패:', e.message);
    }
  }
  save();
}

// ── Location & travel ──────────────────────────────────
export function getLocation() { return state.location; }
export function isHomeSet() { return !!state.location; }
export function isInTransit() { return !!state.transit; }
export function getTransit() { return state.transit; }

export function setHome(loc) {
  state.location = { lng: loc.lng, lat: loc.lat, name: loc.name };
  save();
  bus.emit(Events.LOCATION_CHANGED, state.location);
}

export function distanceToKm(lng, lat) {
  if (!state.location) return 0;
  return distanceKm(state.location.lng, state.location.lat, lng, lat);
}

/** Can the player buy a property at this point right now? */
export function canBuyAt(lng, lat) {
  if (!state.location) return true;                // pre-onboarding fallback
  // During a flight `location` is still the origin, so buying near your current
  // location stays allowed — only the far destination is out of reach.
  return distanceToKm(lng, lat) <= GAME_CONFIG.TRAVEL.BUY_RADIUS_KM;
}

/** Fare/time quote from current location to a destination. */
export function getTravelQuote(toLng, toLat) {
  const from = state.location || { lng: toLng, lat: toLat };
  return travelOptions(from.lng, from.lat, toLng, toLat);
}

export async function startTravel(toLng, toLat, name, mode = 'direct') {
  if (state.transit) return { success: false, message: '이미 이동 중입니다.' };
  const q = getTravelQuote(toLng, toLat);
  const opt = mode === 'connecting' ? q.connecting : mode === 'train' ? q.train : q.direct;
  if (!opt) return { success: false, message: '해당 이동 옵션이 없습니다.' };
  if (state.balance < opt.fare) return { success: false, message: '항공료가 부족합니다.' };

  const pay = await spend(opt.fare, 'travel'); // server-authoritative spend
  if (!pay?.success) return { success: false, message: pay?.message || '결제 실패' };
  state.balance = pay.balance;
  const via = mode === 'connecting' ? q.connecting?.via : null;
  const origin = state.location || { lng: q.from.lng, lat: q.from.lat };
  const now = Date.now();
  state.transit = {
    originLng: origin.lng, originLat: origin.lat,
    destLng: toLng, destLat: toLat, destName: name || q.to.name,
    viaLng: via ? via.lng : null, viaLat: via ? via.lat : null, viaName: via ? via.name : null,
    departAt: now,
    arrivalTime: now + opt.durationSec * 1000,
    fare: opt.fare, mode,
  };
  state.transactions.unshift({ type: 'travel', territoryName: name || q.to.name, price: opt.fare, timestamp: Date.now() });
  if (state.transactions.length > 100) state.transactions.length = 100;

  save();
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  bus.emit(Events.TRAVEL_STARTED, state.transit);
  startTransitTicker();
  return { success: true, transit: state.transit };
}

function startTransitTicker() {
  if (transitInterval) clearInterval(transitInterval);
  if (!state.transit) return;
  transitInterval = setInterval(checkArrival, 1000);
}

function checkArrival() {
  if (!state.transit) { clearInterval(transitInterval); transitInterval = null; return; }
  if (Date.now() >= state.transit.arrivalTime) arriveNow();
}

function arriveNow() {
  const t = state.transit;
  state.location = { lng: t.destLng, lat: t.destLat, name: t.destName };
  state.transit = null;
  if (transitInterval) { clearInterval(transitInterval); transitInterval = null; }
  save();
  bus.emit(Events.LOCATION_CHANGED, state.location);
  bus.emit(Events.TRAVEL_ARRIVED, state.location);
}

// ── Character ──────────────────────────────────────────
export function selectCharacter(id) {
  const char = CHARACTERS.find(c => c.id === id);
  if (!char) return;
  state.character = char;
  state.perClick = state.clickUpgradeIndex > 0
    ? CLICK_UPGRADES[state.clickUpgradeIndex - 1].perClick
    : 1;
  save();
}

// ── Clicker (daily-capped, flat reward) ────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Reset per-day counters (clicks, ad views) when the local date changes.
function rolloverDayIfNeeded() {
  const today = todayStr();
  if (state.clickDay !== today) {
    state.clickDay = today;
    state.dailyClicks = 0;
    state.adWatchedToday = [];
  }
}

export function getClickReward() { return GAME_CONFIG.CLICK.REWARD; }
export function getDailyClickLimit() { return GAME_CONFIG.CLICK.DAILY_LIMIT; }
export function getDailyClicksLeft() {
  rolloverDayIfNeeded();
  return Math.max(0, GAME_CONFIG.CLICK.DAILY_LIMIT - state.dailyClicks);
}

export function doClick() {
  rolloverDayIfNeeded();
  if (state.dailyClicks >= GAME_CONFIG.CLICK.DAILY_LIMIT) return 0; // daily cap reached
  const earned = GAME_CONFIG.CLICK.REWARD;
  state.balance += earned;   // optimistic; server reconciles + enforces the cap
  state.dailyClicks++;
  state.totalClicks++;
  queueClicks(1);
  scheduleSave();
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  return earned;
}

// ── Goals / missions ───────────────────────────────────
export function isGoalClaimed(id) {
  return (state.claimedGoals || []).includes(id);
}

export async function claimGoal(id) {
  if (!state.claimedGoals) state.claimedGoals = [];
  if (state.claimedGoals.includes(id)) return { success: false };
  // Server verifies the goal condition + credits the reward authoritatively.
  const r = await claimGoalRpc(id);
  if (!r?.success) return { success: false, message: r?.message };
  state.claimedGoals.push(id);
  state.balance = r.balance;
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  return { success: true, reward: r.reward };
}

// ── 토스 보상형 광고 (일일 한도는 서버 RPC가 관리) ──────
export function getTossAdsWatchedToday() {
  rolloverDayIfNeeded();
  return state.adWatchedToday.length; // 오늘 시청 완료한 횟수 (UI 표시용 캐시)
}

export async function claimTossAdReward() {
  rolloverDayIfNeeded();
  // 보상 지급 + 일일 한도는 서버(watch_toss_ad)가 검증한다.
  const r = await watchTossAdRpc();
  if (!r?.success) return { success: false, message: r?.message || '보상 지급 실패' };
  state.adWatchedToday.push(String(Date.now()));
  state.balance = r.balance;
  save();
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  return { success: true, reward: r.reward };
}

export function buyClickUpgrade() {
  const up = CLICK_UPGRADES[state.clickUpgradeIndex];
  if (!up || state.balance < up.cost) return false;
  state.balance -= up.cost;
  state.perClick = up.perClick;
  state.clickUpgradeIndex++;
  save();
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  return true;
}

export function buyAutoUpgrade() {
  const up = AUTO_UPGRADES[state.autoUpgradeIndex];
  if (!up || state.balance < up.cost) return false;
  state.balance -= up.cost;
  state.autoPerSec = up.perSec;
  state.autoUpgradeIndex++;
  save();
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  startAutoClicker();
  return true;
}

// ── Territory pricing ──────────────────────────────────
export function setTerritoryPrice(id, price) {
  priceCache[id] = price;
}

export function getTerritoryPrice(id) {
  return priceCache[id] || 0;
}

export function estimatePrice(props, level) {
  const levelFactor = GAME_CONFIG.LEVEL_FACTORS[level] || 500_000;
  const pop = Number(props.population) || 1_000_000;
  const gdp = Number(props.gdp) || 0;
  let sig = 3;
  if (gdp > 1_000_000) sig = 10;
  else if (gdp > 100_000) sig = 8;
  else if (gdp > 10_000) sig = 5;
  else if (pop > 50_000_000) sig = 7;
  else if (pop > 10_000_000) sig = 5;
  const popFactor = pop > 0 ? Math.log(pop) : 1;
  return Math.round(levelFactor * popFactor * (sig / 5));
}

// ── Purchase / Sell (server-authoritative) ─────────────
export async function purchaseTerritory(id, name, level, price, meta = {}) {
  if (!userId) return { success: false, message: '로그인이 필요합니다' };
  if (state.ownedTerritories[id]) return { success: false, message: '이미 소유한 자산입니다!' };

  const income = calculateIncomePerHour(price);
  const r = await buyProperty(id, level, name, Math.round(price), income, meta);
  if (!r?.success) return { success: false, message: r?.message || '구매 실패' };

  const paid = r.price ?? Math.round(price);
  state.balance = r.balance;
  state.ownedTerritories[id] = {
    name, level, currentPrice: paid, purchasePrice: paid,
    incomePerHour: income, boughtAt: Date.now(), ...meta,
  };
  priceCache[id] = paid;

  state.transactions.unshift({ type: 'purchase', territoryId: id, territoryName: name, price: paid, timestamp: Date.now() });
  if (state.transactions.length > 100) state.transactions.length = 100;

  save();
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  bus.emit(Events.TERRITORY_UPDATED, { id, owner_id: 'me' });
  refreshWorld();
  return { success: true, newPrice: paid };
}

export async function sellTerritory(id) {
  const t = state.ownedTerritories[id];
  if (!t) return { success: false, message: '소유하지 않은 자산입니다!' };

  const r = await sellToBank(id);
  if (!r?.success) return { success: false, message: r?.message || '판매 실패' };

  state.balance = r.balance;
  delete state.ownedTerritories[id];

  state.transactions.unshift({ type: 'sale', territoryId: id, territoryName: t.name, price: r.refund, timestamp: Date.now() });
  if (state.transactions.length > 100) state.transactions.length = 100;

  save();
  bus.emit(Events.BALANCE_UPDATED, state.balance);
  bus.emit(Events.TERRITORY_UPDATED, { id, owner_id: null });
  refreshWorld();
  return { success: true, refund: r.refund };
}

// ── Marketplace listing ────────────────────────────────
export async function listOwnedProperty(id, price) {
  const r = await listProperty(id, Math.round(price));
  const t = state.ownedTerritories[id];
  if (r?.success && t) { t.forSale = true; t.listPrice = Math.round(price); refreshWorld(); }
  return r;
}
export async function unlistOwnedProperty(id) {
  const r = await unlistProperty(id);
  const t = state.ownedTerritories[id];
  if (r?.success && t) { t.forSale = false; t.listPrice = null; refreshWorld(); }
  return r;
}

export function isOwned(id) { return !!state.ownedTerritories[id]; }
export function getOwnedTerritories() { return state.ownedTerritories; }
export function getOwnedCount() { return Object.keys(state.ownedTerritories).length; }
export function getTotalTerritoryValue() {
  return Object.values(state.ownedTerritories).reduce((s, t) => s + t.currentPrice, 0);
}
export function getTotalIncomePerHour() {
  return Object.values(state.ownedTerritories).reduce((s, t) => s + t.incomePerHour, 0);
}
export function getNetWorth() { return state.balance + getTotalTerritoryValue(); }
export function getTransactions() { return state.transactions; }

// ── Auto-clicker ───────────────────────────────────────
function startAutoClicker() {
  if (autoInterval) clearInterval(autoInterval);
  if (state.autoPerSec <= 0) return;
  autoInterval = setInterval(() => {
    const autoBonus = state.character?.autoBonus || 1;
    state.balance += Math.round(state.autoPerSec * autoBonus);
    scheduleSave();
    bus.emit(Events.BALANCE_UPDATED, state.balance);
  }, 1000);
}

// ── Territory passive income ───────────────────────────
function startTerritoryIncome() {
  if (incomeInterval) clearInterval(incomeInterval);
  incomeInterval = setInterval(() => {
    const owned = Object.values(state.ownedTerritories);
    if (owned.length === 0) return;
    const perMinute = owned.reduce((s, t) => s + Math.round(t.incomePerHour / 60), 0);
    if (perMinute > 0) {
      state.balance += perMinute;
      state.totalIncome += perMinute;
      scheduleSave();
      bus.emit(Events.BALANCE_UPDATED, state.balance);
    }
  }, 60_000);
}

// ── Persistence (Supabase: profiles.game_state) ────────
function serialize() {
  return {
    nickname: state.nickname,
    location: state.location,
    transit: state.transit,
    character: state.character?.id || null,
    // NOTE: balance + property ownership are server-authoritative, not in this blob.
    dailyClicks: state.dailyClicks,
    clickDay: state.clickDay,
    adWatchedToday: state.adWatchedToday,
    claimedGoals: state.claimedGoals,
    totalClicks: state.totalClicks,
    transactions: state.transactions,
    prices: priceCache,
    lastSeen: Date.now(),
  };
}

async function save() {
  // A pending throttled save is now redundant — this write is fresh.
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

  const data = serialize();

  // Guest mode (no auth): persist locally so the game still works offline.
  if (!userId) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('저장 실패:', e.message);
    }
    return;
  }

  try {
    // Only client prefs — balance/ownership are owned by the marketplace RPCs.
    const { error } = await supabase.from('profiles').update({ game_state: data }).eq('id', userId);
    if (error) throw error;
  } catch (e) {
    console.warn('저장 실패:', e.message);
  }
}

function applySaved(saved) {
  // Client prefs only — balance + ownedTerritories come from the server.
  saved = saved || {};
  state.nickname = saved.nickname || null;
  state.location = saved.location || null;
  state.transit = saved.transit || null;
  state.dailyClicks = saved.dailyClicks || 0;
  state.clickDay = saved.clickDay || null;
  state.adWatchedToday = saved.adWatchedToday || [];
  state.claimedGoals = saved.claimedGoals || [];
  state.totalClicks = saved.totalClicks || 0;
  state.transactions = saved.transactions || [];
  priceCache = saved.prices || {};
  loadedLastSeen = saved.lastSeen || null;
  state.character = null;
}

async function loadState() {
  // Guest mode: load from localStorage.
  if (!userId) {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      applySaved(raw ? JSON.parse(raw) : {});
    } catch (e) {
      console.warn('불러오기 실패:', e.message);
    }
    return;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('game_state')
      .eq('id', userId)
      .single();
    if (error) throw error;
    applySaved(data?.game_state);
  } catch (e) {
    console.warn('불러오기 실패:', e.message);
  }
}

export async function resetGame() {
  if (userId) {
    await supabase.from('profiles').update({ game_state: {} }).eq('id', userId);
  } else {
    localStorage.removeItem(SAVE_KEY);
  }
  location.reload();
}
