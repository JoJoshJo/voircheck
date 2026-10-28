import { errorMessage, unavailable, type Fetch, type SignalOutcome } from './types';

/**
 * Signal 5: Google Safe Browsing v4 Lookup API (threatMatches:find).
 * Licence: free but non-commercial only; a paid VoirCheck must move this to Google Web Risk (spec 5.5).
 */

const ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'];

const READABLE: Record<string, string> = {
  MALWARE: 'malware',
  SOCIAL_ENGINEERING: 'phishing / deceptive site',
  UNWANTED_SOFTWARE: 'unwanted software',
  POTENTIALLY_HARMFUL_APPLICATION: 'harmful app',
};

export function evaluateThreatMatches(urls: string[], matches: Array<{ threatType?: string; threat?: { url?: string } }>): { outcome: SignalOutcome; hit: boolean } {
  const id = 'threat_list' as const;
  if (matches.length === 0) {
    return { outcome: { id, status: 'pass', evidence: [`Not on Google Safe Browsing threat lists (${urls.length} address${urls.length > 1 ? 'es' : ''} checked).`] }, hit: false };
  }
  const evidence = matches.map((m) => `Google Safe Browsing lists ${m.threat?.url ?? 'this address'} as ${READABLE[m.threatType ?? ''] ?? m.threatType ?? 'a threat'}.`);
  return { outcome: { id, status: 'fail', evidence: [...new Set(evidence)] }, hit: true };
}

export async function threatListSignal(urls: string[], apiKey: string | undefined, fetchImpl: Fetch = fetch): Promise<{ outcome: SignalOutcome; hit: boolean }> {
  if (!apiKey) return { outcome: unavailable('threat_list', 'Threat-list check is not configured.'), hit: false };
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      // Key in a header, not the query string, so it never lands in URL logs.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        client: { clientId: 'voircheck', clientVersion: '0.1.0' },
        threatInfo: {
          threatTypes: THREAT_TYPES,
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: urls.map((url) => ({ url })),
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Safe Browsing HTTP ${res.status}`);
    const body = (await res.json()) as { matches?: Array<{ threatType?: string; threat?: { url?: string } }> };
    return evaluateThreatMatches(urls, body.matches ?? []);
  } catch (err) {
    return { outcome: unavailable('threat_list', `Couldn't reach Google Safe Browsing (${errorMessage(err)}).`), hit: false };
  }
}
