# VoirCheck real-world eval: tune split, 2026-11-11

- VoirCheck real-world eval — split "tune", 2026-11-11, commit 063725c. AI page analysis: ON.
- Sample: 10 stores; 0 dead (excluded: 0 scam, 0 legit), 0 runner errors (excluded); scored 0 scam + 10 legit.
- Scams caught (HOLD or BLOCK): 0/0 = n/a (BLOCK 0, HOLD 0, missed 0); 0 of those only via "couldn't verify".
- Legit false alarms: hard (BLOCK) 0/10 = 0%, soft (HOLD) 4/10 = 40%.
- Median scan time: 15.7 s.
- Without AI: scams caught 0/0 (BLOCK 0, HOLD 0); legit false alarms BLOCK 0, HOLD 2 of 10.
- With AI (qwen/qwen3.8-27b > nvidia/nemotron-3.5-lightning:free): scams caught 0/0 (BLOCK 0, HOLD 0); legit false alarms BLOCK 0, HOLD 4 of 10.
- AI cost: $0.0000 total for 8 model calls (0 cached) = $0.0000 per scan; 54432 input tokens (0 more read from cache), 2510 output.

> Small sample (0 scam + 10 legit scored): treat percentages as rough. AI page analysis was **on** (qwen/qwen3.8-27b > nvidia/nemotron-3.5-lightning:free); "without AI" re-scores the same scans with its points and hard rule removed. Stores were scanned by URL only (homepage, no peers), so the price signal has nothing to compare against and is "unavailable". Ground truth comes from the sources in `eval/stores.json`, not from VoirCheck.

## Confusion table

| True label | BLOCK | HOLD | SAFE |
|---|---|---|---|
| Scam (source-listed) | 0 | 0 | 0 (missed) |
| Legit (source-listed) | 0 (hard false alarm) | 4 (soft false alarm) | 6 |

## Before vs after AI

| URL | Label | Without AI | With AI | AI status | AI findings | AI cost |
|---|---|---|---|---|---|---|
| https://www.rei.com/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | $0.0000 |
| https://www.johnlewis.com/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | $0.0000 |
| https://www.currys.co.uk/ | legit | HOLD 0 | HOLD 0 | unavailable (0) | No store page was read, so there was nothing to analyze. | - |
| https://bettenreiter.at/ | legit | SAFE 0 | SAFE 15 | warn (15) | Company details inconsistent, Copied or generic text | $0.0000 |
| https://bikepalast.com/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | $0.0000 |
| https://messerkoenig.at/ | legit | SAFE 0 | SAFE 15 | warn (15) | Company details inconsistent, Copied or generic text | $0.0000 |
| https://tee-shop.at/ | legit | SAFE 0 | HOLD 35 | fail (35) | Copied or generic text, Unrealistic discounts, Fake scarcity or urgency | $0.0000 |
| https://tauchversand.com/ | legit | SAFE 0 | HOLD 35 | fail (35) | Company details inconsistent, Company details inconsistent, Unrealistic discounts, Fake scarcity or urgency | $0.0000 |
| https://dieroester.at/ | legit | HOLD 0 | HOLD 0 | unavailable (0) | No store page was read, so there was nothing to analyze. | - |
| https://naehprinz.at/ | legit | SAFE 0 | SAFE 0 | pass (0) | - | $0.0000 |

## Per-signal hit rates

| Signal | Scam: hit rate (fail+warn / available) | Scam coverage | Legit: hit rate | Legit coverage |
|---|---|---|---|---|
| domain_age | n/a | n/a | 0% | 70% |
| ssl_redirects | n/a | n/a | 0% | 100% |
| price | n/a | n/a | n/a | 0% |
| ai_page | n/a | n/a | 50% | 80% |
| threat_list | n/a | n/a | 0% | 100% |
| clone | n/a | n/a | n/a | 0% |

## Facts collected for page analysis (evidence only, not scored)

Out of the scored stores (scam N=0, legit N=10); a scan blocked by a bot check collects nothing.

| Fact | Scam | Legit |
|---|---|---|
| extra pages read (any) | 0/0 | 7/10 |
| legal notice / Impressum page | 0/0 | 6/10 |
| contact / about page | 0/0 | 6/10 |
| returns / shipping / terms page | 0/0 | 7/10 |
| product page | 0/0 | 1/10 |
| company name with legal form | 0/0 | 6/10 |
| postal address | 0/0 | 6/10 |
| phone number | 0/0 | 6/10 |
| any contact email | 0/0 | 6/10 |
| free-mail contact email | 0/0 | 0/10 |
| email on the store's own domain | 0/0 | 5/10 |
| VAT / company registration number | 0/0 | 7/10 |
| PayPal mentioned | 0/0 | 1/10 |
| bank transfer / prepayment mentioned | 0/0 | 1/10 |
| return policy mentioned | 0/0 | 8/10 |
| discount of 50% or more seen | 0/0 | 3/10 |

## Missed scams (0)

None.

## False alarms on legit stores (4)

#### https://www.currys.co.uk/ — legit, HOLD (score 0), hard rules: cant_verify

