import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicModel, toApiMessages, type MessagesCreator } from './anthropic-model';
import { runAgentTurn, type AnyAgentTool } from './loop';
import { MissingModelKeyError, ModelUnavailableError, type AgentMessage, type ModelRequest } from './model';
import { AGENT_SYSTEM_PROMPT } from './prompt';
import { z } from 'zod';

type Reply = Pick<Anthropic.Message, 'content' | 'stop_reason' | 'usage'>;
const usage = { input_tokens: 1_000, output_tokens: 100, cache_read_input_tokens: 2_000, cache_creation_input_tokens: 0 } as Anthropic.Usage;
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as Anthropic.TextBlock;
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } }) as unknown as Anthropic.ToolUseBlock;
const thinking = { type: 'thinking', thinking: 'Searching first.', signature: 'sig' } as Anthropic.ThinkingBlock;

function fakeClient(replies: Array<Reply | Error>) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesCreator = {
    messages: {
      async create(params) {
        calls.push(structuredClone(params));
        const r = replies.shift() ?? { content: [text('done')], stop_reason: 'end_turn', usage };
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
  return { client, calls };
}

const req = (messages: AgentMessage[] = [{ role: 'user', text: 'find earbuds' }], lang: 'en' | 'fr' = 'en'): ModelRequest => ({
  system: AGENT_SYSTEM_PROMPT,
  messages,
  tools: [{ name: 'search_products', description: 'Find one item.', inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', properties: { query: { type: 'string' } } } }],
  lang,
});

describe('AnthropicModel: request', () => {
  it('Sonnet 5.5, cached system prompt (+ tools), automatic history caching, low effort, small max_tokens, no sampling params', async () => {
    const { client, calls } = fakeClient([]);
    await new AnthropicModel({ apiKey: 'k', client }).respond(req(undefined, 'fr'));
    const p = calls[0]!;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.max_tokens).toBeLessThanOrEqual(2_048);
    expect(p.output_config).toEqual({ effort: 'low' });
    expect(p.cache_control).toEqual({ type: 'ephemeral' });
    expect(p.system).toEqual([
      { type: 'text', text: AGENT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'The person’s app language is French: reply in the language they write in, French when unclear, always with “vous”.' },
    ]);
    expect(p).not.toHaveProperty('temperature');
    expect(p).not.toHaveProperty('tool_choice');
    expect(p.tools).toEqual([{ name: 'search_products', description: 'Find one item.', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }]);
  });

  it('AGENT_MODEL picks the model', async () => {
    const { client, calls } = fakeClient([]);
    await new AnthropicModel({ apiKey: 'k', client, model: 'claude-haiku-5-5' }).respond(req());
    expect(calls[0]!.model).toBe('claude-haiku-5-5');
  });

  it('history: assistant turns replay their raw blocks unchanged; tool results go back in one user message; adjacent user turns merge', () => {
    const raw = [thinking, toolUse('t1', 'search_products', { query: 'x' }), toolUse('t2', 'get_scan_verdict', { storeId: 'a' })];
    const out = toApiMessages([
      { role: 'user', text: 'find x' },
      { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'search_products', input: { query: 'x' } }, { id: 't2', name: 'get_scan_verdict', input: { storeId: 'a' } }], raw },
      { role: 'tool', results: [{ toolCallId: 't1', content: '{"status":"ok"}' }, { toolCallId: 't2', content: '{"error":"x"}', isError: true }] },
      { role: 'user', text: 'and now?' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'find x' }] },
      { role: 'assistant', content: raw },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"status":"ok"}' },
          { type: 'tool_result', tool_use_id: 't2', content: '{"error":"x"}', is_error: true },
          { type: 'text', text: 'and now?' },
        ],
      },
    ]);
  });

  it('history from the FakeModel (no raw) is rebuilt from text + tool calls', () => {
    expect(toApiMessages([{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello.', toolCalls: [] }])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello.' }] },
    ]);
  });
});

describe('AnthropicModel: response', () => {
  it('reads blocks by type: text joined, tool calls only on a complete tool_use turn, usage priced as Sonnet', async () => {
    const { client } = fakeClient([{ content: [thinking, text('Looking.'), toolUse('t1', 'search_products', { query: 'earbuds' })], stop_reason: 'tool_use', usage }]);
    const t = await new AnthropicModel({ apiKey: 'k', client }).respond(req());
    expect(t.text).toBe('Looking.');
    expect(t.toolCalls).toEqual([{ id: 't1', name: 'search_products', input: { query: 'earbuds' } }]);
    expect(t.raw).toHaveLength(3);
    expect(t.usage).toMatchObject({ inputTokens: 1_000, outputTokens: 100, cacheReadTokens: 2_000 });
    expect(t.usage!.costUsd).toBeCloseTo((1_000 * 2 + 100 * 10 + 2_000 * 0.2) / 1e6, 8);
  });

  it('a max_tokens cut never runs a half-written tool call', async () => {
    const { client } = fakeClient([{ content: [text('Let me'), toolUse('t1', 'create_order', { storeId: 'a' })], stop_reason: 'max_tokens', usage }]);
    const t = await new AnthropicModel({ apiKey: 'k', client }).respond(req());
    expect(t.toolCalls).toEqual([]);
    expect(t.raw).toEqual([text('Let me')]);
  });

  it('a refusal becomes a calm line in the person’s language', async () => {
    const { client } = fakeClient([{ content: [], stop_reason: 'refusal', usage }]);
    expect((await new AnthropicModel({ apiKey: 'k', client }).respond(req(undefined, 'fr'))).text).toMatch(/^Je ne peux pas/);
  });
});

