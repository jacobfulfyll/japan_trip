# Tasks

## Active Tasks

### author-travel-arrival
**Task**: Author Days 1–2 (Jun 16 flight + Jun 17 Tokyo arrival), incl. the AC 5 Montréal→Tokyo flight; refactor the partial-trip tests
**Pipeline**: code-workflow
**Branch**: task/author-travel-arrival
**Worktree**: .worktree/author-travel-arrival
**Base**: main
**Started**: 2026-05-30
**Files**:
- MOD: data/days.js
- MOD: sw.js
- MOD: app.test.js

---

## Backlog

### Trip Content — Author Jun 16–23 (data/days.js)
<!-- Fills the unauthored Jun 16–23 leg (Days 1–8) to the existing Kyoto-day bar. All edit data/days.js + sw.js (CACHE_VERSION) + app.test.js, so they run serially in date order (depends chain). Research dossiers + verified facts live in each .pipeline/<slug>/task.md. -->
- [ ] author-tokyo-asakusa-ginza: Author Days 3–4 (Jun 18 Asakusa/Eastern Tokyo + Jun 19 teamLab/Tokyo Tower/Ginza, Faro booked) [P2] [moderate] [tier: opus:medium] [depends: author-travel-arrival] [code] [planned]
  files: data/days.js (MOD), sw.js (MOD), app.test.js (MOD)
- [ ] author-tokyo-nightlife-shibuya: Author Days 5–6 (Jun 20 Tsukiji/Golden Gai + Jun 21 Shinjuku/Shibuya, Amam Dacotan on Day 6) [P2] [moderate] [tier: opus:medium] [depends: author-tokyo-asakusa-ginza] [code] [planned]
  files: data/days.js (MOD), sw.js (MOD), app.test.js (MOD)
- [ ] author-hakone-leg: Author Days 7–8 (Jun 22 Tokyo→Hakone Romancecar + Jun 23 Hakone loop); close the gap, sync docs [P2] [moderate] [tier: opus:medium] [depends: author-tokyo-nightlife-shibuya] [code] [planned]
  files: data/days.js (MOD), sw.js (MOD), app.test.js (MOD), CLAUDE.md (MOD)
- [ ] add-jun24-checkout: Add an explicit 10am checkout item to the existing Jun 24 day [P3] [simple] [tier: sonnet:medium] [depends: author-hakone-leg] [code] [planned]
  files: data/days.js (MOD), sw.js (MOD)

### Firebase Photo Journal (v2 — after v1)
- [ ] firebase-project-setup: Console setup — project, Storage/Firestore/Auth, shared account, Blaze + budget [P2] [simple] [tier: sonnet:medium] [depends: data-model-and-scaffold] [manual] [planned]
  files: external (Firebase console)
- [ ] auth-password-gate: Password-only landing via one shared account, persistent sessions, auth-gated rules [P2] [moderate] [tier: opus:medium] [depends: firebase-project-setup] [conflicts: photo-upload-flow] [code] [planned]
  files: index.html (MOD), app.js (MOD)
- [ ] photo-upload-flow: One-tap photo sync (evening-window) → uploads everything since last sync, EXIF-bucketed by day, deduped [P2] [complex] [tier: opus:high] [depends: auth-password-gate, date-time-aware-navigation] [conflicts: auth-password-gate] [code] [planned]
  files: index.html (MOD), app.js (MOD)
- [ ] reminisce-photo-gallery: Reminisce shows all travelers' photos per day, live + offline-cached [P2] [moderate] [tier: opus:medium] [depends: photo-upload-flow, day-view-screen] [code] [planned]
  files: app.js (MOD), index.html (MOD), sw.js (MOD)

