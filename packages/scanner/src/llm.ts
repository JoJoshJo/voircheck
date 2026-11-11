import { z } from 'zod';

/**
 * Shared AI provider layer (spec 5.13, $0 for AI, J Nov 11): free providers FIRST, Claude LAST.
 *   Page analysis: Groq qwen → Gemini Flash-Lite → OpenRouter free → Claude (no gpt-oss, J Nov 11).
 *   Shopping agent: Groq qwen → gpt-oss-120b → gpt-oss-20b → OpenRouter free → Claude. NEVER Gemini (user chat stays
 *   off Google's free tier, whose content is used to improve Google's products; public store pages only).
 * No paid usage: Groq and Gemini only on their free plans (the code can't see billing, so never link one), OpenRouter
 * only ":free" models listed at price 0 with max price 0 on every request, Claude only when a key with credit is set
 * (and within the daily Anthropic budget); "credit too low" benches Claude for 60 min. ONE provider at a time, each with its own short timeout; a timeout, 429, 402, 5xx,
 * "no credit" or a "request too large" moves straight to the next one. A circuit breaker skips a provider that just
 * failed (cool-down table below) instead of trying it on every call.
 *
 * Only the provider's name, the job, the outcome and the time are logged: never the prompt, the answer or a key.
 * Web research ("what the web says", price fallback) is NOT on this layer: it needs Claude's web search and stays
 * Claude-only (research.ts); if Claude fails it says "Not checked", never a guess.
 */

