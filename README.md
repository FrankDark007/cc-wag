# Project Atlas / cc-wag

## What this is

Node.js daemon bridging WhatsApp and the Claude Agent SDK. Built for Frank Darakhshan, President of Flood Doctor LLC (water-damage restoration, Northern Virginia / DC / Maryland). Atlas runs 24/7 on a Mac Mini, processing WhatsApp messages prefixed with `Atlas,` and responding via Claude with access to email, calendar, Drive, tasks, shell commands, and 44 domain-specific plugin features.

## Current production status

- **Feature-complete** plugin system: 44 feature files under `src/features/`
- **Twilio** is the production WhatsApp adapter (`WHATSAPP_ADAPTER=twilio`)
- **Baileys** is legacy/sandbox (WhatsApp Web reverse-engineered client)
- **88 tests** passing across 7 test files (vitest)
- **Production blocker:** Meta WhatsApp Business Sender registration not yet submitted. Twilio Senders array is empty. Requires Frank to complete Facebook OAuth (not delegatable to AI). See `.planning/META-WHATSAPP-SUBMISSION.md`.
- **Security debt:** 4 credentials were exposed in a prior session context. Must be rotated on the vendor dashboards and in `.env` on the production machine.

## Deployment target

Atlas runs on **mini2** (Mac Mini M4, user `ghost2`). The repo can be cloned anywhere — all runtime paths are machine-agnostic.

## Path policy

- **Repo root** is derived automatically from `import.meta.url` in `src/config.js`.
- **`ATLAS_PROJECT_ROOT`** env var overrides the auto-detected root if set.
- **Do not hardcode** `/Users/ghost/` or `/Users/ghost2/` in runtime code or scripts.
- **`config/launchd/*.plist`** files are deployment templates — replace absolute paths with the current machine's repo path before installing.
- **Shell scripts** derive their own root via `SCRIPT_DIR` + `ATLAS_PROJECT_ROOT` fallback.

## First commands for a new agent

```bash
pwd
git branch --show-current
git status --short
node --version    # must be >= 22
npm --version
npm test          # must show 0 failures
```

## Handoff

Full project context, architecture, feature inventory, priorities, and operational runbook:

```
.planning/GPT-5.5-HANDOFF.md
```

Additional planning docs:
- `.planning/META-WHATSAPP-SENDER-GUIDE.md` — **Operator guide** for Frank to register the WhatsApp sender (P0 blocker)
- `.planning/META-WHATSAPP-SUBMISSION.md` — Technical playbook for the sender registration
- `.planning/ATLAS-EVOLUTION-ROADMAP.md` — Current forward-looking roadmap (supersedes stale master roadmap)
- `.planning/ATLAS-MASTER-ROADMAP.md` — Original phase roadmap (historical, Phases 1-6 shipped)
- `.claude/CLAUDE.md` — Architecture notes and design decisions

## Non-negotiable rules

1. **Work on `main` only.** Do not create branches unless Frank explicitly asks.
2. **One logical change = one immediate commit.** Never batch, never leave uncommitted work.
3. **Never commit `.env` or secrets.** `.env` is gitignored. Never `cat .env`, never read `.env` with the Read tool.
4. **Use `grep -c` or `grep -l` only** when checking for secret presence. Never print secret values.
5. **Read files before editing.**
6. **Plugin isolation:** `src/features/` files must not import from each other. Each feature exports `register(gateway)` and is independently removable.
7. **Node >= 22**, ESM only, `.js` import extensions required.
8. **Machine-agnostic paths.** Never hardcode `/Users/ghost/` or `/Users/ghost2/`. Use `config.paths.*` or script `$PROJECT_ROOT`.
9. **Never claim done without verification.** Build passes, tests green, imports resolve.

## Verification checklist

```bash
# Tests
npm test

# Architecture — all four must return empty (no cross-feature imports)
grep -R "from './" src/features/ 2>/dev/null || true
grep -R "from \"./" src/features/ 2>/dev/null || true
grep -R "from '../features" src/ 2>/dev/null || true
grep -R "from \"../features" src/ 2>/dev/null || true

# Clean working tree
git status --short
```

## Current next priorities

1. **Meta WhatsApp Business Sender registration** — walk Frank through Twilio Embedded Signup
2. **Submit 3 Twilio message templates** (briefing, lead alert, adjuster followup)
3. **Wire Twilio inbound webhook** once Sender is ONLINE
4. **End-to-end WhatsApp test** — round-trip in <15s
5. **Credential rotation** — rotate ANTHROPIC_API_KEY, TWILIO_AUTH_TOKEN, COMPANYCAM_API_TOKEN, GATEWAY_API_TOKEN on vendor dashboards and production `.env`
