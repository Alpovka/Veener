'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { VeneerProvider, VeneerCanvas } from '@veneer/react';
import { VeneerChat } from './_components/VeneerChat';
import { VeneerLogo } from './_components/VeneerLogo';
import { registry, initialTasks, defaultUI, theme as brandTheme } from './veneer.config';
import { useTheme } from './_components/theme';
import {
  Reveal,
  Tilt,
  ParallaxScene,
  ParallaxLayer,
  ScrollParallax,
  Counter,
  usePrefersReducedMotion,
  useScrollProgress,
} from './_components/motion';
import { SiteNav } from './_components/site-nav';
import {
  BrowserFrame,
  EditorFrame,
  MiniKanban,
  MiniDashboard,
  PromptBubble,
  RegistryChip,
  Sparkle,
  Shield,
  Check,
  kw,
  str,
  com,
  fn,
  prop,
  num,
  pl,
} from './_components/visuals';

// Persona-driven prompts: the same task app, personalized for very different people.
const DEMO_PROMPTS = [
  'I manage the team — show a dashboard with progress and anything overdue',
  'Show a calendar by due date and flag anything overdue',
  'Make it a kanban board I can drag tasks across',
];

export default function Home() {
  // The host app owns the real data + the real action implementations, in plain React state.
  const [tasks, setTasks] = useState(initialTasks);

  const actions = useMemo(
    () => ({
      createTask: ({ title, status = 'todo', dueDate = null }) => {
        const t = { id: 't' + Date.now() + Math.floor(Math.random() * 1000), title, status, dueDate };
        setTasks((prev) => [...prev, t]);
        return t;
      },
      updateTask: ({ id, ...changes }) => {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
        return { id, ...changes };
      },
      archiveTask: ({ id }) => {
        setTasks((prev) => prev.filter((t) => t.id !== id));
        return { id, archived: true };
      },
      // Note: there is deliberately NO deleteTask. It isn't registered and isn't implemented,
      // so no generated UI can ever delete a task — the bridge would reject the call.
    }),
    []
  );

  const data = useMemo(() => ({ tasks }), [tasks]);
  // Fresh copies on every reset: a new array and new objects guarantee the canvas receives a data
  // push and returns to the pristine sample, regardless of what the current view did to the tasks.
  const reload = useCallback(() => setTasks(initialTasks.map((t) => ({ ...t }))), []);
  // The canvas and the chat widget follow the site's light/dark toggle.
  const { theme: siteMode } = useTheme();
  const veneerTheme = useMemo(() => ({ ...brandTheme, mode: siteMode === 'dark' ? 'dark' : 'light' }), [siteMode]);

  return (
    <VeneerProvider
      registry={registry}
      actions={actions}
      data={data}
      defaultUI={defaultUI}
      persist="memory"
      theme={veneerTheme}
      onThemeError={(e) => console.warn('[veneer] theme:', e)}
      onSecurityViolation={(v) => console.warn('[veneer] sandbox violation:', v.reason, v)}
    >
      <div className="min-h-screen bg-white text-slate-900 dark:bg-[#070b18] dark:text-slate-200">
        <SiteNav overHero />
        <Hero />
        <HowItWorks />
        <LiveDemo reload={reload} />
        <Features />
        <Security />
        <Developer />
        <WhyMcp />
        <Faq />
        <FinalCta />
        <Footer />

        {/* Floating "just joined" social-proof toast. */}
        <WaitlistToast />
      </div>
    </VeneerProvider>
  );
}

/* ============================ WAITLIST (shared) ============================ */
function WaitlistForm({ className = '' }) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [location, setLocation] = useState('');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.city && data.country_name) {
          setLocation(`${data.city}, ${data.country_name}`);
        } else if (data && data.country_name) {
          setLocation(data.country_name);
        }
      })
      .catch(() => {
        try {
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
          setLocation(tz);
        } catch (_) {}
      });
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last names are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName, lastName, location }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.ok) setJoined(true);
      else setError(json.error || 'Something went wrong. Please try again.');
    } catch (err) {
      setError('Network error — please try again.');
    }
    setBusy(false);
  }

  if (joined) {
    return (
      <div
        className={`flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 ${className}`}
      >
        <Check className="h-4 w-4" /> You’re on the list — we’ll be in touch.
      </div>
    );
  }

  const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-400 disabled:opacity-60 dark:border-white/15 dark:bg-white/5 dark:text-white dark:placeholder:text-slate-500";

  return (
    <div className={className}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <input
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={busy}
            placeholder="First name"
            className={inputClass}
          />
          <input
            type="text"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={busy}
            placeholder="Last name"
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="you@mail.com"
            className={`${inputClass} flex-1`}
          />
          <button
            type="submit"
            disabled={busy}
            className="group inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 sm:w-auto flex-none"
          >
            {busy ? 'Joining…' : 'Join the waitlist'}
            {!busy && <span className="transition-transform group-hover:translate-x-0.5">→</span>}
          </button>
        </div>
      </form>
      {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}

function WaitlistProof({ ring = 'ring-white dark:ring-[#070b18]', className = '' }) {
  const avatars = [
    ['A', 'from-brand-500 to-violet-500'],
    ['M', 'from-sky-500 to-cyan-500'],
    ['T', 'from-rose-500 to-orange-500'],
    ['P', 'from-emerald-500 to-teal-500'],
  ];
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex -space-x-2">
        {avatars.map(([ch, g]) => (
          <span
            key={ch}
            className={`flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br ${g} text-xs font-semibold text-white ring-2 ${ring}`}
          >
            {ch}
          </span>
        ))}
      </div>
      <span className="text-sm text-slate-600 dark:text-slate-300">
        <span className="font-semibold text-slate-900 dark:text-white">
          <Counter to={165} />+
        </span>{' '}
        builders already joined
      </span>
    </div>
  );
}

