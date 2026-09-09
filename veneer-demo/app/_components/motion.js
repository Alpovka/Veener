'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';

/* ------------------------------------------------------------------ *
 * Reveal — fades + lifts children in when they scroll into view.
 * Uses IntersectionObserver; respects prefers-reduced-motion via CSS.
 * ------------------------------------------------------------------ */
export function Reveal({ as: Tag = 'div', className = '', delay = 0, children, ...rest }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${shown ? 'is-visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ *
 * ParallaxScene / ParallaxLayer — pointer-driven depth parallax.
 * The scene tracks a normalized pointer offset (-1..1) and shares it
 * via context; each layer translates by its `depth`.
 * ------------------------------------------------------------------ */
const ParallaxCtx = createContext({ x: 0, y: 0 });

export function ParallaxScene({ className = '', strength = 1, children, ...rest }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const raf = useRef(0);

  const onMove = useCallback(
    (e) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width - 0.5) * 2 * strength;
      const y = ((e.clientY - r.top) / r.height - 0.5) * 2 * strength;
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => setPos({ x, y }));
    },
    [strength]
  );

  const reset = useCallback(() => setPos({ x: 0, y: 0 }), []);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <ParallaxCtx.Provider value={pos}>
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={reset}
        className={className}
        {...rest}
      >
        {children}
      </div>
    </ParallaxCtx.Provider>
  );
}

export function ParallaxLayer({ depth = 20, rotate = 0, className = '', style = {}, children, ...rest }) {
  const { x, y } = useContext(ParallaxCtx);
  return (
    <div
      className={className}
      style={{
        transform: `translate3d(${x * depth}px, ${y * depth}px, 0) rotate(${rotate}deg)`,
        transition: 'transform 0.25s cubic-bezier(0.16,1,0.3,1)',
        willChange: 'transform',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * ScrollParallax — translates children on the Y axis as they pass
 * through the viewport, producing depth on scroll. `speed` > 0 moves
 * the layer opposite to scroll (slower/background feel).
 * ------------------------------------------------------------------ */
export function ScrollParallax({ speed = 0.15, className = '', style = {}, children, ...rest }) {
  const ref = useRef(null);
  const [y, setY] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight || 800;
        const center = r.top + r.height / 2;
        const offset = center - vh / 2;
        setY(-offset * speed);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf.current);
    };
  }, [speed]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ transform: `translate3d(0, ${y}px, 0)`, willChange: 'transform', ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tilt — 3D card tilt that follows the local pointer.
 * ------------------------------------------------------------------ */
export function Tilt({ className = '', max = 10, glare = true, children, ...rest }) {
  const ref = useRef(null);
  const [t, setT] = useState({ rx: 0, ry: 0, gx: 50, gy: 50, active: false });
  const raf = useRef(0);

  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() =>
      setT({
        rx: (0.5 - py) * max * 2,
        ry: (px - 0.5) * max * 2,
        gx: px * 100,
        gy: py * 100,
        active: true,
      })
    );
  };
  const onLeave = () => setT((s) => ({ ...s, rx: 0, ry: 0, active: false }));

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div className="scene">
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className={`preserve-3d relative ${className}`}
        style={{
          transform: `rotateX(${t.rx}deg) rotateY(${t.ry}deg)`,
          transition: t.active ? 'transform 0.08s linear' : 'transform 0.5s cubic-bezier(0.16,1,0.3,1)',
        }}
        {...rest}
      >
        {children}
        {glare && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300"
            style={{
              opacity: t.active ? 1 : 0,
              background: `radial-gradient(420px circle at ${t.gx}% ${t.gy}%, rgba(255,255,255,0.18), transparent 45%)`,
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Counter — counts up to a value when scrolled into view.
 * ------------------------------------------------------------------ */
export function Counter({ to = 100, suffix = '', duration = 1400, className = '' }) {
  const ref = useRef(null);
  const [val, setVal] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting && !done.current) {
          done.current = true;
          const start = performance.now();
          const tick = (now) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setVal(Math.round(eased * to));
            if (p < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      });
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, [to, duration]);

  return (
    <span ref={ref} className={className}>
      {val}
      {suffix}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * usePrefersReducedMotion — true when the user asks for reduced motion.
 * ------------------------------------------------------------------ */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener('change', on);
    else mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on);
      else mq.removeListener(on);
    };
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ *
 * useScrollProgress — 0..1 progress through a tall, pin-able section.
 * 0 when the section's top reaches the viewport top, 1 once it has been
 * scrolled by (sectionHeight - viewportHeight). Pair with a sticky child
 * to build a "pinned" scroll sequence.
 * ------------------------------------------------------------------ */
export function useScrollProgress(ref, lead = 0) {
  const [p, setP] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const vh = window.innerHeight || 800;
        // `lead` (fraction of the viewport) starts progress while the section is
        // still approaching, so the sequence is already underway by the time it pins.
        const leadPx = vh * lead;
        const total = el.offsetHeight - vh + leadPx;
        const scrolled = Math.min(Math.max(leadPx - rect.top, 0), Math.max(total, 1));
        setP(total > 0 ? scrolled / total : 0);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf.current);
    };
  }, [ref, lead]);
  return p;
}
