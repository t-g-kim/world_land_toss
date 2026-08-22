/**
 * Iconic world landmarks — trophy assets priced far above ordinary buildings.
 * Detected by proximity in building-layer.js: clicking the building at a landmark
 * spot makes it that landmark (very expensive, whole-purchase). Also used as
 * exploration destinations (place-nav 명소 chips). No floating map pins.
 */
export const LANDMARKS = [
  { id: 'statue-liberty', name: '자유의 여신상',    icon: '🗽', lng: -74.0445, lat: 40.6892, price: 8_000_000_000 },
  { id: 'eiffel',         name: '에펠탑',           icon: '🗼', lng: 2.2945,  lat: 48.8584, price: 12_000_000_000 },
  { id: 'times-square',   name: '타임스스퀘어',     icon: '🎆', lng: -73.9855, lat: 40.7580, price: 10_000_000_000 },
  { id: 'colosseum',      name: '콜로세움',         icon: '🏛️', lng: 12.4922, lat: 41.8902, price: 9_000_000_000 },
  { id: 'burj-khalifa',   name: '부르즈 할리파',    icon: '🕌', lng: 55.2744, lat: 25.1972, price: 15_000_000_000 },
  { id: 'sydney-opera',   name: '시드니 오페라하우스', icon: '🎭', lng: 151.2153, lat: -33.8568, price: 11_000_000_000 },
  { id: 'big-ben',        name: '빅벤',             icon: '🕰️', lng: -0.1246, lat: 51.4994, price: 9_000_000_000 },
  { id: 'tokyo-tower',    name: '도쿄타워',         icon: '🗼', lng: 139.7454, lat: 35.6586, price: 7_000_000_000 },
  { id: 'namsan-tower',   name: '남산서울타워',     icon: '🗼', lng: 126.9883, lat: 37.5512, price: 5_000_000_000 },
];

export const landmarkPropId = (id) => `landmark:${id}`;
