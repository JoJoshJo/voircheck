import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

/**
 * SSRF guards (spec 5.17 #2). Store pages are only ever opened inside KERNEL; our server only talks to the
 * store host for the TLS check, and only after resolving it and rejecting every non-public address.
 */
export class SsrfError extends Error {
  override name = 'SsrfError';
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan'];
const ALLOWED_PORTS = new Set(['', '80', '443']);

/** True only for globally routable unicast addresses: blocks loopback, private, link-local (incl. 169.254.169.254), CGNAT, ULA (incl. fd00:ec2::254), reserved, multicast. */
export function isPublicIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) addr = (addr as ipaddr.IPv6).toIPv4Address();
  return addr.range() === 'unicast';
}

/** Cheap checks on the URL itself, before any DNS. */
export function assertSafeUrlShape(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('only http and https URLs are allowed');
  if (url.username || url.password) throw new SsrfError('URLs with credentials are not allowed');
  if (!ALLOWED_PORTS.has(url.port)) throw new SsrfError('only the default web ports (80/443) are allowed');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new SsrfError('internal hostnames are not allowed');
  if (ipaddr.isValid(host) && !isPublicIp(host)) throw new SsrfError('private or reserved IP addresses are not allowed');
  if (!ipaddr.isValid(host) && !host.includes('.')) throw new SsrfError('hostname must be a public domain');
  return url;
}

export type Resolver = (hostname: string) => Promise<string[]>;

const systemResolver: Resolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

/**
 * Resolve-then-check: every address the name resolves to must be public. Returns the addresses so callers
 * connect to a checked IP (not the name again), which stops DNS rebinding between check and use.
 */
export async function resolvePublicHost(hostname: string, resolve: Resolver = systemResolver): Promise<string[]> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const addresses = ipaddr.isValid(host) ? [host] : await resolve(host);
  if (addresses.length === 0) throw new SsrfError('hostname did not resolve');
  const bad = addresses.find((a) => !isPublicIp(a));
  if (bad) throw new SsrfError('hostname resolves to a private or reserved address');
  return addresses;
}
