import { GoogleGenAI } from '@google/genai';
import { createVeneerHandler } from 'veneer-sdk/server';
import { registry } from '../../veneer.config';

export const runtime = 'nodejs';

const MODEL = 'gemini-2.5-flash';

/**
 * The UI generator endpoint. `createVeneerHandler` owns everything security-relevant: it builds
 * the prompt from THIS registry (the client's copy is ignored), enforces same-site + JSON
 * requests, caps sizes, rate-limits per IP, times out the model call, and statically scans the
 * generated code against the registry before returning it. This file only knows how to talk to
 * Gemini.
 */
async function generate({ system, messages, signal }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set. Copy .env.local.example to .env.local and add your key.');
  const ai = new GoogleGenAI({ apiKey });
  // Gemini uses 'user' / 'model' roles and a parts array per turn.
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: system,
      maxOutputTokens: 12000,
      temperature: 0.7,
      responseMimeType: 'application/json',
      abortSignal: signal,
    },
  });
  return response.text || '';
}

export const POST = createVeneerHandler({
  registry,
  generate,
  rateLimit: { limit: 20, windowMs: 60000 },
  onError: (err, ctx) => console.error('[veneer]', err && err.message ? err.message : err, ctx),
});
