# VoirCheck real-world eval: holdout split, 2026-11-11

- VoirCheck real-world eval — split "holdout", 2026-11-11, commit 063725c. AI page analysis: ON.
- Sample: 20 stores; 0 dead (excluded: 0 scam, 0 legit), 0 runner errors (excluded); scored 0 scam + 20 legit.
- Scams caught (HOLD or BLOCK): 0/0 = n/a (BLOCK 0, HOLD 0, missed 0); 0 of those only via "couldn't verify".
- Legit false alarms: hard (BLOCK) 0/20 = 0%, soft (HOLD) 5/20 = 25%.
- Median scan time: 11.7 s.
- Without AI: scams caught 0/0 (BLOCK 0, HOLD 0); legit false alarms BLOCK 0, HOLD 5 of 20.
- With AI (qwen/qwen3.8-27b > nvidia/nemotron-3.5-lightning:free > nvidia/nemotron-3.5-super-vl:free): scams caught 0/0 (BLOCK 0, HOLD 0); legit false alarms BLOCK 0, HOLD 5 of 20.
- AI cost: $0.0000 total for 0 model calls (0 cached) = n/a per scan; 0 input tokens (0 more read from cache), 0 output.

> Small sample (0 scam + 20 legit scored): treat percentages as rough. AI page analysis was **on** (qwen/qwen3.8-27b > nvidia/nemotron-3.5-lightning:free > nvidia/nemotron-3.5-super-vl:free); "without AI" re-scores the same scans with its points and hard rule removed. Stores were scanned by URL only (homepage, no peers), so the price signal has nothing to compare against and is "unavailable". Ground truth comes from the sources in `eval/stores.json`, not from VoirCheck.

## Confusion table

| True label | BLOCK | HOLD | SAFE |
|---|---|---|---|
| Scam (source-listed) | 0 | 0 | 0 (missed) |
| Legit (source-listed) | 0 (hard false alarm) | 5 (soft false alarm) | 15 |

## Before vs after AI

| URL | Label | Without AI | With AI | AI status | AI findings | AI cost |
|---|---|---|---|---|---|---|
| https://www.walmart.com/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://www.homedepot.com/ | legit | HOLD 0 | HOLD 0 | unavailable (0) | No store page was read, so there was nothing to analyze. | - |
| https://www.newegg.com/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://www.boots.com/ | legit | HOLD 0 | HOLD 0 | unavailable (0) | No store page was read, so there was nothing to analyze. | - |
| https://www.waterstones.com/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://www.leroymerlin.fr/ | legit | HOLD 0 | HOLD 0 | unavailable (0) | No store page was read, so there was nothing to analyze. | - |
| https://www.cdiscount.com/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://www.laredoute.fr/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://www.maisonsdumonde.com/ | legit | HOLD 0 | HOLD 0 | unavailable (0) | No store page was read, so there was nothing to analyze. | - |
| https://www.conrad.de/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://www.galaxus.de/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://www.douglas.de/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://al-holz.at/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://aureperlia.at/ | legit | HOLD 0 | HOLD 0 | unavailable (0) | No store page was read, so there was nothing to analyze. | - |
| https://funstasy.at/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://www.heysimeon.com/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://lottacurls.com/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://maluch.at/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://dorascheesecake.com/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |
| https://natur-versand.at/ | legit | SAFE 0 | SAFE 0 | unavailable (0) | - | - |

## Per-signal hit rates

| Signal | Scam: hit rate (fail+warn / available) | Scam coverage | Legit: hit rate | Legit coverage |
|---|---|---|---|---|
| domain_age | n/a | n/a | 0% | 75% |
| ssl_redirects | n/a | n/a | 0% | 100% |
| price | n/a | n/a | n/a | 0% |
| ai_page | n/a | n/a | n/a | 0% |
| threat_list | n/a | n/a | 0% | 100% |
| clone | n/a | n/a | n/a | 0% |

## Facts collected for page analysis (evidence only, not scored)

Out of the scored stores (scam N=0, legit N=20); a scan blocked by a bot check collects nothing.

