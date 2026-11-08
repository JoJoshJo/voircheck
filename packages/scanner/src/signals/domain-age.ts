import { DAY_MS, type DomainInfo } from '../domain';
import { errorMessage, unavailable, type Fetch, type SignalOutcome } from './types';

/** Signal 1: domain age & registration via RDAP. Server-side, hostname only; RDAP servers come from the IANA bootstrap, never from user input. */

export const DOMAIN_AGE = { failBelowDays: 30, warnBelowDays: 180 } as const;

const IANA_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
let bootstrapCache: Promise<Array<[string[], string[]]>> | null = null;

async function rdapBaseFor(tld: string, fetchImpl: Fetch): Promise<string | null> {
  bootstrapCache ??= fetchImpl(IANA_BOOTSTRAP, { signal: AbortSignal.timeout(8000) })
    .then((r) => {
      if (!r.ok) throw new Error(`IANA bootstrap HTTP ${r.status}`);
      return r.json() as Promise<{ services: Array<[string[], string[]]> }>;
    })
    .then((j) => j.services)
    .catch((err) => {
      bootstrapCache = null;
      throw err;
    });
  const services = await bootstrapCache;
  const service = services.find(([tlds]) => tlds.includes(tld));
  const base = service?.[1].find((u) => u.startsWith('https://')) ?? null;
  return base && (base.endsWith('/') ? base : `${base}/`);
}

export interface RdapFacts {
  registeredAt: Date | null;
  registrar: string | null;
}

interface RdapEntity {
  roles?: string[];
  vcardArray?: [string, Array<[string, unknown, string, unknown]>];
}

export function parseRdap(json: unknown): RdapFacts {
  const j = json as { events?: Array<{ eventAction?: string; eventDate?: string }>; entities?: RdapEntity[] };
  const reg = j.events?.find((e) => e.eventAction === 'registration')?.eventDate;
  const registeredAt = reg && !Number.isNaN(Date.parse(reg)) ? new Date(reg) : null;
  const registrarEntity = j.entities?.find((e) => e.roles?.includes('registrar'));
  const fn = registrarEntity?.vcardArray?.[1]?.find((f) => f[0] === 'fn')?.[3];
  return { registeredAt, registrar: typeof fn === 'string' ? fn : null };
}

