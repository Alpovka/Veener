'use client';

import { useState } from 'react';

/* Small, dependency-free visual building blocks used across the landing page.
   Everything here is presentational — the real, running open-source package lives in the
   "Live demo" section of page.js (VeneerFrame + VeneerChat). */

/* ---------- window chrome ---------- */
function Dots() {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
      <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
      <span className="h-3 w-3 rounded-full bg-[#28c840]" />
    </div>
  );
}

// variant: 'light' (always light — used as a screenshot on the dark hero),
//          'dark'  (always dark), or 'auto' (follows the active theme).
export function BrowserFrame({ url = 'app.yoursaas.com', children, variant = 'light', className = '' }) {
  const shell =
    variant === 'dark'
      ? 'border-white/10 bg-slate-900'
      : variant === 'auto'
      ? 'border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900'
      : 'border-slate-200 bg-white';
  const bar =
    variant === 'dark'
      ? 'border-white/10 bg-slate-900/80'
      : variant === 'auto'
      ? 'border-slate-100 bg-slate-50 dark:border-white/10 dark:bg-slate-900/80'
      : 'border-slate-100 bg-slate-50';
  const pill =
    variant === 'dark'
      ? 'bg-white/5 text-slate-400'
      : variant === 'auto'
      ? 'bg-white text-slate-400 dark:bg-white/5'
      : 'bg-white text-slate-400';
  return (
    <div className={`overflow-hidden rounded-2xl border ${shell} shadow-card ${className}`}>
      <div className={`flex items-center gap-3 border-b px-4 py-2.5 ${bar}`}>
        <Dots />
        <div className={`mx-auto flex max-w-[60%] flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1 text-[11px] ${pill}`}>
          <LockGlyph /> {url}
        </div>
      </div>
      {children}
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

/* ---------- syntax helpers (dark editor theme) ---------- */
export const kw = (c) => <span className="text-violet-400">{c}</span>;
export const str = (c) => <span className="text-emerald-300">{c}</span>;
export const com = (c) => <span className="text-slate-500">{c}</span>;
export const fn = (c) => <span className="text-sky-300">{c}</span>;
export const prop = (c) => <span className="text-indigo-300">{c}</span>;
export const num = (c) => <span className="text-amber-300">{c}</span>;
export const pl = (c) => <span className="text-slate-300">{c}</span>;

function getTextFromChildren(children) {
  if (children === null || children === undefined) return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) {
    return children.map(getTextFromChildren).join('');
  }
  if (children.props && children.props.children !== undefined) {
    if (children.props.className && children.props.className.includes('select-none')) {
      return '';
    }
    return getTextFromChildren(children.props.children);
  }
  return '';
}

export function EditorFrame({ file = 'page.jsx', children, className = '' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = getTextFromChildren(children);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={`w-full max-w-full overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] shadow-card ${className}`}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Dots />
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="rounded-md bg-white/5 px-2 py-1 text-slate-300">{file}</span>
          </div>
        </div>
        <button
          onClick={handleCopy}
          className="rounded-md bg-white/5 px-2 py-1 text-[11px] font-medium text-slate-400 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="code-scroll overflow-x-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed text-slate-300">
        {children}
      </pre>
    </div>
  );
}

/* ---------- mini product mockups (for hero float + bento) ---------- */
export function MiniKanban() {
  const cols = [
    { name: 'Todo', tone: 'bg-slate-100 text-slate-600', items: ['Review PRs', 'Q3 roadmap'] },
    { name: 'Doing', tone: 'bg-amber-100 text-amber-700', items: ['Investor update'] },
    { name: 'Done', tone: 'bg-emerald-100 text-emerald-700', items: ['Billing webhook'] },
  ];
  return (
    <div className="w-[290px] rounded-xl bg-white p-3 ring-1 ring-slate-200">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="text-xs font-semibold text-slate-700">Board</span>
        <span className="text-[10px] text-slate-400">grouped by status</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {cols.map((c) => (
          <div key={c.name} className="rounded-lg bg-slate-50 p-1.5">
            <div className={`mb-1.5 inline-flex rounded px-1.5 py-0.5 text-[9px] font-medium ${c.tone}`}>
              {c.name}
            </div>
            <div className="space-y-1.5">
              {c.items.map((i) => (
                <div key={i} className="rounded-md bg-white px-2 py-1.5 text-[10px] text-slate-600 shadow-sm ring-1 ring-slate-100">
                  {i}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// A richer "generated" view — the same tasks data shown as an overview dashboard.
export function MiniDashboard() {
  const legend = [
    ['Done', 'bg-emerald-400', '68%'],
    ['In progress', 'bg-amber-400', '22%'],
    ['To do', 'bg-slate-300', '10%'],
  ];
  const bars = [42, 70, 52, 88, 60, 78, 46];
  return (
    <div className="w-[236px] rounded-xl bg-white p-3.5 ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">Overview</span>
        <span className="text-[10px] text-slate-400">this week</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative h-14 w-14 flex-none">
          <div className="h-14 w-14 rounded-full" style={{ background: 'conic-gradient(#6366f1 68%, #e2e8f0 0)' }} />
          <div className="absolute inset-[5px] flex items-center justify-center rounded-full bg-white text-[11px] font-bold text-slate-700">
            68%
          </div>
        </div>
        <div className="flex-1 space-y-1">
          {legend.map(([l, c, v]) => (
            <div key={l} className="flex items-center gap-1.5 text-[10px] text-slate-500">
              <span className={`h-2 w-2 rounded-full ${c}`} /> {l}
              <span className="ml-auto font-medium text-slate-600">{v}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-10 items-end gap-1.5">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm bg-gradient-to-t from-brand-500 to-violet-400"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function PromptBubble({ text = 'Show me a dashboard with progress and what’s overdue' }) {
  return (
    <div className="w-[260px] rounded-2xl bg-gradient-to-br from-brand-600 to-violet-600 p-px shadow-glow">
      <div className="rounded-2xl bg-[#0b1020] p-3.5">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-brand-300">
          <Sparkle className="h-3 w-3" /> You
        </div>
        <p className="text-[13px] leading-snug text-slate-200">“{text}”</p>
        <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="inline-flex gap-0.5">
            <Dot /> <Dot d="150ms" /> <Dot d="300ms" />
          </span>
          designing your UI…
        </div>
      </div>
    </div>
  );
}

function Dot({ d = '0ms' }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400"
      style={{ animationDelay: d }}
    />
  );
}

export function RegistryChip() {
  return (
    <div className="w-[240px] rounded-xl border border-white/10 bg-[#0b1020] p-3.5 shadow-card">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        registered capabilities
      </div>
      <div className="space-y-1.5 font-mono text-[11px]">
        {[
          ['createTask', true],
          ['updateTask', true],
          ['archiveTask', true],
          ['deleteTask', false],
        ].map(([id, ok]) => (
          <div key={id} className="flex items-center justify-between">
            <span className={ok ? 'text-slate-300' : 'text-slate-600 line-through'}>{id}</span>
            {ok ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-300">
                allowed
              </span>
            ) : (
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] text-rose-300">
                impossible
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- icons ---------- */
export function Sparkle({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2L12 2z" fill="currentColor" />
    </svg>
  );
}

export function Shield({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2l8 3v6c0 5-3.4 8.4-8 11-4.6-2.6-8-6-8-11V5l8-3z" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

export function Check({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
