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

export async function domainAgeSignal(domain: DomainInfo, now: Date, fetchImpl: Fetch = fetch): Promise<{ outcome: SignalOutcome; ageDays: number | null }> {
  if (!domain.registrable) return { outcome: unavailable('domain_age', `${domain.hostname} is not a registered domain name.`), ageDays: null };
  try {
    return evaluateDomainAge(domain, await lookupRdap(domain.registrable, fetchImpl), now);
  } catch (err) {
    return { outcome: unavailable('domain_age', `Couldn't look up the registration of ${domain.registrable} (${errorMessage(err)}).`), ageDays: null };
  }
}
