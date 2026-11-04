import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { builtStrokes } from '../lib/ghost';
import { FACES, Mascot, strokeScale } from './Mascot';

const html = (props: Parameters<typeof Mascot>[0]) => renderToStaticMarkup(createElement(Mascot, props));
const offCount = (s: string) => (s.match(/vc-off/g) ?? []).length;

describe('ghost mascot', () => {
  it('builds one stroke per finished check, with a dotted outline for the rest', () => {
    const two = html({ mood: 'scanning', built: 2, title: '' });
    expect(two).toContain('data-built="2"');
    expect(two).toContain('vc-track');
    // 4 strokes still to come + the two fills (body, lens) stay hidden until the ghost is complete.
    expect(offCount(two)).toBe(4 + 2);
    expect(two).not.toContain('data-face');
  });

  it('shows no face until all six checks are in and a verdict is known', () => {
    expect(html({ mood: 'scanning', built: 6 })).not.toContain('data-face');
    const done = html({ mood: 'BLOCK', built: 6 });
    expect(offCount(done)).toBe(0);
    expect(done).not.toContain('vc-track');
    expect(done).toContain('data-face="BLOCK"');
  });

  it('has a different face for each verdict: smile, raised brow, frown', () => {
    expect(new Set([FACES.SAFE.join(), FACES.HOLD.join(), FACES.BLOCK.join()]).size).toBe(3);
    for (const mood of ['SAFE', 'HOLD', 'BLOCK'] as const) {
      const s = html({ mood });
      for (const d of FACES[mood]) expect(s).toContain(d);
    }
  });

  it('assembles once on load and draws the face in after a check, via CSS classes only', () => {
    expect(html({ mood: 'SAFE', assemble: true })).toContain('class="vc-asm"');
    expect(html({ mood: 'HOLD', faceIn: true })).toContain('vc-face-in');
    // A plain ghost floats only while scanning, never while it is being built step by step.
    expect(html({ mood: 'scanning' })).toContain('vc-float');
    expect(html({ mood: 'scanning', built: 3 })).not.toContain('vc-float');
  });

  it('decorative when title is empty; named otherwise', () => {
    expect(html({ title: '' })).toContain('aria-hidden="true"');
    expect(html({ title: 'Looks safe' })).toContain('aria-label="Looks safe"');
  });

  it('keeps the line thin at large sizes', () => {
    expect(strokeScale(64)).toBe(1);
    expect(strokeScale(32)).toBe(1);
    expect(strokeScale(340)).toBeLessThan(0.5);
  });

  it('counts finished checks of any result', () => {
    expect(builtStrokes({})).toBe(0);
    expect(builtStrokes({ domain_age: 'pass', price: 'fail', clone: 'pending', ai_page: 'unavailable' })).toBe(3);
    expect(builtStrokes({ domain_age: 'pass', ssl_redirects: 'warn', price: 'pass', ai_page: 'fail', threat_list: 'pass', clone: 'unavailable', extra: 'pass' })).toBe(6);
  });
});
