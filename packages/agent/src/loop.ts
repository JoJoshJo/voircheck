import { z } from 'zod';
import type { AgentMessage, ModelClient, ToolCall, ToolResult, ToolSpec } from './model';

/**
 * One agent tool. `output` is a strict schema: the loop parses every result with it, so only the fields it names
 * reach the model (zod strips unknown keys). That is where "the agent never sees page text" is enforced
 * (spec 5.13 defense 3): a tool can't leak a field its output schema doesn't have.
 */
export interface AgentTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  run(input: I): Promise<O>;
}

// Tools are stored without their type parameters; each one validates its own input before `run`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentTool = AgentTool<any, any>;

export type LoopEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_call'; id: string; name: string }
  | { type: 'tool_result'; id: string; name: string; isError: boolean };

export const MAX_STEPS = 8;
/** A tool result longer than this is a bug in our tool code, not something to send. */
export const MAX_TOOL_RESULT_CHARS = 8_000;

export function toolSpecs(tools: readonly AnyAgentTool[]): ToolSpec[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.input) as Record<string, unknown> }));
}

const errorResult = (toolCallId: string, error: string): ToolResult => ({ toolCallId, content: JSON.stringify({ error }), isError: true });

async function runTool(tools: Map<string, AnyAgentTool>, call: ToolCall): Promise<ToolResult> {
  const tool = tools.get(call.name);
  if (!tool) return errorResult(call.id, `unknown tool: ${call.name}`);
  const input = tool.input.safeParse(call.input);
  if (!input.success) return errorResult(call.id, 'invalid input for this tool');
  let raw: unknown;
  try {
    raw = await tool.run(input.data);
  } catch (err) {
    console.error(`agent tool ${tool.name} failed:`, err instanceof Error ? err.message : 'unknown error');
    return errorResult(call.id, 'the tool failed; try again later');
  }
  const out = tool.output.safeParse(raw);
  if (!out.success) return errorResult(call.id, 'the tool returned an unexpected result');
  const content = JSON.stringify(out.data);
  if (content.length > MAX_TOOL_RESULT_CHARS) return errorResult(call.id, 'the tool result was too large');
  return { toolCallId: call.id, content };
}

/**
 * One user turn: call the model, run the tools it asks for (in parallel, results back in ONE message), repeat until
 * it answers without tool calls. Returns the whole conversation, ready for the next turn.
 */
export async function runAgentTurn(opts: {
  model: ModelClient;
  tools: readonly AnyAgentTool[];
  system: string;
  history: readonly AgentMessage[];
  userText: string;
  lang: 'en' | 'fr';
  maxSteps?: number;
  onEvent?: (e: LoopEvent) => void;
}): Promise<{ messages: AgentMessage[]; stopped: 'done' | 'max_steps' }> {
  const messages: AgentMessage[] = [...opts.history, { role: 'user', text: opts.userText }];
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const specs = toolSpecs(opts.tools);
  const emit = opts.onEvent ?? (() => {});

  for (let step = 0; step < (opts.maxSteps ?? MAX_STEPS); step++) {
    const turn = await opts.model.respond({ system: opts.system, messages, tools: specs, lang: opts.lang });
    messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });
    if (turn.text) emit({ type: 'assistant_text', text: turn.text });
    if (!turn.toolCalls.length) return { messages, stopped: 'done' };
    for (const c of turn.toolCalls) emit({ type: 'tool_call', id: c.id, name: c.name });
    const results = await Promise.all(turn.toolCalls.map((c) => runTool(byName, c)));
    results.forEach((r, i) => emit({ type: 'tool_result', id: r.toolCallId, name: turn.toolCalls[i]!.name, isError: !!r.isError }));
    messages.push({ role: 'tool', results });
  }
  return { messages, stopped: 'max_steps' };
}
