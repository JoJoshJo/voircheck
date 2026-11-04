import { describe, expect, it } from 'vitest';
import { DICTS } from './i18n';

describe('gentle errors', () => {
  it.each(['en', 'fr'] as const)('say what happened and what to do, in plain words, with no technical terms (%s)', (lang) => {
    const t = DICTS[lang];
    const messages = [t.workspace.errorGeneric, t.workspace.errorRate, t.workspace.errorCap, t.workspace.errorUrl, t.agent.scanFailed, t.agent.scanRate, t.agent.errorGeneric, t.agent.errorRate, t.agent.errorCap, t.agent.errorBusy, t.agent.errorModel];
    for (const m of messages) {
      expect(m).not.toMatch(/\b(scan\w*|analyse\w*|agent|error|erreur|http or https|limit reached|limite atteinte|failed|échou\w*)\b/i);
      expect(m.split(/(?<=[.?])\s+/).length).toBeLessThanOrEqual(3);
    }
  });
});