export const PROVIDERS = ['groq', 'gemini', 'openrouter', 'claude'] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<ProviderId, string> = { groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter', claude: 'Claude' };

/** Who answered an AI job (stored with the result; shown on the evidence page as "Page analysis: Groq"). */
export const AnalyzedBy = z.object({ provider: z.enum(PROVIDERS), model: z.string().max(100) });
export type AnalyzedBy = z.infer<typeof AnalyzedBy>;

/** Why a provider call failed. Decides the circuit breaker's cool-down. */
export type FailureKind =
  | 'timeout' // our own per-provider timeout
  | 'rate_minute' // 429 per-minute limit
  | 'quota_day' // daily request/token quota used up
  | 'credit' // 402 / "credit balance is too low"
  | 'auth' // 401 / 403
  | 'server' // 408, 5xx, provider down/overloaded
  | 'network' // connection failed
  | 'too_large' // 413 / request bigger than the provider allows: this call only
  | 'bad_output' // the answer was empty, cut off or not the shape we need: this call only
  | 'not_configured' // no key / not allowed (e.g. a non-free OpenRouter model): skipped
  | 'other'; // anything else (a 400 we caused): this call only

export class ProviderError extends Error {
  constructor(
    readonly kind: FailureKind,
    detail: string,
    readonly retryAfterMs?: number,
    /** Epoch ms when a daily quota resets, when the provider says so. */
    readonly resetAt?: number,
  ) {
    super(`${kind}: ${detail.slice(0, 200)}`);
    this.name = 'ProviderError';
  }
}

const MIN = 60_000;
/**
 * Cool-downs (approved Nov 10; OpenRouter timeouts shortened Nov 11). `null` = this call only, the provider stays in.
 * Free OpenRouter models are sometimes just slow: one timeout benches that model for a minute, not ten.
 */
export function coolDownMs(err: ProviderError, now: number, provider?: ProviderId): number | null {
  if (provider === 'openrouter' && err.kind === 'timeout') return MIN;
  switch (err.kind) {
    case 'rate_minute':
      return Math.min(120_000, Math.max(30_000, err.retryAfterMs ?? 30_000));
    case 'quota_day':
      return Math.max(MIN, (err.resetAt ?? nextUtcMidnight(now)) - now);
    case 'credit':
    case 'auth':
      return 60 * MIN;
    case 'server':
    case 'timeout':
    case 'network':
      return 10 * MIN;
    default:
      return null;
  }
}

/** Gemini's daily quotas reset at midnight Pacific time. */
export function nextPacificMidnight(now: number): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const sinceMidnight = ((Number(parts.hour) % 24) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000;
  return now - sinceMidnight - (now % 1000) + 24 * 3_600_000;
}

export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** Per-provider "skip until" times. In memory: one per process (one Render instance), shared by every AI job. */
export class CircuitBreaker {
  /** Keyed by `breakerKey`: each OpenRouter model is benched on its own. */
  private until = new Map<string, { at: number; kind: FailureKind }>();
  constructor(private readonly now: () => number = Date.now) {}

  /** The reason a provider is being skipped right now, or null when it may be called. */
  skipped(id: string): FailureKind | null {
    const e = this.until.get(id);
    if (!e) return null;
    if (e.at <= this.now()) {
      this.until.delete(id);
      return null;
    }
    return e.kind;
  }

  record(id: string, err: ProviderError): void {
    const ms = coolDownMs(err, this.now(), id.split(':')[0] as ProviderId);
    if (ms !== null) this.until.set(id, { at: this.now() + ms, kind: err.kind });
  }

  reset(): void {
    this.until.clear();
  }
}

const g = globalThis as typeof globalThis & { __voircheckBreaker?: CircuitBreaker };
/** The process-wide breaker (Groq's per-minute limit is per account, so a 429 from one job applies to all). */
export const sharedBreaker = (): CircuitBreaker => (g.__voircheckBreaker ??= new CircuitBreaker());

export interface Attempt<T> {
  provider: ProviderId;
  /** Circuit-breaker key (default: the provider). OpenRouter models each get their own: `breakerKey`. */
  key?: string;
  model: string;
  timeoutMs: number;
  run(signal: AbortSignal): Promise<T>;
}

export interface FailoverLog {
  job: string;
  provider: ProviderId;
  outcome: 'ok' | FailureKind | 'skipped';
  ms: number;
}

export type FailoverResult<T> = { ok: true; value: T; by: AnalyzedBy; ms: number; tried: FailoverLog[] } | { ok: false; tried: FailoverLog[] };

export const defaultLog = (l: FailoverLog) => console.log(`[ai] ${l.job}: ${l.provider} ${l.outcome} ${l.ms}ms`);

/**
 * Tries each attempt in order, one at a time. Each gets min(its own timeout, what is left of `overallMs`).
 * Any failure → the next attempt; the breaker remembers failures that should skip the provider for a while.
 */
export async function runFailover<T>(
  job: string,
  attempts: ReadonlyArray<Attempt<T>>,
  opts: { breaker?: CircuitBreaker; overallMs?: number; log?: (l: FailoverLog) => void; now?: () => number } = {},
): Promise<FailoverResult<T>> {
  const breaker = opts.breaker ?? sharedBreaker();
  const log = opts.log ?? defaultLog;
  const now = opts.now ?? Date.now;
  const start = now();
  const tried: FailoverLog[] = [];
  const note = (l: FailoverLog) => {
    tried.push(l);
    log(l);
  };
  for (const a of attempts) {
    if (breaker.skipped(a.key ?? a.provider)) {
      note({ job, provider: a.provider, outcome: 'skipped', ms: 0 });
      continue;
    }
    const left = opts.overallMs === undefined ? a.timeoutMs : opts.overallMs - (now() - start);
    // Under a second left of the overall cap: not worth starting another provider.
    if (opts.overallMs !== undefined && left < 1_000) break;
    const t0 = now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(new ProviderError('timeout', `${a.provider} took longer than ${Math.min(a.timeoutMs, left)} ms`)), Math.min(a.timeoutMs, left));
    try {
      const value = await Promise.race([
        a.run(ctl.signal),
        new Promise<never>((_, reject) => ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason), { once: true })),
      ]);
      note({ job, provider: a.provider, outcome: 'ok', ms: now() - t0 });
      return { ok: true, value, by: { provider: a.provider, model: a.model }, ms: now() - t0, tried };
    } catch (err) {
      const e = toProviderError(err);
      breaker.record(a.key ?? a.provider, e);
      note({ job, provider: a.provider, outcome: e.kind, ms: now() - t0 });
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, tried };
}

export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return new ProviderError('timeout', err.message);
  if (err instanceof TypeError) return new ProviderError('network', err.message);
  return new ProviderError('other', err instanceof Error ? err.message : String(err));
}

/** An Anthropic SDK error → why it failed (same breaker rules as the other providers). */
export function anthropicError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const e = err as { status?: number; message?: string; headers?: Headers | Record<string, string>; name?: string };
  const msg = String(e?.message ?? err);
  if (e?.name === 'APIConnectionTimeoutError') return new ProviderError('timeout', msg);
  if (e?.name === 'APIConnectionError') return new ProviderError('network', msg);
  const status = e?.status;
  if (typeof status !== 'number') return toProviderError(err);
  if (/credit balance|billing|insufficient/i.test(msg)) return new ProviderError('credit', msg);
  if (status === 401 || status === 403) return new ProviderError('auth', msg);
  if (status === 413) return new ProviderError('too_large', msg);
  if (status === 429) {
    const h = e.headers;
    const ra = h instanceof Headers ? h.get('retry-after') : (h?.['retry-after'] ?? null);
    return new ProviderError('rate_minute', msg, parseDuration(ra));
  }
  if (status === 408 || status === 529 || status >= 500) return new ProviderError('server', msg);
  return new ProviderError('other', msg);
}

