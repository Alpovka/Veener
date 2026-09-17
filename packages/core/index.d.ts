// Type declarations for @veneer/core (hand-maintained; the runtime is plain JavaScript).

export interface RegistryField {
  name: string;
  type?: string;
  description?: string;
}

export interface RegistryDataSource {
  id: string;
  description?: string;
  fields?: RegistryField[];
}

export interface RegistryArg {
  name: string;
  type?: string;
  description?: string;
  required?: boolean;
}

export interface RegistryAction {
  id: string;
  description?: string;
  args?: RegistryArg[];
  /** Declare to let generated code see the return value; otherwise it receives `undefined`. */
  returns?: boolean | string;
  /** Your own argument validation; return `false` or a string (the reason) to reject. */
  validate?: (args: Record<string, unknown>) => boolean | string | void;
}

export interface Registry {
  dataSources?: RegistryDataSource[];
  actions?: RegistryAction[];
}

export type ActionImplementations = Record<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>;

// ---- bridge -----------------------------------------------------------------------------------

export const DEFAULT_LIMITS: { maxBytes: number; maxDepth: number };

export class BridgeError extends Error {
  name: 'BridgeError';
  code: string;
  constructor(message: string, code?: string);
}

export function typeChecker(typeText: string | undefined): ((value: unknown) => boolean) | null;
export function validateArgs(
  def: RegistryAction,
  args: unknown,
  options?: { validation?: 'on' | 'off'; limits?: Partial<typeof DEFAULT_LIMITS> }
): Record<string, unknown>;
export function runBridgeAction(params: {
  registry: Registry;
  actions: ActionImplementations;
  action: unknown;
  args: unknown;
  validation?: 'on' | 'off';
  limits?: Partial<typeof DEFAULT_LIMITS>;
}): Promise<unknown>;
export function filterActionResult(def: RegistryAction | undefined, result: unknown): unknown;
export function readDataSource(params: { registry: Registry; data: Record<string, unknown>; source: string }): unknown;
export function pickRegisteredData(registry: Registry, data: Record<string, unknown> | undefined): Record<string, unknown>;
export function createRateLimiter(opts?: { ratePerSec?: number; burst?: number; now?: () => number }): { take(): boolean };

// ---- scanner ----------------------------------------------------------------------------------

export function createScanner(parser: unknown, traverse: unknown): (code: string, registry: Registry) => string[];
export function registryIds(registry: Registry): { actionIds: string[]; dataIds: string[] };

// ---- frame document ---------------------------------------------------------------------------

export const RUNTIME_SCRIPTS: ReadonlyArray<{ src: string; integrity?: string }>;
export const FRAME_CSP: string;
export const FRAME_SANDBOX: string;
export const PROTOCOL_VERSION: number;
export function buildFrameSrcDoc(): string;
export const buildFrameHtml: typeof buildFrameSrcDoc;

// ---- theme ------------------------------------------------------------------------------------

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemeColor = string | { light: string; dark: string };

export interface ThemeFont {
  family: string;
  src: string;
  weight?: string | number;
  style?: string;
}

export interface Theme {
  mode: ThemeMode;
  colors: Record<string, ThemeColor>;
  radius: Record<string, string>;
  font: { sans: string; mono: string; size: string };
  shadow: Record<string, string>;
  fonts: ThemeFont[];
}

export type PartialTheme = {
  [K in keyof Theme]?: K extends 'fonts' ? ThemeFont[] : K extends 'mode' ? ThemeMode : Partial<Theme[K]>;
};

export interface ResolvedTheme {
  theme: Theme;
  vars: { light: Record<string, string>; dark: Record<string, string> };
  problems: string[];
}

export interface LoadedFont {
  family: string;
  weight: string;
  style: string;
  format: string;
  dataUri: string;
}

export const THEME_UTILITIES: Record<string, string>;
export const DEFAULT_THEME: Theme;
export function resolveTheme(partial?: PartialTheme | null): ResolvedTheme;
export function hashTheme(resolved: ResolvedTheme): string;
export function themeFromCSSVariables(
  map: Record<string, string>,
  opts?: { element?: Element; getComputedStyle?: (el: Element) => CSSStyleDeclaration }
): PartialTheme;
export function loadThemeFonts(
  fonts: ThemeFont[],
  opts?: { fetch?: typeof fetch; maxBytes?: number; onError?: (e: { type: string; [k: string]: unknown }) => void }
): Promise<LoadedFont[]>;
export function themePayload(resolved: ResolvedTheme, mode: 'light' | 'dark', fonts: LoadedFont[]): unknown;

// ---- license tokens ---------------------------------------------------------------------------

export const LICENSE_PUBLIC_KEYS: string[];
export const DEV_TOKEN: string;
export const TOKEN_TTL_SECONDS: number;

export interface LicenseClaims {
  sub: string;
  plan?: string;
  evt: 'generation';
  reg?: string;
  iat: number;
  exp: number;
  [k: string]: unknown;
}

export type LicenseVerification =
  | { ok: true; claims: LicenseClaims }
  | { ok: false; reason: 'missing' | 'malformed' | 'unsupported' | 'unsupported-runtime' | 'bad-signature' | 'expired' | 'wrong-event' | 'registry-mismatch' | string };

export function signLicenseToken(
  claims: Partial<LicenseClaims> & { sub: string },
  privateKey: CryptoKey,
  opts?: { kid?: string; now?: () => number; ttl?: number }
): Promise<string>;
export function verifyLicenseToken(
  token: unknown,
  opts?: { publicKeys?: string[]; now?: () => number; registryHash?: string; clockSkewSeconds?: number }
): Promise<LicenseVerification>;
export function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }>;
export function importPublicKey(rawB64url: string): Promise<CryptoKey>;
export function importPrivateKey(pkcs8B64url: string): Promise<CryptoKey>;
export function isLocalHost(hostname: string): boolean;
export function b64urlEncode(bytes: Uint8Array): string;
export function b64urlDecode(s: string): Uint8Array;

// ---- registry ---------------------------------------------------------------------------------

export function hashRegistryShape(registry: Registry | undefined): string;
