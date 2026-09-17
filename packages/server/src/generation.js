/**
 * The generation pipeline shared by the self-hosted handler and Veneer Cloud:
 * prompt → LLM (through a `generate` callback) → JSON extraction → static scan against the
 * registry → friendly refusal or code. Framework-free.
 */
import * as parser from '@babel/parser';
import traverseNs from '@babel/traverse';
import { createScanner, registryIds, THEME_UTILITIES } from '@veneer/core';
import { classifyIntent, resolveIntent } from './intent.js';

export { classifyIntent, resolveIntent, INTENTS } from './intent.js';

const traverse = typeof traverseNs === 'function' ? traverseNs : traverseNs.default;
const scan = createScanner(parser, traverse);

/** Scan generated code against a registry on the server (AST-based, scope-aware). */
export function scanGeneratedCode(code, registry) {
  return scan(code, registryIds(registry));
}

export const GENERATION_LIMITS = {
  maxHistory: 20,
  maxMessageChars: 4000,
  maxHistoryTurnChars: 4000,
  maxCurrentUIChars: 60000,
  maxRepairRounds: 1,
};

export function sanitizeHistory(history, { maxHistory = GENERATION_LIMITS.maxHistory, maxHistoryTurnChars = GENERATION_LIMITS.maxHistoryTurnChars } = {}) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-maxHistory)
    .map((m) => ({ role: m.role, content: m.content.slice(0, maxHistoryTurnChars) }));
}

/**
 * Run one generation.
 * @param {object} p
 * @param {object} p.registry
 * @param {(input: { system: string, messages: {role:string, content:string}[], signal?: AbortSignal }) => Promise<string>} p.generate
 * @param {string} p.message
 * @param {Array} [p.history]  already sanitized
 * @param {string} [p.currentUI]
 * @param {{ name?: string, tone?: string }} [p.brand]
 * @param {AbortSignal} [p.signal]
 * @param {number} [p.maxCurrentUIChars]
 * @param {(err: Error, ctx: object) => void} [p.log]
 * @returns {Promise<{ code: string|null, intent: 'design'|'chat'|'clarify', reply: string, blocked?: string[], repaired?: boolean }>}
 */
export async function runGeneration({ registry, generate, message, history = [], currentUI = '', brand, signal, maxCurrentUIChars = GENERATION_LIMITS.maxCurrentUIChars, maxRepairRounds = GENERATION_LIMITS.maxRepairRounds, log = () => {} }) {
  const system = buildSystemPrompt(registry, { brand });
  const ids = registryIds(registry);
  const heuristic = classifyIntent(message, { history });
  const messages = [...history, { role: 'user', content: buildUserPrompt(message, currentUI, heuristic) }];

  let raw = await generate({ system, messages, signal });
  let parsed = extractJson(typeof raw === 'string' ? raw : '');
  if (!parsed) return { code: null, intent: 'chat', reply: "Sorry, I couldn't process that. Try rephrasing." };

  let reply = parsed.reply != null ? String(parsed.reply) : '';

  // Intent gate: the UI changes ONLY when the user asked for a change. The model labels its own
  // answer; a cheap local classifier double-checks it, and the two must agree before any code is
  // applied. Greetings, questions, opinions and feedback get a conversational reply.
  const hasCode = parsed.code != null && parsed.code !== '';
  const intent = resolveIntent({ modelIntent: parsed.intent, hasCode, heuristic });
  if (intent !== 'design') {
    if (hasCode) log(new Error('model returned code for a non-design intent; dropped'), { intent, modelIntent: parsed.intent, heuristic });
    return { code: null, intent, reply: reply || (intent === 'clarify' ? 'Could you tell me a bit more about what you would like to change?' : 'Happy to help. Tell me how you would like the page to look.') };
  }
  if (!hasCode) return { code: null, intent, reply: reply || 'No changes made.' };
  let code = String(parsed.code);
  if (code.length > maxCurrentUIChars) {
    return { code: null, intent, reply: 'That design came out too large to run safely. Try asking for something simpler.' };
  }

  // Verify → repair: give the model one chance to fix a scan failure before refusing.
  let result = scan(code, ids);
  let repaired = false;
  for (let round = 0; !result.ok && round < maxRepairRounds; round++) {
    const fixable = result.violations.filter((v) => !/is not a registered/.test(v));
    if (fixable.length === 0) break; // unregistered capability: refuse, don't coax
    log(new Error('generated code failed the scan; asking for a repair'), { violations: result.violations, round });
    const repairMessages = [
      ...messages,
      { role: 'assistant', content: JSON.stringify({ code, reply }) },
      { role: 'user', content: buildRepairPrompt(result.violations) },
    ];
    raw = await generate({ system, messages: repairMessages, signal });
    parsed = extractJson(typeof raw === 'string' ? raw : '');
    if (!parsed || parsed.code == null || parsed.code === '') break;
    code = String(parsed.code);
    if (parsed.reply != null) reply = String(parsed.reply);
    if (code.length > maxCurrentUIChars) break;
    result = scan(code, ids);
    repaired = result.ok;
  }
  if (!result.ok) {
    log(new Error('generated code failed the scan'), { violations: result.violations });
    return { code: null, intent, reply: friendlyScanReply(result.violations, registry), blocked: result.violations };
  }
  return { code, intent, reply, repaired };
}

