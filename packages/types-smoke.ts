// Compile-only check that the hand-written declarations describe a usable API.
// Run with `npm run typecheck`; nothing here executes.
// Only the two published packages are imported here: @veneer/core is internal and bundled.
import { VeneerProvider, VeneerCanvas, VeneerFrame, DEFAULT_WORKER_URL, useVeneerGenerate, resolveTheme, type Registry } from '@veneer/react';
import { createVeneerHandler, buildFrameResponse, classifyIntent, verifyLicenseToken } from '@veneer/server';

const registry: Registry = {
  dataSources: [{ id: 'tasks', description: "The user's tasks.", fields: [{ name: 'id', type: 'string' }] }],
  actions: [{ id: 'createTask', description: 'Create a task.', args: [{ name: 'title', type: 'string', required: true }] }],
};

export const POST = createVeneerHandler({
  registry,
  licenseKey: 'vn_live_x',
  generate: async ({ system, messages, signal }) => `${system.length}${messages.length}${signal ? 1 : 0}`,
  brand: { name: 'Acme' },
  rateLimit: { limit: 10, windowMs: 60000 },
});
export const GET = () => buildFrameResponse({ frameAncestors: "'self'" });

export function Example() {
  const { generate, busy, history, undo, canUndo, violation } = useVeneerGenerate({ endpoint: '/api/veneer' });
  void generate;
  void busy;
  void history;
  void undo;
  void canUndo;
  void violation;
  return VeneerProvider({
    registry,
    actions: { createTask: async (args) => ({ id: String(args.title) }) },
    data: { tasks: [] },
    theme: { mode: 'dark', colors: { primary: '#0f766e' } },
    children: VeneerCanvas({
      workerUrl: DEFAULT_WORKER_URL,
      minHeight: 400,
      bleed: 200,
      onLog: (level, text) => void [level, text],
      onSecurityViolation: (v) => void v.reason,
    }),
  });
}

// The legacy iframe engine stays typed while it ships.
export const legacy = VeneerFrame({ frameSrc: '/veneer-frame', autoHeight: true, minHeight: 400 });

const guess = classifyIntent('make it a kanban');
const intent: 'design' | 'chat' | 'clarify' | 'unknown' = guess.intent;
void intent;

export async function verify(token: string) {
  const v = await verifyLicenseToken(token);
  if (v.ok) return v.claims.sub;
  return v.reason;
}

export const vars = resolveTheme({ colors: { primary: '#000' } }).vars.light;
