import {
  CLAUDE_BACKUP_MODEL,
  ProviderError,
  breakerKey,
  chatComplete,
  runFailover,
  sharedBreaker,
  type AnalyzedBy,
  type Attempt,
  type ChatMessage,
  type ChatProvider,
  type ChatTool,
  type CircuitBreaker,
  type FailoverLog,
  type ProviderId,
} from '@voircheck/scanner';
import { AnthropicModel, type MessagesCreator } from './anthropic-model';
import { MissingModelKeyError, ModelUnavailableError, type AgentMessage, type ModelClient, type ModelRequest, type ModelTurn, type ToolCall, type ToolSpec } from './model';

/**
 * The shopping agent on the shared AI provider layer (spec 5.13, $0 for AI, J Nov 11): Groq qwen → gpt-oss-120b →
 * gpt-oss-20b → OpenRouter free → Claude Haiku 5.5 last, one at a time. NEVER Gemini: user chat stays off Google's
 * free tier (refused in the constructor). Each model call can land on a different provider, so the conversation is kept in
 * our own neutral shape (text + tool calls + tool results); only Claude's own turns carry Claude blocks (`raw`).
 *
 * Safety is unchanged: the model only proposes tool calls; our tool code checks them (MoneyGate, our own prices, code
 * verdicts), tool results are our JSON summaries (never page text), and a call that isn't valid JSON for a real tool
 * is a bad answer (the next provider gets the turn), never something we guess at.
 */

/** Per-provider timeouts for one agent model call (approved Nov 10). */
/** Per-provider timeouts and the overall cap for one agent model call. Gemini is never used for the agent. */
export const AGENT_TIMEOUTS = { groq: 10_000, gemini: 0, openrouter: 20_000, claude: 30_000, overall: 45_000 } as const;
/** Free providers' max reply size: Groq's free plan counts it against 8,000 tokens a minute. */
export const CHAT_AGENT_MAX_TOKENS = 1_024;

const LANG_LINE = { en: 'The person’s app language is English: reply in the language they write in, English when unclear.', fr: 'The person’s app language is French: reply in the language they write in, French when unclear, always with “vous”.' } as const;

function chatTools(tools: readonly ToolSpec[]): ChatTool[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: { ...Object.fromEntries(Object.entries(t.inputSchema).filter(([k]) => k !== '$schema')), type: 'object' } },
  }));
}

/** Our conversation as OpenAI-style chat messages (one `tool` message per result). */
export function toChatMessages(system: string, lang: 'en' | 'fr', messages: readonly AgentMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: 'system', content: `${system}\n\n${LANG_LINE[lang]}` }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'tool') for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.isError ? `ERROR: ${r.content}` : r.content });
    else if (m.text || m.toolCalls.length)
      out.push({
        role: 'assistant',
        content: m.text || null,
        ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}),
      });
  }
  return out;
}