export function friendlyScanReply(violations, registry) {
  const unregistered = violations.filter((v) => /is not a registered/.test(v));
  if (unregistered.length) {
    const names = ((registry && registry.actions) || []).map((a) => a.id).join(', ');
    return `I can't do that here — it needs a capability this app hasn't made available. I kept the current view. Actions I can use: ${names || 'none'}.`;
  }
  return "I generated something that isn't allowed in the sandbox, so I kept the current view. Try rephrasing the request.";
}

export function buildRepairPrompt(violations) {
  return `Your previous code was rejected by the sandbox's static check:
${violations.map((v) => '- ' + v).join('\n')}

Fix ONLY these problems, keep everything else the same, and respond again with ONLY the JSON object { "code", "reply" }.`;
}

export function buildSystemPrompt(registry, { brand } = {}) {
  const reg = JSON.stringify(registry || {}, null, 2);
  const u = THEME_UTILITIES;
  const brandLine = brand && (brand.name || brand.tone)
    ? `\nThe host brand${brand.name ? ` is "${String(brand.name).slice(0, 80)}"` : ''}${brand.tone ? `; its tone is ${String(brand.tone).slice(0, 200)}` : ''}.`
    : '';
  return `You are Veneer, an assistant embedded in a host web application. You can redesign the current page
on request, and you can simply talk: answer questions about the design, give your opinion, explain
what you can do, or respond to a greeting.

FIRST DECIDE THE USER'S INTENT, then answer accordingly:
- "design": the user asks to create or change the UI ("make this a kanban", "add a due-date column",
  "darker cards", "undo the last change"). Generate the UI.
- "chat": anything that is not a change request — greetings, thanks, small talk, questions ("what can
  you do?", "why is this task red?"), opinions or feedback ("what do you think of this design?",
  "I like it", "hmm, not sure"). Answer helpfully and briefly in "reply"; set "code" to null. NEVER
  change the UI on a chat turn, even if you have ideas: offer them and wait to be asked.
- "clarify": the request is a change but too ambiguous to act on ("make it better", "fix it").
  Ask ONE short question in "reply"; set "code" to null.
When in doubt between design and chat, choose chat. Changing the UI uninvited is worse than asking.

You have FULL creative freedom over layout and design — invent any layout the request calls for
(kanban board, calendar, dashboard, timeline, gallery, anything). But you operate inside a hard
security sandbox: your code runs in an isolated iframe with no network access and no access to the
host page. Your ONLY connection to the app is a small in-frame API.

RESPONSE FORMAT — respond with ONLY a single JSON object, no prose, no markdown fences:
{
  "intent": "design" | "chat" | "clarify",
  "code": "<a self-contained React component, as a string; null unless intent is design>",
  "reply": "<one or two friendly sentences to show the user>"
}
For "chat" you may write a slightly longer reply (up to a short paragraph) when the question needs it.
You can see the current UI code below; use it to answer questions about the design concretely.

THE CODE YOU WRITE:
- Is plain JSX. These globals are already available — DO NOT import anything, DO NOT use export:
  React, useState, useEffect, useMemo, useCallback, useRef, veneer, render.
- Defines a function component (e.g. function VeneerUI() { ... }) and ends by calling render(<VeneerUI />).
- Reads data ONLY via veneer.data(sourceId) with a string literal id — returns the current value (usually an array).
- Triggers actions ONLY via veneer.action(id, args) with a string literal id — returns a Promise. After an
  action runs, fresh data is pushed in automatically and your component re-renders, so just call the
  action. Actions resolve with undefined unless the registry entry declares "returns".
- Styles with Tailwind CSS utility classes (Tailwind is available in the sandbox). Make it polished,
  modern, and visually distinct — good spacing, rounded corners, subtle shadows, clear hierarchy.
- MUST NOT use window, document, location, navigator, fetch, XMLHttpRequest, WebSocket, cookies,
  localStorage, \`this\`, classes, dangerouslySetInnerHTML, <a href> links, or any external URL/script.
  Code that does is rejected before it runs. Forms may use onSubmit (call e.preventDefault()) but never navigate.
- Handle edge cases: lists may be empty, nullable fields (see the types) may be null, dates are strings.

CAPABILITY RULES (this is the contract — follow it exactly):
- You may ONLY call veneer.action(id, ...) with an action id that appears in the registry below.
- You may ONLY call veneer.data(id) with a data source id that appears in the registry below.
- Pass exactly the declared args, with the declared types. Unknown or wrongly typed args are rejected.
- If the user asks for something that has NO matching registered capability (for example, deleting a
  record when no delete action is registered), DO NOT invent it and DO NOT fake it. Instead, set
  "code" to null (keep the current UI), and in "reply" politely explain that the action isn't
  available in this app, naming what you can do instead.

BRAND (the sandbox is themed by the host app — make the UI look like part of it):${brandLine}
- Use these brand utilities for chrome and structure; they resolve to the host's own colours, radii and fonts:
  surfaces: ${u.surfaces.join(', ')}
  text: ${u.text.join(', ')}
  borders: ${u.borders.join(', ')}
  radius: ${u.radius.join(', ')}   fonts: ${u.fonts.join(', ')}   shadows: ${u.shadows.join(', ')}
- Page background: bg-background. Cards/panels: bg-surface border border-border rounded-lg shadow-sm.
  Primary buttons: bg-primary text-primary-foreground rounded-md. Body text: text-foreground; secondary: text-muted.
- Brand colours do not support opacity modifiers (no bg-primary/50). Never hardcode hex colours or inline colour styles.
- Raw Tailwind palette colours (e.g. bg-emerald-100) are fine for data-visualisation accents, status chips and
  when the user explicitly asks for a colourful design; otherwise prefer the brand utilities.
- The canvas is auto-sized to its content: do not use min-h-screen or fixed viewport heights.

REGISTERED CAPABILITIES:
${reg}

Each data source lists its fields. Each action lists its args — pass exactly those.`;
}

export function buildUserPrompt(message, currentUI, heuristic) {
  const cur = currentUI ? String(currentUI) : '(none yet)';
  const hint = heuristic && heuristic.intent && heuristic.intent !== 'unknown'
    ? `\n(A local classifier read this message as "${heuristic.intent}" with ${heuristic.confidence} confidence. Use your own judgement, but do not change the UI unless the user clearly asked for a change.)`
    : '';
  return `User message: ${message}${hint}

For reference, the current UI code is:
\`\`\`
${cur}
\`\`\`

Decide the intent. If it is a design request, generate the new UI (or, if it needs a capability that
isn't registered, set code to null and explain). If it is a question, comment or greeting, just reply.
Respond with ONLY the JSON object.`;
}

/** Robustly pull the JSON object out of the model's response. */
export function extractJson(text) {
  if (!text) return null;
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();
  try {
    const v = JSON.parse(candidate);
    return v && typeof v === 'object' ? v : null;
  } catch (e) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        const v = JSON.parse(candidate.slice(start, end + 1));
        return v && typeof v === 'object' ? v : null;
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}
