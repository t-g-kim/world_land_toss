/**
 * 인앱 광고 배치 (토스 IAA 정책 준수):
 * - 배너: 스크롤형 사이드바 헤더 아래 1개씩 (동일 화면 1개, 게임 플레이 영역과 분리)
 * - 전면형: 비행기/기차 이동 시작 시(명확한 화면 전환 지점) — 사전 로딩 + 쿨다운
 * 보상형은 돈벌기(earn.js)에서 별도 처리.
 */
import { bus, Events } from '../lib/event-bus.js';
import {
  isBannerSupported, initBannerAds, attachBannerTo,
  isRewardedAdSupported, loadInterstitialAd, showInterstitialAd,
} from '../lib/toss.js';

// 배너를 넣을 사이드바 (친구 사이드바는 상호작용 버튼이 많아 제외)
const BANNER_SIDEBARS = [
  'dashboard-sidebar', 'portfolio-sidebar', 'leaderboard-sidebar',
  'market-sidebar', 'missions-sidebar', 'earn-sidebar',
];

const INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000; // 여행 연속 시 광고 도배 방지
let interstitialLoaded = false;
let lastInterstitialAt = 0;

export function initAds() {
  // ── 배너 ──
  if (isBannerSupported()) {
    initBannerAds();
    for (const id of BANNER_SIDEBARS) {
      const sidebar = document.getElementById(id);
      const header = sidebar?.querySelector('.sidebar-header');
      if (!header) continue;
      const slot = document.createElement('div');
      slot.className = 'ad-banner-slot';
      header.insertAdjacentElement('afterend', slot);
      attachBannerTo(slot);
    }
  }

  // ── 전면형: 여행 시작 = 화면 전환 지점 ──
  if (isRewardedAdSupported()) { // 전면/보상형은 같은 통합 API를 씀
    preloadInterstitial();
    bus.on(Events.TRAVEL_STARTED, maybeShowInterstitial);
  }
}

function preloadInterstitial() {
  loadInterstitialAd({
    onLoaded: () => { interstitialLoaded = true; },
    onError: (e) => console.warn('전면 광고 로드 실패:', e?.message || e),
  });
}

function maybeShowInterstitial() {
  if (!interstitialLoaded) return;
  if (Date.now() - lastInterstitialAt < INTERSTITIAL_COOLDOWN_MS) return;
  interstitialLoaded = false;
  lastInterstitialAt = Date.now();
  showInterstitialAd({
    onClosed: () => preloadInterstitial(), // 다음 노출을 위해 미리 로드
    onError: () => preloadInterstitial(),
  });
}
