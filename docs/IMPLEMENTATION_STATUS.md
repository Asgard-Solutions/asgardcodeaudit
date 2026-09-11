# Implementation status

Updated September 11, 2026.

## Current scope

Phase 1 foundation is implemented. The remaining immediate startup/shutdown race is corrected, the backend lockfile is delivered, the preview uses bounded same-origin requests, and the desktop/test dependencies have been updated and locked.

The code candidate `ba01bfadff10be35ba2aec002c28cb3b6dd01345` passed clean Windows and Linux validation, including actual Windows Electron launch, native folder-dialog selection/cancellation, project registration, process restart, navigation/reload, second-instance handling, and actual backend crash recovery. The real Chromium preview also booted and registered an approved fixture through a same-origin ingress.

See [PHASE1_COMPLETION.md](PHASE1_COMPLETION.md) for the test counts, F01-F09 evidence, and limitations. Final acceptance applies to a revision with a passing `Phase 1 validation` workflow; a future change is not covered merely because this document exists.

## Final merged verification

The merged application code at `acc787dca839ba4c714816db55eeadb7dcdaba46` passed the `Phase 1 validation` workflow on September 11, 2026:

https://github.com/Asgard-Solutions/asgardcodeaudit/actions/runs/34639760343

Both `foundation (windows-latest)` and `foundation (ubuntu-latest)` completed successfully. The Windows job also executed the documented PowerShell entrypoint, the actual native Electron scenarios, and the real Chromium preview. The logs identify the tested application revision as `acc787d` and record `NATIVE_WINDOWS_FOUNDATION_PASSED`, `REAL_PREVIEW_BROWSER_PASSED`, and `DESKTOP_BUILD_ISOLATION_PASSED`.

The desktop renderer output was checked to exclude the preview adapter and dev-session endpoint. All three delivered dependency locks were used by the validation workflow. This handoff update changes documentation only; use the workflow associated with its resulting revision to verify the final repository state.

| Phase | Status |
|---|---|
| 0: Design and decisions | Complete; historical records retained. |
| 1: Desktop foundation, SQLite, project registration | Implemented; merged-code Windows/Linux validation and actual native/browser evidence recorded. |
| 2: Snapshot/inventory | Not started. |
| 3: Rules/evidence/findings | Not started. |
| 4: Providers/LLM review | Not started. |
| 5: Prompts/history/reports | Not started. |
| 6: Backup/installer/release | Not started. |

## Verification boundaries

There are 99 passing automated cases per platform in the recorded run: backend 24, desktop Vitest 53, startup regressions 6, frontend Vitest 9, and preview regressions 7. Native/browser scenarios are additional. Their evidence is not interchangeable with unit tests. External hosted-preview pytest is excluded; Windows-only workflow steps are intentionally not run on Linux.

Windows-native evidence exists for the scenarios listed in the completion record. Blanket historical statements that all native execution is unverified are superseded only for those scenarios. The runner was Windows Server 2025, not Windows 11 or Jake's own Windows machine. A native startup-failure dialog and an exhaustive native frame/CSP attack matrix were not separately UI-automated. No installer, installed-app upgrade, signing, live provider connection, performance certification, or comprehensive security penetration test was performed.

The real preview browser was exercised against a test-owned same-origin ingress. The current hosted Emergent tenant and its ingress/access-control configuration were not independently tested. The app no longer uses a different deployment's backend hostname for preview session requests.

The passing workflow still reports non-failing dependency/configuration deprecation warnings. A green workflow is not a claim that every warning has been removed or that the application is universally defect-free.

## Delivery

The maintained Windows entrypoint is `scripts/start-desktop.ps1`. The three actual lockfiles are `backend/uv.lock`, `frontend/package-lock.json`, and `desktop/package-lock.json`. The normal workflow verifies the uv lock and uses frozen/clean installs. Tests write only isolated app/test data and synthetic fixtures, not registered user projects.

From the project root in PowerShell, run:

```powershell
.\scripts\start-desktop.ps1
```

Node.js 24 and uv must be available. The script prepares the Python 3.13 environment and builds the frontend and desktop from the delivered locks. This is the Phase 1 source-development launch path, not a self-contained installed application.

To run the automated suites and native synthetic smoke instead of the normal launch:

```powershell
.\scripts\start-desktop.ps1 -Validate
```

The native automation briefly focuses its own folder dialog and sends keyboard input; do not operate other applications during that automation.

## Historical records

The complete pre-takeover status, including its Phase 0 and successive correction-pass notes, remains preserved at:

https://github.com/Asgard-Solutions/asgardcodeaudit/blob/fb37575937cba8ec73c3bdcfc4de7bada5340a65/docs/IMPLEMENTATION_STATUS.md

Its old dates, missing-delivery claims, and modeled-test claims are historical, not the current acceptance record. Existing decision logs are unchanged; the current completion record documents the tested dependency versions and scope.


---

## Phase 2 — safe snapshot + real inventory (IN PROGRESS, 2026-09-11)

