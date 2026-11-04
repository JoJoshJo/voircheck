/**
 * The shopping agent's model, behind one small interface (spec 5.13). The shapes map 1:1 onto the Claude Messages API:
 * an assistant turn = text + tool_use blocks; the next user turn = one tool_result per call, all in ONE message
 * (parallel tool use). Tool results are always JSON strings built by our own code (tools.ts), never page text.
 */

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  /** JSON produced by our tool code from a strict output schema. */
  content: string;
  isError?: boolean;
}

export type AgentMessage =
  | { role: 'user'; text: string }
  /** `raw` = the provider's own content blocks for this turn (thinking blocks included), replayed unchanged. */
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; results: ToolResult[] };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the input (Anthropic `input_schema`). */
  inputSchema: Record<string, unknown>;
}

export interface ModelRequest {
  system: string;
  messages: readonly AgentMessage[];
  tools: readonly ToolSpec[];
  /** The user's app language; the real model gets it in the system prompt too. */
  lang: 'en' | 'fr';
  /** Called with each piece of the reply's text as it is written (streaming). The turn's returned text is final. */
  onText?: (delta: string) => void;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  raw?: unknown;
  usage?: ModelUsage;
}

export interface ModelClient {
  readonly id: string;
  respond(req: ModelRequest): Promise<ModelTurn>;
}

/** Spec 5.13: Sonnet 5.5 runs the agent (env AGENT_MODEL overrides). */
export const AGENT_MODEL_ID = 'claude-sonnet-5-5';

export class MissingModelKeyError extends Error {
  constructor() {
    super('no key: ANTHROPIC_API_KEY is not set, so the real agent model is unavailable');
    this.name = 'MissingModelKeyError';
  }
}

/** The model API can't be used right now (out of credit, bad key, overloaded, network). The chat says so calmly. */
export class ModelUnavailableError extends Error {
  constructor(
    readonly reason: 'credit' | 'auth' | 'overloaded' | 'network' | 'other',
    detail: string,
  ) {
    super(`agent model unavailable (${reason}): ${detail.slice(0, 200)}`);
    this.name = 'ModelUnavailableError';
  }
}
