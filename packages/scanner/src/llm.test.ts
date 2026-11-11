import { describe, expect, it } from 'vitest';
import {
  breakerKey,
  chatComplete,
  geminiProvider,
  groqProviders,
  pageAnalysisChain,
  CircuitBreaker,
  classifyHttp,
  coolDownMs,
  extractJson,
  groqProvider,
  isFreeOpenRouterModel,
  openRouterProvider,
  parseDuration,
  ProviderError,
  runFailover,
  strictJsonSchema,
  verifyOpenRouterFree,
  type Attempt,
  type FailoverLog,
} from './llm';
import { z } from 'zod';

const ok = <T>(provider: Attempt<T>['provider'], value: T): Attempt<T> => ({ provider, model: `${provider}-m`, timeoutMs: 1_000, run: async () => value });
const fail = <T>(provider: Attempt<T>['provider'], err: ProviderError, calls?: { n: number }): Attempt<T> => ({
  provider,
  model: `${provider}-m`,
  timeoutMs: 1_000,
  run: async () => {
    if (calls) calls.n++;
    throw err;
  },
});
const quiet = () => {};

describe('runFailover: one provider at a time, in order', () => {
  it('Groq fails → OpenRouter answers (Claude is never called)', async () => {
    const claude = { n: 0 };
    const r = await runFailover('t', [fail('groq', new ProviderError('rate_minute', '429')), ok('openrouter', 'or'), fail('claude', new ProviderError('other', 'x'), claude)], { breaker: new CircuitBreaker(), log: quiet });
    expect(r).toMatchObject({ ok: true, value: 'or', by: { provider: 'openrouter' } });
    expect(claude.n).toBe(0);
  });

  it('Groq and OpenRouter fail → Claude answers', async () => {
    const r = await runFailover('t', [fail('groq', new ProviderError('server', '503')), fail('openrouter', new ProviderError('credit', '402')), ok('claude', 'c')], { breaker: new CircuitBreaker(), log: quiet });
    expect(r).toMatchObject({ ok: true, value: 'c', by: { provider: 'claude', model: 'claude-m' } });
    if (r.ok) expect(r.tried.map((t) => `${t.provider}:${t.outcome}`)).toEqual(['groq:server', 'openrouter:credit', 'claude:ok']);
  });

  it('all fail → not ok (the caller shows "Not checked")', async () => {
    const r = await runFailover('t', [fail('groq', new ProviderError('timeout', 't')), fail('openrouter', new ProviderError('bad_output', 'b')), fail('claude', new ProviderError('credit', 'c'))], { breaker: new CircuitBreaker(), log: quiet });
    expect(r.ok).toBe(false);
    expect(r.tried).toHaveLength(3);
  });

  it('a provider slower than its timeout counts as a timeout and the next one answers', async () => {
    const slow: Attempt<string> = { provider: 'groq', model: 'g', timeoutMs: 20, run: () => new Promise((res) => setTimeout(() => res('late'), 500)) };
    const logs: FailoverLog[] = [];
    const r = await runFailover('t', [slow, ok('openrouter', 'fast')], { breaker: new CircuitBreaker(), log: (l) => logs.push(l) });
    expect(r).toMatchObject({ ok: true, value: 'fast' });
    expect(logs[0]).toMatchObject({ provider: 'groq', outcome: 'timeout' });
  });

  it('the log has the job, provider, outcome and time only (no content, no keys)', async () => {
    const logs: FailoverLog[] = [];
    await runFailover('page_analysis', [ok('groq', { secret: 'page text' })], { breaker: new CircuitBreaker(), log: (l) => logs.push(l) });
    expect(Object.keys(logs[0]!).sort()).toEqual(['job', 'ms', 'outcome', 'provider']);
  });
});

