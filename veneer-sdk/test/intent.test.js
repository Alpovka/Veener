import { describe, it, expect, vi } from 'vitest';
import { classifyIntent, resolveIntent } from '../src/server/intent.js';
import { createVeneerHandler, buildSystemPrompt, buildUserPrompt } from '../src/server/index.js';

const registry = {
  dataSources: [{ id: 'tasks', fields: [{ name: 'id', type: 'string' }] }],
  actions: [{ id: 'createTask', args: [{ name: 'title', type: 'string', required: true }] }],
};
const OK_CODE = 'function A(){ const t = veneer.data("tasks"); return <button onClick={() => veneer.action("createTask", { title: "x" })}>{t.length}</button>; } render(<A />);';

function req(body, headers = {}) {
  return new Request('http://host.test/api/veneer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...headers },
    body: JSON.stringify(body),
  });
}

describe('classifyIntent (local heuristics)', () => {
  const chat = [
    'hi', 'Hey!', 'hello there', 'good morning', 'how are you?', "what's up", 'thanks!', 'thank you', 'nice, love it', 'ok',
    'what do you think about this design?', 'do you like it?', 'how does this look?', 'thoughts?',
    'what can you do?', 'who are you', 'why is this task red?', 'how does this work?', 'is this good?',
    'selam', 'merhaba nasılsın',
  ];
  const design = [
    'make this a kanban board grouped by status', 'show a calendar by due date', 'add a due date column',
    'turn the list into cards', 'give me a colorful dashboard', 'hide the done tasks', 'sort by title',
    'can you make the cards bigger', 'I want a dark theme', 'remove the header', 'undo', 'reset', 'revert that',
  ];
  const clarify = ['make it better', 'fix it', 'improve this', 'surprise me', 'change it'];
  it.each(chat)('reads "%s" as chat', (m) => {
    const r = classifyIntent(m);
    expect(r.intent).toBe('chat');
  });
  it.each(design)('reads "%s" as design', (m) => {
    expect(classifyIntent(m).intent).toBe('design');
  });
  it.each(clarify)('reads "%s" as clarify', (m) => {
    expect(classifyIntent(m).intent).toBe('clarify');
  });
  it('is unsure about bare nouns and unknown text', () => {
    expect(classifyIntent('kanban').intent).toBe('design');
    expect(classifyIntent('kanban').confidence).toBe('low');
    expect(classifyIntent('the quarterly numbers').intent).toBe('unknown');
    expect(classifyIntent('').intent).toBe('chat');
  });
});

describe('resolveIntent (model label + local read)', () => {
  const high = (intent) => ({ intent, confidence: 'high' });
  it('applies code only when the model says design and the local read does not confidently say chat', () => {
    expect(resolveIntent({ modelIntent: 'design', hasCode: true, heuristic: high('design') })).toBe('design');
    expect(resolveIntent({ modelIntent: 'design', hasCode: true, heuristic: { intent: 'unknown', confidence: 'low' } })).toBe('design');
    expect(resolveIntent({ modelIntent: 'design', hasCode: true, heuristic: { intent: 'chat', confidence: 'medium' } })).toBe('design');
    expect(resolveIntent({ modelIntent: 'design', hasCode: true, heuristic: high('chat') })).toBe('chat');
    expect(resolveIntent({ modelIntent: 'design', hasCode: false, heuristic: high('clarify') })).toBe('clarify');
  });
  it('never applies code when the model says chat or clarify', () => {
    expect(resolveIntent({ modelIntent: 'chat', hasCode: true, heuristic: high('design') })).toBe('chat');
    expect(resolveIntent({ modelIntent: 'clarify', hasCode: true, heuristic: high('design') })).toBe('clarify');
  });
  it('infers a missing model label from the presence of code (older prompts)', () => {
    expect(resolveIntent({ modelIntent: undefined, hasCode: true, heuristic: high('design') })).toBe('design');
    expect(resolveIntent({ modelIntent: undefined, hasCode: false, heuristic: high('design') })).toBe('chat');
    expect(resolveIntent({ modelIntent: 'nonsense', hasCode: true, heuristic: high('chat') })).toBe('chat');
  });
});

