// Type declarations for @veneer/server (hand-maintained; the runtime is plain JavaScript).
import type { Registry } from '@veneer/core';

export { hashRegistryShape, verifyLicenseToken, LICENSE_PUBLIC_KEYS, FRAME_CSP, FRAME_SANDBOX } from '@veneer/core';
export type { Registry, RegistryAction, RegistryDataSource, RegistryArg, RegistryField, LicenseClaims, LicenseVerification } from '@veneer/core';

export type Intent = 'design' | 'chat' | 'clarify';
export const INTENTS: Intent[];

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type GenerationMode = 'edit' | 'design';

export interface GenerateRequest {
  system: string;
  messages: ChatTurn[];
  signal?: AbortSignal;
  /**
   * 'edit': a small tweak to the current UI; the model answers with a few search/replace edits
   * (a few hundred output tokens). Route these to a fast model with thinking off for near-instant
   * changes. 'design': a whole view.
   */
  mode: GenerationMode;
}

/** Your LLM call. Return the raw model text (JSON with { code | edits, reply, intent } is expected). */
export type GenerateFn = (req: GenerateRequest) => Promise<string> | string;

export interface Brand {
  name?: string;
  tone?: string;
}

export interface LicenseClient {
  /** Records one generation and returns a signed token; throws `LicenseError` when the license does not allow it. */
  assertGeneration(ctx: { registryHash: string }): Promise<{ token: string; plan?: string; remaining?: number; stale?: boolean }>;
}

export interface CloudOptions {
  apiKey: string;
  apiBase?: string;
  llm: { provider: 'gemini' | 'openai' | 'anthropic' | string; key: string; model?: string };
}

export interface HandlerOptions {
  registry: Registry;
  /** Required unless `cloud` is set. */
  generate?: GenerateFn;
  /** Self-hosted mode: verified against the Veneer license API on every generation. */
  licenseKey?: string;
  licenseApiBase?: string;
  /** `false` for local development: issues the DEV token, accepted by @veneer/react on localhost only. */
  license?: boolean;
  licenseClient?: LicenseClient;
  /** Veneer Cloud mode: the pipeline runs hosted, with your LLM key passed through. */
  cloud?: CloudOptions;
  brand?: Brand;
  /** `{ limit, windowMs }` for the in-memory default, your own `(key) => boolean`, or `false`. */
  rateLimit?: { limit?: number; windowMs?: number } | ((key: string) => Promise<boolean> | boolean) | false;
  /** Extra Origins allowed to call the endpoint (cross-origin embeds); adds CORS headers. */
  allowedOrigins?: string[];
  allowMissingFetchMetadata?: boolean;
  authorize?: (request: Request) => Promise<boolean> | boolean;
  onError?: (err: unknown, ctx: Record<string, unknown>) => void;
  maxBodyBytes?: number;
  timeoutMs?: number;
  maxHistory?: number;
  maxMessageChars?: number;
  maxHistoryTurnChars?: number;
  maxCurrentUIChars?: number;
  maxRepairRounds?: number;
  /** Maximum search/replace edits accepted in one edit-mode response. Default 30. */
  maxEdits?: number;
  /** Request small tweaks as search/replace edits against the current UI (default true). `false` always regenerates the whole view. */
  editMode?: boolean;
  /**
   * Image/link URL prefixes generated UI may use — pass the same object as the client's
   * `<VeneerCanvas allow>` / `<VeneerProvider allow>`, so the model is told what it may use.
   * Keywords: 'same-origin', 'https:', and (images) 'data:'. Default: none.
   */
  allow?: { images?: string[]; links?: string[] };
  fetch?: typeof fetch;
}

export const DEFAULT_HANDLER_OPTIONS: Required<
  Pick<HandlerOptions, 'maxBodyBytes' | 'timeoutMs' | 'allowedOrigins' | 'allowMissingFetchMetadata' | 'rateLimit' | 'maxHistory' | 'maxMessageChars' | 'maxHistoryTurnChars' | 'maxCurrentUIChars' | 'maxRepairRounds' | 'maxEdits' | 'editMode'>
