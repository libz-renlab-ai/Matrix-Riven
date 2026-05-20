# Matrix·Riven Pitch Site

Static pitch site for VC + leadership audiences. Two pages:

- **`/` (index.html)** — VC 速览版. 5 compact sections: Hero (with live mini-dashboard) → 4 product views → 3 outcome case studies → 4 traction numbers → CTA. Scroll-progress bar, cursor blob, magnetic buttons, reveal stagger.
- **`/detail.html`** — 完整版 13 章 editorial pitch. Hero → Manifesto → Problem → Insight → Product → T1-T5 narrative → 16 signals → Flow → The Pact (safety) → Moat → Numbers → Roadmap → CTA. Floating "← 返回简版" link returns to `/`.

## Tech

- Pure static HTML / CSS / JSX (no build step).
- React 18 UMD + Babel standalone compile JSX in the browser.
- Fonts: Newsreader (serif) + Inter + JetBrains Mono — Google Fonts.

## Local preview

```bash
npx serve landing
```

then open http://localhost:3000 (`/` for VC version, `/detail.html` for full).

## Deploy

Zero-config Vercel static deploy:

```bash
npx vercel deploy --prod --cwd landing
```

## File map

- `index.html` — VC 速览; pulls in `styles.css` + `styles-vc.css` + `demo-data.js` + `helpers.js` + `vc.jsx`.
- `detail.html` — 完整版; pulls in `styles.css` + `demo-data.js` + `helpers.js` + `dashboard.jsx` + `pitch-a/b/c.jsx` + `app.jsx`.
- `styles.css` — shared design system (warm paper + sage green + Newsreader serif).
- `styles-vc.css` — VC-page-only additions.
- `vc.jsx` — the VC 速览 `<App>` (self-contained, doesn't share with detail).
- `app.jsx` — the 完整版 `<App>` shell.
- `components/`
  - `demo-data.js`, `helpers.js` — shared utilities.
  - `dashboard.jsx` — embedded v7 Spatial dashboard mock.
  - `pitch-a.jsx`, `pitch-b.jsx`, `pitch-c.jsx` — full-version section components.
