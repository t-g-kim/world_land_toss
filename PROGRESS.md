# someday — 진행 상황 & 할 일

> 전 세계 실제 지도에서 **국가 → 시도/주 → 시군구 → 건물**까지 사고파는 부동산/땅따먹기 게임.
> 컨셉: 현실에선 이루기 힘든 "내 집·건물 마련"의 꿈을 게임으로. (브랜드명 **someday**, 도메인 `someday.land` 예정)
>
> _마지막 업데이트: 2026-08-22_
>
> **현재 상태**: **앱인토스(게임 카테고리) 포팅 완료** — 토스 사용자 식별키 자동 로그인, 토스 인앱 광고(보상형), 쿠팡/자체 광고 제거. 서버 권위 마켓, 층별 매매, 위치·이동, 목표·리더보드 동작. (콘솔 앱 등록 + QR 테스트 전)

## 기술 스택
- **프런트**: Vite + Vanilla JS, Mapbox GL JS v3 (globe), Chart.js
- **백엔드**: Supabase (Auth + Postgres/PostGIS) — *현재 클라이언트는 정적 GeoJSON + game_state 블롭만 사용*
- **데이터**: geoBoundaries(ADM0/1/2), Mapbox Streets(건물)
- **실행**: `npm run dev` → http://localhost:3000 · `npm run build`

---

## ✅ 완료한 것

### 1. 인증 / 로그인 (코드 완료)
- Google OAuth via Supabase Auth. 핵심 파일: `src/lib/supabase.js`(미설정 시 null-safe → 안 죽음), `src/ui/auth.js`(Google 로그인 + 게스트 + `getSession`/`signOut`/`displayName`), `src/main.js`(auth 게이트 + 👤 계정/로그아웃 버튼).
- **게스트 모드**: 로그인 화면 "게스트로 바로 플레이" → Supabase 없이 즉시 플레이(임시 우회). 나중에 `auth.js` `showLogin()`의 `#guest-start` 버튼만 지우면 로그인 필수.
- DB 설정 SQL: `supabase/setup-auth.sql` (profiles + 트리거 + RLS + game_state, 한 방에 실행).

### 2. 게임 상태 저장 → Supabase
- 로그인 유저: `profiles.game_state` JSONB에 저장 (마이그레이션 `011_add_game_state.sql`).
- 게스트: `localStorage`(키 `someday_game`) 폴백. `src/game/game-state.js`가 `userId` 유무로 분기.

### 3. 3D 건물 + 구매 (`src/map/building-layer.js`)
- 줌 15+에서 Mapbox `composite`/`building`을 `fill-extrusion`으로 3D 렌더, 진입 시 카메라 55° 틸트.
- 건물 클릭 → 구매(기존 패널 재사용). 소유 건물은 금색(자체 GeoJSON 소스, 새로고침에도 유지, geometry는 game_state에 저장).
- 호버 시 하이라이트 + 가격 툴팁(`🏢 건물 · N층 / ₩가격`).
- **프리미엄 지역 배수**(`PREMIUM_ZONES` in `config.js`): 강남 ×4, 맨해튼 ×5, 도쿄/런던 ×4 등 — 비싼 동네는 비싸게.

### 4. 시군구(ADM2) 레벨 (`main.js` + `territory-layers.js`)
- 줌 4단계: 국가(0–4) → 시도/주(4–7) → **시군구(7–15)** → 건물(15+).
- 데이터: `data/raw/.../ADM2.geojson`(49k) → mapshaper로 단순화·국가별 분할 → `public/data/districts/<ISO3>.json`(218개).
- **on-demand 로딩**: 화면에 보이는 국가의 파일만 fetch(`loadDistrictsInView`, moveend 디바운스). province 머신(컬러링·호버·클릭구매) 재사용.

### 5. 접근성/온보딩 (`src/ui/place-nav.js`)
- 상단 **도시 바로가기 칩**(서울/부산/도쿄/뉴욕/런던/파리) + **📍 내 위치**(geolocation) + **장소 검색**(Mapbox geocoding).
- 신규 유저는 캐릭터 선택 후 **서울로 자동 비행**. 온보딩 힌트(건물 줌 도달 시 자동 숨김). 더블클릭 줌 +3 가속.

### 6. 브랜딩
- 프로젝트명 "World Land" → **someday** 전면 교체(package.json, index.html, UI, config.toml 등).
- 도메인 `someday.land` 선정(미등록·정상가 ~₩3만/년). **아직 구매 안 함**.

---

