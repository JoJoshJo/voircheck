# AI page analysis: claude-haiku-5-5 vs claude-sonnet-5-5 (tune, prompt v2, 2026-11-01)

Same captured input for every model. Risk 0–100; "unavailable" = the answer was rejected or the call failed.

| URL | Label | claude-haiku-5-5 | claude-sonnet-5-5 | Findings (claude-sonnet-5-5) |
|---|---|---|---|---|
| https://steadyhandtooling.com/ | scam | 82 | 88 | unrealistic_discounts, unrealistic_discounts, missing_legal_info, company_details_inconsistent, copied_or_generic_text, copied_or_generic_text, language_mismatch |
| https://rimowa-store.de/ | scam | 12 | 82 | payment_red_flags, company_details_inconsistent, company_details_inconsistent, company_details_inconsistent, copied_or_generic_text, unrealistic_discounts |
| https://messtool.com/ | scam | 35 | 58 | missing_legal_info, copied_or_generic_text, unrealistic_discounts, payment_red_flags, company_details_inconsistent, copied_or_generic_text |
| https://missmodaberlin.de/ | scam | 22 | 58 | unrealistic_discounts, missing_legal_info, company_details_inconsistent, copied_or_generic_text, language_mismatch |
| https://heizungug.de/ | scam | 35 | 50 | copied_or_generic_text, fake_scarcity_urgency, copied_or_generic_text, unrealistic_discounts, company_details_inconsistent, payment_red_flags |
| https://kinderschatz.com/ | scam | 35 | 30 | payment_red_flags, company_details_inconsistent, missing_legal_info, language_mismatch, copied_or_generic_text |
| https://bikepalast.com/ | legit | 30 | 8 | unrealistic_discounts, unrealistic_discounts |
| https://messerkoenig.at/ | legit | 8 | 4 | - |
| https://www.rei.com/ | legit | 6 | 3 | - |
| https://www.johnlewis.com/ | legit | 5 | 3 | - |
| https://www.currys.co.uk/ | legit | 12 | 3 | - |
| https://bettenreiter.at/ | legit | 8 | 3 | - |
| https://mall.elvaritaro.com/ | scam | - | - | dead (unreachable: ENOTFOUND) |
| https://pureshoerack.com/ | scam | unavailable | unavailable | - |
| https://scandiwarm.com/ | scam | - | - | dead (unreachable: ENOTFOUND) |
| https://werkstatt-teile.com/ | scam | - | - | no page read (blocked / error page) |
| https://tee-shop.at/ | legit | - | - | no page read (blocked / error page) |
| https://tauchversand.com/ | legit | - | - | dead (unreachable: UND_ERR_CONNECT_TIMEOUT) |
| https://dieroester.at/ | legit | - | - | dead (unreachable: ENOTFOUND) |
| https://naehprinz.at/ | legit | - | - | dead (unreachable: ENOTFOUND) |

- claude-haiku-5-5: 13 calls, $0.0139 total, $0.0011 per store.
- claude-sonnet-5-5: 13 calls, $0.2793 total, $0.0215 per store.
