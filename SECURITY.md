# Security

## Reporting a vulnerability

Email **lawsgamer213@gmail.com** with "VoirCheck security" in the subject. Please include what you found, the steps to
reproduce it, and what an attacker could do with it. Please don't open a public issue for a vulnerability, and give us
a reasonable time to fix it before you share details. We'll reply within a few days. There's no bug bounty.

## Sandbox only

VoirCheck is a hackathon project. Every payment runs in the **PayPal sandbox**: no real money moves, and the PayPal
client refuses any non-sandbox API URL. Never enter real card or bank details anywhere in the app. The "scam" stores in
the demo are fictional brands we built for the demo and are clearly labeled as demos.

## In scope

- The web app (`apps/web`) and its API routes: authentication and sessions, access to another user's data, the money
  flow (anything that captures, voids or reauthorizes a payment outside the rules below), the shopping agent, the
  store scanner (including SSRF), rate limits and spending caps.
- The code in this repository: `packages/*`, `db`, `scripts`.

## Out of scope

- PayPal, Neon (Neon Auth), KERNEL, Anthropic, Channel3, Resend, Render and Cloudflare themselves: report those to
  them.
- The demo stores' deliberately deceptive content (`apps/stores`): fake prices and hidden text aimed at AI agents are
  the test material.
- Denial of service, load testing and spam. The public demo has per-user, per-IP and global daily caps; please don't
  try to exhaust them.
- Social engineering, and anything that needs a compromised device or browser.

## How the design limits damage

1. Store pages are only ever opened in KERNEL's isolated cloud browser, never on our server or your device, behind
   SSRF guards (public http(s) only, no private, loopback or metadata addresses, redirects re-checked).
2. Page text is untrusted data: the AI analysis reads it inside marked blocks and only reports findings; the shopping
   agent never sees page text at all, only our structured verdicts, so a page can't instruct it. Store and product
   names from product search reach it only inside an `untrusted` object (control characters and `<>` removed,
   length-capped), and its instructions say those fields are data. The MCP server returns only our own fixed wording,
   the checked URL, our evidence link and the store's hostname: nothing a store wrote.
3. Money moves only through MoneyGate on the server. The browser and the agent send IDs, never amounts or stores;
   prices and stores come from our own database rows.
4. MoneyGate decides from a fresh scan of that same store: SAFE is captured, HOLD waits for the person, BLOCK is
   voided. Only the person can override a BLOCK, after confirming the risk; Auto-pay and the agent never can.
5. Every money decision is written to an append-only audit log, and PayPal webhooks are signature-checked before
   anything is stored.
6. Cookie-authenticated requests that change anything (payments and refunds, scans, the agent, settings, agent tokens,
   sign-in and sign-out) must come from our own site: a cross-site Origin, or none, is refused. The MCP server takes a
   Bearer token only, never a cookie.

## Limits

Per account (guest "Try the demo" accounts get the lower number):

| What | Limit |
| --- | --- |
| Store links checked (check-a-link, MCP `check_store`) | 15 / 30 per hour |
| Shopping agent requests, MCP `prepare_purchase` | 5 / 10 per hour |
| MCP `get_verdict` (database read) | 60 per hour |
| Active MCP tokens | 5 (guest accounts can't create any) |

Per MCP token: one fresh scan running at a time, and 10 fresh (uncached) scans per hour. One JSON-RPC message per
request: batches are refused (400), and bodies over 64 KB get 413.

Per IP: 30 store checks per hour, and 5 new guest accounts per hour. The IP is Cloudflare's `CF-Connecting-IP`. On Nov
4, one request to production sent with a forged `CF-Connecting-IP` showed Cloudflare in front of the Render host,
assigning the real address and ignoring the forged one.

Whole app, per UTC day: 300 KERNEL scans and $3 of Anthropic usage (under the workspace's own hard cap). Each fresh
scan reserves its KERNEL session and its page analysis (an upper bound) up front, in one conditional database
statement, so concurrent scans can't overshoot the caps. Past the KERNEL cap, only stores checked in the last 24
hours show a result; past the Anthropic cap, scans run without page analysis. At most 5 fresh scans run at once.

The per-account, per-token and per-IP windows are kept in memory: they reset when the server restarts and assume one
instance. The daily caps and per-account scan counts are in the database.

## Accepted risks

Known, judged acceptable for a sandbox-only demo, and revisited before any real-money use:

- **DNS rebinding inside KERNEL.** We resolve the store's host and refuse private, loopback and metadata addresses
  before the visit, but KERNEL's browser resolves the host again. A hostile DNS server could answer differently the
  second time and point KERNEL's browser at an address in KERNEL's own network (not ours). The page we get back is
  still treated as untrusted. Mitigation is KERNEL's own egress filtering.
- **CSP allows inline scripts** (`script-src 'self' 'unsafe-inline'`), which Next.js needs without per-request
  nonces. No user or store content is rendered as HTML (no `dangerouslySetInnerHTML` on it), so there is no known way
  to inject a script. Moving to nonces is planned.
- **Scans are shared by URL.** A scan is a public fact about a store, cached for 24 hours: anyone who checks the same
  URL sees the same result, including that URL's query string. Don't check links that carry private tokens.
- **The auth package is a beta** (`@neondatabase/auth` 0.7.0-beta), pinned to an exact version, with its
  better-auth dependencies overridden to patched releases. We watch its advisories.
- **Rate-limit windows are in memory** (see Limits): a restart or deploy resets them, and a second instance would have
  its own. The daily spending caps don't depend on them.
- **Transitive advisories with no usable fix** (`pnpm audit --prod`, Nov 4): zod 3.25.76 inside
  `@paypal/agent-toolkit` (fixed only in zod 4, which the toolkit doesn't support; VoirCheck checks every ID it passes to
  the toolkit against a strict pattern first); esbuild 0.18 (drizzle-kit's dev loader under the auth package, not on
  any request path); and low-severity advisories in `ai`, `@ai-sdk/provider-utils` and `deepmerge`.
