/**
 * Minimal i18n. `t(key, params)` looks up the current language, falling back to
 * Korean then the key. Language is persisted; switching reloads the app so every
 * rendered string is re-evaluated. Static HTML uses [data-i18n]/[data-i18n-title]/
 * [data-i18n-ph] attributes, applied by applyStaticI18n().
 */
const LS_KEY = 'wl_lang';

const DICT = {
  ko: {
    'app.subtitle': '전 세계 영토를 사고 팔아 부를 쌓으세요',
    'lang.label': '언어',

    // Top-bar button tooltips
    'nav.portfolio': '내 자산', 'nav.leaderboard': '랭킹', 'nav.dashboard': '대시보드',
    'nav.missions': '목표', 'nav.market': '마켓', 'nav.earn': '돈벌기',
    'nav.friends': '친구', 'nav.notif': '알림', 'nav.account': '계정',

    // Sidebar headers
    'side.dashboard': '대시보드', 'side.portfolio': '내 자산', 'side.leaderboard': '랭킹',
    'side.market': '🏷️ 마켓', 'side.missions': '🎯 목표', 'side.friends': '👥 친구', 'side.earn': '💵 돈벌기',

    // Place nav
    'nav.searchPh': '🔍 장소 검색 (도시 · 주소 · 랜드마크)',
    'nav.myloc': '📍 내 위치', 'nav.random': '🎲 랜덤 탐험',
    'nav.hint': '🏙️ 도시를 선택하거나 더 줌인하면 건물을 구매할 수 있어요',

    // Common
    'common.cancel': '취소', 'common.confirm': '확인', 'common.buy': '구매', 'common.sell': '판매',
    'common.close': '닫기', 'common.loading': '불러오는 중…',

    // Clicker
    'clicker.income': '시간당 수입', 'clicker.today': '오늘', 'clicker.guest': '🔑 토스 앱에서 실행하면 돈을 모으고 부동산을 살 수 있어요!',
    'clicker.clicksLeft': '오늘 {n}/{max} 클릭', 'clicker.usedUp': '오늘 클릭을 다 썼어요! 💵 돈벌기 메뉴에서 광고로 더 벌 수 있어요',
    'clicker.perClick': '{v}/클릭', 'clicker.perMin': '+{v}/분 (자산)', 'clicker.btnTitle': '클릭해서 돈 벌기!',

    // Territory panel
    'panel.browsing': '👀 둘러보는 중이에요',
    'panel.loginToBuy': '🔑 토스 앱에서 실행하면 구매할 수 있어요',
    'panel.buy': '구매하기', 'panel.sellBank': '판매(은행)', 'panel.refund': '환급',
    'panel.list': '💹 판매 등록', 'panel.listed': '💹 판매 등록됨', 'panel.unlist': '판매 등록 취소',
    'panel.coBuy': '👥 친구와 공동구매',
    'panel.incomePerH': '시간당 +{v} 수입',
    'panel.notEnough': '잔액 부족 ({v} 더 필요)',
    'panel.othersListing': '💹 다른 플레이어의 매물',
    'panel.buyListing': '이 매물 구매', 'panel.locked': '🔒 다른 플레이어 소유 (비매물)',
    'panel.coOwned': '👥 공동소유 · 내 지분 {v}%',
    'panel.coOwnedNote': '수익은 지분대로 자동 정산돼요. (공동소유 매각은 준비 중)',
    'panel.needTravel': '📍 {here}에서 {km}km · 구매하려면 이동이 필요합니다',
    'panel.inTransitBuy': '📍 {here}에서 {km}km · ✈️ 이동 중 — 도착 후 다른 지역을 살 수 있어요',
    'panel.flyDirect': '✈️ 직항', 'panel.flyConnect': '🛫 경유', 'panel.train': '🚄 기차',
    'panel.level.country': '국가', 'panel.level.province': '시/도', 'panel.level.district': '시군구',
    'panel.level.building': '건물', 'panel.level.floor': '층', 'panel.level.landmark': '🏆 랜드마크',

    // Toasts
    'toast.buyOk': '구매 완료! 🎉', 'toast.sellOk': '판매 완료!',
    'toast.welcome': '🎉 {name}님, {bal} 시드로 시작!',
    'toast.idle': '💤 자리를 비운 {dur} 동안 +{earned} 벌었어요!',
    'toast.guestBrowse': '👀 둘러보는 중 — 마음에 드는 곳을 클릭해보세요! (게스트는 dev 전용)',

    // Tutorial
    'tut.next': '다음', 'tut.prev': '이전', 'tut.skip': '건너뛰기', 'tut.start': '시작하기 🚀',
    'tut.1.t': '지도를 둘러보세요', 'tut.1.b': '드래그로 이동, 휠로 줌인. 도시로 들어가면 건물이 3D로 솟아납니다. 상단 🎲 랜덤·명소 칩으로 순간이동도 돼요.',
    'tut.2.t': '건물을 사세요', 'tut.2.b': '건물이나 층을 클릭해 구매! 단, <b>내 위치 근처</b>만 가능해요. 멀리 사려면 ✈️ 비행기·🚄 기차로 이동(요금·시간 소요).',
    'tut.3.t': '돈 모으기', 'tut.3.b': '💰 클릭(하루 한도)·💵 광고로 초반 자금. 부동산은 시간당 수입이 쌓여 <b>주 수입원</b>이 됩니다.',
    'tut.4.t': '사고팔기', 'tut.4.b': '내 자산을 <b>💹 판매 등록</b>하면 다른 사람이 삽니다. 🏷️ 마켓에서 남의 매물을 나라·지역별로 둘러보고 구매하세요.',
    'tut.5.t': '목표를 향해', 'tut.5.b': '🎯 목표를 달성해 보상을 받고, 🏆 랜드마크(초고가!)에 도전하세요. 언젠가, 당신도 건물주 👑',

    // Account modal
    'acct.guestNote': '게스트 모드 · 진행 상황은 이 브라우저에만 저장됩니다',
    'acct.logout': '로그아웃', 'acct.guest': '게스트',
    'acct.tossNote': '토스 계정으로 자동 연결됨',
    'auth.connecting': '토스 계정으로 연결하는 중…',
    'auth.tossOnly': '이 게임은 토스 앱 안에서 실행해야 해요.',
    'auth.guest': '둘러보기 (게스트)',
    'auth.guestHint': '게스트는 구경만 — 토스 앱에서 실행하면 자동 로그인됩니다.',
    'auth.error': '로그인에 실패했습니다: ',
  },
  en: {
    'app.subtitle': 'Buy and sell land worldwide to build your fortune',
    'lang.label': 'Language',

    'nav.portfolio': 'My Assets', 'nav.leaderboard': 'Ranking', 'nav.dashboard': 'Dashboard',
    'nav.missions': 'Goals', 'nav.market': 'Market', 'nav.earn': 'Earn',
    'nav.friends': 'Friends', 'nav.notif': 'Notifications', 'nav.account': 'Account',

    'side.dashboard': 'Dashboard', 'side.portfolio': 'My Assets', 'side.leaderboard': 'Ranking',
    'side.market': '🏷️ Market', 'side.missions': '🎯 Goals', 'side.friends': '👥 Friends', 'side.earn': '💵 Earn',

    'nav.searchPh': '🔍 Search a place (city · address · landmark)',
    'nav.myloc': '📍 My location', 'nav.random': '🎲 Explore',
    'nav.hint': '🏙️ Pick a city or zoom in further to buy buildings',

    'common.cancel': 'Cancel', 'common.confirm': 'Confirm', 'common.buy': 'Buy', 'common.sell': 'Sell',
    'common.close': 'Close', 'common.loading': 'Loading…',

    'clicker.income': 'Income/hr', 'clicker.today': 'Today', 'clicker.guest': '🔑 Open in the Toss app to earn money and buy real estate!',
    'clicker.clicksLeft': '{n}/{max} clicks today', 'clicker.usedUp': "You're out of clicks today! Earn more via ads in the 💵 Earn menu.",
    'clicker.perClick': '{v}/click', 'clicker.perMin': '+{v}/min (assets)', 'clicker.btnTitle': 'Click to earn!',

    'panel.browsing': '👀 Just browsing',
    'panel.loginToBuy': '🔑 Open in the Toss app to buy',
    'panel.buy': 'Buy', 'panel.sellBank': 'Sell (bank)', 'panel.refund': 'refund',
    'panel.list': '💹 List for sale', 'panel.listed': '💹 Listed for sale', 'panel.unlist': 'Unlist',
    'panel.coBuy': '👥 Co-buy with friends',
    'panel.incomePerH': '+{v}/hr income',
    'panel.notEnough': 'Not enough ({v} more needed)',
    'panel.othersListing': "💹 Another player's listing",
    'panel.buyListing': 'Buy this listing', 'panel.locked': '🔒 Owned by another player (not for sale)',
    'panel.coOwned': '👥 Co-owned · your share {v}%',
    'panel.coOwnedNote': 'Income is split by share automatically. (Selling co-owned assets is coming soon.)',
    'panel.needTravel': '📍 {km}km from {here} · you need to travel to buy',
    'panel.inTransitBuy': '📍 {km}km from {here} · ✈️ in transit — you can buy elsewhere after arriving',
    'panel.flyDirect': '✈️ Direct', 'panel.flyConnect': '🛫 Connecting', 'panel.train': '🚄 Train',
    'panel.level.country': 'Country', 'panel.level.province': 'Region', 'panel.level.district': 'District',
    'panel.level.building': 'Building', 'panel.level.floor': 'Floor', 'panel.level.landmark': '🏆 Landmark',

    'toast.buyOk': 'Purchased! 🎉', 'toast.sellOk': 'Sold!',
    'toast.welcome': '🎉 {name}, starting with {bal}!',
    'toast.idle': '💤 You earned +{earned} while away for {dur}!',
    'toast.guestBrowse': '👀 Just browsing — click anywhere you like! Sign in to buy.',

    'tut.next': 'Next', 'tut.prev': 'Back', 'tut.skip': 'Skip', 'tut.start': 'Start 🚀',
    'tut.1.t': 'Explore the map', 'tut.1.b': 'Drag to move, scroll to zoom in. Enter a city and buildings rise in 3D. Use the 🎲 Explore & landmark chips up top to teleport.',
    'tut.2.t': 'Buy buildings', 'tut.2.b': 'Click a building or floor to buy it! But only <b>near your location</b>. To buy far away, travel by ✈️ plane or 🚄 train (costs money & time).',
    'tut.3.t': 'Make money', 'tut.3.b': '💰 Click (daily cap) and 💵 ads for starter cash. Real estate accrues hourly income — your <b>main source</b>.',
    'tut.4.t': 'Trade', 'tut.4.b': '<b>💹 List</b> your assets and others can buy them. Browse listings by country/region in the 🏷️ Market.',
    'tut.5.t': 'Aim high', 'tut.5.b': 'Complete 🎯 goals for rewards, and go for 🏆 landmarks (super expensive!). Someday, you too will own it all 👑',

    'acct.guestNote': 'Guest mode · progress is saved only in this browser',
    'acct.logout': 'Log out', 'acct.guest': 'Guest',
    'acct.tossNote': 'Connected via your Toss account',
    'auth.connecting': 'Connecting with your Toss account…',
    'auth.tossOnly': 'This game must run inside the Toss app.',
    'auth.guest': 'Browse as guest',
    'auth.guestHint': 'Guests can only look — open in the Toss app to sign in automatically.',
    'auth.error': 'Sign-in failed: ',
  },
};

let lang = detect();

function detect() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === 'ko' || saved === 'en') return saved;
  } catch {}
  return (navigator.language || '').toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function getLang() { return lang; }

export function setLang(l) {
  if (l !== 'ko' && l !== 'en') return;
  try { localStorage.setItem(LS_KEY, l); } catch {}
  location.reload();
}

export function t(key, params) {
  let s = DICT[lang]?.[key] ?? DICT.ko[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// Apply translations to static HTML elements.
export function applyStaticI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
}
