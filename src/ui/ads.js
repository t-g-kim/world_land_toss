/**
 * 인앱 광고 배치 (토스 IAA 정책 준수):
 * - 배너: 사이드바가 "열릴 때" 헤더 아래에 부착하고 "닫힐 때" 제거 —
 *   미리 붙여두면 사이드바 슬라이드 애니메이션과 어긋나 광고가 엉뚱한
 *   위치에 남는 문제가 생긴다. 화면당 1개.
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
  // ── 배너: 사이드바 열림/닫힘에 맞춰 부착/제거 ──
  if (isBannerSupported()) {
    initBannerAds();
    for (const id of BANNER_SIDEBARS) {
      const sidebar = document.getElementById(id);
      if (sidebar?.querySelector('.sidebar-header')) watchSidebarBanner(sidebar);
    }
  }

  // ── 전면형: 여행 시작 = 화면 전환 지점 ──
  if (isRewardedAdSupported()) { // 전면/보상형은 같은 통합 API를 씀
    preloadInterstitial();
    bus.on(Events.TRAVEL_STARTED, maybeShowInterstitial);
  }
}

function watchSidebarBanner(sidebar) {
  let slot = null;
  let handle = null;

  const sync = () => {
    const open = !sidebar.classList.contains('hidden');
    if (open && !handle) {
      slot = document.createElement('div');
      slot.className = 'ad-banner-slot';
      sidebar.querySelector('.sidebar-header').insertAdjacentElement('afterend', slot);
      handle = attachBannerTo(slot);
    } else if (!open && handle) {
      handle.destroy();
      handle = null;
      slot?.remove();
      slot = null;
    }
  };

  new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  sync();
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
