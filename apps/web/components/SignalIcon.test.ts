import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MARKS, SIGNAL_ORDER, SignalIcon, type SignalState } from './SignalIcon';

const html = (state: SignalState, id?: string) => renderToStaticMarkup(createElement(SignalIcon, { state, id }));

describe('check icons', () => {
  it('each of the six checks has its own moving outline icon while it runs', () => {
    const shapes = new Set<string>();
    for (const id of SIGNAL_ORDER) {
      const s = html('pending', id);
      expect(s).toContain(`vc-run-${id}`);
      expect(s).toContain('class="vc-m"');
      expect(s).toContain('text-faint'); // grey while running
      expect(s).toContain('aria-hidden="true"');
      shapes.add(s.replace(/vc-run-\w+/, ''));
    }
    expect(shapes.size).toBe(6);
  });

  it('a running check without a known id falls back to the plain grey dot', () => {
    expect(html('pending')).toContain('animate-pulse');
    expect(html('pending', 'something_else')).toContain('animate-pulse');
  });

  it('results: ✓ green, amber – for a bit off, ✕ red, grey – for not checked', () => {
    expect(html('pass', 'price')).toContain('fill-safe-bg');
    expect(html('pass', 'price')).toContain(MARKS.pass.d);
    const warn = html('warn', 'price');
    expect(warn).toContain('fill-hold-bg');
    expect(warn).toContain('stroke-hold');
    expect(warn).toContain('d="M8.5 12h7"');
    expect(html('fail')).toContain('stroke-block');
    expect(html('fail')).toContain(MARKS.fail.d);
    const na = html('unavailable');
    expect(na).toContain('fill-surface');
    expect(na).toContain('stroke-faint');
    expect(MARKS.warn.d).toBe(MARKS.unavailable.d); // same dash, only the colour differs
    for (const st of ['pass', 'warn', 'fail', 'unavailable'] as const) expect(html(st)).toContain(`data-state="${st}"`);
  });
});
