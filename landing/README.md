# Matrix·Riven Pitch Site

Static pitch site for VC + leadership audiences, with **中 / EN** language toggle.

- **`/` (index.html)** — VC 速览版. 5 compact sections: Hero (with live mini-dashboard) → 4 live product views (dashboard / pipeline / PII / repo) → 3 outcome case studies → 4 traction numbers → CTA. Scroll-progress bar, cursor blob, magnetic buttons, reveal stagger.
- **`/detail.html`** — 完整版 13 章 editorial pitch. Floating "← 返回简版" returns to `/`.
- **Top-right nav button toggles 中 / EN** — state persisted in `localStorage`. UI strings, embedded demo data (LLM rewrites, callouts), and the full essay content all re-render via `i18n.js`. Detail-page essay is translated via a MutationObserver + dictionary; technical paths, command samples, terminal logs, and demo people names stay original.

## Tech

- Pure static HTML / CSS / JSX (no build step).
- React 18 UMD + Babel standalone compile JSX in the browser.
- Fonts: Newsreader (serif) + Inter + JetBrains Mono — Google Fonts.

## Local preview

```bash
npx serve landing
```

## Deploy

```bash
npx vercel deploy --prod --cwd landing
```

## File map

- `index.html` / `detail.html` — entry pages.
- `i18n.js` — translation dictionary + `window.tr()` / `useLang()` hook + DOM auto-translator (loaded before any JSX).
- `vc.jsx` — VC 速览 self-contained `<App>`.
- `app.jsx` — 完整版 `<App>` shell with the 13-chapter pitch.
- `styles.css` — shared design system.
- `styles-vc.css` — VC-page additions.
- `components/`
  - `demo-data.js`, `helpers.js` — shared utilities (`helpers.js` exposes `useLang`).
  - `dashboard.jsx` — embedded v7 Spatial dashboard mock.
  - `pitch-a.jsx`, `pitch-b.jsx`, `pitch-c.jsx` — full-version section components.