### 7. 구글 로그인 — ✅ 실제 동작 확인 (2026-06-29)
- 호스티드 Supabase 프로젝트(`eikctmmdgosdjlwhkteq`) 연결, `.env` 설정 완료.
- `setup-auth.sql` 실행 + 트리거 `search_path` 버그 수정 → 로그인 시 profiles 행 자동 생성 확인.

### 8. 닉네임 (직업/캐릭터 대체)
- 첫 화면을 **닉네임 입력**으로 교체(`src/ui/nickname-setup.js`). 검증: 영문·숫자·특수문자, 2~30자, 공백·한글 불가.
- 직업(캐릭터) 시스템 제거 — 보너스는 기본값(1배). 닉네임은 `game_state.nickname` + 로그인 시 `profiles.username`에 저장.
- XSS 방지: 닉네임 렌더 시 `escapeHtml`(`src/lib/escape.js`) — 리더보드/대시보드/환영.

### 9. 아이들 수익 + 시작 시드 (2026-06-29)
- **오프라인 수익**: 자리 비운 동안 (자동클릭 + 영토수입)을 재접속 시 정산(최대 8h), "다녀온 사이 +₩X" 토스트. `lastSeen` 타임스탬프 기반.
- **시작 시드**: 신규 플레이어 ₩50,000(`STARTING_BALANCE`)로 시작 → 첫 건물 즉시 구매 가능.

### 10. 위치 기반 이동 비용 (2026-06-29)
- 시작 시 **홈(현재 위치) 직접 선택**(`src/ui/home-select.js`). 구매는 **내 위치 반경 100km 안에서만** 가능(`canBuyAt`).
- 멀리 사려면 패널에서 **항공 이동**: **직항**(빠름·비쌈) vs **경유**(허브 경유, 쌈·느림). 거리 비례 요금 + 이동 시간(카운트다운). 공항 데이터 `src/game/travel.js`.
- 이동 중엔 구매 잠금, 도착 시 위치 갱신·토스트. 상단바에 위치/이동 상태 표시(`src/ui/travel-status.js`). 설정값: `GAME_CONFIG.TRAVEL`.

### 11. 층별 매매 + 소유 표시
- 5층↑ 빌딩은 **층별 매매**(패널 층 리스트, 구매/판매 컨펌), 집(≤4층)·영토는 통 구매. 층 id `건물id#fN`.
- 내가 산 **층만 금색 띠**로 표시(그 높이 구간 돌출 밴드). `building-layer.js`.

### 12. 쿠팡 파트너스 광고 (건물에 노출)
- 시크릿키는 **Supabase Edge Function**(`coupang-products`)에 보관, HMAC 서명. 클라는 `src/map/coupang-ads.js`.
- **고층=벽면 광고**(월스케이프, matrix3d 코너핀·백페이스 컬링), **저층 넓은 건물=옥상 광고**(방향 맞춘 OBB). 이미지 CORS 없어 HTML `<img>`+CSS로 3D 부착.

### 13. 수익화: 일일 클리커 + 돈벌기(보상형 광고)
- 클릭 하루 400회 한도(현 ₩10,000/클릭), 광고 시청 보상(₩500,000). 업그레이드/자동클릭 제거.
- **돈벌기 메뉴**(💵) — 광고 리스트, 하루 1회 시청. **관리자 페이지 `/admin.html`**(ADMIN_EMAIL만)에서 광고 등록. `supabase/setup-ads.sql`.
- ⚠️ AdSense≠보상형. 실제 보상형은 광고망 SDK 필요(현재 자리표시자).

### 14. 목표/미션 + 실유저 리더보드
- 목표 10종 + 게임머니 보상(`src/game/goals.js`, `src/ui/missions.js`), 🎯 뱃지.
- 리더보드는 **실제 플레이어**(순자산 = 잔액+자산가치) — NPC 제거.

### 15. 경제 밸런스
- `INCOME_DIVISOR` 50(부동산 회수 ~2.2일, 주 수입원). 클릭 ₩10,000·광고 ₩500,000(경제 스케일 맞춤).

### 16. 🌐 멀티플레이 마켓플레이스 (서버 권위, 로그인 필수)
- 돈·소유가 서버에 있음: `properties` 테이블 + RPC(`buy_property`/`sell_to_bank`/`list_property`/`unlist_property`/`collect_income`/`add_balance`). `supabase/setup-marketplace.sql`.
- **판매 등록 → 남이 구매**(돈 판매자에게 이체, 소유권 이전). 지도 색: **내것 금 / 타인 보라 / 매물 초록**. **🏷️ 마켓 사이드바**로 매물 브라우즈·구매.
- 클라: `src/game/market.js`(RPC 래퍼) + `src/game/world.js`(30s 월드 캐시) + `src/map/world-ownership.js`.