- **domain_age**: pass (0 pts) — currys.co.uk was registered on 1996-11-13 (about 30 years ago). · Registrar: CSC Corporate Domains, Inc. · Well-known site: currys.co.uk is #6,254 in the Tranco top-sites research list (list 746VX, 2026-10-30). This alone doesn't make a store safe.
- **ssl_redirects**: pass (0 pts) — Valid HTTPS certificate. · Certificate issued by DigiCert Inc. · Certificate is 104 days old (auto-renewed certificates are often new, so this alone means little). · No redirects. · Couldn't verify this store: the store returned an error page (HTTP 503), so the cloud browser never saw the shop itself.
- **price**: unavailable (0 pts) — Couldn't read the store page: the store returned an error page (HTTP 503), so its price is unknown.
- **ai_page**: unavailable (0 pts) — Couldn't read the store page: the store returned an error page (HTTP 503). · No store page was read, so there was nothing to analyze.
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.
- cloud browser error: the store returned an error page (HTTP 503)

#### https://tee-shop.at/ — legit, HOLD (score 35)

- **domain_age**: unavailable (0 pts) — Couldn't look up the registration of tee-shop.at (no RDAP server listed for .at). · No first certificate date either (crt.sh took too long). · tee-shop.at is not in the Tranco top 100,000 sites (list 746VX).
- **ssl_redirects**: pass (0 pts) — Valid HTTPS certificate. · Certificate issued by Let's Encrypt. · Certificate is 43 days old (auto-renewed certificates are often new, so this alone means little). · No redirects.
- **price**: unavailable (0 pts) — Not enough other trustworthy stores sell exactly "Sparkling Tea bio in Variationen" to compare prices.
- **ai_page**: fail (35 pts) — AI page analysis (OpenRouter, nvidia/nemotron-3.5-lightning:free): risk 55/100, 3 findings. · Copied or generic text (med, product): "Sparkling Tea bio - eine neue Kategorie in der Getränkewelt" · Unrealistic discounts (high, product): "Normaler Preis €23,30 €31,07/l inkl. MwSt. zzgl. Versandkosten" · Fake scarcity or urgency (med, product): "Mengenrabatt für diesen Tee 6-12 bestellen und 10% spar
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.

#### https://tauchversand.com/ — legit, HOLD (score 35)

- **domain_age**: pass (0 pts) — tauchversand.com was registered on 2000-02-09 (about 26 years ago). · Registrar: INWX GmbH. · tauchversand.com is not in the Tranco top 100,000 sites (list 746VX).
- **ssl_redirects**: pass (0 pts) — Valid HTTPS certificate. · Certificate issued by DigiCert Inc. · Certificate is 72 days old (auto-renewed certificates are often new, so this alone means little). · Redirects stay on tauchversand.com (1 hop).
- **price**: unavailable (0 pts) — Not enough other trustworthy stores sell exactly "Tauchen & Schnorcheln mit der passenden Tauchausrüstung \| Divestore" to compare prices.
- **ai_page**: fail (35 pts) — AI page analysis (OpenRouter, nvidia/nemotron-3.5-lightning:free): risk 65/100, 4 findings. · Company details inconsistent (high, legal): "Mailorder & Service GmbH" · Company details inconsistent (high, legal): "info@ws-billiger.de" · Unrealistic discounts (med, home): "nur 299,00 €* UVP 349,99 € *" · Fake scarcity or urgency (low, home): "Schnelle Lieferzeiten!"
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (2 addresses checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.

#### https://dieroester.at/ — legit, HOLD (score 0), hard rules: cant_verify

- **domain_age**: pass (0 pts) — Couldn't look up the registration of dieroester.at (no RDAP server listed for .at). · dieroester.at was first seen on 2015-07-14 (about 11 years ago): its first certificate in the public certificate logs (crt.sh). This is not the registration date; the domain may be older. · dieroester.at is not in the Tranco top 100,000 sites (list 746VX).
- **ssl_redirects**: pass (0 pts) — The browser accepted the HTTPS certificate, but our own check didn't (CERT_HAS_EXPIRED). · Certificate issued by catchall. · Certificate is 778 days old (auto-renewed certificates are often new, so this alone means little). · No redirects. · Couldn't verify this store: the store returned an error page (HTTP 500), so the cloud browser never saw the shop itself.
- **price**: unavailable (0 pts) — Couldn't read the store page: the store returned an error page (HTTP 500), so its price is unknown.
- **ai_page**: unavailable (0 pts) — Couldn't read the store page: the store returned an error page (HTTP 500). · No store page was read, so there was nothing to analyze.
- **threat_list**: pass (0 pts) — Not on Google Safe Browsing threat lists (1 address checked).
- **clone**: unavailable (0 pts) — No other stores to compare with.
- cloud browser error: the store returned an error page (HTTP 500)

## Excluded (0)


## All scored stores

| URL | Label | Verdict | Score | Hard rules | Scan time |
|---|---|---|---|---|---|
| https://www.rei.com/ | legit | SAFE | 0 | - | 14.6 s |
| https://www.johnlewis.com/ | legit | SAFE | 0 | - | 16.8 s |
| https://www.currys.co.uk/ | legit | HOLD | 0 | cant_verify | 6.7 s |
| https://bettenreiter.at/ | legit | SAFE | 15 | - | 17.9 s |
| https://bikepalast.com/ | legit | SAFE | 0 | - | 12.7 s |
| https://messerkoenig.at/ | legit | SAFE | 15 | - | 20.4 s |
| https://tee-shop.at/ | legit | HOLD | 35 | - | 25.2 s |
| https://tauchversand.com/ | legit | HOLD | 35 | - | 23.1 s |
| https://dieroester.at/ | legit | HOLD | 0 | cant_verify | 13.4 s |
| https://naehprinz.at/ | legit | SAFE | 0 | - | 11.4 s |
