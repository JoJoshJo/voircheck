import type { AgentMessage } from '@voircheck/agent';

/** A conversation as Markdown: what the person said, what the agent said, every tool call and what it returned. */
export function renderTranscript(messages: readonly AgentMessage[], maxResultChars = 900): string {
  const out: string[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push(`**Person:** ${m.text}`);
    if (m.role === 'assistant') {
      if (m.text) out.push(`**Agent:** ${m.text}`);
      for (const c of m.toolCalls) out.push(`→ \`${c.name}(${JSON.stringify(c.input)})\``);
    }
    if (m.role === 'tool') for (const r of m.results) out.push(`← \`${r.content.length > maxResultChars ? `${r.content.slice(0, maxResultChars)}…` : r.content}\``);
  }
  return out.join('\n\n');
}
