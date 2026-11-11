import Anthropic from '@anthropic-ai/sdk';
import { agentChain, breakerKey, CircuitBreaker, geminiProvider, groqProvider, groqProviders, openRouterProvider } from '@voircheck/scanner';
import { describe, expect, it } from 'vitest';
import type { MessagesCreator } from './anthropic-model';
import { FailoverModel, parseToolCalls, toChatMessages } from './failover-model';
import { ModelUnavailableError, type AgentMessage, type ModelRequest, type ToolSpec } from './model';

const TOOLS: ToolSpec[] = [{ name: 'search_products', description: 'Search', inputSchema: { $schema: 'x', type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }];
const req = (messages: AgentMessage[] = [{ role: 'user', text: 'find earbuds' }], onText?: (d: string) => void): ModelRequest => ({ system: 'SYSTEM', messages, tools: TOOLS, lang: 'en', ...(onText ? { onText } : {}) });
const GROQ = groqProvider({ GROQ_API_KEY: 'g' })!;
const OR = openRouterProvider({ OPENROUTER_API_KEY: 'o' })!;

type Reply = { status?: number; content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>; finish?: string };
function fakeNet(groq: Reply[], openrouter: Reply[]) {
  const sent: { groq: unknown[]; openrouter: unknown[] } = { groq: [], openrouter: [] };
  const f = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify({ data: [{ id: OR.model, pricing: { prompt: '0', completion: '0' } }] }));
    const who = url.includes('groq.com') ? 'groq' : 'openrouter';
    sent[who].push(JSON.parse(String(init?.body)));
    const r = (who === 'groq' ? groq : openrouter).shift() ?? { status: 500 };
    if (r.status && r.status !== 200) return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: r.status });
    return new Response(JSON.stringify({ choices: [{ finish_reason: r.finish ?? (r.tool_calls ? 'tool_calls' : 'stop'), message: { content: r.content ?? null, tool_calls: r.tool_calls } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  }) as unknown as typeof fetch;
  return { f, sent };
}

const usage = { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Anthropic.Usage;
function fakeClaude(reply: Anthropic.Message['content'] | Error) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesCreator = {
    messages: {
      async create(params) {
        calls.push(structuredClone(params));
        if (reply instanceof Error) throw reply;
        return { content: reply, stop_reason: 'end_turn', usage };
      },
    },
  };
  return { client, calls };
}

const model = (f: typeof fetch, claude: MessagesCreator | null = null) => new FailoverModel({ free: [GROQ, OR], claude: claude ? { client: claude } : null, fetchImpl: f, breaker: new CircuitBreaker(), onAttempt: () => {} });

describe('shopping agent failover (Groq → OpenRouter free → Claude Haiku)', () => {
  it('Groq answers with a tool call; the reply is ours (neutral shape, no Claude blocks)', async () => {
    const { f, sent } = fakeNet([{ tool_calls: [{ id: 'c1', function: { name: 'search_products', arguments: '{"query":"earbuds"}' } }] }], []);
    const m = model(f);
    const turn = await m.respond(req());
    expect(turn.toolCalls).toEqual([{ id: 'c1', name: 'search_products', input: { query: 'earbuds' } }]);
    expect(turn.raw).toBeUndefined();
    expect(m.lastBy?.provider).toBe('groq');
    const body = sent.groq[0] as { tools: Array<{ function: { parameters: Record<string, unknown> } }>; reasoning_effort: string };
    expect(body.reasoning_effort).toBe('none');
    expect(body.tools[0]!.function.parameters).not.toHaveProperty('$schema');
  });

  it('a broken tool call (not JSON, or a tool we do not have) is a bad answer: OpenRouter gets the turn', async () => {
    const { f } = fakeNet([{ tool_calls: [{ id: 'c1', function: { name: 'search_products', arguments: '{"query": earbuds' } }] }], [{ content: 'Which colour?' }]);
    const m = model(f);
    const turn = await m.respond(req());
    expect(turn.text).toBe('Which colour?');
    expect(m.lastBy?.provider).toBe('openrouter');
    expect(() => parseToolCalls([{ id: 'x', name: 'pay_now', arguments: '{}' }], TOOLS)).toThrow(/unknown tool/);
  });

  it('Groq and OpenRouter fail → Claude Haiku answers, without thinking blocks from earlier Claude turns', async () => {
    const { f } = fakeNet([{ status: 429 }], [{ status: 503 }]);
    const claude = fakeClaude([{ type: 'text', text: 'Here are three stores.', citations: null } as Anthropic.TextBlock]);
    const history: AgentMessage[] = [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'Hello', toolCalls: [], raw: [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'text', text: 'Hello' }] },
      { role: 'user', text: 'find earbuds' },
    ];
    const m = model(f, claude.client);
    const turn = await m.respond(req(history));
    expect(turn.text).toBe('Here are three stores.');
    expect(m.lastBy).toEqual({ provider: 'claude', model: 'claude-haiku-5-5' });
    expect(claude.calls[0]!.model).toBe('claude-haiku-5-5');
    expect(JSON.stringify(claude.calls[0]!.messages)).not.toContain('"thinking"');
  });

  it('all fail → ModelUnavailableError (the chat shows its calm "agent not available" message)', async () => {
    const { f } = fakeNet([{ status: 500 }], [{ status: 402 }]);
    const claude = fakeClaude(Object.assign(new Anthropic.APIError(400, { error: { message: 'Your credit balance is too low' } }, 'Your credit balance is too low', new Headers()), {}));
    await expect(model(f, claude.client).respond(req())).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('the second free OpenRouter model takes the turn when the first is benched', async () => {
    const backup = openRouterProvider({ OPENROUTER_API_KEY: 'o' }, 'backup')!;
    const models: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/v1/models')) return new Response(JSON.stringify({ data: [OR.model, backup.model].map((id) => ({ id, pricing: { prompt: '0', completion: '0' } })) }));
      const body = JSON.parse(String(init?.body));
      models.push(body.model);
      if (url.includes('groq.com') || body.model === OR.model) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'From the backup.' } }] }));
    }) as unknown as typeof fetch;
    const m = new FailoverModel({ free: [GROQ, OR, backup], claude: null, fetchImpl: f, breaker: new CircuitBreaker(), onAttempt: () => {} });
    expect((await m.respond(req())).text).toBe('From the backup.');
    expect((await m.respond(req())).text).toBe('From the backup.');
    expect(models).toEqual([GROQ.model, OR.model, backup.model, backup.model]); // the 5xx benched Groq and the first model
  });

  it('Groq rotation: qwen busy → gpt-oss-120b answers; each Groq model has its own breaker entry', async () => {
    const [qwen, big, small] = groqProviders({ GROQ_API_KEY: 'g' });
    const models: string[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      models.push(`${body.model}:${body.reasoning_effort}`);
      if (body.model === qwen!.model) return new Response(JSON.stringify({ error: { message: 'Rate limit reached ... tokens per minute' } }), { status: 429, headers: { 'retry-after': '30', 'x-ratelimit-remaining-requests': '900' } });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'From gpt-oss.' } }] }));
    }) as unknown as typeof fetch;
    const breaker = new CircuitBreaker();
    const m = new FailoverModel({ free: [qwen!, big!, small!], claude: null, fetchImpl: f, breaker, onAttempt: () => {} });
    expect((await m.respond(req())).text).toBe('From gpt-oss.');
    expect(models).toEqual(['qwen/qwen3.8-27b:none', 'openai/gpt-oss-120b:low']);
    expect(breaker.skipped(breakerKey(qwen!))).toBe('rate_minute');
    expect(breaker.skipped(breakerKey(big!))).toBeNull();
  });

  it('never Gemini for the shopping agent (user chat stays off Google’s free tier)', () => {
    const gemini = geminiProvider({ GEMINI_API_KEY: 'k' })!;
    expect(() => new FailoverModel({ free: [GROQ, gemini], claude: null })).toThrow(/page analysis only/);
    expect(agentChain({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k', OPENROUTER_API_KEY: 'o' }).map((p) => p.id)).toEqual(['groq', 'groq', 'groq', 'openrouter', 'openrouter']);
  });

  it('the circuit breaker skips a provider that just failed', async () => {
    const breaker = new CircuitBreaker();
    const { f, sent } = fakeNet([{ status: 500 }], [{ content: 'one' }, { content: 'two' }]);
    const m = new FailoverModel({ free: [GROQ, OR], claude: null, fetchImpl: f, breaker, onAttempt: () => {} });
    await m.respond(req());
    await m.respond(req());
    expect(sent.groq).toHaveLength(1);
    expect(sent.openrouter).toHaveLength(2);
  });

  it('Claude is skipped when not allowed (today’s Anthropic budget used up)', async () => {
    const { f } = fakeNet([{ status: 500 }], [{ status: 500 }]);
    const claude = fakeClaude([{ type: 'text', text: 'paid', citations: null } as Anthropic.TextBlock]);
    const m = new FailoverModel({ free: [GROQ, OR], claude: { client: claude.client }, claudeAllowed: () => false, fetchImpl: f, breaker: new CircuitBreaker(), onAttempt: () => {} });
    await expect(m.respond(req())).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(claude.calls).toHaveLength(0);
  });

  it('a free provider’s whole reply is passed to onText once', async () => {
    const { f } = fakeNet([{ content: 'Hello there' }], []);
    const deltas: string[] = [];
    await model(f).respond(req(undefined, (d) => deltas.push(d)));
    expect(deltas).toEqual(['Hello there']);
  });

  it('history → chat messages: tool results as tool messages, our system prompt plus the language line', () => {
    const msgs = toChatMessages('SYS', 'fr', [
      { role: 'user', text: 'cherche' },
      { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'search_products', input: { query: 'x' } }] },
      { role: 'tool', results: [{ toolCallId: 't1', content: '{"ok":true}' }] },
    ]);
    expect(msgs[0]).toMatchObject({ role: 'system' });
    expect(msgs[0]!.content).toContain('French');
    expect(msgs[2]).toMatchObject({ role: 'assistant', content: null, tool_calls: [{ id: 't1', function: { name: 'search_products', arguments: '{"query":"x"}' } }] });
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: '{"ok":true}' });
  });
});