| Fact | Scam | Legit |
|---|---|---|
| extra pages read (any) | 0/0 | 14/20 |
| legal notice / Impressum page | 0/0 | 9/20 |
| contact / about page | 0/0 | 11/20 |
| returns / shipping / terms page | 0/0 | 13/20 |
| product page | 0/0 | 8/20 |
| company name with legal form | 0/0 | 8/20 |
| postal address | 0/0 | 7/20 |
| phone number | 0/0 | 6/20 |
| any contact email | 0/0 | 8/20 |
| free-mail contact email | 0/0 | 0/20 |
| email on the store's own domain | 0/0 | 7/20 |
| VAT / company registration number | 0/0 | 8/20 |
| PayPal mentioned | 0/0 | 3/20 |
| bank transfer / prepayment mentioned | 0/0 | 3/20 |
| return policy mentioned | 0/0 | 12/20 |
| discount of 50% or more seen | 0/0 | 5/20 |

## Missed scams (0)

None.

## False alarms on legit stores (5)

#### https://www.homedepot.com/ — legit, HOLD (score 0), hard rules: cant_verify

- **domain_age**: pass (0 pts) — homedepot.com was registered on 1992-08-04 (about 34 years ago). · Registrar: CSC Corporate Domains, Inc. · Well-known site: homedepot.com is #767 in the Tranco top-sites research list (list 746VX, 2026-10-30). This alone doesn't make a store safe.
- **ssl_redirects**: pass (0 pts) — Valid HTTPS certificate. · Certificate issued by DigiCert Inc. · Certificate is 107 days old (auto-renewed certificates are often new, so this alone means little). · No redirects. · Couldn't verify this store: blocked by a bot check (HTTP 403), so the cloud browser never saw the shop itself.
- **price**: unavailable (0 pts) — Couldn't read the store page: blocked by a bot check (HTTP 403), so its price is unknown.
- **ai_page**: unavailable (0 pts) — Couldn't read the store page: blocked by a bot check (HTTP 403). · No store page was read, so there was nothing to analyze.
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.
- cloud browser error: blocked by a bot check (HTTP 403)

#### https://www.boots.com/ — legit, HOLD (score 0), hard rules: cant_verify

- **domain_age**: pass (0 pts) — boots.com was registered on 1995-06-06 (about 31 years ago). · Registrar: CSC Corporate Domains, Inc. · Well-known site: boots.com is #10,207 in the Tranco top-sites research list (list 746VX, 2026-10-30). This alone doesn't make a store safe.
- **ssl_redirects**: pass (0 pts) — Valid HTTPS certificate. · Certificate issued by Sectigo Limited. · Certificate is 29 days old (auto-renewed certificates are often new, so this alone means little). · No redirects. · Couldn't verify this store: blocked by a bot check, so the cloud browser never saw the shop itself.
- **price**: unavailable (0 pts) — Couldn't read the store page: blocked by a bot check, so its price is unknown.
- **ai_page**: unavailable (0 pts) — Couldn't read the store page: blocked by a bot check. · No store page was read, so there was nothing to analyze.
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.
- cloud browser error: blocked by a bot check

#### https://www.leroymerlin.fr/ — legit, HOLD (score 0), hard rules: cant_verify

- **domain_age**: pass (0 pts) — leroymerlin.fr was registered on 1996-09-12 (about 30 years ago). · Registrar: NAMESHIELD. · Well-known site: leroymerlin.fr is #1,347 in the Tranco top-sites research list (list 746VX, 2026-10-30). This alone doesn't make a store safe.
- **ssl_redirects**: pass (0 pts) — Valid HTTPS certificate. · Certificate issued by GlobalSign nv-sa. · Certificate is 20 days old (auto-renewed certificates are often new, so this alone means little). · No redirects. · Couldn't verify this store: blocked by a bot check (HTTP 403), so the cloud browser never saw the shop itself.
- **price**: unavailable (0 pts) — Couldn't read the store page: blocked by a bot check (HTTP 403), so its price is unknown.
- **ai_page**: unavailable (0 pts) — Couldn't read the store page: blocked by a bot check (HTTP 403). · No store page was read, so there was nothing to analyze.
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.
- cloud browser error: blocked by a bot check (HTTP 403)

