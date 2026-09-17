'use client';

import { useState, useEffect } from 'react';
import { VeneerLogo } from './VeneerLogo';
import { ThemeToggle } from './theme';

/**
 * Shared top navigation, used by the landing page and the docs/legal pages.
 *  - overHero:   transparent until scrolled (the landing hero sits behind it).
 *  - linkPrefix: '' on the home page (in-page anchors), '/' on other routes.
 */
export function SiteNav({ overHero = false, linkPrefix = '' }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // Lock body scroll while the mobile menu is open.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);
  const solid = !overHero || scrolled || open;

  const links = [
    ['How it works', `${linkPrefix}#how`],
    ['Why Veneer', `${linkPrefix}#features`],
    ['MCP', `${linkPrefix}#mcp`],
    ['Docs', '/docs'],
  ];

  const wordmark = 'text-slate-900 dark:text-white';
  const link =
    'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white';
  const plain = 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white';
  const toggleSkin =
    'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/10';

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        solid
          ? 'border-b border-slate-200/70 bg-white/80 backdrop-blur-xl dark:border-white/10 dark:bg-[#0b1020]/80'
          : 'border-b border-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <a href={overHero ? '#top' : '/'} className="flex items-center gap-2.5">
          <VeneerLogo size={26} />
          <span className={`text-lg font-bold tracking-tight transition-colors ${wordmark}`}>Veneer</span>
        </a>
        <nav className="hidden items-center gap-1 md:flex">
          {links.map(([label, href]) => (
            <a key={href} href={href} className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${link}`}>
              {label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <a
            href={`${linkPrefix}#demo`}
            className="group hidden items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 sm:inline-flex"
          >
            <PlayIcon />
            See it live
          </a>
          <ThemeToggle className={toggleSkin} />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors md:hidden ${toggleSkin}`}
          >
            {open ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <div
        className={`overflow-hidden border-slate-200/70 bg-white/95 backdrop-blur-xl transition-[max-height,opacity] duration-300 dark:border-white/10 dark:bg-[#0b1020]/95 md:hidden ${
          open ? 'max-h-96 border-b opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-3">
          {links.map(([label, href]) => (
            <a
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${link}`}
            >
              {label}
            </a>
          ))}
          <a
            href={`${linkPrefix}#demo`}
            onClick={() => setOpen(false)}
            className={`rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${link}`}
          >
            See it live
          </a>
        </nav>
      </div>
    </header>
  );
}

function PlayIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="transition-transform group-hover:scale-110"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
