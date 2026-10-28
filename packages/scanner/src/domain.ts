import { getDomain, getDomainWithoutSuffix } from 'tldts';

export interface DomainInfo {
  hostname: string;
  /** Registered domain (ICANN rules), the thing RDAP knows about, e.g. "onrender.com". */
  registrable: string | null;
  /** The site's own domain, counting hosting providers as suffixes (Public Suffix List private section), e.g. "voircheck-stores.onrender.com". */
  site: string | null;
  /** `site` without its suffix, e.g. "voircheck-stores" or "velbrook-outlet"; used for lookalike checks. */
  siteLabel: string | null;
  /** True when the store is a subdomain of a shared hosting provider (onrender.com, myshopify.com, ...). */
  sharedHosting: boolean;
}

export function domainInfo(rawUrlOrHost: string): DomainInfo {
  const hostname = (rawUrlOrHost.includes('://') ? new URL(rawUrlOrHost).hostname : rawUrlOrHost).toLowerCase();
  const registrable = getDomain(hostname);
  const site = getDomain(hostname, { allowPrivateDomains: true });
  return {
    hostname,
    registrable,
    site,
    siteLabel: getDomainWithoutSuffix(hostname, { allowPrivateDomains: true }),
    sharedHosting: !!registrable && !!site && registrable !== site,
  };
}

export const DAY_MS = 86_400_000;