export async function lookupRdap(registrable: string, fetchImpl: Fetch = fetch): Promise<RdapFacts> {
  const tld = registrable.split('.').pop()!;
  const base = await rdapBaseFor(tld, fetchImpl);
  if (!base) throw new Error(`no RDAP server listed for .${tld}`);
  const res = await fetchImpl(`${base}domain/${encodeURIComponent(registrable)}`, {
    headers: { accept: 'application/rdap+json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`RDAP HTTP ${res.status}`);
  return parseRdap(await res.json());
}

function formatAge(days: number): string {
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 730) return `about ${Math.round(days / 30)} months`;
  return `about ${Math.floor(days / 365)} years`;
}

/** Pure: turn RDAP facts into a signal. */
export function evaluateDomainAge(domain: DomainInfo, facts: RdapFacts, now: Date): { outcome: SignalOutcome; ageDays: number | null } {
  const id = 'domain_age' as const;
  if (!facts.registeredAt) return { outcome: unavailable(id, `The registry record for ${domain.registrable} has no registration date.`), ageDays: null };
  const ageDays = Math.floor((now.getTime() - facts.registeredAt.getTime()) / DAY_MS);
  const evidence = [`${domain.registrable} was registered on ${facts.registeredAt.toISOString().slice(0, 10)} (${formatAge(ageDays)} ago).`];
  if (facts.registrar) evidence.push(`Registrar: ${facts.registrar.replace(/\.$/, '')}.`);
  if (domain.sharedHosting) {
    evidence.push(
      `This store is a subdomain (${domain.site}) of the hosting provider ${domain.registrable}, so the age shown is the provider's domain, not this store's. The store itself could be brand new.`,
    );
  }
  const status = ageDays < DOMAIN_AGE.failBelowDays ? 'fail' : ageDays < DOMAIN_AGE.warnBelowDays ? 'warn' : 'pass';
  return { outcome: { id, status, evidence }, ageDays };
}

// ---------- first seen (certificate), spec 5.5 Nov 8 ----------

/**
 * crt.sh: the public certificate-transparency logs. It has no published API, rate limit or terms; throttling shows up
 * as 502s, empty answers or hangs (community reports, Nov 8). So: one request per domain, 15 s at most, cached 7 days
 * per domain (failures 1 hour), and anything doubtful (no certificates, a result at its ~1,000-row cap) is "not
 * checked". In a Nov 8 test the earliest certificate matched the RDAP registration date exactly (3 of 3).
 */
export const CRT_SH = { url: 'https://crt.sh/', timeoutMs: 15_000, rowCap: 999, cacheMs: 7 * DAY_MS, failCacheMs: 3_600_000 } as const;
const firstSeenCache = new Map<string, { at: number; ttl: number; value: FirstSeen }>();

export type FirstSeen = { first: Date } | { first: null; why: string };

/** Pure: crt.sh's JSON → the earliest certificate's start date, or why there is none. */
export function parseCrtSh(json: unknown): FirstSeen {
  if (!Array.isArray(json)) return { first: null, why: 'unexpected answer' };
  if (!json.length) return { first: null, why: 'no certificates found' };
  if (json.length >= CRT_SH.rowCap) return { first: null, why: 'too many certificates to tell' };
  let min = Infinity;
  for (const c of json as Array<{ not_before?: unknown }>) {
    const t = typeof c?.not_before === 'string' ? Date.parse(`${c.not_before.replace(/Z?$/, '')}Z`) : NaN;
    if (Number.isFinite(t) && t < min) min = t;
  }
  return Number.isFinite(min) ? { first: new Date(min) } : { first: null, why: 'no certificate dates' };
}

export async function lookupFirstCertificate(registrable: string, fetchImpl: Fetch = fetch, now = Date.now()): Promise<FirstSeen> {
  const hit = firstSeenCache.get(registrable);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  let value: FirstSeen;
  try {
    const res = await fetchImpl(`${CRT_SH.url}?q=${encodeURIComponent(registrable)}&output=json`, {
      headers: { accept: 'application/json', 'user-agent': 'VoirCheck/1.0 (store check: domain age)' },
      signal: AbortSignal.timeout(CRT_SH.timeoutMs),
    });
    value = res.ok ? parseCrtSh(await res.json()) : { first: null, why: `crt.sh HTTP ${res.status}` };
  } catch (err) {
    value = { first: null, why: /abort|timeout/i.test(errorMessage(err)) ? 'crt.sh took too long' : 'crt.sh failed' };
  }
  firstSeenCache.set(registrable, { at: now, ttl: value.first ? CRT_SH.cacheMs : CRT_SH.failCacheMs, value });
  return value;
}

/** Pure: a first-certificate date as the age, labelled as "first seen", never as the registration date. */
export function evaluateFirstSeen(domain: DomainInfo, first: Date, now: Date, rdapWhy: string): { outcome: SignalOutcome; ageDays: number } {
  const ageDays = Math.max(0, Math.floor((now.getTime() - first.getTime()) / DAY_MS));
  const evidence = [
    `Couldn't look up the registration of ${domain.registrable} (${rdapWhy}).`,
    `${domain.registrable} was first seen on ${first.toISOString().slice(0, 10)} (${formatAge(ageDays)} ago): its first certificate in the public certificate logs (crt.sh). This is not the registration date; the domain may be older.`,
  ];
  const status = ageDays < DOMAIN_AGE.failBelowDays ? 'fail' : ageDays < DOMAIN_AGE.warnBelowDays ? 'warn' : 'pass';
  return { outcome: { id: 'domain_age', status, evidence }, ageDays };
}

/**
 * Domain age: RDAP first; when it has no registration date (no RDAP server for the TLD, e.g. .de/.at, or a failed
 * lookup), the first certificate (crt.sh) as "first seen". Well-known sites (Tranco top 100k) skip the fallback: they
 * aren't new, and their certificate lists can be too long to read.
 */
export async function domainAgeSignal(domain: DomainInfo, now: Date, fetchImpl: Fetch = fetch, opts: { wellKnown?: boolean; firstSeen?: boolean } = {}): Promise<{ outcome: SignalOutcome; ageDays: number | null }> {
  if (!domain.registrable) return { outcome: unavailable('domain_age', `${domain.hostname} is not a registered domain name.`), ageDays: null };
  let rdapWhy: string;
  try {
    const r = evaluateDomainAge(domain, await lookupRdap(domain.registrable, fetchImpl), now);
    if (r.ageDays !== null) return r;
    rdapWhy = 'its record has no registration date';
  } catch (err) {
    rdapWhy = errorMessage(err);
  }
  const notChecked = unavailable('domain_age', `Couldn't look up the registration of ${domain.registrable} (${rdapWhy}).`);
  // Shared hosting (*.onrender.com…): the provider's certificates say nothing about this store.
  if (opts.firstSeen === false || opts.wellKnown || domain.sharedHosting) return { outcome: notChecked, ageDays: null };
  const seen = await lookupFirstCertificate(domain.registrable, fetchImpl, now.getTime());
  if (!seen.first) return { outcome: { ...notChecked, evidence: [...notChecked.evidence, `No first certificate date either (${seen.why}).`] }, ageDays: null };
  return evaluateFirstSeen(domain, seen.first, now, rdapWhy);
}
