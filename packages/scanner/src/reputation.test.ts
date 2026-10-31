import { describe, expect, it } from 'vitest';
import { domainInfo } from './domain';
import { parseRanks, popularity, TRANCO, trancoLookup, trancoRanks } from './reputation';

describe('well-known-site reputation (pinned Tranco list)', () => {
  it('loads the pinned top-100k list from the repo, rank = line number', () => {
    const ranks = trancoRanks();
    expect(ranks).not.toBeNull();
    expect(ranks!.size).toBeGreaterThan(99_000);
    expect(ranks!.get('google.com')).toBe(1);
    expect(trancoLookup('argos.co.uk')).toBe(1302);
    expect(trancoLookup('MediaMarkt.de')).toBe(6072);
    expect(TRANCO.listId).toBe('746VX');
  });

  it('uses the registrable domain: www/subdomains share the rank, a lookalike does not', () => {
    expect(popularity(domainInfo('https://www.argos.co.uk/'), trancoLookup)).toMatchObject({ rank: 1302 });
    expect(popularity(domainInfo('https://www.argos.co.uk/'), trancoLookup).evidence).toContain('Well-known site: argos.co.uk is #1,302');
    expect(popularity(domainInfo('https://argos-outlet-store.de/'), trancoLookup)).toMatchObject({ rank: null });
    expect(popularity(domainInfo('https://heizungug.de/'), trancoLookup).evidence).toBe('heizungug.de is not in the Tranco top 100,000 sites (list 746VX).');
  });

  it('a shop on a shared host never inherits the host rank (onrender.com is in the list)', () => {
    expect(trancoLookup('onrender.com')).not.toBeNull();
    const p = popularity(domainInfo('https://voircheck-stores.onrender.com/s/velbrook-outlet-deals'), trancoLookup);
    expect(p.rank).toBeNull();
    expect(p.evidence).toContain('shared host');
  });

  it('skips placeholder entries and says so when the list is unavailable', () => {
    expect(parseRanks('google.com\n_wildcard_.ph\nexample.org\n')).toEqual(new Map([['google.com', 1], ['example.org', 3]]));
    expect(popularity(domainInfo('https://argos.co.uk/'), null)).toEqual({ rank: null, evidence: "Couldn't check the Tranco top-sites list (list 746VX not available)." });
  });
});
