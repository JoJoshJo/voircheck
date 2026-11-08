import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WebReputation } from '@voircheck/scanner';
import { DICTS } from '../lib/i18n';
import { toScanView } from '../lib/scan-view';
import { WebReputationRow } from './CollectedEvidence';

const web: WebReputation = {
  status: 'fail',
  findings: [
    { kind: 'scam_report', note: { en: 'Reviewers call it a <b>fake</b> shop.', fr: 'Des avis la décrivent comme une fausse boutique.' }, sourceUrl: 'https://reviews.example/review/hensaro.com', sourceTitle: '<script>alert(1)</script>' },
    { kind: 'complaint', note: { en: 'A buyer says the camera never arrived.', fr: 'Un acheteur dit que l’appareil n’est jamais arrivé.' }, sourceUrl: 'https://forum.example/t/1', sourceTitle: 'Never arrived' },
  ],
  summary: { en: 'Two other sites report problems with this shop.', fr: 'Deux autres sites signalent des problèmes avec cette boutique.' },
  evidence: ["From a web search about hensaro.com (3 searches; the shop's own site is never searched)."],
};

const html = (lang: 'en' | 'fr', w = web) => renderToStaticMarkup(createElement(WebReputationRow, { web: w, t: DICTS[lang], lang }));

describe('"What the web says" on the evidence page', () => {
  it('each point with its source as plain text: never a link, never HTML', () => {
    const h = html('en');
    expect(h).toContain('What the web says');
    expect(h).toContain('Red flag · 0 points');
    expect(h).toContain('Reported as a scam');
    expect(h).toContain('https://reviews.example/review/hensaro.com');
    expect(h).not.toMatch(/<a\b/);
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;script&gt;');
    expect(h).toContain('&lt;b&gt;fake&lt;/b&gt;');
  });
  it('in French: labels, evidence and the model’s French notes', () => {
    const h = html('fr');
    expect(h).toContain('Ce que dit le web');
    expect(h).toContain('Signalée comme arnaque');
    expect(h).toContain('D’après une recherche web sur hensaro.com (3 recherches');
    expect(h).toContain('Deux autres sites signalent');
  });
  it('not checked: says why, no findings block', () => {
    const h = html('en', { status: 'unavailable', findings: [], evidence: ["The web search took too long, so what the web says wasn't checked."] });
    expect(h).toContain('Not checked');
    expect(h).toContain('took too long');
    expect(h).not.toContain('Source');
  });
});

describe('stored scans', () => {
  const row = { id: 'x', url: 'https://hensaro.com/', storeDomain: 'hensaro.com', verdict: 'HOLD' as const, riskScore: 25, signals: [], hardRulesTriggered: [], scannedAt: new Date('2026-11-07T00:00:00Z') };
  it('what the web says comes back from the explanation column; older or malformed rows have none', () => {
    expect(toScanView({ ...row, explanation: { webReputation: web } }).webReputation).toEqual(web);
    expect(toScanView({ ...row, explanation: {} }).webReputation).toBeNull();
    expect(toScanView({ ...row, explanation: { webReputation: { status: 'nope' } } }).webReputation).toBeNull();
  });
});
