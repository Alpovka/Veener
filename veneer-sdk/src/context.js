'use client';
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';

/**
 * The Veneer context exposes, to every Veneer component:
 *  - registry:   the developer-declared capabilities (data sources + actions, described in plain language)
 *  - actions:    the REAL implementations of those actions (functions the host app provides)
 *  - data:       the current live data for each registered data source
 *  - ui:         the current generated UI (a self-contained component, as a code string)
 *  - generation: bumps whenever the UI must be re-mounted in a FRESH sandbox document
 *  - violation:  the last security violation (frame navigated / unresponsive / failed the scan), if any
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

/** Stable, cheap hash of the parts of the registry that define the capability surface. */
export function hashRegistry(registry) {
  const r = registry || {};
  const shape = JSON.stringify({
    a: (r.actions || []).map((a) => [a.id, (a.args || []).map((x) => x.name), !!a.returns]),
    d: (r.dataSources || []).map((d) => d.id),
  });
  let h = 5381;
  for (let i = 0; i < shape.length; i++) h = ((h * 33) ^ shape.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function readStored(store, key, registryHash) {
  try {
    const raw = store.getItem(key);
    if (raw == null) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return typeof raw === 'string' ? raw : null; // legacy: bare code string
    }
    if (typeof parsed === 'string') return parsed; // legacy JSON string
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
  children,
}) {
  const [ui, setUiState] = useState(defaultUI);
  const [loaded, setLoaded] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [violation, setViolation] = useState(null);
  const violationTimes = useRef([]);
  const registryHash = useMemo(() => hashRegistry(registry), [registry]);
  const quarantineKey = storageKey + ':quarantine';

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
      if (typeof onSecurityViolation === 'function') {
        try {
          onSecurityViolation(record);
        } catch (e) {
          /* host callback errors must not break the SDK */
        }
      }
    },
    [ui, defaultUI, persist, storageKey, quarantineKey, onSecurityViolation]
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
  };
  return <VeneerContext.Provider value={value}>{children}</VeneerContext.Provider>;
}
