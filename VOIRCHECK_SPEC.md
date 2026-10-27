# VoirCheck — Master Spec

> Single source of truth for the PayPal AI Hackathon build. Claude Code builds from this file.
> Status legend: ✅ locked · 🟡 proposed · ⬜ open

## 0. Hackathon facts ✅
- Event: PayPal AI Hackathon (Devpost)
- Deadline: **Nov 12, 2026, 12:00pm PT (3:00pm ET)**
- Judging: Dec 1–15, 2026 → demo must stay live through Dec 15
- Must: meaningful PayPal (sandbox) + meaningful AI, working demo, public open-source repo (license visible), YouTube video < 3 min, English
- Judging criteria (equal weight): Technological Implementation (tie-breaker), Design, Potential Impact, Innovation, Presentation
- Max winnings: 1 Grand OR 1 Honorable Mention + 1 Sponsor prize

## 1. Identity
- Name: **VoirCheck** ✅ (French *voir* = to see + check)
- Tagline: 🟡 "VoirCheck — your AI agent sees who it's paying, before it pays."
- One-liner: 🟡 An AI shopping agent that scam-checks a store with GhostCheck before a PayPal payment is captured; risky stores get the authorization voided, with the evidence shown.
- Repo: 🟡 `voircheck` (private until submission, then public + MIT)

## 2. Prize targets ✅
| Category | How we qualify |
|---|---|
| 1st/2nd/3rd | Complete polished end-to-end product |
| Best Use of PayPal + AI | Orders v2 authorize/capture/void, webhooks, Agent Toolkit or MCP |
| Best Use of Agentic Commerce | Agent actually transacts |
| Most Impactful | Named audience, real scam-loss data, French language support |
| Most Creative | Signature element (e.g., shareable "Trust Receipt") |
| Best Demo Delivery | Scripted, edited video planned early |
| Sponsor: Channel3 | Core product search (default) |
| Sponsor: Render | Hosting (default) |
| Sponsor: AG Grid | Stretch only — build only if core works by ~Nov 6 |

## 3. Resources & accounts
| Item | Purpose | Status |
|---|---|---|
| GitHub repo | Code | ⬜ |
| PayPal Developer sandbox app + business & personal sandbox accounts | Payments | ⬜ |
| Supabase project | DB + audit log | ⬜ |
| Anthropic / Gemini keys | AI | ⬜ |
| Channel3 key (promo `PAYPAL-HACKATHON-2026`, 20k credits) | Product search | ⬜ |
| KERNEL ($50 credits via sponsor page) | Cloud browser for store scans, live view/replay | ⬜ |
| Render ($50 credits via sponsor page) | Hosting | ⬜ |
| PayPal Discord | Support | ⬜ |
| YouTube channel | Demo video | ⬜ |
| AG Grid 45-day trial | Stretch only — don't start yet | ⬜ |

## 4. Hard constraints ✅
- Demo scam store = **fictional brand, clearly labeled as a demo**, never imitating a real retailer.
- No "PayPal" in product name/branding; no third-party trademarks or unlicensed music in video.
- Sandbox credentials only in repo docs; no production keys committed; judge AI key gets a spend cap.
- Core flow finished before any extras.

## 5. Pieces (to be filled in order)
1. ⬜ Demo story (3-min) & demo user
2. ⬜ Persona
3. ⬜ Agent flow
4. ⬜ Product search (Channel3)
5. ⬜ Store scan (GhostCheck + KERNEL)
6. ⬜ Risk rules (allow / hold / block, user override)
7. ⬜ PayPal flow (authorize, capture, void, webhooks)
8. ⬜ Demo stores (1 legit, 1 scam — fictional)
9. ⬜ Data model (Supabase, audit log)
10. ⬜ Login / judge access
11. ⬜ Screens & layout
12. ⬜ Design system (fonts, colors, logo, tone)
13. ⬜ AI models & prompts
14. ⬜ Sponsor integration
15. ⬜ Tech stack & repo structure
16. ⬜ Hosting & uptime through Dec 15
17. ⬜ Security
18. ⬜ Testing & failure cases
19. ⬜ README, license, judge instructions
20. ⬜ Video script & Devpost submission
21. ⬜ Day-by-day timeline

## 6. Decision log
- 2026-10-27 — Idea locked: AI agent scam-checks store before PayPal capture (GhostCheck). West Africa mobile-money idea parked.
- 2026-10-27 — Name locked: VoirCheck.
- 2026-10-27 — AG Grid = stretch goal only.
