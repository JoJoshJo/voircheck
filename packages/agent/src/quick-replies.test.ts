import { describe, expect, it } from 'vitest';
import { AGENT_SYSTEM_PROMPT } from './prompt';
import { parseQuickReplies } from './quick-replies';

describe('quick replies', () => {
  it('takes the last [[replies: …]] line off the text and returns its labels', () => {
    expect(parseQuickReplies('Velbrook Supply looks safe to buy. Want it?\n[[replies: Buy at Velbrook Supply | Why? | Show me cheaper]]')).toEqual({
      text: 'Velbrook Supply looks safe to buy. Want it?',
      replies: ['Buy at Velbrook Supply', 'Why?', 'Show me cheaper'],
    });
  });

  it('keeps at most 4 short plain labels: no links, no brackets, no duplicates, nothing over 40 characters', () => {
    const r = parseQuickReplies(`Hi.\n[[replies: Buy it | buy it | https://evil.test | www.x.test | <b>x</b> | ${'x'.repeat(41)} | One | Two | Three | Four]]`);
    expect(r.replies).toEqual(['Buy it', 'One', 'Two', 'Three']);
  });

  it('leaves text without a final replies line alone (a line in the middle is not one)', () => {
    expect(parseQuickReplies('Plain answer.')).toEqual({ text: 'Plain answer.', replies: [] });
    const mid = 'A\n[[replies: x | y]]\nB';
    expect(parseQuickReplies(mid)).toEqual({ text: mid, replies: [] });
  });

  it('the prompt asks for them, in the person’s words, buttons only for what the agent can do', () => {
    expect(AGENT_SYSTEM_PROMPT).toContain('[[replies: ');
    expect(AGENT_SYSTEM_PROMPT).toMatch(/Offer only what you can actually do next/);
  });
});
