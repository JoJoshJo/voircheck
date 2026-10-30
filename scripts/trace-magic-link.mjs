/**
 * Debug helper: trace a magic-link URL hop by hop (one cookie jar, like one browser context).
 *   node scripts/trace-magic-link.mjs "<link from the email>" [appOrigin]
 *   node scripts/trace-magic-link.mjs --exchange "<link>" [appOrigin]
 *     → stop after Neon's redirect and exchange the verifier via our /api/auth/get-session (no challenge cookie)
 * Prints statuses, hosts/paths, Set-Cookie NAMES (never values) and whether our app ended up signed in.
 * Tokens/verifiers are redacted. The link is single-use: tracing it consumes it.
 */
const args = process.argv.slice(2);
const exchange = args[0] === '--exchange';
if (exchange) args.shift();
const link = args[0];
const appOrigin = args[1] ?? 'http://localhost:3000';
if (!link) {
  console.error('usage: node scripts/trace-magic-link.mjs "<link>" [appOrigin]');
  process.exit(2);
}
const red = (u) => u.replace(/(token|neon_auth_session_verifier|state|code)=([^&]+)/g, (_, k, v) => `${k}=<${v.length} chars>`);
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
let url = link;
console.log(`link host: ${new URL(link).host}  path: ${new URL(link).pathname}`);
if (exchange) {
  const res = await fetch(link, { redirect: 'manual' });
  const loc = res.headers.get('location');
  console.log(`neon verify: ${res.status} → ${loc ? red(loc) : 'no redirect'}`);
  const verifier = loc ? new URL(loc, link).searchParams.get('neon_auth_session_verifier') : null;
  if (!verifier) {
    console.log('no verifier in the redirect');
    process.exit(0);
  }
  const ex = await fetch(`${appOrigin}/api/auth/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`);
  const set = ex.headers.getSetCookie();
  for (const c of set) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
  const body = await ex.json().catch(() => null);
  console.log(`exchange via ${appOrigin}/api/auth/get-session (no challenge cookie): ${ex.status} | set-cookie: ${set.map((c) => c.split('=')[0]).join(', ') || 'none'} | user in response: ${body && body.user ? 'yes' : 'no'}`);
  const session = await fetch(`${appOrigin}/api/auth/get-session`, { headers: { cookie: cookieHeader() } }).then((r) => r.json()).catch(() => null);
  console.log(`signed in on ${appOrigin} afterwards: ${session && session.user ? 'yes' : 'no'}`);
  process.exit(0);
}
for (let hop = 0; hop < 10; hop++) {
  const res = await fetch(url, { redirect: 'manual', headers: { cookie: cookieHeader() } });
  const set = res.headers.getSetCookie();
  for (const c of set) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    // Keep cookies only for our app's host (what a browser would send back to it).
    if (new URL(url).origin === new URL(appOrigin).origin) jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
  const q = new URL(url).searchParams;
  console.log(`hop ${hop}: ${res.status} ${red(url)}`);
  console.log(`   has neon_auth_session_verifier: ${q.has('neon_auth_session_verifier')} | set-cookie: ${set.map((c) => `${c.split('=')[0]}@${new URL(url).host}`).join(', ') || 'none'}`);
  const loc = res.headers.get('location');
  if (!loc || res.status < 300 || res.status >= 400) break;
  url = new URL(loc, url).href;
}
const session = await fetch(`${appOrigin}/api/auth/get-session`, { headers: { cookie: cookieHeader() } }).then((r) => r.json()).catch(() => null);
console.log(`\nsigned in on ${appOrigin}: ${session && session.user ? `yes (${String(session.user.email).replace(/^[^@]+/, '***')})` : 'no'}`);
