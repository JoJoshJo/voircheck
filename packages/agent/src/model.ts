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
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
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
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
}

export interface ModelClient {
  readonly id: string;
  respond(req: ModelRequest): Promise<ModelTurn>;
}

/** Spec 5.13: Sonnet 5.5 runs the agent. (🟡 proposed, not built: AGENT_MODEL to develop on Haiku 5.5.) */
export const AGENT_MODEL_ID = 'claude-sonnet-5-5';

export class MissingModelKeyError extends Error {
  constructor() {
    super('no key: ANTHROPIC_API_KEY is not set, so the real agent model is unavailable');
    this.name = 'MissingModelKeyError';
  }
}

/**
 * The real model, not wired yet: the Anthropic key arrives by Nov 3 (spec 5.13). Without a key it throws "no key".
 * With a key it still refuses until the SDK call is written, so a key alone never sends anything to the API.
 */
export class AnthropicModel implements ModelClient {
  readonly id = AGENT_MODEL_ID;
  constructor(private readonly apiKey: string | undefined) {}

  respond(): Promise<ModelTurn> {
    if (!this.apiKey) return Promise.reject(new MissingModelKeyError());
    return Promise.reject(new Error('AnthropicModel is a stub: the Messages API call is not written yet'));
  }
}
