# CHANGES-ashura — dsh-workspace (Ashura fork)

Delta ledger for the Ashura fork of `Hakunm/dsh-workspace` (server-side remote
plugin + bundled Kotlin SDK). Each entry records phase / date / upstream-SHA /
reason so Ashura-specific changes stay separable from upstream.

## Provenance

- Upstream: `Hakunm/dsh-workspace` (AGPL-3.0), default branch `main`.
- Upstream pinned HEAD (at fork): `4c6b1fa` — "Release v1.0.0".
- Local fork `origin`: `gitronnie/dsh-workspace`.
- License file: `LICENSE` (GNU AGPL v3, 2007) at repo root. Fork is AGPL-3.0-derived;
  Ashura-specific reuse is under the AGPL, per operator decision GO fork-and-extend
  (no clean-room).
- NOTE: through M0′/M2a′/server-prep the fork adds DOCUMENTATION only (this ledger and
  `ENABLE-REMOTE.md`) plus product-source changes in the app fork; it performs NO
  dsh-workspace product-source change, NO server-plugin install into any profile, and NO
  bind/enable of remote access. Server-side DSH-workspace source deltas and any live
  install/enable are later checkpoints and stay operator-performed + supervised.

## Log

_(Entries appended below as changes land.)_

### 000 — initial fork hygiene (2026-09)

- Fork + clone upstream into `~/sources/dsh-workspace`; added this ledger.
- No product-source changes in this entry.

### 001 — M2a′ dependency/CVE scan (2026-09) — no upstream fork source change

- Ran `pnpm install --frozen-lockfile` from upstream `pnpm-lock.yaml` and captured the
  ORIGINAL, untuned `pnpm audit` report against the declared deps (incl. `ws`).
- Result: **1 finding, severity moderate, dev-tooling only** — `yaml` (transitive via
  `vitest` → `@vitest/mocker` → `vite` → `yaml`; the repo also pins a direct devDep
  `yaml 2.8.1`, below the patched `>=2.8.3`). Advisory GHSA-48c2-rrv3-qjmp (Stack
  Overflow via deeply nested YAML collections). **Not reachable** in the shipped plugin
  runtime: it is a build/test-time devDependency, absent from the `dependencies` set that
  the remote listener ships. No High/Critical REACHABLE finding.
- `ws` resolves `8.21.3` (declared `^8.18.0`) — **no advisory flagged**, matches the
  current line.
- This checkpoint performs NO dsh-workspace product-source change, NO server-plugin
  install/enable, and NO bind (those are a later checkpoint).

Origin (audit report, unmodified): captured 2026-09; 1 moderate (yaml devDep), exit code 1.

### 002 — server/remote-access PREP only (2026-09) — ENABLE-REMOTE.md + loopback round-trip

Upstream-SHA-baseline (this fork, unchanged source): `4c6b1fa`.

What was NOT done (hard stop honored): no install into any live `~/.dsh` profile, no
`dsh plugin add` against the real profile, no enable of remote access, no bind wider than
loopback, no mutation of `~/.dsh/profiles/web/cordis.patch.yml` or ashura-harness
governance/persona. No product-source change in this fork.

Added: `ENABLE-REMOTE.md` at fork root — the operator-exact enable procedure. Decisions it
bakes in (verified against this fork's source):
- The plugin's own `http`+`ws` `/api/v1` listener (independent of DSH private wire) defaults
  remote target `0.0.0.0:3090`, but `RemoteApiServer.start()` binds the **loopback** address
  while remote access is disabled (`src/host/server.ts` `remote_enabled` gate) and only
  `enable()` widens the bind. Ashura doctrine: keep it configured to `127.0.0.1` and never
  point `0.0.0.0`/a LAN IP directly.
- **F2 is real and was demonstrated live**: `requireAdmin` (`src/host/auth.ts`) passes when
  (a) the TCP peer is loopback AND (b) `Origin` is absent OR a loopback hostname
  (`isLoopbackOrigin(undefined) === true`). Empirically `GET /manage/status` with **no Origin**
  over loopback returned **200** (admin granted), while an untrusted Origin returned **403**.
  A same-host reverse proxy would therefore make remote requests *look* like loopback admin —
  so `ENABLE-REMOTE.md` makes the **TLS reverse proxy the real per-request client-auth
  boundary** (Caddy `basic_auth` on `/manage*`, upstream `127.0.0.1:3090`; Nginx mTLS variant
  given). The proxy is the only net-exposed listener; the phone URL points only at it.
- Supplies the one-line unauthenticated-rejection `curl` (expect 401) the operator runs before
  pairing any phone, the exact `dsh plugin --profile web add <tgz>` + pairing/enable curl
  sequence, the loopback-only bind doctrine, and the explicit STOP-before-first-real-bind line.

Loopback round-trip readiness proof (teared down, nothing enabled): ran the repo's own
`scripts/test-server.ts` (isolated throwaway temp `DSH_HOME`-style state + stubbed DSH api;
binds `127.0.0.1:<ephemeral>` only) via `tsx`, then exercised the `/api/v1` + `/manage`
contract with curl:
- `GET /api/v1/healthz` → 200 `{"ok":true,"version":"v1","pluginVersion":"1.0.0"}`.
- `/manage` admin gate: no-Origin over loopback → 200 (admin); untrusted Origin → **403**
  (proves the F2 vector / why proxy auth is mandatory).
- `POST /manage/roots` path boundary held (nonexistent/absolute path rejected
  `ROOT_INVALID` / `PATH_INVALID`).
- `POST /manage/pairings` → 10-minute code; `POST /api/v1/pairings/exchange` → 256-bit
  Bearer + scoped device; `GET /api/v1/devices/self` + `GET /api/v1/roots` honored the
  single-root `chat.read`,`files.read` grant; authenticated file browse worked and the
  `?path=/` absolute form was rejected.
- `DELETE /manage/devices/{id}` (revoke) then the same token → **401** immediately.
- Teardown: `TERM` the test server; verified via `lsof` **no listener on the port**, no
  orphaned process. Nothing enabled, nothing bound beyond loopback.
Honest limit: chat/approvals/settings used the harness's stubbed DSH api, so this proves the
plugin's **wire/auth/file contract** against real server code, not live session orchestration
against a real harness host (that requires plugin install into a real web profile — M1a, the
next operator checkpoint).

