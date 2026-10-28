# PayPal sandbox spike — results

Run: 2026-10-27 (evening ET), `scripts/paypal-spike.ts` against `api-m.sandbox.paypal.com`.
Two runs: T1–T4 first, then T1 + T3b + T5 + T6 (stopped run 1 before T5 so T3b could run first). T5c was a one-off API call made afterwards with the saved wallet from T5.
Store A / store B = two separate sandbox business accounts; neither is the app's own merchant account.
Saved-wallet (vault) IDs and customer IDs are left out on purpose (they're payment tokens).

| Test | Result | Key IDs | Exact PayPal response | What this means for VoirCheck |
|---|---|---|---|---|
| T1 OAuth | ✅ PASS | app `APP-941649431D238483J` | token valid ~9h; scope includes vault | Client-credentials auth works; refresh the token before ~9h. |
| T2 AUTHORIZE + payee A → capture | ✅ PASS | order `6K8173381E517264A`, auth `22F44158AG137513L`, capture `6E589964T4542163C` | capture `COMPLETED`; order payee = store A | Capturing to a third-party payee works, but on its own that's not enough (see T3/T4). |
| T3 AUTHORIZE + payee B → void | ❌ FAIL | order `5VP95926XN263203N`, auth `90593026BE861083J` (still CREATED) | `403 NOT_AUTHORIZED` / `PERMISSION_DENIED` on `/void` (debug_id `ca5167069bfda`) | A BLOCK verdict can't void a third-party-payee hold, so per-store payees break the core flow. |
| T3b AUTHORIZE, **no payee** (app's own account) → void | ✅ PASS | order `1HN59579GS5569026`, auth `28A424315V165911L` | auth `VOIDED` | **Fallback confirmed:** every payment goes to the app's own merchant; the store identity lives in `custom_id` + `description`. |
| T4 Reauthorize inside honor period | ℹ️ REJECTED (expected) | order `4B9073125H191251K`, auth `0R4018991S100015F` (still CREATED) | `422 UNPROCESSABLE_ENTITY` / `REAUTHORIZATION_TOO_SOON`: "only allowed once from Day 4 to Day 29" (debug_id `ca51678599d50`). Cleanup void to store A: `403 PERMISSION_DENIED` (debug_id `ca516785d1e9d`) | The HOLD screen offers reauthorize only from day 4 (once). The auth itself lasts 29 days, so a HOLD doesn't need it in the demo. The second void failure confirms T3 applies to every third-party payee, not just store B. |
| T5 Vault on first payment → charge saved wallet, no approval | ✅ PASS | first order `7MR75560FD427405T` / auth `23450970VE547181E`; second order `77686070759373150` / auth `6H707402X2755804W` | vault `VAULTED`; second order created already `COMPLETED` with auth `CREATED`, no buyer step | **Real auto-pay works** (with AUTHORIZE intent, so the money gate still applies). No `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE`. Capturing a saved-wallet auth wasn't tested; auto-pay uses a direct CAPTURE instead (T5c). |
| T5c Saved wallet, `intent: CAPTURE`, no approval (checked after the spike) | ✅ PASS | order `4LJ90652RG565781F`, capture `1HR073536B772753V` | order `COMPLETED`, capture `COMPLETED` in one call, no buyer step | Auto-pay charges a SAFE store with a direct CAPTURE, so capturing a saved-wallet authorization isn't needed. The verdict check must run before the order is created. |
| T5b Saved wallet + payee A, no approval (extra) | ❌ FAIL | — | `422 UNPROCESSABLE_ENTITY` / `BILLING_AGREEMENT_NOT_FOUND` (debug_id `ca5167e499ce7`) | A saved wallet is tied to the app's own merchant, so auto-pay can't target per-store payees. That's consistent with the T3b fallback. |
| T6 Webhooks + signature verification | ✅ PASS | webhook `5MT56509XD0729612` (temporary, deleted after run); order `9UY99949ER581750E`, auth `7P695870664068703` | 4/4 events `verification_status: SUCCESS`: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED` ×2, `PAYMENT.AUTHORIZATION.VOIDED` | Webhooks with `POST /v1/notifications/verify-webhook-signature` are ready to drive live UI + audit log. Webhooks can be registered via API (`POST /v1/notifications/webhooks`) at deploy time. |

## Notes for the build
- Every POST sent `PayPal-Request-Id` (idempotency) and `Prefer: return=representation` (without it, create-order responses omit `purchase_units`/payee).
- Orders were created with `payment_source.paypal.experience_context` (return/cancel URLs); the approval link has `rel: payer-action`.
- Twice (T4, T3b) the first buyer approval didn't register (order stayed `PAYER_ACTION_REQUIRED`); the second click-through worked. Poll order status (or use the `CHECKOUT.ORDER.APPROVED` webhook) rather than trusting the redirect alone.
- No `PayPal-Client-Metadata-Id` (RDA) header was needed for the saved-wallet charge in sandbox.
- Leftover sandbox holds (expire on their own ~Nov 26): T3 `90593026BE861083J`, T4 `0R4018991S100015F` (both third-party, can't be voided), T5 `23450970VE547181E` + `6H707402X2755804W`, plus the unused approved order `2UT67900FS7653420` from the first attempt.
