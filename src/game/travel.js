/**
 * Travel logic: curated major airports + fare/duration estimation.
 * You move between regions by flying; direct flights are fast & pricey, while
 * connecting (경유) flights route through a hub — cheaper but slower.
 */
import { GAME_CONFIG } from '../config.js';

// Major airports (name, IATA, lng, lat). `hub` marks big connecting hubs.
export const AIRPORTS = [
  { iata: 'ICN', name: '인천',          lng: 126.4407, lat: 37.4602, hub: true },
  { iata: 'GMP', name: '김포',          lng: 126.7906, lat: 37.5583 },
  { iata: 'PUS', name: '부산',          lng: 128.9389, lat: 35.1795 },
  { iata: 'CJU', name: '제주',          lng: 126.4928, lat: 33.5113 },
  { iata: 'HND', name: '도쿄',          lng: 139.7798, lat: 35.5494, hub: true },
  { iata: 'KIX', name: '오사카',        lng: 135.2381, lat: 34.4273 },
  { iata: 'PEK', name: '베이징',        lng: 116.5970, lat: 40.0799, hub: true },
  { iata: 'PVG', name: '상하이',        lng: 121.8053, lat: 31.1443, hub: true },
  { iata: 'HKG', name: '홍콩',          lng: 113.9185, lat: 22.3080, hub: true },
  { iata: 'TPE', name: '타이베이',      lng: 121.2342, lat: 25.0777 },
  { iata: 'SIN', name: '싱가포르',      lng: 103.9915, lat:  1.3644, hub: true },
  { iata: 'BKK', name: '방콕',          lng: 100.7501, lat: 13.6900, hub: true },
  { iata: 'KUL', name: '쿠알라룸푸르',  lng: 101.7099, lat:  2.7456 },
  { iata: 'DEL', name: '델리',          lng:  77.1031, lat: 28.5562, hub: true },
  { iata: 'BOM', name: '뭄바이',        lng:  72.8679, lat: 19.0896 },
  { iata: 'DXB', name: '두바이',        lng:  55.3644, lat: 25.2532, hub: true },
  { iata: 'DOH', name: '도하',          lng:  51.6138, lat: 25.2731, hub: true },
  { iata: 'IST', name: '이스탄불',      lng:  28.7519, lat: 41.2753, hub: true },
  { iata: 'SVO', name: '모스크바',      lng:  37.4146, lat: 55.9726 },
  { iata: 'LHR', name: '런던',          lng:  -0.4543, lat: 51.4700, hub: true },
  { iata: 'CDG', name: '파리',          lng:   2.5479, lat: 49.0097, hub: true },
  { iata: 'FRA', name: '프랑크푸르트',  lng:   8.5622, lat: 50.0379, hub: true },
  { iata: 'AMS', name: '암스테르담',    lng:   4.7639, lat: 52.3105, hub: true },
  { iata: 'MAD', name: '마드리드',      lng:  -3.5668, lat: 40.4983 },
  { iata: 'FCO', name: '로마',          lng:  12.2389, lat: 41.8003 },
  { iata: 'JFK', name: '뉴욕',          lng: -73.7781, lat: 40.6413, hub: true },
  { iata: 'LAX', name: '로스앤젤레스',  lng: -118.4085, lat: 33.9416, hub: true },
  { iata: 'SFO', name: '샌프란시스코',  lng: -122.3790, lat: 37.6213 },
  { iata: 'ORD', name: '시카고',        lng:  -87.9048, lat: 41.9742, hub: true },
  { iata: 'ATL', name: '애틀랜타',      lng:  -84.4277, lat: 33.6407, hub: true },
  { iata: 'DFW', name: '댈러스',        lng:  -97.0380, lat: 32.8998 },
  { iata: 'YYZ', name: '토론토',        lng:  -79.6306, lat: 43.6777 },
  { iata: 'GRU', name: '상파울루',      lng:  -46.4731, lat: -23.4356, hub: true },
  { iata: 'MEX', name: '멕시코시티',    lng:  -99.0721, lat:  19.4361 },
  { iata: 'SYD', name: '시드니',        lng:  151.1772, lat: -33.9461, hub: true },
  { iata: 'MEL', name: '멜버른',        lng:  144.8410, lat: -37.6690 },
  { iata: 'JNB', name: '요하네스버그',  lng:   28.2460, lat: -26.1392, hub: true },
  { iata: 'CAI', name: '카이로',        lng:   31.4056, lat:  30.1219 },
];

export function distanceKm(aLng, aLat, bLng, bLat) {
  const R = 6371;
  const dLat = (bLat - aLat) * Math.PI / 180;
  const dLng = (bLng - aLng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function nearestAirport(lng, lat, exclude = []) {
  let best = null, bestD = Infinity;
  for (const a of AIRPORTS) {
    if (exclude.includes(a.iata)) continue;
    const d = distanceKm(lng, lat, a.lng, a.lat);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

function nearestHub(lng, lat, exclude = []) {
  let best = null, bestD = Infinity;
  for (const a of AIRPORTS) {
    if (!a.hub || exclude.includes(a.iata)) continue;
    const d = distanceKm(lng, lat, a.lng, a.lat);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best;
}

const clamp = (lo, hi, v) => Math.max(lo, Math.min(hi, v));

/**
 * Travel options from one point to another.
 * Returns nearest airports, distance, and a `direct` (+ optional `connecting`) quote.
 */
export function travelOptions(fromLng, fromLat, toLng, toLat) {
  const T = GAME_CONFIG.TRAVEL;
  const from = nearestAirport(fromLng, fromLat);
  const to = nearestAirport(toLng, toLat, [from.iata]);
  const dist = distanceKm(from.lng, from.lat, to.lng, to.lat);
  const groundDist = distanceKm(fromLng, fromLat, toLng, toLat); // door-to-door (train)

  const direct = {
    fare: Math.round(T.BASE_FARE + dist * T.PER_KM),
    durationSec: Math.round(clamp(T.MIN_SEC, T.DIRECT_MAX_SEC, dist * T.SEC_PER_KM + T.MIN_SEC)),
  };

  // Train: available only for shorter trips; cheaper, a bit slower than flying.
  let train = null;
  if (groundDist <= T.TRAIN.MAX_KM) {
    train = {
      fare: Math.round(T.TRAIN.BASE_FARE + groundDist * T.TRAIN.PER_KM),
      durationSec: Math.round(clamp(T.MIN_SEC, T.TRAIN.MAX_SEC, groundDist * T.TRAIN.SEC_PER_KM + T.MIN_SEC)),
    };
  }

  let connecting = null;
  if (dist >= T.CONNECT_MIN_KM) {
    const mid = nearestHub((from.lng + to.lng) / 2, (from.lat + to.lat) / 2, [from.iata, to.iata]);
    if (mid) {
      const viaDist = distanceKm(from.lng, from.lat, mid.lng, mid.lat) +
        distanceKm(mid.lng, mid.lat, to.lng, to.lat);
      connecting = {
        via: mid,
        fare: Math.round((T.BASE_FARE + viaDist * T.PER_KM) * T.CONNECT_DISCOUNT),
        durationSec: Math.round(clamp(T.MIN_SEC, T.CONNECT_MAX_SEC, viaDist * T.SEC_PER_KM * T.CONNECT_TIME_FACTOR + T.MIN_SEC)),
      };
    }
  }

  return { from, to, distanceKm: Math.round(dist), groundKm: Math.round(groundDist), direct, connecting, train };
}
