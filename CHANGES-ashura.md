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
- NOTE: this checkpoint (M0′/M2a′) makes NO changes to dsh-workspace product source
  and performs NO server-plugin install/enable, no bind. Server-side Ashura deltas
  are a later checkpoint.

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
