/**
 * Quick replies: the model may end a reply with one line `[[replies: Buy this one | Show me cheaper | Why?]]`. The
 * server strips that line from the text and shows the labels as tap-to-send buttons; a tap sends the label as the
 * person's own message, so a button can't do anything typing couldn't. Labels are short plain text: no links, no
 * brackets, at most 4 of them, each at most 40 characters. Anything else is dropped.
 */
export const MAX_QUICK_REPLIES = 4;
export const MAX_QUICK_REPLY_CHARS = 40;

const LINE = /(?:^|\n)[ \t]*\[\[[ \t]*replies[ \t]*:([^\]\n]*)\]\][ \t]*$/i;
const BAD = /https?:|www\.|[[\]<>{}\\]|[\u0000-\u001f]/i;

export function parseQuickReplies(raw: string): { text: string; replies: string[] } {
  const m = raw.match(LINE);
  if (!m) return { text: raw.trim(), replies: [] };
  const seen = new Set<string>();
  const replies: string[] = [];
  for (const part of m[1]!.split('|')) {
    const label = part.trim().replace(/\s+/g, ' ');
    const key = label.toLowerCase();
    if (!label || label.length > MAX_QUICK_REPLY_CHARS || BAD.test(label) || seen.has(key)) continue;
    seen.add(key);
    replies.push(label);
    if (replies.length === MAX_QUICK_REPLIES) break;
  }
  return { text: raw.slice(0, m.index).trim(), replies };
}
