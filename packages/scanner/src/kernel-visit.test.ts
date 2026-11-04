import { describe, expect, it, vi } from 'vitest';

// A fake KERNEL SDK: no real browser is ever opened here.
const k = vi.hoisted(() => ({
  log: [] as string[],
  replayGate: null as null | (() => void),
  stopGate: null as null | (() => void),
  deleteGate: null as null | (() => void),
  stopFails: false,
}));
vi.mock('@onkernel/sdk', () => ({
  default: class {
    browsers = {
      create: async () => (k.log.push('create'), { session_id: 'sess-1', browser_live_view_url: 'https://live.example/' }),
      deleteByID: () => (k.log.push('delete'), new Promise<void>((ok) => (k.deleteGate = ok))),
      replays: {
        start: () => (k.log.push('replay_start'), new Promise((ok) => (k.replayGate = () => ok({ replay_id: 'rep-1', replay_view_url: 'https://replay.example/' })))),
        stop: () => (k.log.push('replay_stop'), new Promise<void>((ok, no) => (k.stopGate = () => (k.stopFails ? no(new Error('x')) : ok())))),
      },
      playwright: {
        execute: async () => (k.log.push('execute'), { success: true, result: [{ ok: false, error: 'not found' }] }),
      },
    };
  },
}));

const { kernelVisitor } = await import('./kernel');
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('KERNEL visit: cleanup off the critical path', () => {
  it('starts the replay alongside the first page read, returns without waiting for replay stop or delete, then cleans up in order', async () => {
    Object.assign(k, { log: [], stopFails: false });
    let cleanup: Promise<void> | undefined;
    const visit = kernelVisitor({ apiKey: 'k', onCleanup: (p) => (cleanup = p) }).visit(['https://shop.example/']);
    await tick();
    expect(k.log).toEqual(['create', 'replay_start', 'execute']); // the page read didn't wait for the replay
    k.replayGate!();
    const v = await visit; // stop and delete are still pending
    expect(v.replayUrl).toBe('https://replay.example/');
    expect(k.log).toEqual(['create', 'replay_start', 'execute', 'replay_stop']);
    let cleaned = false;
    void cleanup!.then(() => (cleaned = true));
    k.stopGate!();
    await tick();
    expect(k.log.at(-1)).toBe('delete');
    expect(cleaned).toBe(false);
    k.deleteGate!();
    await tick();
    expect(cleaned).toBe(true);
  });

  it('the browser is deleted even when the replay stop fails', async () => {
    Object.assign(k, { log: [], stopFails: true });
    let cleanup: Promise<void> | undefined;
    const visit = kernelVisitor({ apiKey: 'k', onCleanup: (p) => (cleanup = p) }).visit(['https://shop.example/']);
    await tick();
    k.replayGate!();
    await visit;
    k.stopGate!();
    await tick();
    expect(k.log.at(-1)).toBe('delete');
    k.deleteGate!();
    await expect(cleanup).resolves.toBeUndefined();
  });

  it('no replay wanted: nothing to stop, the browser is still deleted', async () => {
    Object.assign(k, { log: [], stopFails: false });
    let cleanup: Promise<void> | undefined;
    await kernelVisitor({ apiKey: 'k', replay: false, onCleanup: (p) => (cleanup = p) }).visit(['https://shop.example/']);
    await tick();
    expect(k.log).toEqual(['create', 'execute', 'delete']);
    k.deleteGate!();
    await expect(cleanup).resolves.toBeUndefined();
  });
});