describe('circuit breaker', () => {
  it('skips a provider that just failed, instead of calling it again', async () => {
    const breaker = new CircuitBreaker();
    const groq = { n: 0 };
    const attempts = [fail<string>('groq', new ProviderError('server', '500'), groq), ok('openrouter', 'or')];
    await runFailover('t', attempts, { breaker, log: quiet });
    const logs: FailoverLog[] = [];
    const r = await runFailover('t', attempts, { breaker, log: (l) => logs.push(l) });
    expect(groq.n).toBe(1);
    expect(logs[0]).toMatchObject({ provider: 'groq', outcome: 'skipped' });
    expect(r).toMatchObject({ ok: true, value: 'or' });
  });

  it('lets the provider back in after the cool-down', () => {
    let now = 0;
    const b = new CircuitBreaker(() => now);
    b.record('groq', new ProviderError('server', '500'));
    expect(b.skipped('groq')).toBe('server');
    now = 10 * 60_000;
    expect(b.skipped('groq')).toBeNull();
  });

  it('cool-downs follow the approved table', () => {
    const now = Date.UTC(2026, 10, 10, 18, 0, 0);
    expect(coolDownMs(new ProviderError('rate_minute', 'x', 5_000), now)).toBe(30_000);
    expect(coolDownMs(new ProviderError('rate_minute', 'x', 90_000), now)).toBe(90_000);
    expect(coolDownMs(new ProviderError('rate_minute', 'x', 600_000), now)).toBe(120_000);
    expect(coolDownMs(new ProviderError('quota_day', 'x'), now)).toBe(6 * 3_600_000); // until midnight UTC
    expect(coolDownMs(new ProviderError('quota_day', 'x', undefined, now + 3 * 3_600_000), now)).toBe(3 * 3_600_000);
    expect(coolDownMs(new ProviderError('credit', 'x'), now)).toBe(60 * 60_000);
    expect(coolDownMs(new ProviderError('auth', 'x'), now)).toBe(60 * 60_000);
    for (const k of ['server', 'timeout', 'network'] as const) expect(coolDownMs(new ProviderError(k, 'x'), now)).toBe(10 * 60_000);
    // This call only: the provider stays in.
    for (const k of ['too_large', 'bad_output', 'other'] as const) expect(coolDownMs(new ProviderError(k, 'x'), now)).toBeNull();
  });

  it('an OpenRouter timeout benches that model for a minute only; each OpenRouter model has its own entry', async () => {
    let now = 0;
    const b = new CircuitBreaker(() => now);
    const main = openRouterProvider({ OPENROUTER_API_KEY: 'k' })!;
    const backup = openRouterProvider({ OPENROUTER_API_KEY: 'k' }, 'backup')!;
    expect(breakerKey(main)).not.toBe(breakerKey(backup));
    b.record(breakerKey(main), new ProviderError('timeout', 't'));
    expect(b.skipped(breakerKey(main))).toBe('timeout');
    expect(b.skipped(breakerKey(backup))).toBeNull();
    now = 60_000;
    expect(b.skipped(breakerKey(main))).toBeNull();
    b.record('groq', new ProviderError('timeout', 't'));
    now += 60_000;
    expect(b.skipped('groq')).toBe('timeout'); // Groq keeps the 10-minute cool-down
  });

  it('a request too large for Groq goes to the next provider without benching Groq', async () => {
    const breaker = new CircuitBreaker();
    await runFailover('t', [fail<string>('groq', new ProviderError('too_large', '413')), ok('openrouter', 'x')], { breaker, log: quiet });
    expect(breaker.skipped('groq')).toBeNull();
  });
});

