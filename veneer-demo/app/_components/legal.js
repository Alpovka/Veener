'use client';

import { useEffect } from 'react';
import { SiteNav } from './site-nav';

export function LegalPage({ title, updated, children }) {
  useEffect(() => {
    document.title = `${title} · Veneer`;
  }, [title]);

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-[#070b18] dark:text-slate-200">
      <SiteNav linkPrefix="/" />
      <main className="mx-auto max-w-3xl px-5 pb-24 pt-28">
        <a
          href="/"
          className="text-sm text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          ← Back to home
        </a>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">Last updated {updated}</p>
        <div className="mt-10 space-y-9">{children}</div>
        <p className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
          Veneer is a product of{' '}
          <a
            href="https://alpovka.github.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            AlpovkaApps
          </a>
          . Questions? Reach us through{' '}
          <a
            href="https://alpovka.github.io/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-slate-700 transition-colors hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          >
            alpovka.github.io
          </a>
          .
        </p>
      </main>
    </div>
  );
}

export function Sec({ title, children }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
      <div className="mt-2 space-y-3 leading-relaxed text-slate-600 dark:text-slate-400">{children}</div>
    </section>
  );
}
