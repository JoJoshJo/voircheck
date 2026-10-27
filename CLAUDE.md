# VoirCheck — instructions for Claude Code
- Every session and every prompt starts with the REPO CHECK: pwd && git remote -v && git branch --show-current && git status --short. Path must be ~/Desktop/voircheck, remote JoJoshJo/voircheck. If not, STOP.
- Re-run the REPO CHECK before every commit and push.
- VOIRCHECK_SPEC.md is the single source of truth. Read it before any task.
- Only build pieces marked ✅ locked. Never build 🟡 proposed or ⬜ open items without asking.
- Never commit secrets. Keys go in .env (gitignored); keep .env.example with placeholder names only.
- PayPal = sandbox only. Never use live credentials.
- Demo scam store must be a fictional brand, clearly labeled as a demo; never imitate a real retailer.
- Small commits, clear messages.
