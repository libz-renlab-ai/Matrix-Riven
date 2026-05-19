/**
 * 2026-05-19 QA round-5 legal P0 — in-product consent surface.
 *
 * The /sources page is candid about what gets retained ("prompt 内容会被
 * leadership 看到") but until now there was no in-product acknowledgment
 * surface — the only place a leader could see it was a secondary page
 * the engineer might never visit. Privacy counsel rated this NO-GO in
 * US-no-policy and EU jurisdictions.
 *
 * This module renders a fixed-bottom banner that:
 *   - explains in plain Chinese what is captured and who sees it
 *   - links to /sources for the full disclosure
 *   - has an "I have read and acknowledged" button that writes a
 *     localStorage record and dismisses the banner
 *   - has a "查看完整说明" link that opens /sources
 *
 * This is NOT GDPR-grade consent (which must be freely given, informed,
 * specific, and unambiguous, AND backed by a server-side record). It is
 * the minimum in-product surface so that a deploying operator can point
 * an engineer at the actual product as proof of disclosure. The legal
 * counsel's full "Must-add before deploy" list (DPIA, ROPA, controller/
 * processor split, per-engineer signed consent stored server-side,
 * jurisdiction filter, etc.) is a v2 feature.
 *
 * Cookie-vs-localStorage: localStorage is per-origin per-browser, so a
 * leader who clears site data sees the banner again. Acceptable for v1.
 *
 * Banner does NOT render when `?demo=1` is set, because demo mode is
 * the marketing surface — the prompts there are editorial fixtures, not
 * real engineer text, and adding a consent gate to a sales demo would
 * be both confusing (consent to what, the fixtures?) and counter to the
 * product's onboarding flow. The /sources page is still linked from
 * landing so a prospect can read the disclosure.
 *
 * 2026-05-19 QA-6: round-5 originally excluded /landing and /sources too
 * (rationale: "they're the marketing + transparency surface, not the
 * authenticated work UI"). Round-6 daily-driver flagged this as inverted —
 * a CTO walking up to /sources first should see the same gate as an
 * authenticated user. So /landing and /sources now opt in via
 * `renderConsentBanner({ demo: false })` at the bottom of their bodies.
 * The "demo-suppressed" rule remains intact: ?demo=1 still hides the
 * banner everywhere it appears.
 */

export const CONSENT_BANNER_CSS = `
.consent-scrim {
  position: fixed;
  inset: 0;
  background: rgba(20, 24, 36, 0.32);
  z-index: 9998;
  display: none;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.consent-scrim.show { display: block; }
.consent-banner {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  background: var(--surface, #fff);
  border-top: 2px solid #C8924B;
  box-shadow: 0 -8px 24px rgba(0,0,0,0.08);
  padding: 16px 24px;
  z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-1, #222);
  display: none;
}
.consent-banner.show { display: block; }
.consent-banner-body {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  align-items: center;
}
.consent-banner-title {
  font-family: 'Newsreader', serif;
  font-size: 15px;
  font-weight: 500;
  color: var(--ink-1, #222);
  margin: 0 0 4px;
}
.consent-banner-copy { color: var(--ink-2, #555); max-width: 760px; }
.consent-banner-copy strong { color: var(--ink-1, #222); font-weight: 500; }
.consent-banner-copy a { color: #5a6d4a; border-bottom: 1px solid #b8c3a9; text-decoration: none; }
.consent-banner-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.consent-banner-btn {
  font: inherit;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--hairline, #ddd);
  background: var(--surface, #fff);
  color: var(--ink-1, #222);
  cursor: pointer;
  white-space: nowrap;
}
.consent-banner-btn-primary {
  background: #5a6d4a;
  color: #fff;
  border-color: #5a6d4a;
}
.consent-banner-btn:hover { filter: brightness(0.97); }
@media (max-width: 720px) {
  .consent-banner-body { grid-template-columns: 1fr; }
}
`;

