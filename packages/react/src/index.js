export { VeneerProvider, useVeneer, hashRegistry } from './context.js';
// The engine: generated code runs in a QuickJS interpreter inside a Web Worker; the host draws.
export { VeneerCanvas, DEFAULT_WORKER_URL, hasWarmWorker } from './engine/VeneerCanvas.js';
// Legacy iframe engine, kept one release for hosts that have not migrated. VeneerCanvas is the
// default; VeneerFrame will be removed.
export { VeneerFrame } from './VeneerFrame.js';
export { useVeneerGenerate } from './useVeneerGenerate.js';
// Re-exported for hosts that test their registries or build custom canvases.
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
