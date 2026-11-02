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
   agent never sees page text at all, only our structured verdicts, so a page can't instruct it.
3. Money moves only through MoneyGate on the server. The browser and the agent send IDs, never amounts or stores;
   prices and stores come from our own database rows.
4. MoneyGate decides from a fresh scan of that same store: SAFE is captured, HOLD waits for the person, BLOCK is
   voided. Only the person can override a BLOCK, after confirming the risk; Auto-pay and the agent never can.
5. Every money decision is written to an append-only audit log, and PayPal webhooks are signature-checked before
   anything is stored.
