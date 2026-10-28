import tls from 'node:tls';
import { DAY_MS, domainInfo } from '../domain';
import { resolvePublicHost, type Resolver } from '../ssrf';
import { errorMessage, type SignalOutcome } from './types';

/** Signal 2: SSL & redirects. Cert facts come from a server-side TLS handshake to a checked IP; the redirect chain is what KERNEL observed. */

export interface TlsFacts {
  /** Chain trusted and hostname matches. */
  valid: boolean;
  error?: string;
  issuer?: string;
  validFrom?: Date;
  validTo?: Date;
}

export type TlsChecker = (hostname: string) => Promise<TlsFacts>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function makeTlsChecker(resolve?: Resolver, timeoutMs = 6000): TlsChecker {
  return async (hostname) => {
    const [ip] = await resolvePublicHost(hostname, resolve);
    return new Promise<TlsFacts>((done) => {
      const socket = tls.connect({ host: ip, port: 443, servername: hostname, rejectUnauthorized: false, timeout: timeoutMs });
      const finish = (facts: TlsFacts) => {
        socket.destroy();
        done(facts);
      };
      socket.once('secureConnect', () => {
        const cert = socket.getPeerCertificate();
        const identityError = cert && Object.keys(cert).length ? tls.checkServerIdentity(hostname, cert) : new Error('no certificate');
        const authError = socket.authorized ? undefined : String(socket.authorizationError ?? 'untrusted certificate');
        finish({
          valid: socket.authorized && !identityError,
          error: authError ?? identityError?.message,
          issuer: first(cert.issuer?.O) ?? first(cert.issuer?.CN),
          validFrom: cert.valid_from ? new Date(cert.valid_from) : undefined,
          validTo: cert.valid_to ? new Date(cert.valid_to) : undefined,
        });
      });
      socket.once('timeout', () => finish({ valid: false, error: 'TLS handshake timed out' }));
      socket.once('error', (err) => finish({ valid: false, error: err.message }));
    });
  };
}

export interface NavigationFacts {
  finalUrl: string;
  /** Every URL from the requested one to the final one, in order. */
  redirectChain: string[];
}

export function evaluateSsl(input: {
  url: string;
  /** null when the KERNEL visit failed. */
  navigation: NavigationFacts | null;
  /** TLS facts for the final host (or the input host when navigation is unknown). null when the check couldn't run. */
  tls: TlsFacts | null;
  now: Date;
}): { outcome: SignalOutcome; validHttps: boolean | null } {
  const id = 'ssl_redirects' as const;
  const evidence: string[] = [];
  const finalUrl = input.navigation?.finalUrl ?? input.url;
  const finalIsHttps = finalUrl.startsWith('https://');
  // KERNEL's Chromium refuses invalid certificates, so a page it loaded over https is itself proof of a valid cert.
  const loadedOverHttps = !!input.navigation && finalIsHttps;

  let validHttps: boolean | null;
  if (!finalIsHttps) {
    validHttps = input.navigation ? false : input.tls?.valid ? null : false;
    evidence.push(input.navigation ? `The page ends up on an unencrypted http:// address (${new URL(finalUrl).host}).` : 'The address is http://, not https://.');
  } else if (input.tls) {
    validHttps = input.tls.valid || loadedOverHttps;
    if (input.tls.valid) evidence.push('Valid HTTPS certificate.');
    else if (loadedOverHttps) evidence.push(`The browser accepted the HTTPS certificate, but our own check didn't (${input.tls.error}).`);
    else evidence.push(`HTTPS certificate is not valid (${input.tls.error ?? 'unknown error'}).`);
  } else {
    validHttps = loadedOverHttps ? true : null;
    evidence.push(loadedOverHttps ? 'The browser loaded the page over valid HTTPS (certificate details unavailable).' : "Couldn't check the HTTPS certificate.");
  }

  if (input.tls?.issuer) evidence.push(`Certificate issued by ${input.tls.issuer}.`);
  if (input.tls?.validFrom && !Number.isNaN(input.tls.validFrom.getTime())) {
    const certDays = Math.floor((input.now.getTime() - input.tls.validFrom.getTime()) / DAY_MS);
    evidence.push(`Certificate is ${certDays} day${certDays === 1 ? '' : 's'} old (auto-renewed certificates are often new, so this alone means little).`);
  }

  let crossDomain = false;
  if (input.navigation) {
    const chain = input.navigation.redirectChain.length ? input.navigation.redirectChain : [input.url, finalUrl];
    const sites = [...new Set(chain.map((u) => domainInfo(u).site ?? new URL(u).hostname))];
    crossDomain = sites.length > 1;
    if (crossDomain) evidence.push(`Redirects across domains: ${sites.join(' → ')}.`);
    else if (chain.length > 1) evidence.push(`Redirects stay on ${sites[0]} (${chain.length - 1} hop${chain.length > 2 ? 's' : ''}).`);
    else evidence.push('No redirects.');
  } else {
    evidence.push("Redirects weren't observed (the cloud browser visit failed).");
  }

  const status = validHttps === false ? 'fail' : validHttps === null ? 'unavailable' : crossDomain ? 'warn' : 'pass';
  return { outcome: { id, status, evidence }, validHttps };
}

export async function safeTlsCheck(check: TlsChecker, hostname: string): Promise<TlsFacts | null> {
  try {
    return await check(hostname);
  } catch (err) {
    return { valid: false, error: errorMessage(err) };
  }
}
