'use client';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

/**
 * The Veneer context exposes, to every Veneer component:
 *  - registry: the developer-declared capabilities (data sources + actions, each described in plain natural language)
 *  - actions:  the REAL implementations of those actions (functions the host app provides)
 *  - data:     the current live data for each registered data source
 *  - ui:       the current generated UI (a self-contained component, as a code string)
 *  - setUi / reset: swap or revert the generated UI
 *
 * Persistence is controlled by the `persist` prop:
 *  - 'local'   (default) → localStorage: survives reloads and browser restarts (per-user, private)
 *  - 'session'           → sessionStorage: survives reloads, cleared when the tab closes
 *  - 'memory' | false    → in-memory only: reverts to the default on reload
 *
 * The registry is the security contract. A generated UI can only ever invoke an action
 * whose id appears in `registry.actions` — see bridge.js.
 */
const VeneerContext = createContext(null);

export function useVeneer() {
  const ctx = useContext(VeneerContext);
  if (!ctx) throw new Error('useVeneer() must be used inside a <VeneerProvider>.');
  return ctx;
}

const STORAGE_KEY = 'veneer-ui';

// Resolve the backing store for the chosen persistence mode (null = in-memory only).
function getStore(persist) {
  try {
    if (persist === 'session') return typeof window !== 'undefined' ? window.sessionStorage : null;
    if (persist === 'local' || persist === true) return typeof window !== 'undefined' ? window.localStorage : null;
  } catch (e) {
    /* storage can throw (privacy mode, disabled cookies) — fall back to memory */
  }
  return null;
}

export function VeneerProvider({ registry, actions, data, defaultUI = '', persist = 'local', children }) {
  const [ui, setUiState] = useState(defaultUI);
  const [loaded, setLoaded] = useState(false);

  // Hydrate from the chosen store (if any) on mount. In 'memory' mode this just flips `loaded`.
  useEffect(() => {
    const store = getStore(persist);
    if (store) {
      try {
        const saved = store.getItem(STORAGE_KEY);
        if (saved != null) setUiState(saved);
      } catch (e) {
        /* ignore read failures; fall back to defaultUI */
      }
    }
    setLoaded(true);
  }, [persist]);

  const setUi = useCallback(
    (code) => {
      setUiState(code);
      const store = getStore(persist);
      if (store) {
        try {
          store.setItem(STORAGE_KEY, code);
        } catch (e) {
          /* ignore persistence failures */
        }
      }
    },
    [persist]
  );

  const reset = useCallback(() => {
    const store = getStore(persist);
    if (store) {
      try {
        store.removeItem(STORAGE_KEY);
      } catch (e) {
        /* ignore */
      }
    }
    setUiState(defaultUI);
  }, [persist, defaultUI]);

  const value = { registry, actions, data, ui, setUi, reset, loaded, defaultUI };
  return <VeneerContext.Provider value={value}>{children}</VeneerContext.Provider>;
}
