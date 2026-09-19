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
  /** What generated UI may load: image and link URL prefixes. Default none (images dropped, links demoted to text). */
  allow?: AllowPolicy;
  children?: ReactNode;
}

/**
 * URL prefixes (`https://cdn.example.com/`) or the keywords `'same-origin'`, `'https:'` (any https
 * URL) and, for images only, `'data:'` (inline base64 images). Cross-origin links open in a new
 * tab with `rel="noopener noreferrer nofollow"`; images load lazily with no referrer.
 */
export interface AllowPolicy {
  images?: string[];
  links?: string[];
}

export interface EngineError {
  kind: 'render' | 'runtime' | 'compile' | string;
  stage?: string;
  message: string;
  /** The generated code that was running. */
  code?: string;
  at: number;
}

export interface VeneerContextValue {
  registry: Registry;
  actions: ActionImplementations;
  data: Record<string, unknown> | undefined;
  ui: string;
  /** `carryState: true` keeps the previous interpreter's component state across the swap (used for edits and undo). */
  setUi(code: string, opts?: { carryState?: boolean }): void;
  reset(): void;
  loaded: boolean;
  defaultUI: string;
  generation: number;
  carryState: boolean;
  violation: SecurityViolation | null;
  flagViolation(info: Partial<SecurityViolation>): void;
  restoreQuarantined(): boolean;
  clearViolation(): void;
  /** Last crash the engine reported for the current UI; cleared by setUi/reset. */
  engineError: EngineError | null;
  reportEngineError(err: Omit<EngineError, 'at'>): void;
  allow: AllowPolicy | null;
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

/** Legacy iframe engine. Kept one release; prefer `VeneerCanvas`. */
export function VeneerFrame(props: VeneerFrameProps): ReactElement | null;

/** Default URL the canvas loads the engine worker from (serve `dist/veneer-worker.js` there). */
export const DEFAULT_WORKER_URL: string;

export interface VeneerCanvasProps {
  className?: string;
  style?: CSSProperties;
  /** Same-origin URL of `dist/veneer-worker.js`. Default '/veneer-worker.js'. */
  workerUrl?: string;
  onError?: (err: FrameError) => void;
  /** console output from generated code (level, text). */
  onLog?: (level: string, text: string) => void;
  onSecurityViolation?: (info: { reason: ViolationReason; detail?: unknown; code?: string; protocol: number; engine: 'worker' }) => void;
  actionTimeoutMs?: number;
  heartbeatMs?: number;
  maxMissedHeartbeats?: number;
  readyTimeoutMs?: number;
  validation?: 'on' | 'off';
  rateLimit?: { ratePerSec?: number; burst?: number };
  /** Reserved height before the first render, so the page does not jump. Default 120. */
  minHeight?: number;
  /** How far (px) generated UI may hang below the canvas before it is clipped. Default 280. */
  bleed?: number;
  /**
   * Keep one spare engine worker booted in the background (QuickJS + Tailwind ready), so the next
   * generated UI swaps in without the ~1 s cold start. Default true. Costs one idle worker.
   */
  warm?: boolean;
  /** Image/link URL prefixes the renderer may load; overrides the provider's `allow`. Default none. */
  allow?: AllowPolicy;
  /**
   * Interpreter limits for heavy views, clamped in the worker: `entryMs` (per event/timer, 50–2000,
   * default 250), `initialEvalMs` (500–10000, default 2000), `memoryMB` (16–256, default 64),
   * `maxOpsPerFlush` (1000–100000, default 20000).
   */
  limits?: { entryMs?: number; initialEvalMs?: number; memoryMB?: number; maxOpsPerFlush?: number };
  /**
   * Persistent marker that the area is AI-generated, drawn above anything generated code can paint
   * (spoofing defence). A string (default 'AI-generated view'), a React node, or `false` to hide.
   */
  badge?: ReactNode | false;
}

/** Diagnostic: is a spare engine worker currently booted for this URL? */
export function hasWarmWorker(workerUrl?: string): boolean;

/**
 * The worker engine: generated code runs in a QuickJS interpreter inside a Web Worker and only
 * describes what to draw; your React draws it in your DOM through an allowlist. No iframe.
 */
export function VeneerCanvas(props: VeneerCanvasProps): ReactElement | null;

export type Intent = 'design' | 'chat' | 'clarify';

/** 'edit': the server applied a few search/replace edits to the current UI (fast path); 'design': a whole new view. */
export type GenerationMode = 'edit' | 'design';

export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
  changed?: boolean;
  intent?: Intent;
  mode?: GenerationMode;
  error?: boolean;
  /** Internal turn (the automatic runtime-repair request); do not render it. */
  hidden?: boolean;
  /** The assistant turn that answered a runtime-repair request. */
  repair?: boolean;
}

export type GenerateOutcome =
  | { ok: true; changed: boolean; intent: Intent; mode: GenerationMode; reply: string; blocked?: string[] }
  | { ok: false; error: string; code?: string; reason?: string };

export interface UseVeneerGenerateOptions {
  /** Default '/api/veneer'. */
  endpoint?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  /** Default true. Only responses that carry code need a token. */
  requireLicense?: boolean;
  publicKeys?: string[];
  /** Default true: when a freshly applied UI crashes, send one hidden turn asking the model to fix it. */
  repairOnError?: boolean;
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