Phase 2 is built in the four bounded increments from the handoff. **This pass
delivers Increment 1 only (schema + scope + bounded capture + provenance), fully
tested on the backend. Increments 2–4 are NOT implemented yet, so the end-to-end
inventory journey and several D-items are not yet demonstrable. Phase 2 is NOT
complete.**

### Increment 1 — delivered + verified (backend, Python 3.13)
- **Schema/migration** `backend/migrations/versions/0003_phase2_inventory.py` +
  ORM in `backend/app/storage/models.py`: `project_components`, `snapshots`,
  `snapshot_files`, `audits`, `audit_events`, `audit_steps`, `inventory_facts`.
  UUID-hex ids, UTC ISO timestamps, FKs, indexed relations, unique `(audit_id, seq)`.
  Verified `alembic upgrade head` stacks on `0002` and preserves
  `projects`/`project_settings`/`app_meta` (no reseed); `alembic_version=0003`.
- **Scope** `backend/app/inventory/scope.py`: roots resolved from the project
  record (never an arbitrary path), canonicalized via Phase 1 `pathcheck`; default
  + credential + user exclusions via `pathspec` (`gitignore`); `within_root()`
  re-checks realpath at open time (symlink/junction escape refused); unvalidated
  associated roots dropped.
- **Bounded capture** `backend/app/inventory/capture.py`: permitted text bytes
  copied into an app-owned dir under `snapshots_dir` (outside every root) and those
  bytes are recorded (not the live dir); per-file sha256/size/encoding/reason;
  binary/oversized/excluded accounting; file-count + aggregate-byte + per-file
  limits → **Partial**; post-copy re-hash → **inconsistent/Partial**; never copies
  credential/excluded files; no target execution.
- **Optional provenance** `backend/app/inventory/provenance.py`: read-only `git`
  via absolute path + sanitized no-network/no-hook/no-pager env; ordinary folders
  return None (no fabricated revision).
- **Dependency:** added `pathspec>=1.1.1`; `backend/uv.lock` updated (34 pkgs),
  recorded in `backend/pyproject.toml`.

### Increment 1 evidence (executed 2026-09-11, Python 3.13.15 via uv `--frozen`)
`env -u VIRTUAL_ENV uv run --frozen --group test --python 3.13 python -m pytest tests/ --ignore=tests/test_external_preview.py`
→ **30 passed / 0 failed / 0 skipped** (24 Phase 1 regressions retained + 6 new
`tests/test_snapshot_capture.py`). Desktop vitest baseline **53 passed** (Node 24.21.0).
Backend healthy after restart (handshake 200).

### D01–D12 status after Increment 1
| ID | Status | Note |
|---|---|---|
| D01 Python/JS manifests+syntax | **Not implemented** | Increment 2 (parsers) |
| D02 C#/PowerShell/WiX metadata | **Not implemented** | Increment 2 |
| D03 unsupported-language inventory | **Not implemented** | Increment 2 |
| D04 versioned vs ordinary provenance | **Partial** | ordinary-folder no-fabricated-revision tested; versioned real-metadata + native pending |
| D05 source unchanged after audit | **Pass (Linux)** | `test_capture_hashes_and_source_unmutated_and_no_execution` |
| D06 symlink/junction/traversal no escape | **Pass (Linux symlink)** | `test_symlink_escape_not_captured` + `within_root`; Windows junction pending |
| D07 changing file → inconsistent/Partial | **Pass** | `test_changing_file_marks_inconsistent_partial` |
| D08 excluded/unreadable/oversized/limit → Partial | **Pass** | `test_excluded_credentials_and_oversized`, `test_aggregate_limit_yields_partial` |
| D09 space-path full journey (Windows) | **Open (native)** | needs Increments 2–4 + Windows |
| D10 cancel/termination → Cancelled/Interrupted | **Not implemented** | Increment 3 |
| D11 malformed JSON/YAML/XML bounded | **Not implemented** | Increment 2 (defusedxml/PyYAML) |
| D12 target config not executed | **Pass** | tripwire `setup.py`/`postinstall` not run |

### Remaining increments (not started)
2. Deterministic indexing/parsers (stdlib `ast`, Tree-sitter JS/TS, `PyYAML`,
   `defusedxml`) → persisted `inventory_facts` w/ per-file+hash evidence → D01,D02,D03,D11.
3. Persistent job queue + progress/events + cancellation + interrupted recovery
   (Queued→Snapshotting→Indexing→Completed/Partial/Cancelled/Failed/Interrupted) → D10.
4. UI Inventory workflow + `/api/v1` endpoints (`/projects/{id}/inventory`,
   `/audits`, `/audits/{id}`, `/audits/{id}/events`) + desktop allow-list ops +
   close/reopen journey → D01–D12 completion incl. D09 native.

### Reproducible validation (Increment 1)
```
cd /app/backend
env -u VIRTUAL_ENV uv run --frozen --group test --python 3.13 python -m pytest tests/test_snapshot_capture.py -v
# cleanup after any uv run (avoids uvicorn --reload storm):
rm -rf /app/backend/.venv /app/backend/asgard_codeaudit_backend.egg-info && sudo supervisorctl restart backend
```