### Ungroomed
<!-- Real-world trip bookings & confirmations surfaced during grooming. Personal to-dos, not build tasks — to be tackled later. -->
- [ ] reserve-jun24-dinner: Reserve Tousuiro Kiyamachi for 8pm — riverside terrace + Megan's vegetarian ROKUHARA course (state: no fish/bonito/dashi)
- [ ] reserve-odawara-kyoto-shinkansen: Reserve Hikari seats Odawara→Kyoto (4 together; Hikari/Kodama only — not Nozomi)
- [ ] confirm-senkyoro-checkout: Confirm Senkyoro checkout time (ryokan typically 10–11am)
- [ ] confirm-hakone-free-pass: Confirm Hakone Free Pass covers Jun 24 (2-day vs 3-day) for the Senkyoro→Odawara bus
- [ ] reserve-jun26-tea-ceremony: Book Rie's Urasenke tea ceremony (byFood #760) — Jun 26, 15:30 slot, ~US$207 for 4 ($51.75pp)
- [ ] reserve-jun26-shigetsu-lunch: Reserve Shigetsu shojin ryori lunch at Tenryu-ji (Arashiyama) for 4 — Jun 26, lunch-only
- [ ] (optional) reserve-jun26-dinner-tenamonya: IF you want Teppan Tavern Tenamonya for Jun 26 dinner — reserve ~Jun 19 (1-week window, ~7 tables/night, sells out)
- [ ] (optional) reserve-jun27-dinner-gyuzen: IF you want Gion Gyuzen's private room for Jun 27 (Sat) dinner — reserve ahead
- [ ] usj-app-setup: Before the trip — all 4 install the USJ app + link your (already-purchased) passes for ride times + Super Nintendo World entry
- [ ] (optional) reserve-jun29-dinner-robin: IF you want Pontocho Robin for the final Kyoto night (Jun 29) — reserve ≥2 days ahead via concierge, incl. Megan's vegetarian course
- [ ] reserve-jun30-shinkansen: Reserve Shinkansen seats Kyoto→Tokyo for Jun 30 (~10:30 Nozomi, 4 people together, with luggage)
- [ ] reserve-jul2-couples-massage: Book the couples massage at SPA KIOI by Swiss Perfection (30F, Prince Gallery) for Jul 2 — phone/email, ahead
- [ ] reserve-jul3-narita-express: Reserve Narita Express (N'EX) seats Tokyo Station → Narita for Jul 3 (~1 PM, for the 5:35 PM flight)
- [ ] (optional) reserve-jul2-farewell-dinner: IF you want a special farewell dinner Jul 2 (Ningyocho Imahan or Sushi Fukunaga) — reserve ~2–4 weeks ahead
- [ ] sw-runtime-cache-cap: Add an eviction cap (count/age) to the service worker `runtime-v1` photo cache (discovered during offline-and-installable)
  > sw.js staleWhileRevalidate grows unbounded. Fine for the small Wikimedia hero set today, but a real device-storage concern once v2 adds user-uploaded photos. Revisit alongside reminisce-photo-gallery / photo-upload-flow.
- [ ] upgrade-deploy-pages-actions: Bump deploy-pages.yml `upload-pages-artifact` and `deploy-pages` from @v1 to @v3 (discovered during offline-and-installable; also in CLAUDE.md Known Issues)
  > @v1 actions are deprecated. Low-risk mechanical bump; verify a Pages deploy still succeeds after.
- [ ] register-visit-japan-web: Before Jun 16 — each of the 4 travelers registers their own Visit Japan Web account + QR (a single account with empty companions = paper-form lane); screenshot every QR before boarding (surfaced authoring author-travel-arrival)
- [ ] prebook-teamlab-borderless: Pre-book teamLab Borderless (Azabudai Hills) timed entry for Jun 19 — June slots open ~mid-April 2026; confirm June hours + the scattered closed-Tuesday calendar when teamLab publishes it (surfaced authoring author-tokyo-asakusa-ginza)
- [ ] reserve-tokyo-tower-top-deck: IF you want the Tokyo Tower Top Deck (250m) on Jun 19 — reserve a timed slot online (¥3,300 vs ¥3,500 at counter); Main Deck needs no booking
- [ ] buy-hakone-openair-tickets: Buy Hakone Open-Air Museum tickets online before Jun 23 (skip the ticket line; −¥100 with Free Pass)
- [ ] request-senkyoro-veg-kaiseki: Request Megan's vegetarian kaiseki at Senkyoro in advance for both nights (Jun 22 & 23) — no fish, no katsuobushi/bonito, no fish dashi; confirm dinner seating time + late-arrival cutoff
- [ ] confirm-faro-vegan-tasting: Confirm the Faro (Ginza) booking specifies Megan's vegan tasting menu for the Jun 19 dinner (1 of 4 covers)
- [ ] confirm-hakone-free-pass-jun22-23: Confirm the Hakone Free Pass (2-day vs 3-day) covers the Jun 22–23 legs — Tozan buses, cable car, ropeway, pirate cruise (Romancecar surcharge is separate, already paid)
