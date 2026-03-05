# Japan Trip Planning Guide

Static HTML site for planning a 16-day Japan trip for 4 travelers (2 couples). Deployed via GitHub Pages.

## Trip Status

**Flights booked: June 16 - July 3, 2026 (in/out of Tokyo)**

The site currently shows 3 itinerary options as a comparison guide. The booked dates align closest with Option 3 (Hokkaido Summer). Note: `index.html` still shows pre-booking dates (Jun 19 - Jul 4) that need updating to match actual flights (Jun 16 - Jul 3).

## Tech Stack

- Static HTML with embedded CSS (no JavaScript, no build step)
- GitHub Pages deployment
- System fonts only (`'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`)

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Main (only) page — all content and styles in one 843-line file |
| `deploy-pages.yml` | GitHub Actions workflow for Pages deployment |

## Commands

No build or test commands — open `index.html` in a browser to preview.

## Deployment

Pushes to `main` trigger automatic GitHub Pages deployment via `deploy-pages.yml`.
Repo: https://github.com/jacobfulfyll/japan_trip

Note: `deploy-pages.yml` lives at repo root (not `.github/workflows/`). The entire repo root is uploaded as the Pages artifact — all files are publicly served.

## Architecture

Single-file architecture. All CSS is in a `<style>` block in `<head>`. The HTML structure is:

```
<div class="container">        ← max-width 1200px wrapper
  <div class="hero">           ← gradient banner with title
  <div class="nav">            ← sticky anchor navigation
  <div class="content">        ← padding wrapper
    <section id="option1">     ← Trip 1: Cherry Blossom Classic (spring theme)
    <section id="option2">     ← Trip 2: Tohoku Frontier (default theme)
    <section id="option3">     ← Trip 3: Hokkaido Summer (summer theme)
    <section id="comparison">  ← Comparison table + decision guide
```

### Trip Card Structure (repeated per option)

Each trip section follows this exact template:
```
.trip-card[.spring|.summer]
  .trip-header > h2.trip-title + .dates
  .overview > destinations + info-boxes (dates, weather)
  .pros-cons > .pros (5 items) + .cons (5 items)
  .budget-grid > 3x .budget-card (Budget / Mid / Luxury)
  .info-box (key insight)
```

### Color Theme System

Themes cascade via modifier class on `.trip-card`:
- **Default (Option 2):** `#667eea` indigo / `#764ba2` purple
- **`.spring` (Option 1):** `#ff6b9d` pink / `#c44569` rose
- **`.summer` (Option 3):** `#4ecdc4` teal / `#44a08d` green-teal
- **Budget tiers:** Budget = default indigo, Mid = `#f39c12` amber, Luxury = `#9b59b6` violet

## Conventions

- CSS classes use kebab-case (`trip-card`, `budget-grid`, `destination-tag`)
- Section IDs: `#option1`, `#option2`, `#option3`, `#comparison`
- Layout: Flexbox for rows (nav, headers, tags), CSS Grid for 2D layouts (pros-cons, budgets, activities)
- Single responsive breakpoint at `760px`; budget/activity grids use `auto-fit/minmax` for automatic responsiveness
- Mobile tab nav (< 760px): horizontal scroll strip with hidden scrollbar (`flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none`), active tab auto-scrolls into view via `scrollIntoView`
- Sound: `playSwish()` plays a synthesized swish via Web Audio API on tab switch (always on, no toggle)
- Info-box variants use inline style overrides rather than modifier classes
- Hover effects: `translateY(-3px to -5px)` + shadow changes, all using `transition: all 0.3s`
- Pros/cons lists use `::before` pseudo-elements for check/cross markers
- Budget line items are `<p>` tags with `<strong>` labels (not structured data)

## Known Issues

- Option 3 dates in `index.html` show Jun 19 - Jul 4 but booked flights are Jun 16 - Jul 3 (appears in nav, dates badge, info-box, comparison table)
- Option 3 nav link uses cherry blossom emoji `🌸` instead of a summer-appropriate emoji
- `deploy-pages.yml` uses `@v1` for `upload-pages-artifact` and `deploy-pages` (current is `@v3`)