describe('HTTP errors → failure kinds', () => {
  const h = (o: Record<string, string> = {}) => new Headers(o);
  it('Groq 429 with requests left is per-minute; with none left it is the daily quota', () => {
    expect(classifyHttp({ id: 'groq' }, 429, h({ 'retry-after': '7', 'x-ratelimit-remaining-requests': '12' }), null)).toMatchObject({ kind: 'rate_minute', retryAfterMs: 7_000 });
    const now = 1_000_000;
    expect(classifyHttp({ id: 'groq' }, 429, h({ 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '2m30s' }), null, now)).toMatchObject({ kind: 'quota_day', resetAt: now + 150_000 });
  });
  it('OpenRouter: 402, daily free limit, errors inside a 200, 5xx', () => {
    expect(classifyHttp({ id: 'openrouter' }, 402, h(), { error: { code: 402, message: 'Insufficient credits' } }).kind).toBe('credit');
    expect(classifyHttp({ id: 'openrouter' }, 429, h(), { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day' } }).kind).toBe('quota_day');
    expect(classifyHttp({ id: 'openrouter' }, 200, h(), { error: { code: 502, message: 'Provider returned error' } }).kind).toBe('server');
    expect(classifyHttp({ id: 'openrouter' }, 503, h(), null).kind).toBe('server');
    expect(classifyHttp({ id: 'groq' }, 413, h(), { error: { message: 'Request too large for model' } }).kind).toBe('too_large');
    expect(classifyHttp({ id: 'groq' }, 401, h(), null).kind).toBe('auth');
  });
  it('parses Groq durations', () => {
    expect(parseDuration('2m59.56s')).toBe(179_560);
    expect(parseDuration('7.66s')).toBe(7_660);
    expect(parseDuration('1h2m')).toBe(3_720_000);
    expect(parseDuration('450ms')).toBe(450);
    expect(parseDuration('12')).toBe(12_000);
  });
});

describe('OpenRouter: free models only, never charged', () => {
  it('accepts only ":free" model names', () => {
    expect(isFreeOpenRouterModel('nvidia/nemotron-3.5-lightning:free')).toBe(true);
    expect(isFreeOpenRouterModel('anthropic/claude-sonnet-5.5')).toBe(false);
    expect(isFreeOpenRouterModel('openrouter/free')).toBe(false);
    expect(openRouterProvider({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'openai/gpt-5' })).toBeNull();
    expect(openRouterProvider({ OPENROUTER_API_KEY: 'k', OPENROUTER_BACKUP_MODEL: 'openai/gpt-5' }, 'backup')).toBeNull();
    expect(openRouterProvider({ OPENROUTER_API_KEY: 'k' }, 'backup')).toMatchObject({ model: 'nvidia/nemotron-3.5-super-vl:free', jsonSchema: true, extraBody: { provider: { max_price: { prompt: 0, completion: 0, request: 0 } } } });
  });
  it('every request carries a max price of 0 and no thinking', () => {
    const p = openRouterProvider({ OPENROUTER_API_KEY: 'k' })!;
    expect(p.extraBody).toMatchObject({ provider: { max_price: { prompt: 0, completion: 0, request: 0 } }, reasoning: { enabled: false } });
    expect(groqProvider({ GROQ_API_KEY: 'k' })!.extraBody).toEqual({ reasoning_effort: 'none' });
  });
  it('a model listed with a price is refused before any call', async () => {
    const list = { data: [{ id: 'x/paid:free', pricing: { prompt: '0.000001', completion: '0' } }, { id: 'x/ok:free', pricing: { prompt: '0', completion: '0', request: '0' } }] };
    const f = (async () => new Response(JSON.stringify(list))) as unknown as typeof fetch;
    expect(await verifyOpenRouterFree('x/paid:free', f, 1)).toBe(false);
    expect(await verifyOpenRouterFree('x/ok:free', f, 2)).toBe(true);
  });
});

describe('free chains ($0 for AI, Nov 11)', () => {
  const env = { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k', OPENROUTER_API_KEY: 'o' };
  it('page analysis: Groq ×3 → Gemini Flash-Lite → OpenRouter free ×2 (Claude is added last by the caller)', () => {
    expect(pageAnalysisChain(env).map((p) => `${p.id} ${p.model}`)).toEqual([
      'groq qwen/qwen3.8-27b',
      'groq openai/gpt-oss-120b',
      'groq openai/gpt-oss-20b',
      'gemini gemini-3.5-flash-lite',
      'openrouter nvidia/nemotron-3.5-lightning:free',
      'openrouter nvidia/nemotron-3.5-super-vl:free',
    ]);
    expect(groqProviders(env).map((p) => p.extraBody)).toEqual([{ reasoning_effort: 'none' }, { reasoning_effort: 'low' }, { reasoning_effort: 'low' }]);
    expect(groqProviders(env).every((p) => p.smallInput)).toBe(true);
  });
  it('Gemini: only known free-tier models; per-day quota waits for midnight Pacific; errors arrive as an array', async () => {
    expect(geminiProvider({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-4-carbon' })).toBeNull();
    expect(geminiProvider({})).toBeNull();
    const g = geminiProvider({ GEMINI_API_KEY: 'k' })!;
    expect(g.extraBody).toEqual({ reasoning_effort: 'minimal' });
    const now = Date.UTC(2026, 10, 11, 1, 0, 0); // 17:00 in Los Angeles
    const e = classifyHttp(g, 429, new Headers(), { error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 500, model: gemini-3.5-flash-lite. GenerateRequestsPerDayPerProjectPerModel-FreeTier' } }, now);
    expect(e).toMatchObject({ kind: 'quota_day', resetAt: Date.UTC(2026, 10, 11, 8, 0, 0) });
    const f = (async () => new Response(JSON.stringify([{ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }]), { status: 429 })) as unknown as typeof fetch;
    await expect(chatComplete(g, { messages: [], maxTokens: 10 }, new AbortController().signal, f)).rejects.toMatchObject({ kind: 'rate_minute' });
  });
});

describe('chatComplete', () => {
  const groq = groqProvider({ GROQ_API_KEY: 'test-key' })!;
  const ctl = () => new AbortController().signal;
  it('sends the key only in the Authorization header and returns the answer', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    }) as unknown as typeof fetch;
    const a = await chatComplete(groq, { messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }, ctl(), f);
    expect(a).toMatchObject({ content: '{"a":1}', usage: { inputTokens: 5, outputTokens: 2 } });
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
    expect(String(seen!.init.body)).not.toContain('test-key');
    expect(JSON.parse(String(seen!.init.body))).toMatchObject({ model: groq.model, reasoning_effort: 'none', max_tokens: 10 });
  });
  it('an error inside a 200 is a failure', async () => {
    const f = (async () => new Response(JSON.stringify({ error: { code: 502, message: 'Provider returned error' } }))) as unknown as typeof fetch;
    await expect(chatComplete(groq, { messages: [], maxTokens: 10 }, ctl(), f)).rejects.toMatchObject({ kind: 'server' });
  });
  it('a dropped connection is a network failure', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(chatComplete(groq, { messages: [], maxTokens: 10 }, ctl(), f)).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('JSON helpers', () => {
  it('extracts JSON from fenced or chatty answers', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} hope it helps')).toEqual({ a: 2 });
    expect(() => extractJson('no json')).toThrow(ProviderError);
  });
  it('strict schema: every property required, no extras', () => {
    const s = strictJsonSchema(z.object({ a: z.string(), b: z.object({ c: z.number().nullable() }).nullable() })) as { required: string[]; additionalProperties: boolean };
    expect(s.required).toEqual(['a', 'b']);
    expect(s.additionalProperties).toBe(false);
    expect(JSON.stringify(s)).not.toContain('$schema');
  });
});
