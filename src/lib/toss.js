/**
 * 앱인토스 WebView SDK 래퍼.
 * 토스 앱 안에서는 실제 SDK를 호출하고, 밖(로컬 브라우저 dev)에서는 null을
 * 반환해 앱이 죽지 않게 한다. 모든 호출부는 null 처리를 전제로 한다.
 */
import {
  getUserKeyForGame,
  loadFullScreenAd,
  showFullScreenAd,
  getCurrentLocation,
  Accuracy,
  TossAds,
} from '@apps-in-toss/web-framework';

// 개발 단계에서는 테스트 ID 사용이 필수 (실제 ID로 테스트하면 정책 위반).
// 출시 전 콘솔에서 발급받은 광고 그룹 ID들을 .env에 설정할 것.
export const REWARDED_AD_GROUP_ID =
  import.meta.env.VITE_TOSS_REWARDED_AD_GROUP_ID || 'ait-ad-test-rewarded-id';
export const INTERSTITIAL_AD_GROUP_ID =
  import.meta.env.VITE_TOSS_INTERSTITIAL_AD_GROUP_ID || 'ait-ad-test-interstitial-id';
export const BANNER_AD_GROUP_ID =
  import.meta.env.VITE_TOSS_BANNER_AD_GROUP_ID || 'ait-ad-test-banner-id';

/**
 * 토스 게임 미니앱 사용자 식별키(hash)를 반환. 토스 앱 밖이면 null.
 * (게임 카테고리 전용 — 로그인 화면 없이 유저를 식별한다.)
 */
export async function getTossUserKey() {
  try {
    const result = await getUserKeyForGame();
    if (result && typeof result === 'object' && result.type === 'HASH' && result.hash) {
      return result.hash;
    }
    console.warn('[toss] getUserKeyForGame:', result);
    return null;
  } catch (e) {
    console.warn('[toss] getUserKeyForGame 실패 (토스 앱 밖?):', e?.message || e);
    return null;
  }
}

/** 보상형 광고를 사용할 수 있는 환경인지 여부. */
export function isRewardedAdSupported() {
  try {
    return Boolean(loadFullScreenAd?.isSupported?.() && showFullScreenAd?.isSupported?.());
  } catch {
    return false;
  }
}

/**
 * 보상형 광고를 미리 로드한다. loaded 이벤트가 오면 onLoaded 호출.
 * 반환값은 콜백 해제 함수.
 */
export function loadRewardedAd({ onLoaded, onError }) {
  try {
    return loadFullScreenAd({
      options: { adGroupId: REWARDED_AD_GROUP_ID },
      onEvent: (event) => {
        if (event.type === 'loaded') onLoaded?.();
      },
      onError: (err) => onError?.(err),
    });
  } catch (e) {
    onError?.(e);
    return () => {};
  }
}

/**
 * 로드된 보상형 광고를 표시한다.
 * onReward: 사용자가 끝까지 시청해 보상을 획득한 시점(userEarnedReward)에만 호출.
 * onClosed: 광고가 닫힌 시점 — 다음 광고를 다시 load해야 한다.
 */
export function showRewardedAd({ onReward, onClosed, onError }) {
  try {
    return showFullScreenAd({
      options: { adGroupId: REWARDED_AD_GROUP_ID },
      onEvent: (event) => {
        if (event.type === 'userEarnedReward') onReward?.(event.data);
        if (event.type === 'dismissed') onClosed?.();
        if (event.type === 'failedToShow') onError?.(new Error('광고 표시 실패'));
      },
      onError: (err) => onError?.(err),
    });
  } catch (e) {
    onError?.(e);
    return () => {};
  }
}

/**
 * 현재 위치. 토스 SDK를 우선 사용하고, 실패하면 브라우저 geolocation 폴백.
 * @returns {Promise<{lng:number, lat:number}|null>}
 */
export async function getTossCurrentLocation() {
  try {
    const loc = await getCurrentLocation({ accuracy: Accuracy?.Balanced ?? 'Balanced' });
    if (loc && Number.isFinite(loc.longitude) && Number.isFinite(loc.latitude)) {
      return { lng: loc.longitude, lat: loc.latitude };
    }
  } catch (e) {
    console.warn('[toss] getCurrentLocation 실패, 브라우저 폴백:', e?.message || e);
  }
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lng: pos.coords.longitude, lat: pos.coords.latitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

// ── 전면형 광고 (화면 전환 지점 전용 — load → show → 다시 load) ──
export function loadInterstitialAd({ onLoaded, onError } = {}) {
  try {
    return loadFullScreenAd({
      options: { adGroupId: INTERSTITIAL_AD_GROUP_ID },
      onEvent: (event) => { if (event.type === 'loaded') onLoaded?.(); },
      onError: (err) => onError?.(err),
    });
  } catch (e) {
    onError?.(e);
    return () => {};
  }
}

export function showInterstitialAd({ onClosed, onError } = {}) {
  try {
    return showFullScreenAd({
      options: { adGroupId: INTERSTITIAL_AD_GROUP_ID },
      onEvent: (event) => {
        if (event.type === 'dismissed') onClosed?.();
        if (event.type === 'failedToShow') onError?.(new Error('전면 광고 표시 실패'));
      },
      onError: (err) => onError?.(err),
    });
  } catch (e) {
    onError?.(e);
    return () => {};
  }
}

// ── 배너 광고 (TossAds SDK — 초기화 1회 후 슬롯에 부착) ──
let bannerReady = false;
let bannerInitStarted = false;
const pendingBanners = [];

export function isBannerSupported() {
  try {
    return Boolean(TossAds?.initialize?.isSupported?.() && TossAds?.attachBanner?.isSupported?.());
  } catch {
    return false;
  }
}

export function initBannerAds() {
  if (bannerInitStarted || !isBannerSupported()) return;
  bannerInitStarted = true;
  try {
    TossAds.initialize({
      callbacks: {
        onInitialized: () => {
          bannerReady = true;
          pendingBanners.splice(0).forEach((fn) => fn());
        },
        onInitializationFailed: (e) => console.warn('[toss] 배너 SDK 초기화 실패:', e?.message || e),
      },
    });
  } catch (e) {
    console.warn('[toss] 배너 SDK 초기화 예외:', e?.message || e);
  }
}

/**
 * 배너를 슬롯 엘리먼트에 부착 (초기화 전이면 큐잉).
 * 반환된 핸들의 destroy()로 반드시 제거할 것 — 사이드바가 닫힌 뒤에도
 * 광고가 남아 레이아웃을 깨는 것을 막는다.
 */
export function attachBannerTo(el) {
  let attached = null;
  let cancelled = false;
  const doAttach = () => {
    if (cancelled) return;
    try {
      attached = TossAds.attachBanner(BANNER_AD_GROUP_ID, el, {
        theme: 'dark',      // 앱이 다크 테마 고정
        variant: 'card',    // 좌우 패딩 + radius — 사이드바에 어울림
        callbacks: {
          onNoFill: () => { el.style.display = 'none'; },
          onAdFailedToRender: (p) => {
            console.warn('배너 렌더 실패:', p?.error?.message);
            el.style.display = 'none';
          },
        },
      });
    } catch (e) {
      console.warn('배너 부착 실패:', e?.message || e);
      el.style.display = 'none';
    }
  };
  if (bannerReady) doAttach();
  else if (bannerInitStarted) pendingBanners.push(doAttach);
  return {
    destroy() {
      cancelled = true;
      try { attached?.destroy?.(); } catch { /* ignore */ }
      attached = null;
    },
  };
}
