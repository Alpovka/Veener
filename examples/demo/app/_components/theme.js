'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ThemeCtx = createContext({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }) {
  // Default matches the no-flash script in layout.js; synced from the DOM on mount.
  const [theme, setTheme] = useState('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    setMounted(true);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      const root = document.documentElement;
      root.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('veneer-theme', next);
      } catch (e) {
        /* ignore */
      }
      return next;
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme, toggle, mounted }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/* Sun/moon crossfade toggle. Uses currentColor so it adapts to whatever
   text color the surrounding nav sets (light over the hero, themed when scrolled). */
export function ThemeToggle({ className = '' }) {
  const { theme, toggle, mounted } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${className}`}
    >
      <span className="sr-only">Toggle theme</span>
      {/* Sun */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-4 w-4 transition-all duration-300"
        style={{
          opacity: mounted && dark ? 0 : 1,
          transform: mounted && dark ? 'scale(0) rotate(-90deg)' : 'scale(1) rotate(0)',
          position: 'absolute',
        }}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </g>
      </svg>
      {/* Moon */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-4 w-4 transition-all duration-300"
        style={{
          opacity: mounted && dark ? 1 : 0,
          transform: mounted && dark ? 'scale(1) rotate(0)' : 'scale(0) rotate(90deg)',
          position: 'absolute',
        }}
        aria-hidden="true"
      >
        <path
          d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}
