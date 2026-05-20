/* Editorial pitch site app shell — sticky nav, scroll spy, slideover */

const { useState: aUseState, useEffect: aUseEffect, useRef: aUseRef } = React;

const SECTIONS = [
  { id: "hero",       label: "首页" },
  { id: "manifesto",  label: "Manifesto" },
  { id: "problem",    label: "问题" },
  { id: "insight",    label: "洞察" },
  { id: "product",    label: "产品" },
  { id: "narrative",  label: "叙事" },
  { id: "signals",    label: "信号" },
  { id: "flow",       label: "管线" },
  { id: "safety",     label: "安全契约" },
  { id: "moat",       label: "护城河" },
  { id: "numbers",    label: "数字" },
  { id: "roadmap",    label: "路线图" }
];

function App() {
  const [active, setActive] = aUseState("hero");
  const [so, setSo] = aUseState(null);

  aUseEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: "-30% 0px -60% 0px" });
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  // Install global reveal observer (auto-adds .is-in to .reveal-* elements)
  aUseEffect(() => {
    window.MR.installRevealObserver();
  }, []);

  // Magnetic button effect
  aUseEffect(() => {
    const teardown = [];
    const attachAll = () => {
      document.querySelectorAll(".magnetic:not([data-magnetized])").forEach(btn => {
        btn.setAttribute("data-magnetized", "1");
        const onMove = (e) => {
          const r = btn.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const dx = (e.clientX - cx) * 0.18;
          const dy = (e.clientY - cy) * 0.22;
          btn.style.transform = `translate(${dx}px, ${dy}px)`;
        };
        const onLeave = () => { btn.style.transform = ""; };
        btn.addEventListener("mousemove", onMove);
        btn.addEventListener("mouseleave", onLeave);
        teardown.push(() => {
          btn.removeEventListener("mousemove", onMove);
          btn.removeEventListener("mouseleave", onLeave);
        });
      });
    };
    attachAll();
    const mo = new MutationObserver(attachAll);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { mo.disconnect(); teardown.forEach(fn => fn()); };
  }, []);

  const openSlideover = (kind, id) => setSo({ kind, id });
  const closeSlideover = () => setSo(null);

  return (
    <>
      <ScrollProgressBar />
      <CursorBlob />
      <PitchNav active={active} />
      <PitchHero />
      <PitchManifesto />
      <PitchProblem />
      <PitchInsight />
      <PitchProduct openSlideover={openSlideover} />
      <PitchNarrative />
      <PitchSignals />
      <PitchFlow />
      <PitchSafety />
      <PitchMoat />
      <PitchNumbers />
      <PitchRoadmap />
      <PitchCta />
      <PitchFooter />
      <Slideover so={so} onClose={closeSlideover} />
    </>
  );
}

function ScrollProgressBar() {
  const fillRef = aUseRef(null);
  aUseEffect(() => {
    let raf = 0, ticking = false;
    const update = () => {
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
      ticking = false;
    };
    const onScroll = () => { if (!ticking) { raf = requestAnimationFrame(update); ticking = true; } };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => { window.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="scroll-progress">
      <div className="sp-fill" ref={fillRef}></div>
    </div>
  );
}

function CursorBlob() {
  const ref = aUseRef(null);
  aUseEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    let tx = 0, ty = 0;
    let cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    let raf = 0, running = false;

    const animate = () => {
      tx += (cx - tx) * 0.16;
      ty += (cy - ty) * 0.16;
      el.style.transform = `translate3d(${tx}px, ${ty}px, 0) translate(-50%, -50%)`;
      if (Math.abs(cx - tx) > 0.2 || Math.abs(cy - ty) > 0.2) {
        raf = requestAnimationFrame(animate);
      } else {
        running = false;
      }
    };
    const onMove = (e) => {
      cx = e.clientX; cy = e.clientY;
      el.classList.add("on");
      if (!running) { running = true; raf = requestAnimationFrame(animate); }
      const hoverTarget = e.target && e.target.closest && e.target.closest("a, button, .member-tile, .moat-cell, .tier-card, .pact-row, .sig-row, .problem-row, .nf-cell");
      if (hoverTarget) el.classList.add("hover-target");
      else el.classList.remove("hover-target");
    };
    const onLeave = () => { el.classList.remove("on"); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);
  return <div className="cursor-blob" ref={ref}></div>;
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
      <a className="nav-cta magnetic" href="https://github.com/libz-renlab-ai/Matrix-Riven" target="_blank" rel="noopener">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a12 12 0 00-3.79 23.4c.6.1.82-.26.82-.58v-2c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.1-.75.08-.74.08-.74 1.21.09 1.85 1.25 1.85 1.25 1.08 1.84 2.83 1.31 3.52 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.31 1.23a11.5 11.5 0 016 0c2.3-1.55 3.31-1.23 3.31-1.23.66 1.65.25 2.87.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.47 5.92.43.37.82 1.1.82 2.22v3.29c0 .32.22.7.83.58A12 12 0 0012 .5z"/></svg>
        GitHub
      </a>
    </nav>
  );
}

ReactDOM.createRoot(document.getElementById("app")).render(<App />);
