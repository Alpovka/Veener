/**
 * Minimal, dependency-free LLM adapters. Each returns `generate({ system, messages, signal })`
 * resolving with the model's raw text. The customer's key is used per request and never stored.
 */
const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-sonnet-5',
};

export const SUPPORTED_PROVIDERS = Object.keys(DEFAULT_MODELS);

export function createProvider({ provider, key, model, fetch: fetchImpl }) {
  const f = fetchImpl || fetch;
  if (!SUPPORTED_PROVIDERS.includes(provider)) throw new Error(`Unsupported LLM provider "${provider}"`);
  if (!key || typeof key !== 'string') throw new Error('LLM key is required');
  const m = model || DEFAULT_MODELS[provider];

  async function readJson(res, label) {
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch (e) {
        detail = '';
      }
      const err = new Error(`${label} ${res.status}: ${detail}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  if (provider === 'gemini') {
    return async ({ system, messages, signal }) => {
      const res = await f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((x) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.content }] })),
          generationConfig: { temperature: 0.4, maxOutputTokens: 12000, responseMimeType: 'application/json' },
        }),
      });
      const data = await readJson(res, 'gemini');
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      return Array.isArray(parts) ? parts.map((p) => p.text || '').join('') : '';
    };
  }
  if (provider === 'openai') {
    return async ({ system, messages, signal }) => {
      const res = await f('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        signal,
        body: JSON.stringify({
          model: m,
          temperature: 0.4,
          max_tokens: 12000,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, ...messages.map((x) => ({ role: x.role, content: x.content }))],
        }),
      });
      const data = await readJson(res, 'openai');
      return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    };
  }
  // anthropic
  return async ({ system, messages, signal }) => {
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal,
      body: JSON.stringify({
        model: m,
        max_tokens: 12000,
        temperature: 0.4,
        system,
        messages: messages.map((x) => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: x.content })),
      }),
    });
    const data = await readJson(res, 'anthropic');
    return Array.isArray(data && data.content) ? data.content.filter((c) => c.type === 'text').map((c) => c.text).join('') : '';
  };
}
