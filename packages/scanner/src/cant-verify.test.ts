import { describe, expect, it } from 'vitest';
import { cantVerifyOnly } from './cant-verify';
import type { SignalResult } from './schema';

const ssl = (line?: string): SignalResult => ({ id: 'ssl_redirects', status: 'pass', points: 0, evidence: ['Valid HTTPS certificate.', ...(line ? [line] : [])] });
const scan = (line: string | undefined, over: Partial<{ verdict: 'SAFE' | 'HOLD' | 'BLOCK'; score: number; hardRules: string[] }> = {}) => ({
  verdict: 'HOLD' as const,
  score: 0,
  hardRules: ['cant_verify'],
  signals: [ssl(line)],
  ...over,
});

describe('cantVerifyOnly', () => {
  it('reads the reason the scan wrote, with the HTTP status when there is one', () => {
    expect(cantVerifyOnly(scan("Couldn't verify this store: blocked by a bot check (HTTP 403), so the cloud browser never saw the shop itself."))).toEqual({ reason: 'bot_check', httpStatus: 403 });
    expect(cantVerifyOnly(scan("Couldn't verify this store: blocked by a bot check, so the cloud browser never saw the shop itself."))).toEqual({ reason: 'bot_check' });
    expect(cantVerifyOnly(scan("Couldn't verify this store: the store returned an error page (HTTP 503), so the cloud browser never saw the shop itself."))).toEqual({ reason: 'error_page', httpStatus: 503 });
    expect(cantVerifyOnly(scan("Couldn't verify this store: the page showed no content (empty shell), so the cloud browser never saw the shop itself."))).toEqual({ reason: 'empty_page' });
    expect(cantVerifyOnly(scan("Couldn't verify this store: the cloud browser visit failed (net::ERR_NAME_NOT_RESOLVED (HTTP 999))."))).toEqual({ reason: 'visit_failed' });
    expect(cantVerifyOnly(scan(undefined))).toEqual({ reason: 'visit_failed' });
  });
  it('is null when something else also put the store on HOLD', () => {
    const line = "Couldn't verify this store: blocked by a bot check, so the cloud browser never saw the shop itself.";
    expect(cantVerifyOnly(scan(line, { score: 30 }))).toBeNull();
    expect(cantVerifyOnly(scan(line, { hardRules: ['cant_verify', 'no_valid_https'] }))).toBeNull();
    expect(cantVerifyOnly(scan(line, { hardRules: [] }))).toBeNull();
    expect(cantVerifyOnly(scan(line, { verdict: 'BLOCK', score: 100 }))).toBeNull();
  });
});

describe('cantVerifyOnly: sent away', () => {
  it('a store that sent our check elsewhere has its own reason', () => {
    expect(cantVerifyOnly(scan("Couldn't verify this store: it sent our check to google.com instead of showing its product page, so the cloud browser never saw the shop itself."))).toEqual({ reason: 'sent_away' });
  });
});
