import Anthropic from '@anthropic-ai/sdk';
import { costUsd } from '@voircheck/scanner';
import { AGENT_MODEL_ID, MissingModelKeyError, ModelUnavailableError, type AgentMessage, type ModelClient, type ModelRequest, type ModelTurn, type ToolCall, type ToolSpec } from './model';

/**
 * The real shopping-agent model (spec 5.13): Claude Sonnet 5.5 through the Messages API, manual tool loop (loop.ts).
 * - Adaptive thinking at effort "low" (the docs' recommendation over turning thinking off); effort never changes
 *   mid-conversation. Each assistant turn's content blocks (thinking included) are kept in `raw` and sent back
 *   unchanged, as Sonnet 5.5 requires.
 * - Cost guards: cache breakpoint on the system prompt (tools render before it, so tools + system are cached
 *   together), automatic caching of the growing history across tool steps, small max_tokens. No temperature: the API
 *   version our SDK uses rejects sampling parameters.
 * - The language line sits after the cached block, so EN and FR share the cached tools + rules.
 */

export const AGENT_MAX_TOKENS = 2_048;

/** The slice of the SDK client we use (lets tests pass a fake). */
export interface MessagesCreator {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): PromiseLike<Pick<Anthropic.Message, 'content' | 'stop_reason' | 'usage'>> };
}

const LANG_LINE = { en: 'The person’s app language is English: reply in English.', fr: 'The person’s app language is French: reply in French, and call the verdicts Fiable, En attente and Bloquée (never SAFE, HOLD or BLOCK).' } as const;
const REFUSAL = { en: 'I can’t help with that one. I can find an item and check the stores that sell it.', fr: 'Je ne peux pas vous aider sur ce point. Je peux chercher un article et vérifier les boutiques qui le vendent.' } as const;

/** Our tool specs as API tools: z.toJSONSchema adds a `$schema` key the API doesn't need. */
function apiTools(tools: readonly ToolSpec[]): Anthropic.Tool[] {
  return tools.map((t) => {
    const schema = Object.fromEntries(Object.entries(t.inputSchema).filter(([k]) => k !== '$schema'));
    return { name: t.name, description: t.description, input_schema: { ...schema, type: 'object' } as Anthropic.Tool.InputSchema };
  });
}

/** Our conversation as Messages API turns. Tool results go back as ONE user message; adjacent user turns merge. */
export function toApiMessages(messages: readonly AgentMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  const pushUser = (blocks: Anthropic.ContentBlockParam[]) => {
    const last = out.at(-1);
    if (last?.role === 'user') last.content = [...(typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : last.content), ...blocks];
    else out.push({ role: 'user', content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') pushUser([{ type: 'text', text: m.text }]);
    else if (m.role === 'tool') pushUser(m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.toolCallId, content: r.content, ...(r.isError ? { is_error: true } : {}) })));
    else {
      const content = Array.isArray(m.raw)
        ? (m.raw as Anthropic.ContentBlockParam[])
        : [...(m.text ? [{ type: 'text' as const, text: m.text }] : []), ...m.toolCalls.map((c) => ({ type: 'tool_use' as const, id: c.id, name: c.name, input: c.input }))];
      if (content.length) out.push({ role: 'assistant', content });
    }
  }
  return out;
}

function unavailable(err: unknown): ModelUnavailableError {
  if (err instanceof Anthropic.APIConnectionError) return new ModelUnavailableError('network', err.message);
  if (err instanceof Anthropic.APIError) {
    const msg = err.message ?? '';
    if (err.status === 400 && /credit|billing|balance/i.test(msg)) return new ModelUnavailableError('credit', msg);
    if (err.status === 401 || err.status === 403) return new ModelUnavailableError('auth', msg);
    if (err.status === 429 || err.status === 529 || (err.status ?? 0) >= 500) return new ModelUnavailableError('overloaded', msg);
    return new ModelUnavailableError('other', msg);
  }
  return new ModelUnavailableError('other', err instanceof Error ? err.message : 'unknown error');
}

export class AnthropicModel implements ModelClient {
  readonly id: string;
  private client: MessagesCreator | null;

  constructor(private readonly opts: { apiKey: string | undefined; model?: string; client?: MessagesCreator; maxTokens?: number }) {
    this.id = opts.model || AGENT_MODEL_ID;
    this.client = opts.client ?? null;
  }

  async respond(req: ModelRequest): Promise<ModelTurn> {
    if (!this.opts.apiKey && !this.opts.client) throw new MissingModelKeyError();
    this.client ??= new Anthropic({ apiKey: this.opts.apiKey, maxRetries: 2 });
    let res: Awaited<ReturnType<MessagesCreator['messages']['create']>>;
    try {
      res = await this.client.messages.create({
        model: this.id,
        max_tokens: this.opts.maxTokens ?? AGENT_MAX_TOKENS,
        output_config: { effort: 'low' },
        cache_control: { type: 'ephemeral' },
        system: [
          { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: LANG_LINE[req.lang] },
        ],
        tools: apiTools(req.tools),
        messages: toApiMessages(req.messages),
      });
    } catch (err) {
      throw unavailable(err);
    }
    const u = res.usage;
    const tokens = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 };
    const usage = { ...tokens, costUsd: costUsd(tokens, this.id) };
    if (res.stop_reason === 'refusal') return { text: REFUSAL[req.lang], toolCalls: [], usage };
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
    // Only a complete tool_use turn runs tools: a max_tokens cut can leave a half-written call.
    const toolCalls: ToolCall[] = res.stop_reason === 'tool_use' ? res.content.flatMap((b) => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, input: b.input }] : [])) : [];
    const raw = res.stop_reason === 'tool_use' || res.stop_reason === 'end_turn' ? res.content : res.content.filter((b) => b.type !== 'tool_use');
    return { text, toolCalls, raw, usage };
  }
}
