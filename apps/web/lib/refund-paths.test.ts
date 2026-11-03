import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('refund paths in the web app', () => {
  const files = sources(ROOT).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }));

  it('only the person’s button route runs a refund (MoneyGate.userRefund)', () => {
    expect(files.filter((f) => /\.userRefund\(/.test(f.text)).map((f) => f.path)).toEqual(['app/api/pay/[action]/route.ts']);
  });

  it('the agent runtime can only propose one', () => {
    const runtime = files.find((f) => f.path === 'lib/agent-runtime.ts')!.text;
    expect(runtime).toMatch(/agentProposeRefund\(/);
    expect(runtime).not.toMatch(/userRefund|toolkitRefunder|create_refund|\/api\/pay\/refund/);
  });

  it('the public receipt page has no refund button', () => {
    const receipt = files.filter((f) => f.path.startsWith('app/r/') || f.path.includes('receipt'));
    expect(receipt.length).toBeGreaterThan(0);
    for (const f of receipt) expect(f.text).not.toMatch(/RefundButton|\/api\/pay\/refund/);
  });
});