#### https://www.maisonsdumonde.com/ — legit, HOLD (score 0), hard rules: cant_verify

- **domain_age**: pass (0 pts) — maisonsdumonde.com was registered on 2004-07-22 (about 22 years ago). · Registrar: Gandi SAS. · Well-known site: maisonsdumonde.com is #13,737 in the Tranco top-sites research list (list 746VX, 2026-10-30). This alone doesn't make a store safe.
- **ssl_redirects**: pass (0 pts) — Valid HTTPS certificate. · Certificate issued by Google Trust Services. · Certificate is 50 days old (auto-renewed certificates are often new, so this alone means little). · No redirects. · Couldn't verify this store: blocked by a bot check (HTTP 403), so the cloud browser never saw the shop itself.
- **price**: unavailable (0 pts) — Couldn't read the store page: blocked by a bot check (HTTP 403), so its price is unknown.
- **ai_page**: unavailable (0 pts) — Couldn't read the store page: blocked by a bot check (HTTP 403). · No store page was read, so there was nothing to analyze.
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.
- cloud browser error: blocked by a bot check (HTTP 403)

#### https://aureperlia.at/ — legit, HOLD (score 0), hard rules: cant_verify

- **domain_age**: unavailable (0 pts) — Couldn't look up the registration of aureperlia.at (no RDAP server listed for .at). · No first certificate date either (crt.sh HTTP 502). · aureperlia.at is not in the Tranco top 100,000 sites (list 746VX).
- **ssl_redirects**: pass (0 pts) — Valid HTTPS certificate. · Certificate issued by Let's Encrypt. · Certificate is 61 days old (auto-renewed certificates are often new, so this alone means little). · No redirects. · Couldn't verify this store: the store returned an error page (HTTP 404), so the cloud browser never saw the shop itself.
- **price**: unavailable (0 pts) — Couldn't read the store page: the store returned an error page (HTTP 404), so its price is unknown.
- **ai_page**: unavailable (0 pts) — Couldn't read the store page: the store returned an error page (HTTP 404). · No store page was read, so there was nothing to analyze.
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.
- cloud browser error: the store returned an error page (HTTP 404)

## Excluded (0)


## All scored stores

| URL | Label | Verdict | Score | Hard rules | Scan time |
|---|---|---|---|---|---|
| https://www.walmart.com/ | legit | SAFE | 0 | - | 16.9 s |
| https://www.homedepot.com/ | legit | HOLD | 0 | cant_verify | 3.6 s |
| https://www.newegg.com/ | legit | SAFE | 0 | - | 30.2 s |
| https://www.boots.com/ | legit | HOLD | 0 | cant_verify | 3.2 s |
| https://www.waterstones.com/ | legit | SAFE | 0 | - | 11.7 s |
| https://www.leroymerlin.fr/ | legit | HOLD | 0 | cant_verify | 5.1 s |
| https://www.cdiscount.com/ | legit | SAFE | 0 | - | 10.9 s |
| https://www.laredoute.fr/ | legit | SAFE | 0 | - | 11.7 s |
| https://www.maisonsdumonde.com/ | legit | HOLD | 0 | cant_verify | 5.0 s |
| https://www.conrad.de/ | legit | SAFE | 0 | - | 11.9 s |
| https://www.galaxus.de/ | legit | SAFE | 0 | - | 11.5 s |
| https://www.douglas.de/ | legit | SAFE | 0 | - | 3.5 s |
| https://al-holz.at/ | legit | SAFE | 0 | - | 16.8 s |
| https://aureperlia.at/ | legit | HOLD | 0 | cant_verify | 3.9 s |
| https://funstasy.at/ | legit | SAFE | 0 | - | 15.6 s |
| https://www.heysimeon.com/ | legit | SAFE | 0 | - | 15.5 s |
| https://lottacurls.com/ | legit | SAFE | 0 | - | 14.8 s |
| https://maluch.at/ | legit | SAFE | 0 | - | 15.9 s |
| https://dorascheesecake.com/ | legit | SAFE | 0 | - | 13.3 s |
| https://natur-versand.at/ | legit | SAFE | 0 | - | 8.3 s |
