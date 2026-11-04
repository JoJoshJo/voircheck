import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '@voircheck/db/schema';

vi.mock('server-only', () => ({}));

const spend = vi.hoisted(() => ({ kernelOk: true, aiOk: true, recorded: [] as Array<{ anthropicUsd: number; kernelScans: number }> }));
const scanner = vi.hoisted(() => ({ visit: true, aiCost: 0.031, throwBefore: null as Error | null, analyzerUsed: null as unknown, scanCalls: 0 }));
const placeholder = vi.hoisted(() => ({ analyze: async () => ({}) }));

vi.mock('./db', () => ({ getDb: () => ({}) }));
vi.mock('./spend', async (orig) => {
  const real = await orig<typeof import('./spend')>();
  return {
    ...real,
    reserveKernelScan: vi.fn(async () => spend.kernelOk),
    reserveAiScan: vi.fn(async () => spend.aiOk),
    recordSpendQuietly: vi.fn(async (a: { anthropicUsd: number; kernelScans: number }) => void spend.recorded.push(a)),
  };
});
vi.mock('./scans', () => ({ saveScan: async (r: unknown) => r, latestVerdictForStore: async () => null }));
vi.mock('@voircheck/agent/search', () => ({ demoPeersForUrl: () => null }));
vi.mock('@voircheck/scanner', () => ({
  placeholderAnalyzer: placeholder,
  anthropicAnalyzer: () => ({ analyze: async () => ({}) }),
  kernelVisitor: () => ({ visit: async () => ({ pages: [] }) }),
  scanStore: async (_input: unknown, deps: { visitor: { visit: (u: string[]) => Promise<unknown> } | null; analyzer: { analyze: (p: null) => Promise<unknown> } }) => {
    scanner.scanCalls++;
    scanner.analyzerUsed = deps.analyzer;
    if (scanner.throwBefore) throw scanner.throwBefore; // e.g. the SSRF check, before KERNEL
    if (scanner.visit) await deps.visitor?.visit(['https://shop.example/']);
    await deps.analyzer.analyze(null);
    return { result: { url: 'https://shop.example/' }, meta: { ai: deps.analyzer === placeholder ? undefined : { costUsd: scanner.aiCost } } };
  },
}));

const { runStoreScan, settlement } = await import('./scan-runner');
const { AI_RESERVE_PER_SCAN_USD, DailyCapError, DAILY_CAPS, reserveAiQuery, reserveKernelQuery } = await import('./spend');

beforeEach(() => {
  Object.assign(spend, { kernelOk: true, aiOk: true, recorded: [] });
  Object.assign(scanner, { visit: true, aiCost: 0.031, throwBefore: null, analyzerUsed: null, scanCalls: 0 });
  process.env.KERNEL_API_KEY = 'test-kernel-key';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
});

describe('budget reservations are one conditional statement each', () => {
  const db = drizzle.mock({ schema }) as never;
  it('KERNEL: +1 only while below the cap, and a row back means reserved', () => {
    const q = reserveKernelQuery(db, '2026-11-04').toSQL();
    expect(q.sql).toMatch(/on conflict \("day"\) do update set "kernel_scans" = "daily_spend"\."kernel_scans" \+ 1 where "daily_spend"\."kernel_scans" < \$\d+ returning "day"/);
    expect(q.params).toContain(DAILY_CAPS.kernelScans);
  });
  it('Anthropic: + the per-scan reservation only while below the cap', () => {
    const q = reserveAiQuery(db, '2026-11-04', AI_RESERVE_PER_SCAN_USD).toSQL();
    expect(q.sql).toMatch(/do update set "anthropic_usd" = "daily_spend"\."anthropic_usd" \+ \$\d+ where "daily_spend"\."anthropic_usd" < \$\d+ returning "day"/);
    expect(q.params).toEqual(expect.arrayContaining(['0.050000', DAILY_CAPS.anthropicUsd.toFixed(6)]));
  });
});

describe('runStoreScan reserves before it runs', () => {
  it('no KERNEL reservation → DailyCapError, and nothing runs', async () => {
    spend.kernelOk = false;
    await expect(runStoreScan({ url: 'https://shop.example/', demoMode: false, liveView: false })).rejects.toBeInstanceOf(DailyCapError);
    expect(scanner.scanCalls).toBe(0);
    expect(spend.recorded).toEqual([]);
  });
  it('a finished scan settles the AI reservation to the real cost and keeps the KERNEL session', async () => {
    await runStoreScan({ url: 'https://shop.example/', demoMode: false, liveView: false });
    expect(spend.recorded).toHaveLength(1);
    expect(spend.recorded[0]!.kernelScans).toBe(0);
    expect(spend.recorded[0]!.anthropicUsd).toBeCloseTo(0.031 - AI_RESERVE_PER_SCAN_USD, 6);
  });
  it('a scan that fails before KERNEL (e.g. SSRF refusal) hands both reservations back', async () => {
    scanner.throwBefore = new Error('ssrf');
    await expect(runStoreScan({ url: 'https://shop.example/', demoMode: false, liveView: false })).rejects.toThrow('ssrf');
    expect(spend.recorded).toEqual([{ anthropicUsd: -AI_RESERVE_PER_SCAN_USD, kernelScans: -1 }]);
  });
  it('no AI reservation → the scan still runs, without page analysis, and nothing AI is settled', async () => {
    spend.aiOk = false;
    await runStoreScan({ url: 'https://shop.example/', demoMode: false, liveView: false });
    expect(scanner.analyzerUsed).toBe(placeholder);
    expect(spend.recorded).toEqual([{ anthropicUsd: 0, kernelScans: 0 }]); // a zero settlement writes nothing
  });
  it('without a KERNEL key nothing is reserved for KERNEL', async () => {
    delete process.env.KERNEL_API_KEY;
    spend.kernelOk = false; // would refuse if asked
    await runStoreScan({ url: 'https://shop.example/', demoMode: false, liveView: false });
    expect(scanner.scanCalls).toBe(1);
  });
});

describe('settlement', () => {
  it('an analysis that ran but never reported its cost keeps the whole reservation', () => {
    expect(settlement({ aiReserved: 0.05, aiUsd: 0, aiRan: true, kernelReserved: true, kernelUsed: true })).toEqual({ anthropicUsd: 0, kernelScans: 0 });
  });
  it('KERNEL reserved but never used is released', () => {
    expect(settlement({ aiReserved: 0, aiUsd: 0, aiRan: false, kernelReserved: true, kernelUsed: false })).toEqual({ anthropicUsd: 0, kernelScans: -1 });
  });
});
