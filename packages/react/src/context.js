'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { resolveTheme, loadThemeFonts, themePayload as buildThemePayload, hashRegistryShape } from '@veneer/core';

export const hashRegistry = hashRegistryShape;

/**
 * The Veneer context exposes, to every Veneer component:
 *  - registry:   the developer-declared capabilities (data sources + actions, described in plain language)
 *  - actions:    the REAL implementations of those actions (functions the host app provides)
 *  - data:       the current live data for each registered data source
 *  - ui:         the current generated UI (a self-contained component, as a code string)
 *  - generation: bumps whenever the UI must be re-mounted in a FRESH sandbox document
 *  - violation:  the last security violation (frame navigated / unresponsive / failed the scan), if any
 *  - theme / resolvedMode / themePayload: the host brand (see theme.js) as validated tokens, the
 *                current light/dark mode, and the payload the frame receives
 *  - setUi / reset / flagViolation / restoreQuarantined
 *
 * Persistence (`persist` prop): 'local' (default) → localStorage; 'session' → sessionStorage;
 * 'memory' | false → none. The storage key is `storageKey` (default 'veneer-ui'). Use a per-user
 * key (e.g. `veneer-ui:${userId}`) on shared devices, and a distinct key per provider instance.
 * Stored UIs are tagged with a hash of the registry; if the registry changes they are ignored.
 *
 * The registry is the security contract. A generated UI can only ever invoke an action whose id
 * appears in `registry.actions`, with args matching that definition — see bridge.js.
 */
const VeneerContext = createContext(null);

export function useVeneer() {
  const ctx = useContext(VeneerContext);
  if (!ctx) throw new Error('useVeneer() must be used inside a <VeneerProvider>.');
  return ctx;
}

const ENVELOPE_VERSION = 1;
const VIOLATION_WINDOW_MS = 30000;
const MAX_VIOLATIONS_PER_WINDOW = 3;

