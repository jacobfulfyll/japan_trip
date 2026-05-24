# Tasks

## Active Tasks

---

## Backlog

### Static Companion (v1 — ship before Jun 16)
- [ ] day-view-screen: Hype-photo hero + scroll-down practical plan, three lifecycle framings [P1] [complex] [tier: opus:high] [depends: data-model-and-scaffold] [conflicts: date-time-aware-navigation, trip-overview-home] [code] [planned]
  files: index.html (MOD), app.js (MOD)
- [ ] date-time-aware-navigation: Lifecycle framing, smart landing, forward/back nav, evening "Prep for tomorrow" button [P1] [complex] [tier: opus:high] [depends: data-model-and-scaffold, day-view-screen] [conflicts: day-view-screen, trip-overview-home] [code] [planned]
  files: app.js (MOD), index.html (MOD)
- [ ] trip-overview-home: Pre-trip home with countdown + tappable all-days index [P2] [moderate] [tier: opus:medium] [depends: data-model-and-scaffold] [conflicts: day-view-screen, date-time-aware-navigation] [code] [planned]
  files: index.html (MOD), app.js (MOD)
- [ ] offline-and-installable: Service worker + manifest, install to home screen, asset + photo caches [P2] [moderate] [tier: opus:medium] [depends: data-model-and-scaffold] [code] [planned]
  files: sw.js (NEW), manifest.json (NEW), index.html (MOD)
- [ ] time-travel-test-mode: Fake the clock (override `now`) + a test page to verify time-of-day behavior on a phone [P2] [moderate] [tier: opus:medium] [depends: date-time-aware-navigation] [code] [planned]
  files: app.js (MOD), test.html (NEW), index.html (MOD)

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
