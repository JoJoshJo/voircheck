# VoirCheck real-world eval: tune split, 2026-11-08

- VoirCheck real-world eval — split "tune", 2026-11-08, commit 63fbf27. AI page analysis: ON.
- Sample: 10 stores; 0 dead (excluded: 0 scam, 0 legit), 0 runner errors (excluded); scored 0 scam + 10 legit.
- Scams caught (HOLD or BLOCK): 0/0 = n/a (BLOCK 0, HOLD 0, missed 0); 0 of those only via "couldn't verify".
- Legit false alarms: hard (BLOCK) 0/10 = 0%, soft (HOLD) 1/10 = 10%.
- Median scan time: 11.6 s.
- Without AI: scams caught 0/0 (BLOCK 0, HOLD 0); legit false alarms BLOCK 0, HOLD 1 of 10.
- With AI (claude-sonnet-5-5): scams caught 0/0 (BLOCK 0, HOLD 0); legit false alarms BLOCK 0, HOLD 1 of 10.
- AI cost: $0.0000 total for 0 model calls (9 cached) = n/a per scan; 0 input tokens (0 more read from cache), 0 output.

> Small sample (0 scam + 10 legit scored): treat percentages as rough. AI page analysis was **on** (claude-sonnet-5-5); "without AI" re-scores the same scans with its points and hard rule removed. Stores were scanned by URL only (homepage, no peers), so the price signal has nothing to compare against and is "unavailable". Ground truth comes from the sources in `eval/stores.json`, not from VoirCheck.

## Confusion table

| True label | BLOCK | HOLD | SAFE |
|---|---|---|---|
| Scam (source-listed) | 0 | 0 | 0 (missed) |
| Legit (source-listed) | 0 (hard false alarm) | 1 (soft false alarm) | 9 |

## Before vs after AI

| URL | Label | Without AI | With AI | AI status | AI findings | AI cost |
|---|---|---|---|---|---|---|
| https://www.rei.com/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | cached |
| https://www.johnlewis.com/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | cached |
| https://www.currys.co.uk/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | cached |
| https://bettenreiter.at/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | cached |
| https://bikepalast.com/ | legit | SAFE 0 | SAFE 0 | pass (0) | Unrealistic discounts, Unrealistic discounts | cached |
| https://messerkoenig.at/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | cached |
| https://tee-shop.at/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | cached |
| https://tauchversand.com/ | legit | SAFE 0 | SAFE 0 | pass (0) | Company details inconsistent | cached |
| https://dieroester.at/ | legit | HOLD 0 | HOLD 0 | unavailable (0) | No store page was read, so there was nothing to analyze. | - |
| https://naehprinz.at/ | legit | SAFE 0 | SAFE 0 | pass (0) | Copied or generic text | cached |

## Per-signal hit rates

| Signal | Scam: hit rate (fail+warn / available) | Scam coverage | Legit: hit rate | Legit coverage |
|---|---|---|---|---|
| domain_age | n/a | n/a | 0% | 50% |
| ssl_redirects | n/a | n/a | 0% | 100% |
| price | n/a | n/a | n/a | 0% |
| ai_page | n/a | n/a | 0% | 90% |
| threat_list | n/a | n/a | 0% | 100% |
| clone | n/a | n/a | n/a | 0% |

## Facts collected for page analysis (evidence only, not scored)

Out of the scored stores (scam N=0, legit N=10); a scan blocked by a bot check collects nothing.

| Fact | Scam | Legit |
|---|---|---|
| extra pages read (any) | 0/0 | 8/10 |
| legal notice / Impressum page | 0/0 | 6/10 |
| contact / about page | 0/0 | 7/10 |
| returns / shipping / terms page | 0/0 | 8/10 |
| product page | 0/0 | 2/10 |
| company name with legal form | 0/0 | 7/10 |
| postal address | 0/0 | 6/10 |
| phone number | 0/0 | 6/10 |
| any contact email | 0/0 | 6/10 |
| free-mail contact email | 0/0 | 0/10 |
| email on the store's own domain | 0/0 | 5/10 |
| VAT / company registration number | 0/0 | 7/10 |
| PayPal mentioned | 0/0 | 1/10 |
| bank transfer / prepayment mentioned | 0/0 | 1/10 |
| return policy mentioned | 0/0 | 9/10 |
| discount of 50% or more seen | 0/0 | 4/10 |

## Missed scams (0)

None.

## False alarms on legit stores (1)

#### https://dieroester.at/ — legit, HOLD (score 0), hard rules: cant_verify

- **domain_age**: unavailable (0 pts) — Couldn't look up the registration of dieroester.at (no RDAP server listed for .at). · dieroester.at is not in the Tranco top 100,000 sites (list 746VX).
- **ssl_redirects**: pass (0 pts) — The browser accepted the HTTPS certificate, but our own check didn't (CERT_HAS_EXPIRED). · Certificate issued by catchall. · Certificate is 775 days old (auto-renewed certificates are often new, so this alone means little). · No redirects. · Couldn't verify this store: the store returned an error page (HTTP 500), so the cloud browser never saw the shop itself.
- **price**: unavailable (0 pts) — Couldn't read the store page: the store returned an error page (HTTP 500), so its price is unknown.
- **ai_page**: unavailable (0 pts) — Couldn't read the store page: the store returned an error page (HTTP 500). · No store page was read, so there was nothing to analyze.
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.
- cloud browser error: the store returned an error page (HTTP 500)

## Excluded (0)


## All scored stores

| URL | Label | Verdict | Score | Hard rules | Scan time |
|---|---|---|---|---|---|
| https://www.rei.com/ | legit | SAFE | 0 | - | 11.5 s |
| https://www.johnlewis.com/ | legit | SAFE | 0 | - | 22.8 s |
| https://www.currys.co.uk/ | legit | SAFE | 0 | - | 16.8 s |
| https://bettenreiter.at/ | legit | SAFE | 0 | - | 12.0 s |
| https://bikepalast.com/ | legit | SAFE | 0 | - | 10.4 s |
| https://messerkoenig.at/ | legit | SAFE | 0 | - | 11.4 s |
| https://tee-shop.at/ | legit | SAFE | 0 | - | 14.3 s |
| https://tauchversand.com/ | legit | SAFE | 0 | - | 11.8 s |
| https://dieroester.at/ | legit | HOLD | 0 | cant_verify | 7.6 s |
| https://naehprinz.at/ | legit | SAFE | 0 | - | 10.0 s |