function getStore(persist) {
  try {
    if (persist === 'session') return typeof window !== 'undefined' ? window.sessionStorage : null;
    if (persist === 'local' || persist === true) return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (e) {
    /* storage can throw (privacy mode, disabled cookies) — fall back to memory */
  }
  return null;
}

function readStored(store, key, registryHash) {
  try {
    const raw = store.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === ENVELOPE_VERSION && typeof parsed.code === 'string') {
      if (parsed.registryHash && parsed.registryHash !== registryHash) return null;
      return parsed.code;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export function VeneerProvider({
  registry,
  actions,
  data,
  defaultUI = '',
  persist = 'local',
  storageKey = 'veneer-ui',
  onSecurityViolation,
  theme: themeProp,
  onThemeError,
  children,
}) {
  const [ui, setUiState] = useState(defaultUI);
  const [loaded, setLoaded] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [violation, setViolation] = useState(null);
  const violationTimes = useRef([]);
  const registryHash = useMemo(() => hashRegistry(registry), [registry]);
  const quarantineKey = storageKey + ':quarantine';

  // ---- Branding ------------------------------------------------------------------------------
  // Resolve by value so hosts can pass an inline object without re-triggering work every render.
  const themeKey = useMemo(() => JSON.stringify(themeProp || {}), [themeProp]);
  const resolvedTheme = useMemo(() => resolveTheme(themeProp), [themeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hosts usually pass inline callbacks; read them through refs so a new identity per render does
  // not re-fire the theme report (or re-run any effect) on every render.
  const onThemeErrorRef = useRef(onThemeError);
  const onSecurityViolationRef = useRef(onSecurityViolation);
  onThemeErrorRef.current = onThemeError;
  onSecurityViolationRef.current = onSecurityViolation;
  const reportThemeError = useCallback((e) => {
    const cb = onThemeErrorRef.current;
    if (typeof cb !== 'function') return;
    try {
      cb(e);
    } catch (err) {
      /* host callback errors must not break the SDK */
    }
  }, []);
  useEffect(() => {
    if (resolvedTheme.problems.length) reportThemeError({ type: 'theme-invalid', problems: resolvedTheme.problems });
  }, [resolvedTheme, reportThemeError]);

  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (resolvedTheme.theme.mode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(!!mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener('change', update);
    else mq.addListener(update);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', update);
      else mq.removeListener(update);
    };
  }, [resolvedTheme.theme.mode]);
  const resolvedMode = resolvedTheme.theme.mode === 'system' ? (systemDark ? 'dark' : 'light') : resolvedTheme.theme.mode;

  const [themeFonts, setThemeFonts] = useState([]);
  const fontsKey = useMemo(() => JSON.stringify(resolvedTheme.theme.fonts), [resolvedTheme]);
  useEffect(() => {
    let cancelled = false;
    const fonts = resolvedTheme.theme.fonts;
    if (!fonts.length) {
      setThemeFonts([]);
      return undefined;
    }
    loadThemeFonts(fonts, { onError: reportThemeError }).then((loaded) => {
      if (!cancelled) setThemeFonts(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [fontsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const themePayload = useMemo(() => buildThemePayload(resolvedTheme, resolvedMode, themeFonts), [resolvedTheme, resolvedMode, themeFonts]);

  // Hydrate from the chosen store (if any) on mount. In 'memory' mode this just flips `loaded`.
  useEffect(() => {
    const store = getStore(persist);
    if (store) {
      const saved = readStored(store, storageKey, registryHash);
      if (saved != null) {
        setUiState(saved);
        setGeneration((g) => g + 1);
      }
    }
    setLoaded(true);
  }, [persist, storageKey, registryHash]);

  const setUi = useCallback(
    (code) => {
      if (typeof code !== 'string') return;
      setUiState(code);
      setViolation(null);
      setGeneration((g) => g + 1);
      const store = getStore(persist);
      if (store) {
        try {
          store.setItem(storageKey, JSON.stringify({ v: ENVELOPE_VERSION, code, registryHash, savedAt: Date.now() }));
        } catch (e) {
          /* ignore persistence failures */
        }
      }
    },
    [persist, storageKey, registryHash]
  );

  const reset = useCallback(() => {
    const store = getStore(persist);
    if (store) {
      try {
        store.removeItem(storageKey);
      } catch (e) {
        /* ignore */
      }
    }
    setViolation(null);
    setUiState(defaultUI);
    setGeneration((g) => g + 1);
  }, [persist, storageKey, defaultUI]);

  /**
   * Called by VeneerFrame when the sandbox misbehaved. Quarantines the offending code (so the
   * host can inspect or restore it), reverts to the default UI in a fresh document, and reports.
   * Never remounts in a loop: if the default UI itself is the offender, or violations are
   * arriving repeatedly, the canvas stays torn down until the user resets.
   */
  const flagViolation = useCallback(
    (info) => {
      const now = Date.now();
      const offending = typeof (info && info.code) === 'string' ? info.code : ui;
      const store = getStore(persist);
      if (store) {
        try {
          store.removeItem(storageKey);
          store.setItem(quarantineKey, JSON.stringify({ v: ENVELOPE_VERSION, code: offending, reason: info && info.reason, at: now }));
        } catch (e) {
          /* ignore */
        }
      }
      violationTimes.current = violationTimes.current.filter((t) => now - t < VIOLATION_WINDOW_MS).concat(now);
      const tooMany = violationTimes.current.length > MAX_VIOLATIONS_PER_WINDOW;
      const isDefault = offending === defaultUI;
      const record = { ...(info || {}), at: now, remounted: !isDefault && !tooMany, quarantined: !!store };
      setViolation(record);
      if (!isDefault) setUiState(defaultUI);
      if (record.remounted) setGeneration((g) => g + 1);
      const cb = onSecurityViolationRef.current;
      if (typeof cb === 'function') {
        try {
          cb(record);
        } catch (e) {
          /* host callback errors must not break the SDK */
        }
      }
    },
    [ui, defaultUI, persist, storageKey, quarantineKey]
  );

  /** Bring back the quarantined UI (host decision; it will run in a fresh sandbox and be re-scanned). */
  const restoreQuarantined = useCallback(() => {
    const store = getStore(persist);
    if (!store) return false;
    try {
      const raw = store.getItem(quarantineKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.code !== 'string') return false;
      store.removeItem(quarantineKey);
      setUi(parsed.code);
      return true;
    } catch (e) {
      return false;
    }
  }, [persist, quarantineKey, setUi]);

  const clearViolation = useCallback(() => setViolation(null), []);

  const value = {
    registry,
    actions,
    data,
    ui,
    setUi,
    reset,
    loaded,
    defaultUI,
    generation,
    violation,
    flagViolation,
    restoreQuarantined,
    clearViolation,
    storageKey,
    theme: resolvedTheme.theme,
    themeVars: resolvedTheme.vars,
    resolvedMode,
    themeFonts,
    themePayload,
  };
  return <VeneerContext.Provider value={value}>{children}</VeneerContext.Provider>;
}
