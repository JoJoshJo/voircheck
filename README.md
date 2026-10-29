# VoirCheck
Your AI agent sees who it's paying — before it pays.
PayPal AI Hackathon 2026 — work in progress.

## Operations

### Data retention job
The Privacy page promises: data is kept through judging (until **2026-12-15**), then user-linked data is deleted **90 days after it was created**.

```bash
pnpm retention:run            # dry run (default): prints what would be deleted, changes nothing
pnpm retention:run --apply    # deletes, in one transaction; refused before 2026-12-15
```

- Deletes (in foreign-key order): sandbox payments, candidates, shopping sessions, saved-wallet references, profiles, sign-in sessions, old verification links, sign-in methods and accounts. A row goes when it is older than 90 days or belongs to an account older than 90 days.
- Keeps: shared `scans`, the append-only `audit_log` (random user id only), `webhook_events` (payment status only), `test_set_results`, `demo_stores`, and public Trust Receipts (their payment link is cleared first).
- After `--apply`, one anonymous `retention.run` row with the counts is added to `audit_log`.
- Rules and the SQL plan live in `db/src/retention.ts` (tests: `db/src/retention.test.ts`). Needs `DATABASE_URL`.
- To schedule after Dec 15: a daily Render Cron Job running `pnpm retention:run --apply`.

### One-off: redact old PayPal webhook payloads
```bash
pnpm webhooks:redact          # dry run: counts rows with payer details
pnpm webhooks:redact --apply  # rewrite them to payment status details only
```
