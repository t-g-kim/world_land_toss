export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const MAP_CONFIG = {
  style: 'mapbox://styles/mapbox/dark-v11',
  center: [30, 20], // World center view
  zoom: 2.2,
  minZoom: 1.5,
  maxZoom: 18, // high enough to reach individual buildings
};

// Zoom thresholds (country → province/state → district → building)
export const ZOOM_LEVELS = {
  COUNTRY: { min: 0, max: 3.99 },
  PROVINCE: { min: 4, max: 6.99 },
  DISTRICT: { min: 7, max: 14.99 },
  BUILDING: { min: 15, max: 20 },
};

export const ADMIN_LEVELS = {
  COUNTRY: 'country',
  PROVINCE: 'province',
  DISTRICT: 'district',
  BUILDING: 'building',
};

export const GAME_CONFIG = {
  INITIAL_BALANCE: 10_000_000,
  STARTING_BALANCE: 50_000,   // seed money for a brand-new player (≈ one cheap building)
  OFFLINE_MAX_HOURS: 8,       // cap on idle earnings accrued while away

  // Daily-capped clicker + rewarded "watch ad" income (monetization).
  // Scaled to the property economy (assets cost millions): 400 clicks/day ≈ ₩4M,
  // one ad ≈ ₩0.5M — a meaningful daily bootstrap, but property income still scales past it.
  CLICK: { REWARD: 10_000, DAILY_LIMIT: 400 }, // up to 400 clicks/day → ₩4,000,000/day
  // 토스 인앱 광고(보상형): 시청 완료 시 보상. 한도/보상은 서버 RPC(watch_toss_ad)와 일치시킬 것.
  AD: { REWARD: 500_000, DAILY_LIMIT: 5 },
  TAX_RATE: 0.05,
  PURCHASE_PRICE_INCREASE: 0.10,
  SALE_PRICE_DECREASE: 0.15,
  BANK_SALE_RATIO: 0.70,
  PLAYER_SALE_TAX: 0.10,
  INCOME_DIVISOR: 50,
  PRICE_FLUCTUATION_RANGE: 0.05,
  PRICE_FLUCTUATION_INTERVAL_HOURS: 6,
  // ↑ Main economy knob. income/hour = price ÷ INCOME_DIVISOR × (1 − tax).
  // Payback ≈ INCOME_DIVISOR/0.95 hours ≈ 2.2 days at 50. Lower = faster growth.
  // (Was 1000 → property income was negligible; property is now the main income.)
  LEVEL_FACTORS: {
    country: 5_000_000,
    province: 500_000,
    district: 80_000,
    building: 100_000,
  },
  // Individual building/apartment pricing (computed from footprint × floors)
  BUILDING: {
    PRICE_PER_M2_FLOOR: 300, // ₩ per square-meter per floor
    MIN_PRICE: 50_000,
    FLOOR_HEIGHT: 3.2, // meters per floor, to derive floor count from height
    HOUSE_MAX_FLOORS: 4, // ≤ this = a "house", bought whole; taller = sold by floor
  },
  // Location & travel: you can only buy near your current location; moving costs
  // money and time. Connecting (경유) flights are cheaper but slower.
  TRAVEL: {
    BUY_RADIUS_KM: 100,      // how close you must be to buy a territory/building
    BASE_FARE: 30_000,       // flat fare component
    PER_KM: 120,             // ₩ per km (direct)
    CONNECT_DISCOUNT: 0.55,  // connecting fare multiplier (cheaper)
    CONNECT_MIN_KM: 1500,    // only offer connecting for trips longer than this
    SEC_PER_KM: 0.2,         // travel time ≈ distance×this, so ~18,000km ≈ 1h
    MIN_SEC: 20,
    DIRECT_MAX_SEC: 3600,    // cap ≈ 1 hour for the longest flights
    CONNECT_MAX_SEC: 3600,
    CONNECT_TIME_FACTOR: 1.6,
    // Train: short/medium trips only, cheaper than flying but a bit slower.
    TRAIN: {
      MAX_KM: 1200,
      BASE_FARE: 10_000,
      PER_KM: 60,
      SEC_PER_KM: 0.28,
      MAX_SEC: 2400,
    },
  },
  SIGNIFICANCE: {
    CAPITAL: 10,
    MAJOR_CITY: 8,
    CITY: 5,
    TOWN: 3,
    RURAL: 1,
  },
};

// Premium districts — a building's price is multiplied when its footprint falls
// within a zone (highest matching multiplier wins; elsewhere ×1). Rough circles
// by center + radius, tunable. Add/adjust freely.
export const PREMIUM_ZONES = [
  // ── Korea ──
  { name: '강남',      lng: 127.0276, lat: 37.4979, radiusKm: 3.5, multiplier: 4 },
  { name: '서울 도심', lng: 126.9784, lat: 37.5665, radiusKm: 3,   multiplier: 3 },
  { name: '여의도',    lng: 126.9245, lat: 37.5215, radiusKm: 2,   multiplier: 3 },
  { name: '해운대',    lng: 129.1603, lat: 35.1631, radiusKm: 2.5, multiplier: 2.5 },
  // ── World ──
  { name: '맨해튼',     lng: -73.9712, lat: 40.7831, radiusKm: 6, multiplier: 5 },
  { name: '도쿄 도심',  lng: 139.7616, lat: 35.6812, radiusKm: 5, multiplier: 4 },
  { name: '런던 시티',  lng: -0.1246,  lat: 51.5074, radiusKm: 4, multiplier: 4 },
  { name: '파리 도심',  lng: 2.3522,   lat: 48.8566, radiusKm: 4, multiplier: 3 },
];
