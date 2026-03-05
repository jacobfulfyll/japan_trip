# Japan Trip Planning Guide

Static HTML site for planning a 16-day Japan trip for 4 travelers (2 couples). Deployed via GitHub Pages.

## Trip Status

**Flights booked: June 16 - July 3, 2026 (in/out of Tokyo)**

The site currently shows 3 itinerary options. The booked dates align closest with Option 3 (Hokkaido Summer), though the actual dates differ slightly (Jun 16 vs Jun 19 start, Jul 3 vs Jul 4 end).

## Tech Stack

- Static HTML with embedded CSS (no JavaScript, no build step)
- GitHub Pages deployment

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Main (only) page — all content and styles inline |
| `deploy-pages.yml` | GitHub Actions workflow for Pages deployment |

## Commands

No build or test commands — open `index.html` in a browser to preview.

## Deployment

Pushes to `main` trigger automatic GitHub Pages deployment via `deploy-pages.yml`.
Repo: https://github.com/jacobfulfyll/japan_trip

## Architecture

Single-file architecture. All CSS is in a `<style>` block in the `<head>`. Content is organized into sections by trip option, each with overview, pros/cons, and budget breakdowns, followed by a comparison table.

## Conventions

- Semantic HTML sections with id anchors (`#option1`, `#option2`, `#option3`, `#comparison`)
- CSS classes use kebab-case (e.g., `trip-card`, `budget-grid`, `destination-tag`)
- Color themes per trip: spring pink (`#ff6b9d`), default purple (`#667eea`), summer teal (`#4ecdc4`)
- Responsive design via CSS Grid with `auto-fit` and media queries at 760px
- Mobile tab nav (< 760px): horizontal scroll strip with hidden scrollbar (`flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none`), active tab auto-scrolls into view via `scrollIntoView`
- Sound: `playSwish()` plays a synthesized swish via Web Audio API on tab switch (always on, no toggle)