### 17. 🧩 앱인토스 포팅 (2026-08-22)
- **SDK**: `@apps-in-toss/web-framework` v3 설치, `apps-in-toss.config.ts`(appName `someday`, geolocation 권한), `npm run build` = `vite build && ait build` → `someday.ait` 생성(24MB, dist 88MB < 100MB 제한).
- **로그인 교체**: 구글 OAuth 제거(정책상 자사 로그인 금지). 게임 카테고리 전용 `getUserKeyForGame()` hash → Edge Function **`toss-login`** 이 결정적 (email, password)로 교환 → `signInWithPassword`. 기존 RLS/RPC(`auth.uid()`) 그대로 동작. **배포 필요**: `supabase functions deploy toss-login` + `supabase secrets set TOSS_LOGIN_SECRET=$(openssl rand -hex 32)`.
- **광고 정리(정책 준수)**: 쿠팡 파트너스 건물 광고(`coupang-ads.js`, `coupang-products` 함수) 및 링크형 광고 시스템(`/admin.html`, `admin.js`, ads 테이블) **삭제** — 토스 SDK 외 광고 호출은 IAA 정책 위반. 돈벌기(💵)는 **토스 보상형 광고**(`loadFullScreenAd`/`showFullScreenAd`, `userEarnedReward`에만 보상)로 교체. 서버 RPC `watch_toss_ad`(₩50만/회, 5회/일) — `supabase/setup-toss.sql` **실행 필요**.
- **위치**: 📍 내 위치가 토스 SDK `getCurrentLocation` 우선, 브라우저 폴백(`src/lib/toss.js`).
- **게스트 모드**: dev 전용으로 축소(프로덕션은 토스 자동 로그인만).
- **콘솔 진행 (2026-08-22)**: 워크스페이스 "오리의 개발"(82293)의 기존 미니앱 **"건물주"(miniAppId 67347, appName `landmark`, 게임)** 재사용 — config appName을 `landmark`로 변경. 첫 번들 `20260822-1`(deploymentId 01a02826-9eb1-7076-95df-63572fa2e78f, SDK 3.0.5) 업로드·빌드·테스트푸시 완료(isTested).
  - 테스트 딥링크: `intoss-private://landmark?_deploymentId=01a02826-9eb1-7076-95df-63572fa2e78f&host=appsInTossHost`
  - 로고 600x600: https://static.toss.im/appsintoss/82293/e129b99c-480c-4e32-b824-733fdd12aa09.png · 가로 썸네일 1932x828: https://static.toss.im/appsintoss/82293/14ed7733-eb89-40eb-acf5-40d76be0689d.png (앱정보 등록 시 재사용)
- ⚠️ **남은 일**:
  - ① **Supabase 서버 (로그인 동작에 필수)**: `supabase functions deploy toss-login` + `supabase secrets set TOSS_LOGIN_SECRET=$(openssl rand -hex 32)` + SQL Editor에서 `setup-toss.sql` 실행. 이거 전까지 QR 테스트에서 로그인 실패 화면이 뜸.
  - **DB 분리 (2026-08-22)**: 웹 게임(world_land)과 **같은 Supabase 프로젝트**(eikctmmdgosdjlwhkteq)를 공유하되, 테이블·RPC를 전부 `_toss` 접미사로 분리 — `setup-toss.sql` 하나에 전체 스키마(profiles_toss, properties_toss, 친구/공동구매/알림 _toss, RPC 17개) 포함. 토스 유저(@toss.someday.land)는 웹 profiles에서 제외되도록 `handle_new_user`에 가드 추가, `handle_new_user_toss`가 profiles_toss 생성. 클라이언트는 전부 _toss 테이블/RPC 호출로 변경.
  - ② **게임 등급분류 (앱정보 승인·출시에 필수, 콘솔 웹에서만 가능)**: 게임위 등급분류증명서 PDF 또는 오픈마켓 출시 링크+자체등급분류 정보 필요. 신청 방법: https://toss.im/apps-in-toss/blog/game_rating_classification — 등급 없이는 앱정보 검토가 반려됨(miniapp_create 시도 시 "스토어 링크 또는 게임물 등급분류증명서를 등록해주세요" 오류 확인).
  - ③ 앱정보(로고·설명·카테고리 게임>시뮬레이션) 등록 — 등급 정보 준비 후 위 이미지 URL로 재시도.
  - ④ 콘솔에서 보상형 광고 그룹 ID 발급 → `.env` `VITE_TOSS_REWARDED_AD_GROUP_ID` (현재 테스트 ID).
  - ⑤ districts 86MB CDN 이전(dist 88MB, 100MB 제한 임박).

