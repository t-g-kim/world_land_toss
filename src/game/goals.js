/**
 * Goal/mission definitions. Each goal has a `done(stats)` predicate and a
 * money `reward`; numeric goals also expose a `bar(stats) → [current, target]`
 * for a progress bar. Kept purely state-derived so no extra tracking is needed.
 */
import { getOwnedCount, getNetWorth, getOwnedTerritories, getState } from './game-state.js';

export function buildStats() {
  const owned = getOwnedTerritories();
  const levels = new Set(Object.values(owned).map((t) => t.level));
  const st = getState();
  return {
    owned: getOwnedCount(),
    netWorth: getNetWorth(),
    hasDistrict: levels.has('district'),
    hasProvince: levels.has('province'),
    hasCountry: levels.has('country'),
    hasTraveled: (st.transactions || []).some((t) => t.type === 'travel'),
  };
}

export const GOALS = [
  { id: 'first',    icon: '🏠', title: '첫 부동산',   desc: '아무 부동산이나 1개 구매',        reward: 20_000,     done: (s) => s.owned >= 1,          bar: (s) => [s.owned, 1] },
  { id: 'travel',   icon: '✈️', title: '첫 여행',     desc: '비행기·기차로 다른 지역 이동',    reward: 30_000,     done: (s) => s.hasTraveled },
  { id: 'own3',     icon: '🏘️', title: '부동산 3채',  desc: '부동산 3개 소유',                reward: 60_000,     done: (s) => s.owned >= 3,          bar: (s) => [s.owned, 3] },
  { id: 'nw1m',     icon: '💰', title: '백만장자',    desc: '순자산 ₩1,000,000 달성',         reward: 100_000,    done: (s) => s.netWorth >= 1_000_000,   bar: (s) => [s.netWorth, 1_000_000] },
  { id: 'district', icon: '🗺️', title: '시군구 정복', desc: '시군구 단위 영토 소유',          reward: 100_000,    done: (s) => s.hasDistrict },
  { id: 'own10',    icon: '🏙️', title: '부동산 10채', desc: '부동산 10개 소유',               reward: 300_000,    done: (s) => s.owned >= 10,         bar: (s) => [s.owned, 10] },
  { id: 'province', icon: '🏞️', title: '시도 정복',   desc: '시도/주 단위 영토 소유',          reward: 500_000,    done: (s) => s.hasProvince },
  { id: 'nw10m',    icon: '💎', title: '천만장자',    desc: '순자산 ₩10,000,000 달성',        reward: 800_000,    done: (s) => s.netWorth >= 10_000_000,  bar: (s) => [s.netWorth, 10_000_000] },
  { id: 'nw100m',   icon: '👑', title: '억만장자',    desc: '순자산 ₩100,000,000 달성',       reward: 5_000_000,  done: (s) => s.netWorth >= 100_000_000, bar: (s) => [s.netWorth, 100_000_000] },
  { id: 'country',  icon: '🌍', title: '국가 정복',   desc: '국가 단위 영토 소유',            reward: 10_000_000, done: (s) => s.hasCountry },
];