describe('AnthropicModel: failures', () => {
  it('no key → MissingModelKeyError, nothing sent', async () => {
    await expect(new AnthropicModel({ apiKey: undefined }).respond(req())).rejects.toBeInstanceOf(MissingModelKeyError);
    await expect(new AnthropicModel({ apiKey: '' }).respond(req())).rejects.toBeInstanceOf(MissingModelKeyError);
  });

  it.each([
    [new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }, 'Your credit balance is too low', new Headers()), 'credit'],
    [new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()), 'auth'],
    [new Anthropic.InternalServerError(529, undefined, 'Overloaded', new Headers()), 'overloaded'],
    [new Anthropic.APIConnectionError({ message: 'Connection error.' }), 'network'],
  ] as const)('%s → ModelUnavailableError(%s)', async (err, reason) => {
    const { client } = fakeClient([err]);
    const p = new AnthropicModel({ apiKey: 'k', client }).respond(req());
    await expect(p).rejects.toBeInstanceOf(ModelUnavailableError);
    await expect(p).rejects.toMatchObject({ reason });
  });
});

describe('AnthropicModel in the loop', () => {
  it('keeps raw blocks in the history and adds up usage across steps', async () => {
    const { client, calls } = fakeClient([
      { content: [thinking, toolUse('t1', 'search_products', { query: 'earbuds' })], stop_reason: 'tool_use', usage },
      { content: [text('Found two stores.')], stop_reason: 'end_turn', usage },
    ]);
    const tool: AnyAgentTool = { name: 'search_products', description: 'Find one item.', input: z.object({ query: z.string() }), output: z.object({ status: z.literal('ok') }), run: async () => ({ status: 'ok' }) };
    const r = await runAgentTurn({ model: new AnthropicModel({ apiKey: 'k', client }), tools: [tool], system: AGENT_SYSTEM_PROMPT, history: [], userText: 'find earbuds', lang: 'en' });
    expect(r.stopped).toBe('done');
    expect(r.modelCalls).toBe(2);
    expect(r.usage.inputTokens).toBe(2_000);
    // The second request replays the first turn's thinking block unchanged.
    expect(calls[1]!.messages[1]).toEqual({ role: 'assistant', content: [thinking, toolUse('t1', 'search_products', { query: 'earbuds' })] });
    expect(calls[1]!.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"status":"ok"}' }] });
  });
});

describe('AnthropicModel: streaming', () => {
  function streamingClient(reply: Reply, pieces: string[]) {
    const created: unknown[] = [];
    const streamed: unknown[] = [];
    const client: MessagesCreator = {
      messages: {
        async create(params) {
          created.push(params);
          return reply;
        },
        stream(params) {
          streamed.push(params);
          let cb: (d: string) => void = () => {};
          return {
            on(_e: 'text', f: (d: string) => void) {
              cb = f;
            },
            async finalMessage() {
              for (const p of pieces) cb(p);
              return reply;
            },
          };
        },
      },
    };
    return { client, created, streamed };
  }

  it('with onText: streams the same request, passes the text on as written, and returns the same turn', async () => {
    const reply: Reply = { content: [text('Looks safe to buy.')], stop_reason: 'end_turn', usage };
    const { client, created, streamed } = streamingClient(reply, ['Looks ', 'safe ', 'to buy.']);
    const pieces: string[] = [];
    const turn = await new AnthropicModel({ apiKey: 'k', client }).respond({ ...req(), onText: (d) => pieces.push(d) });
    expect(pieces).toEqual(['Looks ', 'safe ', 'to buy.']);
    expect(created).toHaveLength(0);
    expect(streamed).toHaveLength(1);
    expect(turn.text).toBe('Looks safe to buy.');
    const plain = await new AnthropicModel({ apiKey: 'k', client }).respond(req());
    expect(created).toHaveLength(1);
    expect(streamed[0]).toEqual(created[0]); // same model, effort, caching, tools, messages
    expect(plain).toEqual(turn);
  });

  it('a streamed turn cut at max_tokens still runs no tools', async () => {
    const reply: Reply = { content: [text('Let me'), toolUse('t1', 'search_products', { query: 'x' })], stop_reason: 'max_tokens', usage };
    const { client } = streamingClient(reply, ['Let me']);
    const turn = await new AnthropicModel({ apiKey: 'k', client }).respond({ ...req(), onText: () => {} });
    expect(turn.toolCalls).toEqual([]);
  });

  it('the loop forwards the pieces as assistant_delta, then the final assistant_text', async () => {
    const reply: Reply = { content: [text('Hi there')], stop_reason: 'end_turn', usage };
    const { client } = streamingClient(reply, ['Hi ', 'there']);
    const events: unknown[] = [];
    await runAgentTurn({ model: new AnthropicModel({ apiKey: 'k', client }), tools: [], system: 's', history: [], userText: 'hi', lang: 'en', onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'assistant_delta', text: 'Hi ' },
      { type: 'assistant_delta', text: 'there' },
      { type: 'assistant_text', text: 'Hi there' },
    ]);
  });
});
