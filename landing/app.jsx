/* Pitch site shell — sticky frosted nav with scroll-spy + section mount. */

const { useState: aUseState, useEffect: aUseEffect } = React;

const SECTIONS = [
  { id: "hero",      label: "首页" },
  { id: "problem",   label: "问题" },
  { id: "product",   label: "产品" },
  { id: "narrative", label: "LLM 叙事" },
  { id: "signals",   label: "信号" },
  { id: "flow",      label: "数据流" },
  { id: "safety",    label: "安全" },
  { id: "moat",      label: "护城河" },
  { id: "numbers",   label: "数字" },
  { id: "roadmap",   label: "路线图" }
];

function App() {
  const [active, setActive] = aUseState("hero");
  const [so, setSo] = aUseState(null);

  // Scroll spy
  aUseEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) setActive(e.target.id);
      });
    }, { rootMargin: "-30% 0px -60% 0px" });
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  // Fade-up reveal
  aUseEffect(() => {
    const elems = document.querySelectorAll(".fade-up");
    if (!elems.length) return;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("is-visible"); });
    }, { threshold: 0.1 });
    elems.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  });

  const openSlideover = (kind, id) => setSo({ kind, id });
  const closeSlideover = () => setSo(null);

  return (
    <>
      <PitchNav active={active} />
      <PitchHero />
      <PitchProblem />
      <PitchProduct openSlideover={openSlideover} />
      <PitchNarrative />
      <PitchSignals />
      <PitchFlow />
      <PitchSafety />
      <PitchMoat />
      <PitchNumbers />
      <PitchRoadmap />
      <PitchCta />
      <Slideover so={so} onClose={closeSlideover} />
    </>
  );
}

function PitchNav({ active }) {
  const onClick = (id) => (e) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.offsetTop - 100, behavior: "smooth" });
  };
  return (
    <nav className="pitch-nav fade-in">
      <a href="#hero" onClick={onClick("hero")} className="pitch-brand">
        <div className="pitch-brand-mark"></div>
        <span>Matrix·Riven</span>
      </a>
      <div className="pitch-nav-links">
        {SECTIONS.slice(1).map(s => (
          <a key={s.id} href={"#" + s.id} className={active === s.id ? "active" : ""}
            onClick={onClick(s.id)}>{s.label}</a>
        ))}
      </div>
      <a className="nav-cta" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.31 1.23a11.5 11.5 0 016 0c2.3-1.55 3.31-1.23 3.31-1.23.66 1.65.25 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .5z"/></svg>
        GitHub
      </a>
    </nav>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<App />);
