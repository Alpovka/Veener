import { GoogleGenAI } from '@google/genai';
import { createVeneerHandler } from '@veneer/server';
import { registry } from '../../veneer.config';

export const runtime = 'nodejs';
// The handler times the model out at 45 s (`timeoutMs`); give the function room to return a
// friendly error instead of being killed by the platform's default 10–15 s limit.
export const maxDuration = 60;

// Whole views: let the model think. Small edits: same model family, thinking off, short output —
// a tweak like "make that button collapsible" comes back in a second or two instead of ten.
const MODEL = process.env.VENEER_MODEL || 'gemini-2.5-flash';
const EDIT_MODEL = process.env.VENEER_EDIT_MODEL || 'gemini-2.5-flash';

/**
 * The UI generator endpoint. `createVeneerHandler` owns everything security-relevant: it builds
 * the prompt from THIS registry (the client's copy is ignored), enforces same-site + JSON
 * requests, caps sizes, rate-limits per IP, times out the model call, and scans + repairs the
 * generated code before returning it. It also decides the request `mode`: 'edit' asks for a few
 * search/replace edits against the current UI, 'design' for a whole component.
 *
 * Three ways to run it, chosen by environment:
 *   VENEER_CLOUD_API_KEY set     → Veneer Cloud runs the pipeline with the Gemini key below
 *   VENEER_LICENSE_KEY set       → self-hosted with a license check per generation
 *   neither (local development) → self-hosted, unlicensed DEV token (accepted on localhost only)
 */
async function generate({ system, messages, signal, mode }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set. Copy .env.local.example to .env.local and add your key.');
  const ai = new GoogleGenAI({ apiKey });
  const edit = mode === 'edit';
  const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const response = await ai.models.generateContent({
    model: edit ? EDIT_MODEL : MODEL,
    contents,
    config: {
      systemInstruction: system,
      maxOutputTokens: edit ? 4000 : 12000,
      temperature: edit ? 0.2 : 0.4,
      responseMimeType: 'application/json',
      abortSignal: signal,
      ...(edit ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  return response.text || '';
}

const common = {
  registry,
  rateLimit: { limit: 20, windowMs: 60000 },
  brand: { name: 'Veneer', tone: 'clean, modern, quietly confident' },
  onError: (err, ctx) => console.error('[veneer]', err && err.message ? err.message : err, ctx),
};

export const POST = process.env.VENEER_CLOUD_API_KEY
  ? createVeneerHandler({
      ...common,
      cloud: {
        apiKey: process.env.VENEER_CLOUD_API_KEY,
        apiBase: process.env.VENEER_CLOUD_API_BASE,
        llm: { provider: 'gemini', key: process.env.GEMINI_API_KEY, model: MODEL },
      },
    })
  : process.env.VENEER_LICENSE_KEY
    ? createVeneerHandler({ ...common, generate, licenseKey: process.env.VENEER_LICENSE_KEY, licenseApiBase: process.env.VENEER_LICENSE_API_BASE })
    : createVeneerHandler({ ...common, generate, license: false });