/**
 * Server-rendered HTML. The banner is hidden by default; the client
 * script shows it iff localStorage has no acknowledgment record. Order
 * of operations matters: HTML must render before the script runs, so
 * we never flash the banner to a leader who already acknowledged.
 */
export function renderConsentBanner(opts: { demo: boolean }): string {
  if (opts.demo) return '';
  return `
<div class="consent-scrim" id="consent-scrim" aria-hidden="true"></div>
<div class="consent-banner" id="consent-banner" role="dialog" aria-modal="true" aria-labelledby="consent-banner-title" aria-describedby="consent-banner-copy">
  <div class="consent-banner-body">
    <div>
      <div class="consent-banner-title" id="consent-banner-title">这台 Matrix·Riven 会读哪些东西，请告知你的团队后再继续</div>
      <div class="consent-banner-copy" id="consent-banner-copy">
        这套看板从每位工程师的 Claude Code transcript 摄入数据，<strong>包括 prompt 正文、Bash 命令文本、文件路径、活动时间戳</strong>。Leadership 在 <code>/people/&lt;成员&gt;</code> 等页面能看到这些原文。
        如果你的组织没有事先告知团队这件事，请先停下来 —— 这不是一个 "默默运行" 的工具。<a href="/sources" target="_blank">查看完整数据来源说明 →</a>
      </div>
    </div>
    <div class="consent-banner-actions">
      <button type="button" class="consent-banner-btn" onclick="window.open('/sources','_blank')">查看完整说明</button>
      <button type="button" class="consent-banner-btn" id="consent-banner-later" title="本次会话稍后再决定">稍后再说</button>
      <button type="button" class="consent-banner-btn consent-banner-btn-primary" id="consent-banner-ack">我已告知团队 · 继续</button>
    </div>
  </div>
</div>`;
}

/**
 * Client-side script — show the banner when no ack record, persist on
 * ack click. Keep this trivially small so it can run inline without a
 * build step. Read by every nav-bearing renderer via a single <script>
 * include alongside CLIENT_REFRESH_SCRIPT.
 */
export const CONSENT_BANNER_SCRIPT = `
(function () {
  var KEY = 'riven.consent.v1';
  function showBanner(banner, scrim) {
    banner.classList.add('show');
    if (scrim) scrim.classList.add('show');
    // Round-7 P2 / autonomous: while consent is pending, keep the body
    // from scrolling so the banner stays anchored in view. The scrim
    // already blocks click-through via z-index, and aria-modal flags the
    // dialog role to AT.
    try { document.body.style.overflow = 'hidden'; } catch (e) {}
  }
  function dismiss(banner, scrim) {
    banner.classList.remove('show');
    if (scrim) scrim.classList.remove('show');
    try { document.body.style.overflow = ''; } catch (e) {}
  }
  function init() {
    var banner = document.getElementById('consent-banner');
    var scrim = document.getElementById('consent-scrim');
    if (!banner) return;
    try {
      if (localStorage.getItem(KEY)) return;
    } catch (e) { /* private mode / blocked storage: show banner each visit */ }
    showBanner(banner, scrim);
    var btn = document.getElementById('consent-banner-ack');
    if (btn) {
      btn.addEventListener('click', function () {
        try {
          localStorage.setItem(KEY, JSON.stringify({
            ts: new Date().toISOString(),
            ua: (navigator && navigator.userAgent) ? navigator.userAgent.slice(0, 200) : '',
          }));
        } catch (e) { /* swallow — UX dismiss anyway, even if storage failed */ }
        dismiss(banner, scrim);
      });
    }
    // Round-1 QA P0 (journalist): consent banner used to only have "我已告知 ·
    // 继续" — a dark-pattern single path that screen-reads as forced acceptance.
    // Add a "稍后再说" escape: dismisses for the current session only (no
    // localStorage write), so the banner reappears on next page load until
    // the viewer makes an explicit decision.
    var later = document.getElementById('consent-banner-later');
    if (later) {
      later.addEventListener('click', function () { dismiss(banner, scrim); });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
`;
