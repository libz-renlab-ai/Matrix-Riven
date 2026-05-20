# Matrix·Riven Pitch Site

Static one-page pitch site for VC + leadership audiences. 10-section narrative covering the problem, the product, the LLM narrative engine, the 16 signal detectors, the data flow, security/PII, the moat, hard numbers, and the roadmap.

## Tech

- Pure static HTML / CSS / JSX (no build step).
- React 18 UMD + Babel standalone compile JSX in the browser.
- Fonts: Newsreader (serif H1) + Inter + JetBrains Mono — loaded from Google Fonts.

## Local preview

```bash
npx serve landing
```

then open http://localhost:3000.

## Deploy

Zero-config Vercel static deploy. From this directory:

```bash
npx vercel deploy --prod
```

The `index.html` at the root is the entry; everything else (`styles.css`, `app.jsx`, `components/*`) is loaded by relative `<script>` / `<link>` tags.

## File map

- `index.html` — entry; pulls in React UMD + Babel + every component file.
- `styles.css` — design system (warm paper + sage green + Newsreader serif).
- `app.jsx` — `<App>` shell, sticky nav with scroll-spy, slide-over state.
- `components/`
  - `demo-data.js` — synthetic demo data shared across sections.
  - `helpers.js` — small util helpers.
  - `dashboard.jsx` — embedded v7 Spatial dashboard mock (used in the Product section).
  - `pitch-1-hero.jsx` — Hero + Problem + Product sections.
  - `pitch-2-narrative.jsx` — LLM narrative T1-T5 + 16 signal detectors.
  - `pitch-3-engine.jsx` — Data flow + Safety/PII demo.
  - `pitch-4-close.jsx` — Moat + Numbers + Roadmap + CTA + Slideover.
