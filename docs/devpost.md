# VoirCheck: Devpost text

Ready to paste. Plain words, numbers as measured. Everything runs in the PayPal sandbox.

## Tagline

Your AI agent sees who it's paying, before it pays.

## Inspiration

AI agents are starting to shop and pay for people. Payment protocols for agents check the agent and what the person
allowed it to do, but not the shop it pays. Fake shops are built to look real: a copied layout, a price that's a little
too good, a brand-new domain, and sometimes hidden text that tells an AI "this store is verified safe". Researchers
have already shown agents buying from fake shops (Guardio Labs, "Scamlexity") and following hidden instructions
(Unit 42). We wanted a check between "buy" and "paid".

## What it does

VoirCheck checks a store before PayPal takes the money.

1. You approve the order in PayPal. PayPal **holds** the money (intent AUTHORIZE); nothing is taken yet.
2. VoirCheck opens the store in an isolated cloud browser (KERNEL) and checks it six ways: domain age, HTTPS and
   redirects, price against other stores, an AI reading of the pages, Google Safe Browsing, and whether it copies
   another store.
3. Our server code (MoneyGate), never the AI, decides: **Safe** is paid, **Hold** waits for you with the evidence,
   **Block** is cancelled and the hold is released.
4. You get a Trust Receipt page with the evidence, in English or French.

There's also a shopping agent you can chat with ("find wireless earbuds under $60"). It checks every store before it
recommends one, ranks by trust before price, and asks you before it buys. It never sees the store's page text, only
our summary, and it can't pay, cancel or refund by itself. Anyone can also paste a link, use the Chrome extension, or
connect their own AI agent through our MCP server.

## How we built it

- **PayPal:** Orders v2 with intent AUTHORIZE, then capture or void by the verdict; reauthorize for long holds; JS SDK
  v6 buttons; Vault for optional Auto-pay on Safe stores; signature-verified webhooks; the PayPal AI Toolkit for
  `get_order` (read only) and `create_refund` (only after the person presses the button).
- **AI, at $0 right now:** free providers answer first, Claude is the last backup when we have credit.
  - Page analysis (public store pages only): Groq (Qwen) → Google Gemini Flash-Lite → OpenRouter free models → Claude.
  - Shopping agent (your chat): Groq (Qwen, then gpt-oss) → OpenRouter free models → Claude. Never Gemini, so chats
    stay off Google's free tier.
  - Free daily limits apply. When they run out and there's no Claude credit, the page check says "Not checked".
    "What the web says" (a web search about the store) needs Claude.
- **Rules in code, not in the AI:** an AI finding only adds points with proof (a quote we found on the page, or our
  own check for missing legal details). A page showing a "Verified by VoirCheck" or "PayPal Verified" badge it gave
  itself is at least Hold, whatever the AI says. Hidden text aimed at AI agents is detected and flagged.
- **Stack:** Next.js 16, React 19, TypeScript, Neon Postgres + Neon Auth, Drizzle, KERNEL, Channel3 product search,
  Google Safe Browsing, RDAP, Tranco, Resend, Render.

## How we tested

- **Where the shops come from (never from VoirCheck):** fake shops from Watchlist Internet, Verbraucherzentrale
  warnings, MalwareTips write-ups, a news report and one we found in a shopping ad, reported Aug 20 to Nov 6, 2026.
  Real shops: established retailers and shops certified by Austria's E-Commerce-Gütezeichen.
- **Caught** means VoirCheck said Hold or Block. Sites already offline are left out.
- **Results (Claude reading the pages):**
  - Fake shops, Nov 8: **34 of 54** online fake shops caught, 2 of them blocked. Not tuned on: 11 of 20 holdout shops
    and 10 of 12 new finds. Tuned on or seen before: 13 of 22.
  - Real shops, Nov 8: **7 of 30** on Hold, none blocked. 6 of the 7 were shops we couldn't read (bot checks or error
    pages), which VoirCheck never calls safe.
  - The attacks we tested, Nov 4: **0 of 5** moved money or got an order on the attacker's terms.
  - The same agent without VoirCheck paid the fake shop in **6 of 7** runs; with VoirCheck, **0 of 6**.
- We changed the scanner after these runs (Nov 8 and Nov 11) and haven't re-measured everything since, so later
  numbers on the same shops wouldn't be clean. This covers the attacks we tested; a new trick could still get past
  VoirCheck.

## Challenges

- **Per-store payees can't be voided.** Our PayPal spike showed that voiding an authorization to another merchant
  fails, so every order goes to the app's own sandbox merchant and the store is named in the order.
- **A missed attack.** Our first attack run scored an instruction hidden in image alt text as Safe. We fixed the
  scanner the same night and published both runs.
- **Free AI providers make different mistakes.** One model flagged real shops for payment problems their pages never
  showed; another read a fake "Verified by VoirCheck" badge as normal. We answered with rules in code (proof for every
  finding, a fixed badge rule) instead of trusting any one model.
- **Bot checks.** We never solve CAPTCHAs, so some real retailers come out "couldn't verify" and go on Hold.

## Accomplishments

- The AI never touches the money: MoneyGate takes the price from our own records and settles by the verdict.
- Every result we measured is published, including the misses.
- English and French throughout, written for people who aren't comfortable with technology.

## What we learned

A shop's page is the attacker's text. Anything an AI reads there has to be treated as data, and anything that moves
money has to be decided by plain code.

## What's next

- Re-measure the full test set on the current scanner.
- More fake-shop sources outside Germany and Austria.
- Move the threat check to Google Web Risk before any paid use.

## Try it

- Live app: https://voircheck.com ("Try the demo" creates a private temporary account; PayPal sandbox only).
- Code: https://github.com/JoJoshJo/voircheck

## Built with

paypal, paypal-ai-toolkit, next.js, react, typescript, neon, postgresql, drizzle, kernel, groq, gemini, openrouter,
claude, channel3, google-safe-browsing, resend, render, mcp