>;
export const DEFAULT_CLOUD_API: string;
export const DEFAULT_LICENSE_API: string;
export const GENERATION_LIMITS: { maxHistory: number; maxMessageChars: number; maxHistoryTurnChars: number; maxCurrentUIChars: number; maxRepairRounds: number; maxEdits: number };

/** Returns a Fetch-API handler: `(request: Request) => Promise<Response>`. */
export function createVeneerHandler(opts: HandlerOptions): (request: Request) => Promise<Response>;
export function buildFrameResponse(opts?: { frameAncestors?: string }): Response;
export function createMemoryRateLimiter(opts?: { limit?: number; windowMs?: number; now?: () => number }): (key: string) => Promise<boolean>;
export function clientKey(request: Request): string;
export function checkRequestOrigin(
  request: Request,
  opts?: { allowedOrigins?: string[]; allowMissingFetchMetadata?: boolean }
): { ok: true } | { ok: false; status: number; error: string };

export interface GenerationResult {
  code: string | null;
  intent: Intent;
  reply: string;
  /** How the request was made: 'edit' (search/replace against the current UI) or 'design' (whole view). */
  mode: GenerationMode;
  /** True when `code` is the current UI with the model's edits applied. */
  edited?: boolean;
  /** True when an edit request could not be applied and the view was regenerated instead. */
  fallback?: boolean;
  blocked?: string[];
  repaired?: boolean;
}

export interface CodeEdit {
  /** Text copied verbatim from the current UI; must occur exactly once. */
  search: string;
  /** Replacement text ('' deletes). */
  replace: string;
}

export function runGeneration(params: {
  registry: Registry;
  generate: GenerateFn;
  message: string;
  history?: ChatTurn[];
  currentUI?: string;
  brand?: Brand;
  allow?: { images?: string[]; links?: string[] };
  signal?: AbortSignal;
  maxCurrentUIChars?: number;
  maxRepairRounds?: number;
  maxEdits?: number;
  editMode?: boolean;
  log?: (err: unknown, ctx: Record<string, unknown>) => void;
}): Promise<GenerationResult>;
export function scanGeneratedCode(code: string, registry: Registry): string[];
export function buildSystemPrompt(registry: Registry, opts?: { brand?: Brand; allow?: { images?: string[]; links?: string[] } }): string;
export function buildUserPrompt(message: string, currentUI: string, heuristic?: IntentGuess): string;
export function buildEditPrompt(message: string, currentUI: string, heuristic?: IntentGuess): string;
export function buildRepairPrompt(violations: string[]): string;
export function buildEditRepairPrompt(error: string): string;
/** Apply search/replace edits to code; whitespace-tolerant when a search does not match verbatim. */
export function applyEdits(code: string, edits: CodeEdit[], opts?: { maxEdits?: number }): { ok: true; code: string } | { ok: false; error: string };
/** Local read of whether a message is a small tweak to the current UI ('edit') or a new view ('design'). */
export function classifyScope(message: string, ctx?: { currentUI?: string; history?: ChatTurn[] }): GenerationMode;
export function extractJson(text: string): { code?: unknown; edits?: unknown; reply?: unknown; intent?: unknown } | null;
export function sanitizeHistory(history: unknown, opts?: { maxHistory?: number; maxHistoryTurnChars?: number }): ChatTurn[];

export interface IntentGuess {
  intent: Intent | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
}
export function classifyIntent(message: string, ctx?: { currentUI?: string }): IntentGuess;
export function resolveIntent(params: { modelIntent: unknown; hasCode: boolean; heuristic?: IntentGuess }): Intent;

export class LicenseError extends Error {
  name: 'LicenseError';
  status: number;
  code: string;
  constructor(message: string, status: number, code?: string);
}
export function createLicenseClient(opts: {
  licenseKey: string;
  apiBase?: string;
  fetch?: typeof fetch;
  graceMs?: number;
  now?: () => number;
  timeoutMs?: number;
  onError?: (err: unknown) => void;
}): LicenseClient;