// ---------- OpenAI-compatible chat (Groq, Gemini, OpenRouter) ----------

export interface ChatProvider {
  id: Exclude<ProviderId, 'claude'>;
  url: string;
  apiKey: string;
  model: string;
  /** Extra body fields this provider needs on every call (no-thinking switch, price cap). */
  extraBody: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Groq's free plan allows 8,000 tokens a minute per model: page analysis sends it less text. */
  smallInput: boolean;
  /** The model follows a strict JSON schema (response_format json_schema). */
  jsonSchema: boolean;
}

/** One breaker entry per model: Groq's limits are per model, and a slow free model doesn't bench the next one. */
export const breakerKey = (p: Pick<ChatProvider, 'id' | 'model'>): string => `${p.id}:${p.model}`;

export const GROQ_MODEL = 'qwen/qwen3.8-27b';
/**
 * Groq free models, in order (each: 30 req/min, 1,000 req/day, 8k tokens/min, 200k tokens/day, per model; checked
 * Nov 11). qwen thinks not at all; gpt-oss always thinks a little (~10 tokens at "low"), allowed by J (Nov 11).
 */
export const GROQ_MODELS = [
  { model: GROQ_MODEL, extraBody: { reasoning_effort: 'none' } },
  { model: 'openai/gpt-oss-120b', extraBody: { reasoning_effort: 'low' } },
  { model: 'openai/gpt-oss-20b', extraBody: { reasoning_effort: 'low' } },
] as const;
/** Gemini free tier, page analysis only. 3.x can't switch thinking off: "minimal". 2.5 Flash-Lite is closed to new keys. */
export const GEMINI_MODEL = 'gemini-3.5-flash-lite';
/** Models with a free tier on the Gemini API (pricing page, Nov 11). Anything else is refused: it could be paid-only. */
const GEMINI_FREE_MODELS = new Set([GEMINI_MODEL, 'gemini-3.1-flash-lite']);
export const OPENROUTER_MODEL = 'nvidia/nemotron-3.5-lightning:free';
/** Second free OpenRouter model, tried when the first fails or is benched (Nov 11). Supports strict JSON schema. */
export const OPENROUTER_BACKUP_MODEL = 'nvidia/nemotron-3.5-super-vl:free';
/** Free OpenRouter models known to follow a strict JSON schema. */
const OPENROUTER_JSON_SCHEMA = new Set([OPENROUTER_BACKUP_MODEL]);