---

## 🔜 개선 백로그 (우선순위 순)

### 🔴 곧 고쳐야 (보안/치명 — 오픈 전 필수)
- [x] **가격·보상 서버 검증** ⭐ — `supabase/setup-security.sql`: 보상은 서버 RPC(`click_reward` 일일캡, `watch_ad` ad_claims 1일1회, `claim_goal` 서버 조건검증, `spend` 여행)로 교체하고 `add_balance` 제거(민팅 차단). `buy_property`는 면적(PostGIS ST_Area)×₩50 + 종류별 최소가로 헐값 구매 차단. *(가격은 정확 공식이 아닌 하한선 — 필요시 서버 정확 계산으로 강화)*
- [x] **월드 동기화 확장성** ⭐ — `supabase/setup-realtime.sql`: center 좌표 컬럼+트리거, `properties` realtime 발행, `get_leaderboard` 집계 RPC. `world.js`가 **뷰포트 bbox 쿼리**(지도 색칠) + **판매중만 조회**(마켓) + **Supabase Realtime 구독**(즉시 반영, 폴링 제거). 리더보드는 서버 RPC.

### 🎮 재미 / 참여
- [x] **실시간 알림** — 내 매물 판매(서버 트리거+notifications) + 근처 거래 앰비언트. 🔔 벨. `setup-notifications.sql`, `src/ui/notifications.js`.
- [x] **친구 + 공동구매** — 닉네임 친구 추가/수락(👥), 돈 모아 공동구매(제안→각자 결제→체결), 낸 만큼 지분·수익 분배. `setup-friends.sql`, `src/ui/friends.js`. (공동소유 매각은 미구현)
- [ ] **후발주자 장치** ⭐ — 누진세 + 신규 부스트 + 다차원 랭킹(이번주 급상승/지역 최다). 늦게 와도 상위 가능.
- [ ] **데일리 미션·출석 연속** (현 미션은 일회성).
- [ ] **길드/동맹, 지역 점령전**.
- [ ] **자랑 공유 카드**("나 강남 건물주") → 바이럴.

### 💰 경제 깊이
- [ ] **수입 차등화** — 시군구 균일가(~₩66만) → 인구/프리미엄 기반. (`estimatePrice` 개선)
- [ ] **시세 변동** — 수요 기반 가격 등락.
- [ ] **경매/입찰**, **건물 업그레이드**(돈 싱크), **세금/유지비**(인플레 억제).

### 🗺️ 콘텐츠
- [ ] **랜덤 이벤트** — `game_events`/`trigger-event` 활용(급변/보너스/세금).
- [ ] **동(ADM3)** — 한국 행정동(행안부/SGIS 별도 데이터).
- [ ] **컬렉션/업적**(랜드마크·대륙별), 캐릭터/특전 재도입(선택).

### ✨ UX 폴리시
- [x] **온보딩 튜토리얼** — 5스텝 가이드(`src/ui/tutorial.js`), 신규/최초 1회.
- [x] **포트폴리오 화면** — 내 자산 목록·클릭 시 이동(좌표/영토)·총가치/시간당수입 요약.
- [x] **마켓 검색/필터** — 이름 검색 + 종류(건물/랜드마크/영토) + 가격 정렬 + 나라/지역 드릴다운.
- [x] **모바일 반응형** — `src/styles/responsive.css`(사이드바 풀폭, 패널 바텀시트, 칩 가로스크롤 등).

### 🚀 출시/운영
- [ ] **배포** — Vercel/Netlify → Supabase Redirect URLs에 배포 URL 추가. 출시 임박 시 `someday.land` 구입.
- [ ] **실제 광고망 연동**(보상형 SDK), 쿠팡 파트너스 승인.
- [ ] **번들/데이터 최적화** — districts 82MB·번들 1.9MB → 벡터타일(PMTiles)/코드분할. 시군구 뷰포트 밖 eviction.
- [ ] (선택) 폴더명 `world_land`→`someday`, 로고/태그라인 확정.

---

## 참고 파일
- DB 설정 SQL(순서대로 실행): `supabase/setup-auth.sql` → `setup-ads.sql` → `setup-marketplace.sql`
- 데이터 파이프라인: `data/scripts/`, 원본 `data/raw/geoboundaries/ADM*.geojson`, 분할본 `public/data/districts/`
- 환경변수 `.env`: Mapbox·Supabase(URL/anon) 채워짐. 쿠팡 키는 Supabase 시크릿(서버).
- 관리자: `/admin.html` (ADMIN_EMAIL 계정만)
