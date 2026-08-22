/**
 * "돈벌기" 메뉴 — 토스 인앱 광고(보상형).
 * 광고를 끝까지 시청(userEarnedReward)하면 서버 RPC(watch_toss_ad)가 보상을
 * 지급한다 (일일 한도는 서버가 관리). 광고는 load → show → 다시 load 순서.
 */
import { claimTossAdReward, getTossAdsWatchedToday } from '../game/game-state.js';
import { isRewardedAdSupported, loadRewardedAd, showRewardedAd } from '../lib/toss.js';
import { showToast } from './toast.js';
import { formatPrice } from '../game/price-engine.js';
import { GAME_CONFIG } from '../config.js';

let sidebarEl, contentEl;
let adLoaded = false;
let adLoading = false;

export function initEarn() {
  sidebarEl = document.getElementById('earn-sidebar');
  contentEl = document.getElementById('earn-content');
  document.getElementById('btn-earn')?.addEventListener('click', toggle);
}

function toggle() {
  document.querySelectorAll('.sidebar').forEach(s => s.classList.add('hidden'));
  sidebarEl.classList.toggle('hidden');
  if (!sidebarEl.classList.contains('hidden')) {
    render();
    preloadAd();
  }
}

// 광고는 반드시 미리 로드해 두어야 함 (출시 체크리스트 항목).
function preloadAd() {
  if (adLoaded || adLoading || !isRewardedAdSupported()) return;
  adLoading = true;
  loadRewardedAd({
    onLoaded: () => { adLoading = false; adLoaded = true; render(); },
    onError: (e) => {
      adLoading = false;
      console.warn('rewarded ad load failed:', e?.message || e);
      render();
    },
  });
}

function render() {
  if (!contentEl) return;

  if (!isRewardedAdSupported()) {
    contentEl.innerHTML = `<p class="earn-empty">광고 보상은 토스 앱에서만 받을 수 있어요.</p>`;
    return;
  }

  const watched = getTossAdsWatchedToday();
  const limit = GAME_CONFIG.AD.DAILY_LIMIT;
  const left = Math.max(0, limit - watched);
  const done = left <= 0;

  contentEl.innerHTML = `
    <p class="earn-note">광고를 끝까지 보면 보상! 하루 최대 ${limit}회.</p>
    <div class="earn-list">
      <div class="earn-card">
        <div class="earn-body">
          <div class="earn-title">📺 광고 보고 보상 받기</div>
          <div class="earn-desc">오늘 남은 횟수: ${left}회</div>
          <div class="earn-reward">+${formatPrice(GAME_CONFIG.AD.REWARD)}</div>
        </div>
        <button id="toss-ad-watch" class="earn-watch ${done ? 'watched' : ''}"
          ${done || !adLoaded ? 'disabled' : ''}>
          ${done ? '오늘 완료' : adLoaded ? '시청' : '광고 준비 중…'}
        </button>
      </div>
    </div>`;

  document.getElementById('toss-ad-watch')?.addEventListener('click', watch);
}

function watch() {
  if (!adLoaded) return;
  adLoaded = false;
  let rewarded = false;

  showRewardedAd({
    onReward: async () => {
      rewarded = true;
      const r = await claimTossAdReward();
      if (r.success) showToast(`광고 보상 +${formatPrice(r.reward)}! 🎉`, 'success');
      else showToast(r.message || '보상 지급에 실패했어요.', 'info');
      render();
    },
    onClosed: () => {
      // 끝까지 보지 않고 닫으면 보상 없음 (정책: userEarnedReward에만 지급).
      if (!rewarded) showToast('광고를 끝까지 보면 보상을 받아요.', 'info');
      preloadAd(); // 다음 광고 미리 로드
      render();
    },
    onError: (e) => {
      console.warn('rewarded ad show failed:', e?.message || e);
      showToast('광고를 표시하지 못했어요. 잠시 후 다시 시도해주세요.', 'error');
      preloadAd();
      render();
    },
  });
}
