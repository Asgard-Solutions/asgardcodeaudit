# Implementation status

Updated September 11, 2026.

## Current scope

Phase 1 foundation is implemented. The remaining immediate startup/shutdown race is corrected, the backend lockfile is delivered, the preview uses bounded same-origin requests, and the desktop/test dependencies have been updated and locked.

The code candidate `ba01bfadff10be35ba2aec002c28cb3b6dd01345` passed clean Windows and Linux validation, including actual Windows Electron launch, native folder-dialog selection/cancellation, project registration, process restart, navigation/reload, second-instance handling, and actual backend crash recovery. The real Chromium preview also booted and registered an approved fixture through a same-origin ingress.

See [PHASE1_COMPLETION.md](PHASE1_COMPLETION.md) for the exact run, test counts, F01-F09 evidence, and limitations. Final acceptance applies to a revision with a passing `Phase 1 validation` workflow; a future change is not covered merely because this document exists.

| Phase | Status |
|---|---|
| 0: Design and decisions | Complete; historical records retained. |
| 1: Desktop foundation, SQLite, project registration | Implemented; Windows/Linux automated and actual native/browser evidence recorded. |
| 2: Snapshot/inventory | Not started. |
| 3: Rules/evidence/findings | Not started. |
| 4: Providers/LLM review | Not started. |
| 5: Prompts/history/reports | Not started. |
| 6: Backup/installer/release | Not started. |

## Verification boundaries

There are 99 passing automated cases per platform in the recorded run: backend 24, desktop Vitest 53, startup regressions 6, frontend Vitest 9, and preview regressions 7. Native/browser scenarios are additional. Their evidence is not interchangeable with unit tests.

Windows-native evidence now exists for the scenarios listed in the completion record. Blanket historical statements that all native execution is unverified are superseded only for those scenarios. The runner was Windows Server 2025, not Jake's own Windows machine. No installer, installed-app upgrade, signing, live provider connection, performance certification, or comprehensive security penetration test was performed.

The real preview browser was exercised against a test-owned same-origin ingress. The current hosted Emergent tenant and its ingress/access-control configuration were not independently tested. The app no longer uses a different deployment's backend hostname for preview session requests.

## Delivery

The maintained Windows entrypoint is `scripts/start-desktop.ps1`. The three actual lockfiles are `backend/uv.lock`, `frontend/package-lock.json`, and `desktop/package-lock.json`. The normal workflow verifies the uv lock and uses frozen/clean installs. Tests write only isolated app/test data and synthetic fixtures, not registered user projects.

## Historical records

The complete pre-takeover status, including its Phase 0 and successive correction-pass notes, remains preserved at:

https://github.com/Asgard-Solutions/asgardcodeaudit/blob/fb37575937cba8ec73c3bdcfc4de7bada5340a65/docs/IMPLEMENTATION_STATUS.md

Its old dates, missing-delivery claims, and modeled-test claims are historical, not the current acceptance record. Existing decision logs are unchanged; the current completion record documents the tested dependency versions and scope.
