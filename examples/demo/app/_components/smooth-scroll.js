'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';

/**
 * Site-wide smooth/inertia scrolling (the "weighted glide" feel). Lenis drives the real
 * document scroll, so native scroll events still fire — our parallax, sticky nav, and
 * IntersectionObserver reveals all keep working in sync.
 *
 * Notes:
 *  - Disabled when the user prefers reduced motion (falls back to native scroll).
 *  - In-page anchor links are routed through lenis.scrollTo with an offset for the fixed nav.
 *  - Scrollable inner regions (e.g. the chat panel) opt out with [data-lenis-prevent].
 *  - The live demo's canvas wrapper opts out too, so a tall generated view scrolls inside the card.
 */
export default function SmoothScroll() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const lenis = new Lenis({
      lerp: 0.085, // lower = heavier, smoother glide
      wheelMultiplier: 1,
      smoothWheel: true,
    });

    let rafId = 0;
    const loop = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    // Smoothly scroll to in-page anchors, offset for the fixed header.
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) return;
      const a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      const hash = a.getAttribute('href');
      if (!hash || hash === '#') return;
      const el = document.querySelector(hash);
      if (!el) return;
      e.preventDefault();
      // Lenis already honors each section's CSS scroll-margin-top (scroll-mt-*).
      // We pass offset: -5 to scroll closer to the nav bar.
      lenis.scrollTo(el, { duration: 1.1, offset: -5 });
    };
    document.addEventListener('click', onClick);

    return () => {
      document.removeEventListener('click', onClick);
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  return null;
}