/* ============================ HERO ============================ */
function Hero() {
  return (
    <section id="top" className="relative overflow-hidden bg-white pt-24 text-slate-900 dark:bg-[#070b18] dark:text-white">
      {/* animated aurora + grid (with gentle scroll parallax) — adapts to the theme */}
      <ScrollParallax speed={0.12} className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 aurora animate-gradient-pan opacity-50 dark:opacity-90" />
      </ScrollParallax>
      <div className="pointer-events-none absolute inset-0 grid-mask-light dark:hidden" />
      <div className="pointer-events-none absolute inset-0 hidden grid-mask dark:block" />
      <ScrollParallax speed={0.18} className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2">
        <div className="h-full w-full rounded-full bg-brand-500/20 blur-[120px] dark:bg-brand-600/20" />
      </ScrollParallax>

      <ParallaxScene
        strength={1}
        className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 pb-28 pt-2 lg:grid-cols-[1.05fr_0.95fr] lg:pb-36"
      >
        {/* Left: copy */}
        <div className="relative z-10">
          <span className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-3.5 py-1.5 text-xs font-medium text-slate-600 backdrop-blur dark:border-white/15 dark:bg-white/5 dark:text-slate-200">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            Like MCP - but for your app’s UI
          </span>

          <h1
            className="mt-6 animate-fade-up text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl"
            style={{ animationDelay: '80ms' }}
          >
            Let your users
            <br />
            <span className="bg-gradient-to-r from-brand-700 to-violet-600 bg-clip-text text-transparent dark:from-brand-300 dark:to-violet-400">
              personalize the UI
            </span>
            <br />
            as they like.
          </h1>

          <p
            className="mt-6 max-w-xl animate-fade-up text-lg leading-relaxed text-slate-600 dark:text-slate-300"
            style={{ animationDelay: '160ms' }}
          >
            Your users just describe the page they want, and{' '}
            <em className="font-medium not-italic text-slate-900 dark:text-white">AI builds it for them on the spot</em>. You stay in
            control: it can only use the data and actions you allow.
          </p>

          <div className="mt-8 max-w-md animate-fade-up" style={{ animationDelay: '240ms' }}>
            <WaitlistForm />
          </div>

          <div className="mt-5 animate-fade-up" style={{ animationDelay: '320ms' }}>
            <WaitlistProof />
          </div>
        </div>

        {/* Right: floating 3D mockups — mouse parallax (depth) + scroll parallax (drift) */}
        <div className="relative z-0 hidden h-[520px] lg:block">
          <ScrollParallax speed={-0.06} className="absolute inset-0">
            <ParallaxLayer depth={36} className="absolute right-2 top-2">
              <Tilt max={9} className="rounded-2xl">
                <BrowserFrame url="app.yoursaas.com" className="w-[360px] animate-float-slow">
                  <div className="bg-slate-50 p-3">
                    <MiniKanban />
                  </div>
                </BrowserFrame>
              </Tilt>
            </ParallaxLayer>

            <ParallaxLayer depth={64} rotate={-3} className="absolute -left-2 top-36">
              <div className="animate-float">
                <PromptBubble />
              </div>
            </ParallaxLayer>

            <ParallaxLayer depth={50} rotate={4} className="absolute bottom-6 right-16">
              <Tilt max={12} className="rounded-2xl">
                <div className="animate-float-slow">
                  <MiniDashboard />
                </div>
              </Tilt>
            </ParallaxLayer>

            <ParallaxLayer depth={82} className="absolute bottom-0 left-6">
              <div className="animate-float">
                <RegistryChip />
              </div>
            </ParallaxLayer>

            {/* curvy arrow (moves with the mockups): Board card's bottom-right → the Overview the AI builds */}
            <ParallaxLayer depth={44} className="pointer-events-none absolute right-0 top-[195px] z-10">
              <svg
                className="h-[150px] w-[120px] text-brand-500 dark:text-brand-400"
                viewBox="0 0 120 150"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M102 10 C 130 50, 110 100, 50 135"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                <path
                  d="M50 135 l 20 4 M50 135 l 4 -20"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </ParallaxLayer>
          </ScrollParallax>
        </div>
      </ParallaxScene>

      {/* smooth, tall fade from the hero into the page body (theme-aware) */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-b from-transparent to-white dark:to-[#070b18]" />
    </section>
  );
}

/* ============================ HOW IT WORKS ============================ */
/* ============================ HOW IT WORKS ============================ */
function HowItWorks() {
  const ref = useRef(null);
  const reduced = usePrefersReducedMotion();
  
  // Pin only on large screens; on mobile/reduced-motion render a normal stacked section.
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const progress = useScrollProgress(ref, 0.65);
  const pinned = !reduced && wide;
  const p = pinned ? progress : 1;

  // Calculate overlapping parallax metrics for Desktop (fanning card pile)
  let card1Y = 0;
  let card1Scale = 1;
  let card1Opacity = 1;
  if (p > 0.3) {
    const factor = Math.min((p - 0.3) / 0.35, 1);
    card1Y = -50 * factor;
    card1Scale = 1 - 0.08 * factor;
    card1Opacity = 1;
  }
  if (p > 0.65) {
    const factor2 = Math.min((p - 0.65) / 0.35, 1);
    card1Y = -50 - 50 * factor2;
    card1Scale = 0.92 - 0.08 * factor2;
    card1Opacity = 1;
  }

  let card2Y = 850; // starts far offscreen
  let card2Scale = 1;
  let card2Opacity = 1;
  if (p >= 0.1 && p <= 0.45) {
    const factor = (p - 0.1) / 0.35;
    card2Y = 850 * (1 - factor) + 40 * factor; // slides up to Y=40px offset
  } else if (p > 0.45) {
    const factor = Math.min((p - 0.45) / 0.35, 1);
    card2Y = 40 - 50 * factor; // recesses slightly as Card 3 enters
    card2Scale = 1 - 0.08 * factor;
    card2Opacity = 1;
  }

  let card3Y = 850; // starts far offscreen
  if (p >= 0.45 && p <= 0.85) {
    const factor = (p - 0.45) / 0.4;
    card3Y = 850 * (1 - factor) + 80 * factor; // slides up to Y=80px offset
  } else if (p > 0.85) {
    card3Y = 80;
  }

  const cards = [
    {
      number: '01',
      title: 'You set the rules',
      body: 'Declare the data and actions your app allows in plain natural language. Pass the real implementations; they remain completely private to your server.',
      style: {
        transform: `translateY(${card1Y}px) scale(${card1Scale})`,
        opacity: card1Opacity,
        zIndex: 10,
      },
      graphic: (
        <div className="w-full max-w-sm rounded-xl border border-white/10 bg-[#0b1020] p-4 text-left font-mono text-[11px] text-slate-300 shadow-card">
          <div className="mb-2 flex items-center gap-1.5 border-b border-white/5 pb-2">
            <span className="h-2 w-2 rounded-full bg-[#ff5f57]" />
            <span className="h-2 w-2 rounded-full bg-[#febc2e]" />
            <span className="h-2 w-2 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-[10px] text-slate-500">veneer.config.js</span>
          </div>
          <div>
            <span className="text-violet-400">const</span> registry = {'{'}
            <br />
            {'  '}<span className="text-indigo-300">dataSources</span>: [{'{'} id: <span className="text-emerald-300">'tasks'</span> {'}'}],
            <br />
            {'  '}<span className="text-indigo-300">actions</span>: [
            <br />
            {'    '}{'{'} id: <span className="text-emerald-300">'createTask'</span>, desc: <span className="text-slate-400">'Create task.'</span> {'}'},
            <br />
            {'    '}{'{'} id: <span className="text-emerald-300">'updateTask'</span>, desc: <span className="text-slate-400">'Update task.'</span> {'}'}
            <br />
            {'  '}]
            <br />
            {'}'};
          </div>
        </div>
      )
    },
    {
      number: '02',
      title: 'Users describe it',
      body: 'Your users just say how they want the page to look. No settings to dig through, no templates to memorize—Veneer invents the layout on the fly.',
      style: {
        transform: `translateY(${card2Y}px) scale(${card2Scale})`,
        opacity: card2Opacity,
        zIndex: 20,
      },
      graphic: (
        <div className="w-full max-w-sm rounded-2xl bg-gradient-to-br from-brand-600/20 to-violet-600/20 p-px shadow-glow">
          <div className="rounded-2xl bg-[#0b1020] p-4 text-left">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-brand-300">
              <Sparkle className="h-3.5 w-3.5" /> USER REQUEST
            </div>
            <p className="text-xs leading-snug text-slate-200">“Show me a board of my tasks grouped by due date, with high priority tasks at the top”</p>
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-slate-400">
              <span className="inline-flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" style={{ animationDelay: '300ms' }} />
              </span>
              compiling sandboxed UI…
            </div>
          </div>
        </div>
      )
    },
    {
      number: '03',
      title: 'AI builds it, safely',
      body: 'Generated code runs in a sandboxed interpreter that can only describe what to draw. The model can style anything, but can only invoke the native functions you exposed.',
      style: {
        transform: `translateY(${card3Y}px)`,
        zIndex: 30,
      },
      graphic: (
        <div className="w-full max-w-sm rounded-xl border border-emerald-500/15 bg-emerald-500/[0.02] p-4 ring-1 ring-emerald-500/20">
          <div className="mb-3 flex items-center gap-2 text-[10px] font-bold text-emerald-400">
            <Shield className="h-4 w-4" /> SECURE SANDBOX BOUNDARY
          </div>
          <div className="space-y-2 text-xs font-mono text-slate-400 text-left">
            <div className="flex justify-between border-b border-white/5 pb-1">
              <span>Origin Handshake</span>
              <span className="text-emerald-400 font-bold">✔ VERIFIED</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-1">
              <span>Capability Registry</span>
              <span className="text-emerald-400 font-bold">✔ SECURE</span>
            </div>
            <div className="flex justify-between pb-1">
              <span>Data Source Bridge</span>
              <span className="text-emerald-400 font-bold">✔ ENFORCED</span>
            </div>
          </div>
        </div>
      )
    }
  ];

  const Stage = (
    <div className="relative mx-auto flex h-full w-full max-w-5xl flex-col justify-center px-5 py-6 pt-20">
      <SectionHeading
        title="Three steps. That’s the whole thing."
      />

      <div className={`relative mx-auto mt-24 w-full max-w-4xl flex-col items-center justify-start ${
        pinned ? 'flex h-[420px]' : 'space-y-6'
      }`}>
        {cards.map((c) => (
          <div
            key={c.number}
            style={pinned ? c.style : {}}
            className={`${
              pinned ? 'absolute inset-x-0 h-[280px]' : 'relative'
            } transition-all duration-500 ease-out text-center md:text-left`}
          >
            {/* Horizontal overlapping solid card */}
            <div className="flex flex-col items-center gap-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-card dark:border-white/10 dark:bg-[#0b1020] md:flex-row md:gap-10 md:p-8 hover:shadow-glow hover:border-brand-500/20 transition-all duration-300">
              
              {/* Left Column: Context / Descriptions */}
              <div className="flex flex-1 flex-col text-left">
                <span className="bg-gradient-to-r from-indigo-500 to-brand-500 bg-clip-text font-mono text-xs font-bold tracking-widest text-transparent">
                  STEP {c.number}
                </span>
                <h3 className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-white md:text-2xl">
                  {c.title}
                </h3>
                <p className="mt-3.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  {c.body}
                </p>
              </div>

              {/* Right Column: Visual Mockup Graphics */}
              <div className="flex flex-1 items-center justify-center">
                {c.graphic}
              </div>

            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // Not pinned (mobile / reduced motion): render a normal, fully-visible section.
  if (!pinned) {
    return (
      <section id="how" className="relative scroll-mt-[72px] py-20">
        {Stage}
      </section>
    );
  }

  // The section is tall; a sticky child pins to the viewport while the steps
  // reveal one-by-one as you scroll through it.
  return (
    <section id="how" ref={ref} className="relative scroll-mt-[72px]" style={{ height: '300vh' }}>
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">{Stage}</div>
    </section>
  );
}

/* ============================ LIVE DEMO ============================ */
function LiveDemo({ reload }) {
  const [tab, setTab] = useState('preview');
  // Cap the canvas to the viewport so the demo card is fully visible instead of running off the
  // bottom of the screen; taller views scroll inside the card. Leaves room for the browser-frame
  // chrome and the section's padding.
  const [maxCanvas, setMaxCanvas] = useState(720);
  useEffect(() => {
    const calc = () => setMaxCanvas(Math.max(440, Math.min(900, Math.round(window.innerHeight - 240))));
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  return (
    <section
      id="demo"
      className="relative scroll-mt-[72px] overflow-hidden bg-slate-50 py-24 text-slate-900 dark:bg-[#070b18] dark:text-white"
    >
      <div className="pointer-events-none absolute inset-0 grid-mask-light dark:hidden" />
      <div className="pointer-events-none absolute inset-0 hidden grid-mask opacity-70 dark:block" />
      <div className="relative mx-auto max-w-6xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-200">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-emerald-400" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
            </span>
            Live · this is the real open-source package running
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Try it yourself, right here</h2>
          <p className="mt-4 text-slate-600 dark:text-slate-300">
            Below is an ordinary task app built with the <span className="font-mono text-brand-600 dark:text-brand-300">@veneer/react</span>.
            Click the button in the corner and tell the AI how you want it to look. Everything it
            invents runs inside the sandboxed canvas.
          </p>
        </Reveal>

        <Reveal delay={120} className="relative mt-12">
          {/* glow emanating from behind the center of the demo card */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <ScrollParallax speed={0.1} className="h-[520px] w-[900px] max-w-[110vw]">
              <div className="h-full w-full rounded-full bg-violet-500/25 blur-[130px] dark:bg-violet-600/25" />
            </ScrollParallax>
          </div>
          <div className="relative ring-gradient rounded-3xl p-1.5 shadow-card">
            <BrowserFrame url="app.yoursaas.com/tasks" variant="auto">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 dark:border-white/10">
                <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-white/5">
                  {['preview', 'code'].map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition ${
                        tab === t
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-white/15 dark:text-white'
                          : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {tab === 'preview' ? (
                  <button
                    onClick={reload}
                    className="rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-200"
                    title="Reset the demo's data"
                  >
                    Reset data
                  </button>
                ) : (
                  <span className="font-mono text-xs text-slate-400">veneer.config.js · page.jsx</span>
                )}
              </div>
              {/* Keep the canvas mounted across tab switches so demo state persists. The generated
                  UI is real DOM in this page (no iframe); the wrapper scrolls when a view is taller
                  than the viewport cap. */}
              <div
                className={`${tab === 'preview' ? '' : 'hidden'} overscroll-contain`}
                style={{ maxHeight: maxCanvas, overflowY: 'auto' }}
                data-lenis-prevent
              >
                <VeneerCanvas
                  minHeight={Math.min(560, maxCanvas)}
                  onError={(e) => console.warn('[veneer]', e)}
                />
              </div>
              <div className={tab === 'code' ? '' : 'hidden'}>
                <DemoCode />
              </div>
            </BrowserFrame>
            {/* The AI chat floats inside the demo card (launcher + panel anchored here). */}
            <VeneerChat suggestions={DEMO_PROMPTS} anchor="container" />
          </div>
        </Reveal>

        <Reveal delay={180} className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-2 text-center text-sm text-slate-500 dark:text-slate-400">
          <span className="w-full text-xs text-slate-500">
            Adding a task deletion like <span className="font-mono">“add a delete button”</span> will be politely refused, because no{' '}
            <span className="font-mono">deleteTask</span> is registered.
          </span>
        </Reveal>
      </div>
    </section>
  );
}

// The actual integration behind the live demo above — shown in the "Code" tab.
function DemoCode() {
  return (
    <pre
      className="code-scroll overflow-auto bg-[#0b1020] px-5 py-4 font-mono text-[12.5px] leading-relaxed text-slate-300"
      style={{ height: 560 }}
    >
      <div>
        <span>{com('// 1) Declare what the AI may see and do. This registry is the contract.')}</span>
        {'\n'}
        {kw('const')} {pl('registry = {')}
        {'\n'}
        {'  '}{prop('dataSources')}{pl(': [')}
        {'\n'}
        {'    '}{pl('{ ')}{prop('id')}{pl(': ')}{str("'tasks'")}{pl(', ')}{prop('description')}{pl(': ')}{str('"The user\'s tasks."')}{pl(', ')}{prop('fields')}{pl(': [')}
        {'\n'}
        {'      '}{pl('{ ')}{prop('name')}{pl(': ')}{str("'id'")}{pl(', ')}{prop('type')}{pl(': ')}{str("'string'")}{pl(' },')}
        {'\n'}
        {'      '}{pl('{ ')}{prop('name')}{pl(': ')}{str("'title'")}{pl(', ')}{prop('type')}{pl(': ')}{str("'string'")}{pl(' },')}
        {'\n'}
        {'      '}{pl('{ ')}{prop('name')}{pl(': ')}{str("'status'")}{pl(', ')}{prop('type')}{pl(': ')}{str('\'"todo" | "doing" | "done"\'')}{pl(' },')}
        {'\n'}
        {'    '}{pl('] },')}
        {'\n'}
        {'  '}{pl('],')}
        {'\n'}
        {'  '}{prop('actions')}{pl(': [')}
        {'\n'}
        {'    '}{pl('{ ')}{prop('id')}{pl(': ')}{str("'createTask'")}{pl(',  ')}{prop('description')}{pl(': ')}{str("'Create a task.'")}{pl(' },')}
        {'\n'}
        {'    '}{pl('{ ')}{prop('id')}{pl(': ')}{str("'updateTask'")}{pl(',  ')}{prop('description')}{pl(': ')}{str('"Update a task\'s fields."')}{pl(' },')}
        {'\n'}
        {'    '}{pl('{ ')}{prop('id')}{pl(': ')}{str("'archiveTask'")}{pl(', ')}{prop('description')}{pl(': ')}{str("'Archive a task.'")}{pl(' },')}
        {'\n'}
        {'    '}<span>{com('// no deleteTask → no generated UI can ever delete')}</span>
        {'\n'}
        {'  '}{pl('],')}
        {'\n'}
        {pl('};')}
        {'\n\n'}
        <span>{com('// 2) Pass the REAL implementations + live data. Veneer wires the rest.')}</span>
        {'\n'}
        {kw('const')} {pl('actions = {')}
        {'\n'}
        {'  '}{fn('createTask')}{pl(':  ({ title }) => setTasks(...),')}
        {'\n'}
        {'  '}{fn('updateTask')}{pl(':  ({ id, ...changes }) => setTasks(...),')}
        {'\n'}
        {'  '}{fn('archiveTask')}{pl(': ({ id }) => setTasks(...),')}
        {'\n'}
        {pl('};')}
        {'\n\n'}
        <span>{com('// 3) Drop in two components. The canvas is the sandbox; your chat redesigns it.')}</span>
        {'\n'}
        {pl('<')}{fn('VeneerProvider')} {prop('registry')}{pl('={registry} ')}{prop('actions')}{pl('={actions} ')}{prop('data')}{pl('={{ tasks }}>')}
        {'\n'}
        {'  '}{pl('<')}{fn('VeneerCanvas')} {prop('minHeight')}{pl('={')}{num('560')}{pl('} />')}
        {'\n'}
        {'  '}{pl('<')}{fn('YourChatBox')} {pl('/>  ')}{com('// built on useVeneerGenerate()')}
        {'\n'}
        {pl('</')}{fn('VeneerProvider')}{pl('>')}
      </div>
    </pre>
  );
}

/* ============================ FEATURES (bento) ============================ */
function Features() {
  return (
    <section id="features" className="relative mx-auto max-w-6xl scroll-mt-[76px] px-5 py-24">
      <SectionHeading
        eyebrow="Why Veneer"
        title="One app. A perfect fit for everyone."
        sub="A manager wants a dashboard; a teammate just wants today’s checklist. Instead of building both, you ship the pieces — and each person shapes the page to fit how they work, while you stay in control of what’s possible."
      />

      <div className="mt-14 grid auto-rows-[200px] grid-cols-1 gap-4 md:grid-cols-6">
        <Reveal className="md:col-span-4 md:row-span-2">
          <BentoCard className="h-full">
            <LayoutMorph />
            <BentoText
              title="Full creative freedom over the UI"
              body="Change the UI to your liking with AI"
            />
          </BentoCard>
        </Reveal>

        <Reveal delay={80} className="md:col-span-2 md:row-span-1">
          <BentoCard className="h-full">
            <div className="flex flex-1 items-center justify-center">
              <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-violet-600 text-white shadow-glow">
                <Shield className="h-8 w-8" />
                <span className="absolute inset-0 animate-pulse-ring rounded-2xl border border-brand-400/50" />
              </div>
            </div>
            <BentoText title="Hard security sandbox" body="An interpreter with no browser in it, an allowlisted renderer, a validated bridge — three independent layers." />
          </BentoCard>
        </Reveal>

        <Reveal delay={140} className="md:col-span-2 md:row-span-1">
          <BentoCard className="h-full">
            <div className="flex flex-1 items-center justify-center font-mono text-xs">
              <div className="space-y-1.5">
                <span className="block text-slate-400 dark:text-slate-500">veneer.action(</span>
                <span className="block pl-3 text-emerald-600 dark:text-emerald-400">'updateTask'</span>
                <span className="block text-slate-400 dark:text-slate-500">)</span>
              </div>
            </div>
            <BentoText title="MCP for the UI layer" body="A typed, described capability surface the model composes against." />
          </BentoCard>
        </Reveal>

        <Reveal delay={80} className="md:col-span-2 md:row-span-1">
          <BentoCard className="h-full">
            <div className="flex flex-1 items-center justify-center">
              <UserIcon />
            </div>
            <BentoText title="Per-user & private" body="Each person's layout is saved to their own browser. Nobody else sees it." />
          </BentoCard>
        </Reveal>

        <Reveal delay={140} className="md:col-span-2 md:row-span-1">
          <BentoCard className="h-full">
            <div className="flex flex-1 items-center justify-center">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                <span className="text-slate-400 dark:text-slate-500">$</span> npm i @veneer/react @veneer/server
              </div>
            </div>
            <BentoText title="Open-source React package" body="A provider, a canvas, a hook. Drop them in and you're live. (Note: Package naming is a placeholder subject to change on release.)" />
          </BentoCard>
        </Reveal>

        <Reveal delay={200} className="md:col-span-2 md:row-span-1">
          <BentoCard className="h-full">
            <div className="flex flex-1 items-center justify-center">
              <div className="relative text-brand-500 dark:text-brand-400">
                <Sparkle className="h-11 w-11" />
                <span className="absolute -right-3 -top-1.5 animate-pulse text-violet-400">
                  <Sparkle className="h-4 w-4" />
                </span>
                <span
                  className="absolute -left-3 bottom-0 animate-pulse text-sky-400"
                  style={{ animationDelay: '0.5s' }}
                >
                  <Sparkle className="h-3 w-3" />
                </span>
              </div>
            </div>
            <BentoText title="Bring your own model" body="One endpoint returns { code, reply }. Use any LLM you like." />
          </BentoCard>
        </Reveal>
      </div>
    </section>
  );
}

function BentoCard({ className = '', children }) {
  return (
    <div
      className={`group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-card dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 ${className}`}
    >
      {children}
    </div>
  );
}

function BentoText({ title, body }) {
  return (
    <div className="mt-4">
      <h3 className="font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{body}</p>
    </div>
  );
}

function LayoutMorph() {
  const views = ['Kanban', 'Calendar', 'Dashboard', 'Timeline'];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % views.length), 2400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative flex-1 overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-brand-50/60 p-4 ring-1 ring-slate-100 dark:from-white/[0.04] dark:to-brand-500/10 dark:ring-white/10">
      <div className="absolute right-3 top-3 z-10 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-brand-700 shadow-sm backdrop-blur dark:bg-white/10 dark:text-brand-300">
        {views[i]}
      </div>
      <div className="grid h-full grid-cols-3 gap-2">
        {Array.from({ length: 9 }).map((_, k) => (
          <div
            key={k}
            className="rounded-lg bg-white shadow-sm ring-1 ring-slate-100 transition-all duration-700 dark:bg-white/10 dark:ring-white/10"
            style={{
              transform:
                i === 0
                  ? 'translateY(0) scale(1)'
                  : i === 1
                  ? `scale(${0.7 + (k % 3) * 0.06})`
                  : i === 2
                  ? `scaleY(${0.5 + (k % 4) * 0.18})`
                  : 'translateX(0)',
              opacity: i === 3 && k % 3 !== 0 ? 0.35 : 1,
              transitionDelay: `${k * 35}ms`,
              transformOrigin: 'bottom',
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ============================ WHY MCP ============================ */
function WhyMcp() {
  const mcpPoints = [
    'Exposes your tools & data',
    'Each described in plain language',
    'The model can only call what you exposed',
  ];
  const veneerPoints = [
    'Exposes your data sources & actions',
    'Each described in plain language',
    'The model can only use what you registered',
  ];
  const Bullet = ({ children, brand }) => (
    <li className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
      <span
        className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${
          brand ? 'bg-brand-500 dark:bg-brand-400' : 'bg-slate-400 dark:bg-slate-500'
        }`}
      />
      {children}
    </li>
  );

  return (
    <section id="mcp" className="relative mx-auto max-w-6xl scroll-mt-[76px] px-5 py-24">
      <SectionHeading
        title="If you know MCP, you already get Veneer."
        sub="MCP gives an AI model a typed, described set of capabilities to work with. Veneer is the same idea — just pointed at your interface."
      />

      <div className="mt-14 grid items-stretch gap-4 md:grid-cols-2">
        {/* MCP */}
        <Reveal>
          <div className="h-full rounded-2xl border border-slate-200 bg-white p-7 dark:border-white/10 dark:bg-white/[0.03]">
            <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-400">
              MCP
            </span>
            <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">Model Context Protocol</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Lets a model use the tools and data your systems expose — through one typed, described
              surface. It can only ever call what’s on it.
            </p>
            <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-5 dark:border-white/10">
              {mcpPoints.map((p) => (
                <Bullet key={p}>{p}</Bullet>
              ))}
            </ul>
          </div>
        </Reveal>

        {/* Veneer */}
        <Reveal delay={120}>
          <div className="relative h-full overflow-hidden rounded-2xl border-2 border-brand-300 bg-white p-7 shadow-glow dark:border-brand-500/40 dark:bg-white/[0.04]">
            <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-brand-500/10 blur-3xl" />
            <span className="inline-flex rounded-full bg-gradient-to-r from-brand-600 to-violet-600 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white">
              Veneer
            </span>
            <h3 className="mt-4 text-lg font-semibold text-slate-900 dark:text-white">An MCP for the UI layer</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              The exact same shape — but the surface is your interface. The model composes a real UI
              against your registered data and actions, inside a sandbox.
            </p>
            <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-5 dark:border-white/10">
              {veneerPoints.map((p) => (
                <Bullet key={p} brand>
                  {p}
                </Bullet>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>

      <Reveal delay={180} className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-slate-500 dark:text-slate-400">
        Same protocol-shaped idea: a typed capability surface the model composes against. MCP points
        it at your tools — <span className="font-medium text-slate-700 dark:text-slate-200">Veneer points it at your UI.</span>
      </Reveal>
    </section>
  );
}

/* ============================ SECURITY ============================ */
function Security() {
  const layers = [
    {
      n: '1',
      title: 'An interpreter, not a browser',
      code: 'QuickJS (WebAssembly) · Web Worker',
      body: 'Generated code runs in a JavaScript interpreter inside a Web Worker. There is no window, document, fetch, location or cookie in there — not blocked, simply nonexistent. All it can do is describe what to draw.',
    },
    {
      n: '2',
      title: 'Allowlisted rendering',
      code: 'ops → allowlist → your DOM',
      body: 'Your page redraws that description with its own React. Only safe elements, attributes and styles pass; links, images, scripts, url() and anything that could escape the canvas are dropped. Tailwind is compiled per view and scoped to the canvas.',
    },
    {
      n: '3',
      title: 'Validated bridge',
      code: 'veneer.action(id) → registry.actions[id]',
      body: 'Every action is checked against the registry — id, declared args, types, rate — before the real implementation runs. Only declared return values and registered data cross back into the interpreter.',
    },
  ];

  return (
    <section id="security" className="relative scroll-mt-[72px] overflow-hidden bg-slate-50 py-24 text-slate-900 dark:bg-[#070b18] dark:text-white">
      <div className="pointer-events-none absolute inset-0 grid-mask-light dark:hidden" />
      <div className="pointer-events-none absolute inset-0 hidden grid-mask opacity-60 dark:block" />
      <ScrollParallax speed={0.14} className="pointer-events-none absolute right-1/4 top-10 h-[360px] w-[600px]">
        <div className="h-full w-full rounded-full bg-brand-500/20 blur-[120px] dark:bg-brand-600/20" />
      </ScrollParallax>
      <div className="relative mx-auto max-w-6xl px-5">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-200">
            <Shield className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> The security model
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">
            Free-form code.{' '}
            <span className="bg-gradient-to-r from-brand-700 to-violet-600 bg-clip-text text-transparent dark:from-brand-300 dark:to-violet-400">
              Bounded power.
            </span>
          </h2>
          <p className="mt-4 text-slate-600 dark:text-slate-300">
            The model can write anything. It still can’t do anything you didn’t allow.
            Three independent layers enforce the same contract, plus a static scan before any code runs,
            a CPU deadline on every entry, and a watchdog that terminates the worker and resets the canvas
            if a generation ever hangs.
          </p>
        </Reveal>

        <div className="mt-14 grid gap-4 lg:grid-cols-3">
          {layers.map((l, i) => (
            <Reveal key={l.n} delay={i * 110}>
              <div className="group h-full rounded-2xl border border-slate-200 bg-white p-6 transition-all hover:border-slate-300 hover:shadow-card dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 dark:hover:bg-white/[0.05]">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-500 text-sm font-bold text-white">
                    {l.n}
                  </span>
                  <h3 className="text-lg font-semibold">{l.title}</h3>
                </div>
                <code className="mt-4 block rounded-lg bg-slate-900 px-3 py-2 font-mono text-xs text-emerald-300 ring-1 ring-black/5 dark:bg-black/40 dark:ring-white/10">
                  {l.code}
                </code>
                <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{l.body}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120} className="mt-8">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-center dark:border-white/10 dark:bg-white/[0.03] sm:flex-row sm:text-left">
            <div className="flex items-center gap-3">
              <code className="rounded-lg bg-rose-50 px-3 py-2 font-mono text-sm text-rose-600 ring-1 ring-rose-200 line-through dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20">
                deleteTask
              </code>
              <span className="text-slate-400 dark:text-slate-500">→</span>
              <span className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20">
                rejected on every layer
              </span>
            </div>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300 sm:ml-auto sm:max-w-md">
              No <span className="font-mono">deleteTask</span> is registered, so the scanner refuses the
              code before it runs, the interpreter has no network to reach your API, and the bridge
              rejects the call. Deletion fails on every layer.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================ DEVELOPER ============================ */
function Developer() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-24">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal className="w-full min-w-0">
          <SectionHeading
            align="left"
            eyebrow="For developers"
            title="Three components. Your real implementations."
            sub="No new backend, no source-code delivery, no rebuild. Register what your app can do in plain natural language, hand over the functions, and drop in the open-source package."
          />
          <ul className="mt-8 space-y-4">
            {[
              ['Typed capability surface', 'Data sources and actions, each described for the model and enforced by id at runtime.'],
              ['Your code stays yours', 'You pass the real implementations. The model never sees them — only the registry.'],
              ['Model-agnostic', 'One endpoint returns { code, reply }. Wire up Gemini, Claude, or anything else.'],
              ['Persisted per user', 'Generated UI is saved under a per-user storage key and reloaded automatically.'],
            ].map(([t, b]) => (
              <li key={t} className="flex gap-3 text-left">
                <span className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">{t}</div>
                  <div className="text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400 mt-0.5">{b}</div>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>

        <Reveal delay={120} className="w-full min-w-0 overflow-hidden">
          <EditorFrame file="page.jsx">
            <div>
              <span>{com('// 1. Register the capabilities your app exposes')}</span>
              {'\n'}
              {kw('const')} {pl('registry = {')}
              {'\n'}
              {'  '}{prop('dataSources')}{pl(': [')}
              {'\n'}
              {'    '}{pl('{')}
              {'\n'}
              {'      '}{prop('id')}{pl(': ')}{str("'tasks'")}{pl(',')}
              {'\n'}
              {'      '}{prop('description')}{pl(': ')}{str("'The user’s tasks.'")}
              {'\n'}
              {'    '}{pl('}')}
              {'\n'}
              {'  '}{pl('],')}
              {'\n'}
              {'  '}{prop('actions')}{pl(': [')}
              {'\n'}
              {'    '}{pl('{ ')}{prop('id')}{pl(': ')}{str("'createTask'")}{pl(',  ')}{prop('description')}{pl(': ')}{str("'Create a task.'")}{pl(' },')}
              {'\n'}
              {'    '}{pl('{ ')}{prop('id')}{pl(': ')}{str("'updateTask'")}{pl(',  ')}{prop('description')}{pl(': ')}{str("'Update a task.'")}{pl(' },')}
              {'\n'}
              {'    '}{com('// no deleteTask → generated UIs can never delete')}
              {'\n'}
              {'  '}{pl('],')}
              {'\n'}
              {pl('};')}
              {'\n\n'}
              <span>{com('// 2. Pass the REAL implementations + live data')}</span>
              {'\n'}
              {pl('<')}{fn('VeneerProvider')}
              {'\n'}
              {'  '}{prop('registry')}{pl('={registry}')}
              {'\n'}
              {'  '}{prop('actions')}{pl('={actions}')}
              {'\n'}
              {'  '}{prop('data')}{pl('={{ tasks }}>')}
              {'\n'}
              {'  '}{pl('<')}{fn('VeneerCanvas')} {prop('minHeight')}{pl('={')}{num('620')}{pl('} />')}
              {'\n'}
              {'  '}{pl('<')}{fn('YourChatBox')} {pl('/>  ')}{com('// built on useVeneerGenerate()')}
              {'\n'}
              {pl('</')}{fn('VeneerProvider')}{pl('>')}
            </div>
          </EditorFrame>
          <p className="mt-4 text-center text-sm text-slate-400 dark:text-slate-500">
            That’s the whole integration. The registry is the contract; the sandbox is the guarantee.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* Floating "X just joined" social-proof toast — cycles through recent signups. */
function WaitlistToast() {
  const signups = [
    ['Andreas', 'Berlin', '5 min'],
    ['Mia', 'San Francisco', '12 min'],
    ['Tomás', 'Lisbon', '23 min'],
    ['Priya', 'Bangalore', '38 min'],
    ['Jonas', 'Oslo', '51 min'],
    ['Sara', 'Toronto', '1 hr'],
  ];
  const [idx, setIdx] = useState(-1);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let i = 0;
    let hideT;
    const cycle = () => {
      setIdx(i % signups.length);
      setShow(true);
      i += 1;
      hideT = setTimeout(() => setShow(false), 4500);
    };
    const startT = setTimeout(cycle, 4000);
    const loop = setInterval(cycle, 11000);
    return () => {
      clearTimeout(startT);
      clearTimeout(hideT);
      clearInterval(loop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (idx < 0) return null;
  const [name, city, ago] = signups[idx];
  return (
    <div
      className={`fixed bottom-4 right-5 z-40 max-w-[calc(100vw-2.5rem)] transition-all duration-500 ${
        show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-6 opacity-0'
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-card backdrop-blur dark:border-white/10 dark:bg-[#0b1020]/90">
        <span className="relative flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-sm font-semibold text-white">
          {name[0]}
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500 dark:border-[#0b1020]" />
        </span>
        <div className="min-w-0">
          <div className="text-sm text-slate-800 dark:text-slate-100">
            <span className="font-semibold">{name}</span> from {city}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">joined the waitlist · {ago} ago</div>
        </div>
      </div>
    </div>
  );
}

/* ============================ FAQ ============================ */
function Faq() {
  const qs = [
    [
      'Is the generated code actually safe to run?',
      'That’s the core of the product. Generated code runs in a JavaScript interpreter (QuickJS compiled to WebAssembly) inside a Web Worker, where window, document, fetch, location and cookies simply do not exist. It can only describe what to draw; your page redraws that through an allowlist that drops links, images, scripts and url() styles, and a bridge that only runs actions you registered with the args you declared. Code is statically scanned before it runs, every entry has a CPU deadline, and if a generation ever hangs the worker is terminated, the canvas is reset and your app is notified. Only push data you would show that user on screen anyway — the SDK docs spell out every residual.',
    ],
    [
      'Do I have to ship my source code?',
      'No. You keep your code and pass the real action implementations into the provider. The model only ever sees the registry’s plain-English descriptions and ids — never your implementations.',
    ],
    [
      'Which AI model does it use?',
      'Whichever you want. Your generator endpoint returns { code, reply }, so you can wire up Gemini, Claude, or any other model. The demo uses gemini-2.5-flash.',
    ],
    [
      'Can a user break something or delete data?',
      'Only if you registered an action for it. If there is no deleteTask in the registry, the scanner refuses code that calls it and the bridge rejects the call at runtime. Registered actions are validated against their declared args and rate-limited before your implementation runs.',
    ],
    [
      'How does the waitlist work?',
      'Veneer is in private beta. Join the waitlist and we’ll send an invite as access opens up in batches — no spam, just your invite.',
    ],
  ];
  return (
    <section className="mx-auto max-w-3xl px-5 py-24">
      <SectionHeading eyebrow="FAQ" title="Questions, answered." />
      <div className="mt-12 divide-y divide-slate-200 border-y border-slate-200 dark:divide-white/10 dark:border-white/10">
        {qs.map(([q, a], i) => (
          <Reveal key={q} delay={i * 50} as="details" className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
              <span className="font-semibold text-slate-900 dark:text-white">{q}</span>
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full border border-slate-300 text-slate-400 transition-transform group-open:rotate-45 dark:border-white/20 dark:text-slate-500">
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{a}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ============================ FINAL CTA ============================ */
function FinalCta() {
  return (
    <section id="waitlist" className="relative scroll-mt-[72px] overflow-hidden bg-slate-50 py-24 text-slate-900 dark:bg-[#070b18] dark:text-white">
      <div className="pointer-events-none absolute inset-0 aurora animate-gradient-pan opacity-50 dark:opacity-70" />
      <div className="pointer-events-none absolute inset-0 grid-mask-light dark:hidden" />
      <div className="pointer-events-none absolute inset-0 hidden grid-mask dark:block" />
      <Reveal className="relative mx-auto max-w-3xl px-5 text-center">
        <h2 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Give your users a canvas,
          <br />
          <span className="bg-gradient-to-r from-brand-700 to-violet-600 bg-clip-text text-transparent dark:from-brand-300 dark:to-violet-400">
            not just a theme picker.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600 dark:text-slate-300">
          Rethink the last mile of software delivery. Ship the primitives — let your users
          design the interface they actually want. Join the waitlist for early access.
        </p>

        <div className="mx-auto mt-9 max-w-md">
          <WaitlistForm />
        </div>
        <div className="mt-6 flex justify-center">
          <WaitlistProof ring="ring-slate-50 dark:ring-[#070b18]" />
        </div>
      </Reveal>
    </section>
  );
}

/* ============================ FOOTER ============================ */
function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white dark:border-white/10 dark:bg-[#070b18]">
      <div className="mx-auto max-w-6xl px-5 py-12">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row">
          <div className="max-w-xs">
            <div className="flex items-center gap-2.5">
              <VeneerLogo size={26} />
              <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">Veneer</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              An MCP for in-app personalization. Let your users redesign your app with AI — inside a
              hard security sandbox.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm sm:grid-cols-3">
            {[
              ['Product', [['How it works', '#how'], ['Live demo', '#demo'], ['Features', '#features']]],
              ['Resources', [['Docs', '/docs'], ['Security', '#security'], ['Join waitlist', '#waitlist']]],
              ['Legal', [['Terms', '/terms'], ['Privacy', '/privacy']]],
            ].map(([group, items]) => (
              <div key={group}>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group}
                </div>
                <ul className="space-y-1.5">
                  {items.map(([label, href]) => (
                    <li key={label}>
                      <a href={href} className="text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-6 text-sm text-slate-400 dark:border-white/10 dark:text-slate-500 sm:flex-row">
          <span>
            © {new Date().getFullYear()} Veneer · a product of{' '}
            <a
              href="https://alpovka.github.io/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              AlpovkaApps
            </a>
          </span>
          <span>Next level personalization.</span>
        </div>
      </div>
    </footer>
  );
}

/* ============================ SHARED ============================ */
function SectionHeading({ eyebrow, title, sub, align = 'center' }) {
  const center = align === 'center';
  return (
    <div className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-xl'}>
      {eyebrow && (
        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-brand-600 dark:border-white/10 dark:bg-white/5 dark:text-brand-300">
          {eyebrow}
        </span>
      )}
      <h2 className="mt-4 text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight break-words">{title}</h2>
      {sub && <p className={`mt-4 text-slate-600 dark:text-slate-400 text-sm sm:text-base leading-relaxed ${center ? 'mx-auto' : ''}`}>{sub}</p>}
    </div>
  );
}

function UserIcon() {
  return (
    <div className="relative">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-white/10 dark:text-slate-500">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="4" fill="currentColor" />
          <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" fill="currentColor" />
        </svg>
      </div>
      <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white shadow">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor" />
          <path d="M8 11V8a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      </span>
    </div>
  );
}
