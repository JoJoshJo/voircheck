import { describe, expect, it, vi } from 'vitest';
import { PRICE_ANSWER, PRICE_RESULTS, REPUTATION_ANSWER, REPUTATION_RESULTS, searchBlock } from './fixtures/hensaro-2026-11-07';
import { anthropicResearcher, normalizeResultUrl, reputationStatus, searchResultUrls, type ResearchClient } from './research';

const usage = (searches: number) => ({ input_tokens: 9_000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_search_requests: searches } });

function fakeClient(turns: Array<{ stop_reason: string; content: unknown[]; parsed_output?: unknown; searches?: number }>) {
  const parse = vi.fn(async () => {
    const t = turns.shift()!;
    return { stop_reason: t.stop_reason, parsed_output: t.parsed_output, content: t.content, usage: usage(t.searches ?? 1) };
  });
  return { client: { messages: { parse } } as unknown as ResearchClient, parse };
}

const quiet = () => {};

describe('what the web says (research step)', () => {
  it('searches about the domain, never the shop itself, at most 3 searches, web search only', async () => {
    const { client, parse } = fakeClient([{ stop_reason: 'end_turn', content: [searchBlock(REPUTATION_RESULTS)], parsed_output: REPUTATION_ANSWER, searches: 3 }]);
    await anthropicResearcher({ client, log: quiet }).reputation('hensaro.com');
    const params = (parse.mock.calls[0] as unknown as [{ tools: unknown[]; messages: Array<{ content: string }>; system: Array<{ text: string }> }])[0];
    expect(params.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search', max_uses: 3, blocked_domains: ['hensaro.com'] }]);
    expect(params.messages[0]!.content).toBe('Shop domain: hensaro.com');
    expect(params.system[0]!.text).toMatch(/UNTRUSTED DATA/);
  });

  it('every finding needs a real source from the search: made-up links and the shop\'s own site are dropped', async () => {
    const { client } = fakeClient([{ stop_reason: 'end_turn', content: [searchBlock(REPUTATION_RESULTS)], parsed_output: REPUTATION_ANSWER, searches: 3 }]);
    const { reputation, usage: u } = await anthropicResearcher({ client, log: quiet }).reputation('hensaro.com');
    expect(reputation.findings.map((f) => f.sourceUrl)).toEqual(['https://reviews.example/review/hensaro.com', 'https://forum.example/t/hensaro-never-delivered']);
    // The title shown is the search result's own, never the model's.
    expect(reputation.findings[1]!.sourceTitle).toBe('Ordered a camera from hensaro.com, never arrived');
    expect(reputation.status).toBe('warn'); // one site says scam, one buyer complaint, no good word
    expect(reputation.evidence.join(' ')).toMatch(/2 findings without a real source link were left out/);
    expect(reputation.summary?.fr).toMatch(/boutique/);
    // Tokens plus $0.01 per search.
    expect(u!.searches).toBe(3);
    expect(u!.costUsd).toBeGreaterThan(0.03);
  });

  it('pass / warn / fail / not checked', () => {
    const f = (kind: 'scam_report' | 'complaint' | 'warning_list' | 'positive_review' | 'neutral', url: string) => ({ kind, note: { en: '', fr: '' }, sourceUrl: url, sourceTitle: '' });
    expect(reputationStatus([])).toBe('unavailable');
    // A passing mention (a list of new domains) says nothing either way: not "looks fine" (hensaro.com, Nov 7).
    expect(reputationStatus([f('neutral', 'https://lists.example/new-domains')])).toBe('unavailable');
    expect(reputationStatus([f('positive_review', 'https://a.example/x')])).toBe('pass');
    // Ordinary complaints: every big real shop has them (REI, Currys, Newegg… were "Red flag" before 2026-11-08).
    expect(reputationStatus([f('complaint', 'https://a.example/x'), f('complaint', 'https://b.example/x'), f('complaint', 'https://c.example/x'), f('positive_review', 'https://d.example/x')])).toBe('pass');
    expect(reputationStatus([f('complaint', 'https://a.example/x'), f('complaint', 'https://b.example/x')])).toBe('warn'); // no good word anywhere
    expect(reputationStatus([f('complaint', 'https://a.example/x'), f('scam_report', 'https://a.example/y'), f('positive_review', 'https://b.example/x')])).toBe('warn'); // one site says scam
    expect(reputationStatus([f('scam_report', 'https://a.example/x'), f('scam_report', 'https://b.example/y')])).toBe('fail');
    // Nov 8: one list entry that isn't a recognized authority is only worth a look (it scores 0 points).
    expect(reputationStatus([f('warning_list', 'https://watch.example/x'), f('positive_review', 'https://b.example/x')])).toBe('warn');
    expect(reputationStatus([f('warning_list', 'https://www.watchlist-internet.at/liste-betruegerischer-shops/shop/x'), f('positive_review', 'https://b.example/x')])).toBe('fail');
  });

  it('nothing written about the shop → not checked (no sourced findings), said plainly', async () => {
    const { client } = fakeClient([{ stop_reason: 'end_turn', content: [searchBlock([])], parsed_output: { findings: [], summary_en: 'Nothing found.', summary_fr: 'Rien.' }, searches: 3 }]);
    const { reputation } = await anthropicResearcher({ client, log: quiet }).reputation('new-shop.example');
    expect(reputation.status).toBe('unavailable');
    expect(reputation.evidence[0]).toBe('The web search (3 searches) found nothing written about new-shop.example by other sites.');
    expect(reputation.summary).toBeUndefined();
  });

  it('only passing mentions → not checked, the mention still shown with its source', async () => {
    const { client } = fakeClient([
      {
        stop_reason: 'end_turn',
        content: [searchBlock([{ url: 'https://lists.example/new/32', title: 'New domains' }])],
        parsed_output: { findings: [{ kind: 'neutral', source_url: 'https://lists.example/new/32', note_en: 'Only in a list of new domains.', note_fr: 'Seulement dans une liste de domaines récents.' }], summary_en: 'Little is known.', summary_fr: 'On sait peu de choses.' },
        searches: 3,
      },
    ]);
    const { reputation } = await anthropicResearcher({ client, log: quiet }).reputation('hensaro.com');
    expect(reputation.status).toBe('unavailable');
    expect(reputation.findings).toHaveLength(1);
    expect(reputation.evidence[0]).toBe('The web search (3 searches) found only passing mentions of hensaro.com, no reviews or warnings.');
  });

  it('a failed call, a refusal or a wrong-format answer → not checked, never a guess', async () => {
    const failing = { messages: { parse: vi.fn(async () => Promise.reject(new Error('400 web search is not enabled'))) } } as unknown as ResearchClient;
    expect((await anthropicResearcher({ client: failing, log: quiet }).reputation('a.example')).reputation).toEqual({ status: 'unavailable', findings: [], evidence: ["The web search didn't complete, so what the web says wasn't checked."] });
    const { client } = fakeClient([{ stop_reason: 'refusal', content: [] }]);
    expect((await anthropicResearcher({ client, log: quiet }).reputation('a.example')).reputation.status).toBe('unavailable');
    const { client: c2 } = fakeClient([{ stop_reason: 'end_turn', content: [], parsed_output: { nope: 1 } }]);
    expect((await anthropicResearcher({ client: c2, log: quiet }).reputation('a.example')).reputation.evidence[0]).toMatch(/didn't give a usable answer/);
  });

  it('a paused turn is resumed with its own content, and both turns count', async () => {
    const { client, parse } = fakeClient([
      { stop_reason: 'pause_turn', content: [searchBlock(REPUTATION_RESULTS.slice(0, 1))], searches: 2 },
      { stop_reason: 'end_turn', content: [searchBlock(REPUTATION_RESULTS.slice(1, 2))], parsed_output: REPUTATION_ANSWER, searches: 1 },
    ]);
    const { reputation, usage: u } = await anthropicResearcher({ client, log: quiet }).reputation('hensaro.com');
    expect(parse).toHaveBeenCalledTimes(2);
    expect((parse.mock.calls[1] as unknown as [{ messages: Array<{ role: string }> }])[0].messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(reputation.findings).toHaveLength(2); // sources from either turn count
    expect(u!.searches).toBe(3);
  });

  it('cached per domain for 24h: the second scan costs nothing', async () => {
    const { client, parse } = fakeClient([{ stop_reason: 'end_turn', content: [searchBlock(REPUTATION_RESULTS)], parsed_output: REPUTATION_ANSWER, searches: 3 }]);
    const r = anthropicResearcher({ client, log: quiet });
    await r.reputation('hensaro.com');
    const again = await r.reputation('HENSARO.com');
    expect(parse).toHaveBeenCalledTimes(1);
    expect(again.usage).toMatchObject({ cached: true, costUsd: 0 });
    expect(again.reputation.findings).toHaveLength(2);
  });

  it('search errors inside the result are not sources', () => {
    expect(searchResultUrls([{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } } as never]).size).toBe(0);
    expect(normalizeResultUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeResultUrl('https://A.example/x/#top')).toBe('https://a.example/x');
  });
});

describe('price fallback from web search', () => {
  it('at most 2 searches; only offers whose page came back from the search, never the shop itself', async () => {
    const { client, parse } = fakeClient([{ stop_reason: 'end_turn', content: [searchBlock(PRICE_RESULTS)], parsed_output: PRICE_ANSWER, searches: 2 }]);
    const { offers } = await anthropicResearcher({ client, log: quiet }).prices({ name: 'Canon PowerShot SX740 HS Digital Camera (Black)', currency: 'USD', domain: 'hensaro.com' });
    expect((parse.mock.calls[0] as unknown as [{ tools: Array<{ max_uses: number; blocked_domains: string[] }> }])[0].tools[0]).toMatchObject({ max_uses: 2, blocked_domains: ['hensaro.com'] });
    expect(offers!.map((o) => o.price)).toEqual([649, 679, 659]); // the made-up $9 store is dropped
  });
});