describe('handler intent gate', () => {
  it('answers a greeting conversationally and never touches the UI, even if the model returned code', async () => {
    const generate = vi.fn(async () => JSON.stringify({ intent: 'chat', code: OK_CODE, reply: 'Hi! I am doing well. Want me to redesign something?' }));
    const onError = vi.fn();
    const h = createVeneerHandler({ registry, generate, rateLimit: false, onError });
    const body = await (await h(req({ message: 'hey how are you' }))).json();
    expect(body).toEqual({ code: null, intent: 'chat', reply: 'Hi! I am doing well. Want me to redesign something?' });
    expect(onError).toHaveBeenCalled(); // dropped code is logged for prompt tuning
    const sent = generate.mock.calls[0][0];
    expect(sent.system).toContain('FIRST DECIDE THE USER\'S INTENT');
    expect(sent.messages.at(-1).content).toContain('read this message as "chat"');
  });
  it('gives an opinion about the current design without changing it, even when the model mislabels the turn', async () => {
    const generate = vi.fn(async () => JSON.stringify({ intent: 'design', code: OK_CODE, reply: 'I made it cleaner.' }));
    const h = createVeneerHandler({ registry, generate, rateLimit: false });
    const body = await (await h(req({ message: 'what do you think about this design?', currentUI: 'function Old(){}' }))).json();
    expect(body.code).toBeNull();
    expect(body.intent).toBe('chat');
    expect(generate.mock.calls[0][0].messages.at(-1).content).toContain('function Old(){}');
  });
  it('asks a question for vague change requests', async () => {
    const generate = vi.fn(async () => JSON.stringify({ intent: 'clarify', code: null, reply: 'Better in what way: layout, colours or density?' }));
    const h = createVeneerHandler({ registry, generate, rateLimit: false });
    const body = await (await h(req({ message: 'make it better' }))).json();
    expect(body).toEqual({ code: null, intent: 'clarify', reply: 'Better in what way: layout, colours or density?' });
  });
  it('still generates for a clear design request and scans it', async () => {
    const generate = vi.fn(async () => JSON.stringify({ intent: 'design', code: OK_CODE, reply: 'Here is your board.' }));
    const h = createVeneerHandler({ registry, generate, rateLimit: false });
    const body = await (await h(req({ message: 'make this a kanban board grouped by status' }))).json();
    expect(body).toEqual({ code: OK_CODE, intent: 'design', reply: 'Here is your board.' });
  });
  it('a design request phrased as a question still goes through when the model agrees', async () => {
    const generate = vi.fn(async () => JSON.stringify({ intent: 'design', code: OK_CODE, reply: 'Done.' }));
    const h = createVeneerHandler({ registry, generate, rateLimit: false });
    const body = await (await h(req({ message: 'can you make the cards bigger?' }))).json();
    expect(body.code).toBe(OK_CODE);
    expect(body.intent).toBe('design');
  });
  it('unparsable model output is a chat reply, not a broken canvas', async () => {
    const h = createVeneerHandler({ registry, generate: async () => 'garbage', rateLimit: false });
    const body = await (await h(req({ message: 'hi' }))).json();
    expect(body.code).toBeNull();
    expect(body.intent).toBe('chat');
  });
  it('prompt pieces mention the intent contract', () => {
    expect(buildSystemPrompt(registry)).toContain('"intent": "design" | "chat" | "clarify"');
    expect(buildUserPrompt('hi', '', { intent: 'chat', confidence: 'high' })).toContain('read this message as "chat"');
    expect(buildUserPrompt('hi', '', { intent: 'unknown', confidence: 'low' })).not.toContain('local classifier');
  });
});