/** Thinking blocks belong to the Claude call that made them; never replay them into another provider's history. */
function withoutThinking(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.map((m) => (m.role === 'assistant' && Array.isArray(m.raw) ? { ...m, raw: (m.raw as Array<{ type?: string }>).filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking') } : m));
}

/** A model's tool calls → ours. Not JSON, or a tool we don't have → bad answer (counted as a tool-call error). */
export function parseToolCalls(calls: ReadonlyArray<{ id: string; name: string; arguments: string }>, tools: readonly ToolSpec[]): ToolCall[] {
  const names = new Set(tools.map((t) => t.name));
  return calls.map((c) => {
    if (!names.has(c.name)) throw new ProviderError('bad_output', `tool-call error: unknown tool "${c.name.slice(0, 40)}"`);
    let input: unknown;
    try {
      input = c.arguments.trim() ? JSON.parse(c.arguments) : {};
    } catch {
      throw new ProviderError('bad_output', `tool-call error: arguments for ${c.name} are not JSON`);
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProviderError('bad_output', `tool-call error: arguments for ${c.name} are not an object`);
    return { id: c.id, name: c.name, input };
  });
}

/** qwen3 can still emit an empty <think></think> pair; it's never shown. */
const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

async function chatTurn(p: ChatProvider, req: ModelRequest, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ModelTurn> {
  const ans = await chatComplete(p, { messages: toChatMessages(req.system, req.lang, req.messages), tools: chatTools(req.tools), maxTokens: CHAT_AGENT_MAX_TOKENS }, signal, fetchImpl);
  if (ans.finishReason === 'length') throw new ProviderError('bad_output', 'the reply was cut off');
  const toolCalls = parseToolCalls(ans.toolCalls, req.tools);
  const text = stripThink(ans.content);
  if (!text && !toolCalls.length) throw new ProviderError('bad_output', 'empty reply');
  return { text, toolCalls, usage: { inputTokens: ans.usage.inputTokens, outputTokens: ans.usage.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 } };
}

function claudeFailure(err: unknown): ProviderError {
  if (err instanceof MissingModelKeyError) return new ProviderError('not_configured', err.message);
  if (err instanceof ModelUnavailableError) {
    const kind = ({ credit: 'credit', auth: 'auth', overloaded: 'server', network: 'network', other: 'other' } as const)[err.reason];
    return new ProviderError(kind, err.message);
  }
  return err instanceof ProviderError ? err : new ProviderError('other', err instanceof Error ? err.message : String(err));
}

export interface FailoverModelOptions {
  /** The free providers, in order (`agentChain()`): each model has its own breaker entry. Never Gemini. */
  free: readonly ChatProvider[];
  /** Claude, tried LAST; null = free providers only. */
  claude: { apiKey?: string; model?: string; client?: MessagesCreator } | null;
  /** Checked before each call: false = skip Claude this time (e.g. today's Anthropic budget is used up). */
  claudeAllowed?: () => boolean | Promise<boolean>;
  breaker?: CircuitBreaker;
  fetchImpl?: typeof fetch;
  timeouts?: Record<ProviderId, number> & { overall: number };
  onAttempt?: (l: FailoverLog) => void;
}

export class FailoverModel implements ModelClient {
  readonly id = 'failover';
  /** Who answered the last call (for logs and the turn's usage line). */
  lastBy: AnalyzedBy | null = null;
  private claude: AnthropicModel | null;

  constructor(private readonly opts: FailoverModelOptions) {
    // User chat never goes to Gemini's free tier (its content is used to improve Google's products).
    if (opts.free.some((p) => p.id === 'gemini')) throw new Error('Gemini is for page analysis only, never the shopping agent');
    const c = opts.claude;
    this.claude = c && (c.apiKey || c.client) ? new AnthropicModel({ apiKey: c.apiKey, model: c.model || CLAUDE_BACKUP_MODEL, ...(c.client ? { client: c.client } : {}) }) : null;
  }

  async respond(req: ModelRequest): Promise<ModelTurn> {
    const t = this.opts.timeouts ?? AGENT_TIMEOUTS;
    // Order (J, Nov 11): the free chain first, Claude Haiku last (streamed).
    const attempts: Attempt<ModelTurn>[] = this.opts.free.map((p) => ({ provider: p.id, key: breakerKey(p), model: p.model, timeoutMs: t[p.id], run: (signal: AbortSignal) => chatTurn(p, req, signal, this.opts.fetchImpl) }));
    const claude = this.claude;
    if (claude && (await (this.opts.claudeAllowed?.() ?? true))) {
      attempts.push({
        provider: 'claude',
        model: claude.id,
        timeoutMs: t.claude,
        run: async (signal) => {
          // Once Claude has timed out, its late text must not reach the chat while the next provider answers.
          const onText = req.onText;
          const gated = onText ? { onText: (d: string) => (signal.aborted ? undefined : onText(d)) } : {};
          try {
            return await claude.respond({ ...req, ...gated, messages: withoutThinking(req.messages) });
          } catch (err) {
            throw claudeFailure(err);
          }
        },
      });
    }
    if (!attempts.length) throw new MissingModelKeyError();
    const r = await runFailover('agent', attempts, { breaker: this.opts.breaker ?? sharedBreaker(), overallMs: t.overall, ...(this.opts.onAttempt ? { log: this.opts.onAttempt } : {}) });
    if (!r.ok) throw new ModelUnavailableError('other', `no AI provider answered (${r.tried.map((x) => `${x.provider} ${x.outcome}`).join(', ')})`);
    this.lastBy = r.by;
    // The free providers aren't streamed: their whole reply arrives at once (Claude streams its own).
    if (r.by.provider !== 'claude' && r.value.text) req.onText?.(r.value.text);
    return r.value;
  }
}
