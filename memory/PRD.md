# Asgard CodeAudit — PRD / Working Memory

## Original problem statement
Build a Windows desktop tool (working name **Asgard CodeAudit**) that opens local projects, collects evidence, applies supported engineering checks, optionally uses OpenAI or LM Studio for bounded analysis, and generates focused prompts for external coding tools. v1 is **read-only** wrt audited source. Delivered as an Electron + React desktop app with a bundled local FastAPI backend and local **SQLite** storage. Handoff is phased (Phase 0 → 6); each phase authorized separately.

Full reference: `Asgard_CodeAudit_Complete_Reference.md` (six original docs) — content mirrored into `docs/DECISIONS.md` and `docs/IMPLEMENTATION_STATUS.md`.

## User persona
"Jake" — manages several software projects, uses AI coding tools, needs evidence-backed audits and focused investigation/repair prompts, and must distinguish demonstrated problems from unverified concerns.

## User-approved decisions (static)
- **UD-2:** This iteration = **Phase 0 planning only**. No scaffold/features/credentials/paid calls. Stop for review.
- **UD-3:** Deliverable stays a Windows Electron desktop app + bundled FastAPI + SQLite. Web preview = dev harness only, behind adapters. Desktop foundation (Electron/preload/native picker/backend lifecycle/security) is Phase 1, not deferred. Synthetic fixtures scanned by the real backend; no fabricated findings. Windows/LAN/install remain unverified gates.
- **UD-4:** SQLite + SQLAlchemy + Alembic in both preview and desktop. No MongoDB, no dual DBs, no later conversion.
- **UD-5:** Static audit first, no LLM. Later: OpenAI (user's own key, official SDK) + LM Studio (configurable endpoint; host 192.168.1.100, port unconfirmed). NOT Emergent Universal Key. No auto-fallback LM Studio→OpenAI. No LAN tunnel from preview.
- **UD-6:** v1 read-only boundary: app writes only its own DB/snapshots/reports/exports.

## Architecture (target)
Electron (sandboxed renderer + narrow typed preload) → validated IPC → authenticated 127.0.0.1 loopback FastAPI (per-launch pipe secret) → SQLite (backend-only). React 19 + TS + Vite + Tailwind + shadcn/ui. Two runtime modes (desktop/preview) behind one typed transport contract. PyInstaller (Windows) + electron-builder/NSIS packaging.

## Environment facts (preview, measured June 2026)
Linux **aarch64**; Python 3.11.16; SQLite 3.40.1; Node 20.20.2; npm 10.8.2 / yarn 1.22.22; Git 2.39.5; **no** OS credential store; gitleaks/osv-scanner **not installed**.

## What's been implemented / delivered
- **2026-06 — Phase 0 planning:** `docs/DECISIONS.md` (approved decisions, architecture, preview adapters, contradictions C-1..C-9, dependency/version assessment, testability matrix, open questions) and `docs/IMPLEMENTATION_STATUS.md` (phase status, repo layout, interface definitions, Phase 1 task/test plan T1–T9 with acceptance mapping F01–F09, verification gates). **No code, deps, credentials, or builds.**

## Open verification gates (Not verified until exercised)
G-1 IPC/renderer isolation · G-2 loopback+pipe secret+single-instance · G-3 native folder picker · G-4 PyInstaller Windows sidecar · G-5 Windows credential store · G-6 NSIS installer/clean-machine/upgrade/uninstall · G-7 Windows build runner (preview is Linux aarch64) · G-8 live LM Studio LAN · G-9 live OpenAI · G-10 code signing · G-11 measured performance.

## Backlog (phase-gated; each needs explicit approval)
- **P1:** desktop foundation, SQLite, project registration (tasks T1–T9).
- **P2:** safe snapshot + real inventory.
- **P3:** rules, evidence, findings.
- **P4:** OpenAI + LM Studio providers.
- **P5:** Prompt Studio, comparison, evidence exchange.
- **P6:** backup/restore, Windows installer, release validation, SBOMs.

## Next task
Await user approval of Phase 0. On approval, send the Phase 1 prompt from `04_PHASE_PROMPTS.md` and begin only Phase 1 outcomes.
