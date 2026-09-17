// Type declarations for @veneer/react (hand-maintained; the runtime is plain JavaScript).
import type { CSSProperties, ReactNode, ReactElement } from 'react';
import type { Registry, ActionImplementations, PartialTheme, Theme, LoadedFont } from '@veneer/core';

export {
  runBridgeAction,
  validateArgs,
  pickRegisteredData,
  filterActionResult,
  BridgeError,
  resolveTheme,
  themeFromCSSVariables,
  THEME_UTILITIES,
  DEFAULT_THEME,
} from '@veneer/core';
export type { Registry, RegistryAction, RegistryDataSource, RegistryArg, RegistryField, ActionImplementations, PartialTheme, Theme } from '@veneer/core';

export type ViolationReason = 'frame-navigated' | 'frame-unresponsive' | 'scan-violation' | string;

export interface SecurityViolation {
  reason: ViolationReason;
  detail?: unknown;
  /** The generated code that was running when the violation happened. */
  code?: string;
  protocol?: number;
  at: number;
  /** `false` when the provider refuses to remount (default UI offended, or too many violations); only `reset()` recovers. */
  remounted: boolean;
  quarantined: boolean;
}

export interface VeneerProviderProps {
  registry: Registry;
  actions: ActionImplementations;
  data?: Record<string, unknown>;
  /** Code shown before any generation and after a reset. */
  defaultUI?: string;
  /** 'local' (default) → localStorage, 'session' → sessionStorage, 'memory' | false → none. */
  persist?: 'local' | 'session' | 'memory' | boolean;
  /** Use a per-user key (e.g. `veneer-ui:${userId}`) on shared devices. */
  storageKey?: string;
  onSecurityViolation?: (violation: SecurityViolation) => void;
  theme?: PartialTheme;
  onThemeError?: (e: { type: string; [k: string]: unknown }) => void;
  children?: ReactNode;
}

export interface VeneerContextValue {
  registry: Registry;
  actions: ActionImplementations;
  data: Record<string, unknown> | undefined;
  ui: string;
  setUi(code: string): void;
  reset(): void;
  loaded: boolean;
  defaultUI: string;
  generation: number;
  violation: SecurityViolation | null;
  flagViolation(info: Partial<SecurityViolation>): void;
  restoreQuarantined(): boolean;
  clearViolation(): void;
  storageKey: string;
  theme: Theme;
  themeVars: { light: Record<string, string>; dark: Record<string, string> };
  resolvedMode: 'light' | 'dark';
  themeFonts: LoadedFont[];
  themePayload: unknown;
}

export function VeneerProvider(props: VeneerProviderProps): ReactElement | null;
export function useVeneer(): VeneerContextValue;
export function hashRegistry(registry: Registry | undefined): string;

export interface FrameError {
  type: 'post-failed' | 'action-rejected' | 'frame-error' | 'scan-violation' | 'runtime-timeout' | string;
  message?: string;
  [k: string]: unknown;
}

export interface VeneerFrameProps {
  className?: string;
  style?: CSSProperties;
  /** Serve the sandbox document from a URL (recommended; avoids inheriting the host page's CSP). */
  frameSrc?: string;
  onError?: (err: FrameError) => void;
  onSecurityViolation?: (info: { reason: ViolationReason; detail?: unknown; code?: string; protocol: number }) => void;
  actionTimeoutMs?: number;
  heartbeatMs?: number;
  maxMissedHeartbeats?: number;
  readyTimeoutMs?: number;
  validation?: 'on' | 'off';
  rateLimit?: { ratePerSec?: number; burst?: number };
  /** Size the iframe to its content (default true). */
  autoHeight?: boolean;
  minHeight?: number;
  maxHeight?: number;
}

export function VeneerFrame(props: VeneerFrameProps): ReactElement | null;

export type Intent = 'design' | 'chat' | 'clarify';

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  changed?: boolean;
  intent?: Intent;
  error?: boolean;
}

export type GenerateOutcome =
  | { ok: true; changed: boolean; intent: Intent; reply: string; blocked?: boolean }
  | { ok: false; error: string; code?: string; reason?: string };

export interface UseVeneerGenerateOptions {
  /** Default '/api/veneer'. */
  endpoint?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** Default true. Only responses that carry code need a token. */
  requireLicense?: boolean;
  publicKeys?: string[];
}

export interface UseVeneerGenerateResult {
  generate(message: string): Promise<GenerateOutcome | null>;
  cancel(): void;
  busy: boolean;
  error: string | null;
  history: HistoryTurn[];
  reply: string | null;
  undo(): boolean;
  canUndo: boolean;
  clearHistory(): void;
  reset(): void;
  violation: SecurityViolation | null;
  clearViolation(): void;
  currentUI: string;
}

export function useVeneerGenerate(options?: UseVeneerGenerateOptions): UseVeneerGenerateResult;
