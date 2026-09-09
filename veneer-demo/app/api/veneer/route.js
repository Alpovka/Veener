import { GoogleGenAI } from '@google/genai';

export const runtime = 'nodejs';

const MODEL = 'gemini-2.5-flash';

/**
 * The UI generator. Receives { message, registry, currentUI, history } and returns
 * { code, reply }. `code` is a self-contained component that renders using the in-frame API
 * (window.veneer.action / window.veneer.data). It can ONLY call registered action ids; the
 * sandbox + bridge enforce that regardless of what the model writes.
 */
export async function POST(req) {
  try {
    const { message, registry, currentUI, history } = await req.json();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json(
        { error: 'GEMINI_API_KEY is not set. Copy .env.local.example to .env.local and add your key.' },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });

    // Gemini uses 'user' / 'model' roles and a parts array per turn.
    const contents = [];
    (history || []).forEach((m) => {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content) }],
      });
    });
    contents.push({ role: 'user', parts: [{ text: buildUserPrompt(message, currentUI) }] });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: buildSystemPrompt(registry),
        maxOutputTokens: 16000,
        temperature: 0.7,
        // Ask the model for a raw JSON object so we can parse it directly.
        responseMimeType: 'application/json',
      },
    });

    const text = response.text || '';

    const parsed = extractJson(text);
    if (!parsed) {
      return Response.json({ code: null, reply: text || "Sorry, I couldn't generate that. Try rephrasing." });
    }

    return Response.json({
      code: parsed.code != null ? String(parsed.code) : null,
      reply: parsed.reply != null ? String(parsed.reply) : '',
    });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 500 });
  }
}

function buildSystemPrompt(registry) {
  const reg = JSON.stringify(registry || {}, null, 2);
  return `You are Veneer, a UI generator embedded in a host web application. The end user will
describe how they want the current page to look, and you generate the UI for it.

You have FULL creative freedom over layout and design — invent any layout the request calls for
(kanban board, calendar, dashboard, timeline, gallery, anything). But you operate inside a hard
security sandbox: your code runs in an isolated iframe with no network access and no access to the
host page. Your ONLY connection to the app is a small in-frame API.

RESPONSE FORMAT — respond with ONLY a single JSON object, no prose, no markdown fences:
{
  "code": "<a self-contained React component, as a string>",
  "reply": "<one or two friendly sentences to show the user>"
}

THE CODE YOU WRITE:
- Is plain JSX. These globals are already available — DO NOT import anything, DO NOT use export:
  React, useState, useEffect, useMemo, useCallback, useRef, veneer, render.
- Defines a component (e.g. function VeneerUI() { ... }) and ends by calling render(<VeneerUI />).
- Reads data ONLY via veneer.data(sourceId) — returns the current value (usually an array).
- Triggers actions ONLY via veneer.action(id, args) — returns a Promise. After an action runs,
  fresh data is pushed in automatically and your component re-renders, so just call the action.
- Styles with Tailwind CSS utility classes (Tailwind is available in the sandbox). Make it polished,
  modern, and visually distinct — good spacing, rounded corners, subtle shadows, clear hierarchy.
- MUST NOT use fetch, XMLHttpRequest, WebSocket, cookies, localStorage, or any external URL/script —
  none of them work in the sandbox (connect-src is 'none') and the request will fail to render.

CAPABILITY RULES (this is the contract — follow it exactly):
- You may ONLY call veneer.action(id, ...) with an action id that appears in the registry below.
- You may ONLY call veneer.data(id) with a data source id that appears in the registry below.
- If the user asks for something that has NO matching registered capability (for example, deleting a
  record when no delete action is registered), DO NOT invent it and DO NOT fake it. Instead, set
  "code" to null (keep the current UI), and in "reply" politely explain that the action isn't
  available in this app, naming what you can do instead.

REGISTERED CAPABILITIES:
${reg}

Each data source lists its fields. Each action lists its args — pass exactly those.`;
}

function buildUserPrompt(message, currentUI) {
  const cur = currentUI ? String(currentUI) : '(none yet)';
  return `User request: ${message}

For reference, the current UI code is:
\`\`\`
${cur}
\`\`\`

Generate the new UI (or, if the request needs a capability that isn't registered, set code to null
and explain in reply). Respond with ONLY the JSON object.`;
}

// Robustly pull the JSON object out of the model's response.
function extractJson(text) {
  if (!text) return null;
  let candidate = text.trim();

  // Strip ```json ... ``` fences if present.
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();

  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Fall back to the first { ... last } span.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}
