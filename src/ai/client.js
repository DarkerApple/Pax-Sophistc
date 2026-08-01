// A thin, provider-agnostic chat client. Two wire formats cover every free
// provider worth supporting: the OpenAI chat-completions shape, and Gemini's.

import { PROVIDERS_BY_ID } from './providers.js';

export class AiError extends Error {
  constructor(message, { kind = 'unknown', status = null, retryable = false } = {}) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
  }
}

const RETRY_DELAYS = [1200, 3000, 7000];

export class AiClient {
  constructor(config) {
    this.config = config;
  }

  get provider() {
    return PROVIDERS_BY_ID[this.config.providerId] || PROVIDERS_BY_ID.offline;
  }

  get isOffline() {
    return this.provider.kind === 'none' || this.config.enabled === false;
  }

  get model() {
    return this.config.model || this.provider.defaultModel || '';
  }

  /**
   * @param {{system: string, user: string, json?: boolean, maxTokens?: number, temperature?: number}} req
   * @returns {Promise<string>}
   */
  async complete(req) {
    if (this.isOffline) throw new AiError('No AI provider configured.', { kind: 'offline' });

    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        return this.provider.kind === 'gemini'
          ? await this.#callGemini(req)
          : await this.#callOpenAi(req);
      } catch (err) {
        lastError = err;
        if (!(err instanceof AiError) || !err.retryable || attempt === RETRY_DELAYS.length) break;
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
    throw lastError;
  }

  /** Same as complete(), but parses and returns an object. */
  async completeJson(req) {
    const text = await this.complete({ ...req, json: true });
    const parsed = extractJson(text);
    if (!parsed) {
      throw new AiError('The model did not return usable JSON.', { kind: 'parse' });
    }
    return parsed;
  }

  /** Cheap round-trip used by the "Test connection" button. */
  async test() {
    const reply = await this.complete({
      system: 'You are a terse test endpoint.',
      user: 'Reply with exactly: OK',
      maxTokens: 16,
      temperature: 0,
    });
    return reply.trim().slice(0, 40);
  }

  async #callOpenAi(req) {
    const endpoint = this.provider.endpoint(this.model, this.config);
    const headers = { 'Content-Type': 'application/json', ...(this.provider.extraHeaders?.() || {}) };
    if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      temperature: req.temperature ?? this.config.temperature ?? 0.85,
      max_tokens: req.maxTokens ?? 1400,
    };
    if (req.json) body.response_format = { type: 'json_object' };

    const res = await this.#fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await parseResponse(res, this.provider.label);
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AiError('The provider returned an empty completion.', { kind: 'empty' });
    }
    return content;
  }

  async #callGemini(req) {
    const url = `${this.provider.endpoint(this.model)}?key=${encodeURIComponent(this.config.apiKey)}`;
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: req.temperature ?? this.config.temperature ?? 0.85,
        maxOutputTokens: req.maxTokens ?? 1400,
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
      },
    };

    const res = await this.#fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await parseResponse(res, this.provider.label);
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('').trim();
    if (!text) {
      const reason = data?.candidates?.[0]?.finishReason;
      throw new AiError(
        reason ? `Gemini returned no text (finishReason: ${reason}).` : 'Gemini returned no text.',
        { kind: 'empty' },
      );
    }
    return text;
  }

  async #fetch(url, init) {
    try {
      return await fetch(url, init);
    } catch (err) {
      throw new AiError(
        `Could not reach ${this.provider.label}. This is usually a network problem or the provider blocking browser requests (CORS).`,
        { kind: 'network', retryable: true },
      );
    }
  }
}

async function parseResponse(res, providerLabel) {
  if (res.ok) {
    try {
      return await res.json();
    } catch {
      throw new AiError('The provider returned a malformed response.', { kind: 'parse' });
    }
  }

  let detail = '';
  try {
    const body = await res.text();
    const asJson = body.trim().startsWith('{') ? JSON.parse(body) : null;
    detail = asJson?.error?.message || asJson?.message || body.slice(0, 240);
  } catch {
    /* keep detail empty */
  }

  if (res.status === 401 || res.status === 403) {
    throw new AiError(`${providerLabel} rejected the API key. ${detail}`.trim(), {
      kind: 'auth',
      status: res.status,
    });
  }
  if (res.status === 429) {
    throw new AiError(`${providerLabel} rate limit reached — free tiers are per-minute. ${detail}`.trim(), {
      kind: 'rate-limit',
      status: 429,
      retryable: true,
    });
  }
  if (res.status === 404) {
    throw new AiError(`${providerLabel} does not recognise that model. ${detail}`.trim(), {
      kind: 'model',
      status: 404,
    });
  }
  if (res.status >= 500) {
    throw new AiError(`${providerLabel} is having problems (HTTP ${res.status}). ${detail}`.trim(), {
      kind: 'server',
      status: res.status,
      retryable: true,
    });
  }
  throw new AiError(`${providerLabel} returned HTTP ${res.status}. ${detail}`.trim(), {
    kind: 'http',
    status: res.status,
  });
}

/**
 * Pull a JSON object out of a model response, tolerating code fences and
 * the occasional sentence of preamble.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  let body = text.trim();

  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();

  const direct = tryParse(body);
  if (direct) return direct;

  // Scan for the first balanced {...} that parses.
  const start = body.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = tryParse(body.slice(start, i + 1));
        if (candidate) return candidate;
      }
    }
  }
  return null;
}

function tryParse(str) {
  try {
    const value = JSON.parse(str);
    // Every prompt asks for an object; a bare array or scalar is a miss.
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