/** Groq: the first model (qwen3, reasoning_effort "none"), or another of GROQ_MODELS. */
export function groqProvider(env: Record<string, string | undefined> = process.env, index = 0): ChatProvider | null {
  const m = GROQ_MODELS[index];
  if (!env.GROQ_API_KEY || !m) return null;
  const model = index === 0 ? env.GROQ_MODEL || m.model : m.model;
  // A GROQ_MODEL override is a qwen-style model only if it isn't gpt-oss (which can't take "none").
  const extraBody = index === 0 && /gpt-oss/.test(model) ? { reasoning_effort: 'low' } : { ...m.extraBody };
  return { id: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions', apiKey: env.GROQ_API_KEY, model, extraBody, smallInput: true, jsonSchema: true };
}

/** Every Groq free model, in order (each its own breaker entry). */
export const groqProviders = (env: Record<string, string | undefined> = process.env): ChatProvider[] =>
  GROQ_MODELS.map((_, i) => groqProvider(env, i)).filter((p): p is ChatProvider => !!p);

/** Gemini on its free tier, for PAGE ANALYSIS ONLY (never user chat). Only known free-tier models. */
export function geminiProvider(env: Record<string, string | undefined> = process.env): ChatProvider | null {
  const model = env.GEMINI_MODEL || GEMINI_MODEL;
  if (!env.GEMINI_API_KEY || !GEMINI_FREE_MODELS.has(model)) return null;
  return { id: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', apiKey: env.GEMINI_API_KEY, model, extraBody: { reasoning_effort: 'minimal' }, smallInput: false, jsonSchema: true };
}

/** Both OpenRouter free models, in order. */
export const openRouterProviders = (env: Record<string, string | undefined> = process.env): ChatProvider[] =>
  [openRouterProvider(env, 'primary'), openRouterProvider(env, 'backup')].filter((p): p is ChatProvider => !!p);

/**
 * The free chain for page analysis (J, Nov 11, second decision): Groq qwen → Gemini → OpenRouter ×2. Claude is added
 * last by the caller. No gpt-oss here: in the 10-shop check it flagged Target and REI for payment red flags the pages
 * never showed. gpt-oss stays in the agent chain.
 */
export const pageAnalysisChain = (env: Record<string, string | undefined> = process.env): ChatProvider[] => [
  ...[groqProvider(env, 0)].filter((p): p is ChatProvider => !!p),
  ...[geminiProvider(env)].filter((p): p is ChatProvider => !!p),
  ...openRouterProviders(env),
];

/** The free chain for the shopping agent: Groq ×3 → OpenRouter ×2. Never Gemini. */
export const agentChain = (env: Record<string, string | undefined> = process.env): ChatProvider[] => [...groqProviders(env), ...openRouterProviders(env)];

/** A model we may call on OpenRouter: only ":free" variants. Never a paid model, so the account can't be charged. */
export const isFreeOpenRouterModel = (model: string) => /^[\w.-]+\/[\w.:-]+:free$/.test(model);

/**
 * OpenRouter free models only: the model must end in ":free" (checked here and against the live price list,
 * `verifyOpenRouterFree`), and every request carries a max price of 0. The key's own credit limit is $0 too.
 */
export function openRouterProvider(env: Record<string, string | undefined> = process.env, which: 'primary' | 'backup' = 'primary'): ChatProvider | null {
  const model = which === 'primary' ? env.OPENROUTER_MODEL || OPENROUTER_MODEL : env.OPENROUTER_BACKUP_MODEL || OPENROUTER_BACKUP_MODEL;
  if (!env.OPENROUTER_API_KEY || !isFreeOpenRouterModel(model)) return null;
  return {
    id: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    apiKey: env.OPENROUTER_API_KEY,
    model,
    extraBody: { reasoning: { enabled: false }, provider: { max_price: { prompt: 0, completion: 0, request: 0 } } },
    headers: { 'X-OpenRouter-Title': 'VoirCheck' },
    smallInput: false,
    jsonSchema: OPENROUTER_JSON_SCHEMA.has(model),
  };
}

const freeCheck = globalThis as typeof globalThis & { __voircheckFreeModels?: { at: number; ok: Map<string, boolean> } };
/**
 * Is this model listed on OpenRouter at price 0 right now? Checked once an hour from the public model list. If the
 * list can't be read, the ":free" name and the max-price-0 cap still apply.
 */
export async function verifyOpenRouterFree(model: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<boolean> {
  if (!isFreeOpenRouterModel(model)) return false;
  const c = freeCheck.__voircheckFreeModels;
  if (c && now - c.at < 3_600_000 && c.ok.has(model)) return c.ok.get(model)!;
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return true;
    const list = ((await res.json()) as { data?: Array<{ id: string; pricing?: Record<string, string> }> }).data ?? [];
    const m = list.find((x) => x.id === model);
    const free = !!m && Object.values(m.pricing ?? {}).every((p) => Number(p) === 0);
    freeCheck.__voircheckFreeModels = { at: now, ok: new Map([...(c?.ok ?? []), [model, free]]) };
    return free;
  } catch {
    return true;
  }
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatAnswer {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
  finishReason: string | null;
  usage: { inputTokens: number; outputTokens: number };
}

/** "1h2m3.5s" / "2m59.56s" / "7.66s" / "450ms" → ms. */
export function parseDuration(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(s.trim());
  if (!m || !m[0]) return Number.isFinite(Number(s)) ? Number(s) * 1000 : undefined;
  return Math.round((Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000 + Number(m[4] ?? 0));
}

/** An HTTP error (or an error object inside a 200) → why it failed. */
export function classifyHttp(p: Pick<ChatProvider, 'id'>, status: number, headers: Headers, body: unknown, now = Date.now()): ProviderError {
  const err = (body as { error?: { message?: string; code?: unknown; type?: string; metadata?: { error_type?: string } } } | null)?.error;
  const msg = String(err?.message ?? `HTTP ${status}`);
  const code = typeof err?.code === 'number' ? err.code : status;
  const errorType = String(err?.metadata?.error_type ?? err?.type ?? '');
  const retryAfterMs = parseDuration(headers.get('retry-after'));
  if (code === 402 || /payment_required|insufficient.*credit|credit balance/i.test(`${errorType} ${msg}`)) return new ProviderError('credit', msg);
  if (code === 401 || code === 403) return new ProviderError('auth', msg);
  if (code === 413 || /request too large|context.length|maximum context/i.test(msg)) return new ProviderError('too_large', msg);
  if (code === 429) {
    // Groq: the request counters are per DAY. OpenRouter: "free-models-per-day".
    const dailyGroq = p.id === 'groq' && headers.get('x-ratelimit-remaining-requests') === '0';
    if (dailyGroq) return new ProviderError('quota_day', msg, retryAfterMs, now + (parseDuration(headers.get('x-ratelimit-reset-requests')) ?? 0) || undefined);
    if (/per[- _]?day|daily/i.test(msg)) return new ProviderError('quota_day', msg, retryAfterMs, p.id === 'gemini' ? nextPacificMidnight(now) : undefined);
    return new ProviderError('rate_minute', msg, retryAfterMs);
  }
  if (code === 408 || code >= 500) return new ProviderError('server', msg);
  return new ProviderError('other', msg);
}

/**
 * One chat completion. Not streamed: the answer is used only once complete (so a failure can still move to the next
 * provider), which is also how Claude's agent replies arrived in practice (one burst when tools are in the request).
 */
export async function chatComplete(
  p: ChatProvider,
  req: { messages: ChatMessage[]; tools?: ChatTool[]; maxTokens: number; responseFormat?: Record<string, unknown> },
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatAnswer> {
  if (p.id === 'openrouter' && !(await verifyOpenRouterFree(p.model, fetchImpl))) throw new ProviderError('not_configured', `${p.model} is not listed as free`);
  const body = {
    model: p.model,
    messages: req.messages,
    max_tokens: req.maxTokens,
    temperature: 0,
    ...(req.tools?.length ? { tools: req.tools, tool_choice: 'auto' } : {}),
    ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
    ...p.extraBody,
  };
  let res: Response;
  try {
    res = await fetchImpl(p.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${p.apiKey}`, ...p.headers }, body: JSON.stringify(body), signal });
  } catch (err) {
    if (signal.aborted) throw signal.reason instanceof ProviderError ? signal.reason : new ProviderError('timeout', 'aborted');
    throw toProviderError(err);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // a proxy error page
  }
  // Gemini sends its errors as a one-element array.
  if (Array.isArray(json)) json = json[0] ?? null;
  // OpenRouter can send an error inside a 200.
  if (!res.ok || (json as { error?: unknown } | null)?.error) throw classifyHttp(p, res.status, res.headers, json);
  const choice = (json as { choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }> } | null)?.choices?.[0];
  if (!choice?.message) throw new ProviderError('bad_output', 'no message in the answer');
  const u = (json as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
  return {
    content: (choice.message.content ?? '').trim(),
    toolCalls: (choice.message.tool_calls ?? []).map((c, i) => ({ id: c.id || `call_${i}`, name: c.function?.name ?? '', arguments: c.function?.arguments ?? '' })),
    finishReason: choice.finish_reason ?? null,
    usage: { inputTokens: u?.prompt_tokens ?? 0, outputTokens: u?.completion_tokens ?? 0 },
  };
}

/** The JSON object in a model's answer (tolerates ```json fences and a sentence around it). */
export function extractJson(text: string): unknown {
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new ProviderError('bad_output', 'no JSON in the answer');
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {
      throw new ProviderError('bad_output', 'the JSON in the answer does not parse');
    }
  }
}

/** A zod schema as a strict JSON schema (every property required, no extra properties): what strict mode needs. */
export function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const walk = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(walk);
    if (!s || typeof s !== 'object') return s;
    const o = Object.fromEntries(Object.entries(s as Record<string, unknown>).filter(([k]) => k !== '$schema').map(([k, v]) => [k, walk(v)]));
    if (o.type === 'object' && o.properties && typeof o.properties === 'object') {
      o.required = Object.keys(o.properties as object);
      o.additionalProperties = false;
    }
    return o;
  };
  return walk(z.toJSONSchema(schema)) as Record<string, unknown>;
}
