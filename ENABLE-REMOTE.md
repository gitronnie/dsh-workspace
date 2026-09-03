# ENABLE-REMOTE.md — Enabling remote/mobile access to the Ashura harness (DSH-workspace listener)

**Operate from this document only.** It is the single, concrete, copy-pastable enable
procedure for making the Ashura `web` profile reachable from a phone — with the **TLS
reverse proxy as the real per-request authentication boundary**, per Ashura PRD §5.8 and the
security brief finding F2. Everything below is verified against this fork's source
(`src/host/server.ts`, `src/host/router.ts`, `src/host/auth.ts`,
`docs/project/API.md`) and the Ashura reuse brief.

> [!IMPORTANT]
> This is the operator-performed, **supervised, partially-irreversible** step: it turns a
> local agent into a device-reachable control surface. Do all of it; do not skip the proxy
> step, do not bind the plugin to anything but loopback, do not pair a phone before the
> rejection proof passes. If any command fails, STOP and diagnose before proceeding.

---

## 0. Topology you are building (do not deviate)

```
  Phone (HTTPS only)
     │  wss/https  →  https://ashura.example.tld   (your DNS name / tunnel host)
     ▼
  ┌─────────────── THE ONLY NET-EXPOSED LISTENER ───────────────┐
  │  caddy (or nginx) reverse proxy                              │
  │    • terminates TLS                                          │
  │    • performs REAL per-request client auth  ★ THE BOUNDARY ★│
  │      — reverse_proxy auth on /manage* (unauthenticated 4xx)  │
  │      — pairing + api require bearer token / origin check     │
  └───────────────────────────┬──────────────────────────────────┘
                             │  loopback only (127.0.0.1:3090)
                             ▼
  ┌─────────────── plugin listener (dsh-workspace RemoteApiServer)─────────┐
  │  bound to 127.0.0.1 ONLY — never 0.0.0.0, never a LAN IP               │
  │  /api/v1 (REST+WS) owned http+ws listener, DEFAULT target 0.0.0.0:3090 │
  │  DEFAULT bind when remote DISABLED = 127.0.0.1 (loopback, enforced in  │
  │  src/host/server.ts start(): remoteEnabled false → loopbackFor(host))  │
  └──────────────────────────────────────────────────────────────────────────┘
```

Why the proxy is mandatory (security-brief F2): the plugin's `/manage/*` admin surface
(`requireAdmin`, `src/host/auth.ts`) authenticates by **TCP peer is loopback** + a
loopback `Origin`. A same-host proxy on 127.0.0.1 therefore makes *every* forwarded request
look loopback to the plugin, and `Origin` is client-controlled, so the fence would silently
collapse unless the proxy itself rejects anything without real client auth. Rule: **the
proxy is the only thing a phone may talk to, and it refuses requesters it cannot vouch for
— then the plugin's normal pairing/token/scope model applies to the authenticated proxy
client.**

---

## 1. Build the installable bundle (no live-profile mutation here)

From this fork root. Produces a publish-grade tarball without touching any running profile:

```sh
cd ~/sources/dsh-workspace
pnpm install --frozen-lockfile   # resolves the pinned lockfile
pnpm pack                        # creates ./dsh-workspace-1.0.0.tgz
ls -l dsh-workspace-1.0.0.tgz
```

`pnpm pack` emits the package described by `package.json` `files` (`lib/`, `assets/`,
`docs/api`, `kotlin-sdk/…`, `cordis.patch.yml`, README, LICENSE). `cordis.patch.yml` is the
DSH **bundle patch-layer** that `dsh plugin add` applies to the `web` profile — it inserts a
Host row and wires the workspace plugin. Do not hand-copy files; install the tarball.

## 2. Install into the `web` profile (NOT this checkpoint) — the exact future command

The install must go into the live `web` profile and be followed by a WebUI restart to load
the plugin. That is an enablement action and is **NOT performed in this prep checkpoint**;
the operator runs it at the supervised bind step (§6):

```sh
cd ~/sources/dsh-workspace
dsh plugin --profile web add ./dsh-workspace-1.0.0.tgz
# then restart DSH WebUI so the Host row is loaded and the plugin's embedded route is live.
```

Verify the load point (equivalent of the repo's own `scripts/smoke-profile-install.ts`,
but against an **isolated throwaway DSH_HOME**, never the real one):

```sh
export DSH_HOME=/tmp/daw-profile-smoke-$$ ; mkdir -p "$DSH_HOME"
DSH_HOME="$DSH_HOME" dsh plugin --profile web add ./dsh-workspace-1.0.0.tgz
DSH_HOME="$DSH_HOME" dsh web --dump-config | grep -c 'name: dsh-workspace'   # expect >=1
rm -rf "$DSH_HOME"   # fully torn down; nothing left running, nothing in the real profile
```

## 3. The plugin listener contract (what you will bind)

- Own `http` + `ws` `/api/v1` listener (NOT the DSH browser `/api`; documented as independent
  of DSH private wire). REST base `http://HOST:PORT/api/v1`; WS `.../api/v1/events`.
- **DEFAULT remote target `0.0.0.0:3090`** (both configurable in listener settings). But the
  plugin **binds 127.0.0.1 until a local admin enables remote access** (`remote_enabled`);
  this is read from persisted state at start (`src/host/server.ts:59-69`): if
  remote_enabled is false it binds `loopbackFor(configuredHost)` (127.0.0.1 or ::1); if the
  requested host fails it forces the loopback fallback. Only `enable()` flips it to the
  configured host.
- Requests needing a **Bearer device token**: everything except `GET /healthz` and
  `POST /api/v1/pairings/exchange`.
- Local-admin operations live under `/manage/*` (`addRoot`, `/devices`+/grants,
  `POST /manage/pairings`, `/remote/enable|disable`, `PUT /remote/listener`, `/audit`,
  trash purge) and are enforced loopback-only by `requireAdmin`.
- Errors: `{"error":{"code","message","requestId"}}`.

**Your bind doctrine (non-negotiable for Ashura):** configure the listener host to
`127.0.0.1` on a fixed local port (use 3090 to match the app's default hint for now) and
**keep remote_enabled = false until the proxy is up and armed**. Bring remote access up by
reaching the plugin over loopback through the proxy, not by widening the bind.

## 4. The proxy — concrete mechanism chosen: **Caddy** (reverse-proxy TLS + per-request auth)

Caddy has automatic TLS and its request matcher makes "reject unless the requester
presented a credential the proxy itself vouches for" one small rule set. For this doc we
use **HTTP Basic auth with a strong password scoped to the entire `/manage` origin** AND a
separate per-route requirement for pairing. Basic auth over the proxy TLS is sufficient as
the real per-request boundary for the operator's own phone, and it keeps step 6's proof a
single `curl`. (An Nginx client-cert variant is given in §4b if you prefer mTLS.)

First start Caddy with a working dir it can write its data/autocert store to:

```sh
brew install caddy        # or: apt-get install caddy / your OS package
mkdir -p ~/ashura/caddy && cd ~/ashura/caddy
```

Write this `Caddyfile`. Substitute your real DNS name / tunnel host for
`ashura.example.tld` (or use `localhost` only while still testing on the host loopback):

```
# ~/ashura/caddy/Caddyfile  — Caddy v2
# The ONLY network listener. Terminates TLS and performs per-request client auth.
# The proxy upstream is the plugin on loopback only (never 0.0.0.0).

{$DOMAIN:ashura.example.tld} {
	# ---- Every /manage request must present the proxy's own Basic credential.
	# ---- No credential → 401 at the proxy; nothing is forwarded to the plugin.
	@manage path /manage* /workspace*
	handle @manage {
		basic_auth {
			ashura_admin {$ADMIN_PASS}
		}
		reverse_proxy 127.0.0.1:3090
	}

	# ---- /api and /api/v1 pass through to the loopback plugin. The plugin itself
	# ---- still enforces pairing + Bearer tokens: a request with no pair/token is
	# ---- rejected by the plugin (401) even when it reaches loopback. The proxy
	# ---- does NOT need to know device tokens; it only requires that anyone
	# ---- reaching /manage proved identity to the proxy.
	handle /api/* {
		reverse_proxy 127.0.0.1:3090
	}

	handle {
		reverse_proxy 127.0.0.1:3090
	}
}
```

Then start Caddy (it will read the domain and bind 443, or `http://localhost:PORT` when
testing without that DNS name; keep the plugin bound to 127.0.0.1:3090):

```sh
export DOMAIN=ashura.example.tld            # e.g. your Phone-reachable DNS name
export ADMIN_PASS='<generate a 24+ char password: openssl rand -base64 18>'
caddy run --config ~/ashura/caddy/Caddyfile
```

> If you are only testing on the same machine (no phone yet), set `DOMAIN=localhost` and run
> `caddy run --config ... --adapter caddyfile -conf` style; the important invariant is the
> proxy owns TLS+auth and forwards only to `127.0.0.1:3090`.

### §4b — Nginx alternative (client-cert / mTLS) if you choose it over Caddy

```
# /etc/nginx/sites-available/dsh-workspace  — TLS terminated here; auth = client cert.
server {
    listen 443 ssl;
    server_name ashura.example.tld;
    ssl_certificate     /etc/letsencrypt/live/ashura.example.tld/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ashura.example.tld/privkey.pem;

    ssl_client_certificate /etc/nginx/ashura-ca.pem;   # your own CA that signed the phone cert
    ssl_verify_client on;                               # ANY request without a valid client cert → 400

    location /manage/ {
        proxy_pass http://127.0.0.1:3090;               # loopback upstream only
        proxy_set_header Host $host;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:3090;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;         # needed for wss /events
        proxy_set_header Connection "upgrade";
    }
    location / { proxy_pass http://127.0.0.1:3090; }
}
```

With mTLS, "reject an unauthenticated request" is enforced by `ssl_verify_client on`
(your `curl` must then present the phone's client cert — §5/§6 include the exact command).

## 5. The rejection proof — run this BEFORE you pair any phone

This is the gate the operator must watch turn 4xx/44x. With the proxy up and `DOMAIN`
published, confirm that an **unauthenticated** request to the *net-exposed* proxy is refused
at the proxy (it never reaches the plugin). Two variants:

Basic-auth (Caddy, chosen above) — expect **401**:
```sh
curl -i -s https://ashura.example.tld/manage/status | head -1
#  HTTP/1.1 401 Unauthorized   ← proof. No credential, no forward.
```
Client-cert (Nginx) — expect an SSL/400 handshake refusal without `--cert`:
```sh
curl -i -s https://ashura.example.tld/manage/status | head -1
#  curl: (35) ... + NGINX closes with 400 Bad Request (no client cert).
# With the phone cert it succeeds, so bind the phone install to that cert.
```

The correct (armed) request — authenticated to the proxy AND, for /manage, must ALSO carry a
loopback `Origin` because the plugin still enforces the loopback admin fence on top:
```sh
curl -i -s -u 'ashura_admin:<ADMIN_PASS>' -H 'Origin: http://ashura.example.tld' \
     https://ashura.example.tld/manage/status | head -1
#  HTTP/1.1 200 OK   (only once the plugin is actually bound to loopback + running)
```
Point is not to remove the plugin's fence — it is that only a proxy-authenticated caller may
even *try*. The phone reachability URL is ALWAYS `https://DOMAIN` (the proxy only). Never
give the app a `http://LAN-IP:3090` address.

## 6. Bring it up — first real bind (operator, supervised)

Only now, with the rejection proof green, enable the listener to loopback and let the proxy
be the WAN face. The `remote_enabled` state is set through the local WebUI ("Workspace →
Remote access → Enable …") or via the loopback `/manage` API. You must run these **from the
host shell** (the plugin is loopback bound, so a host-originated request is a loopback peer);
each `curl` hits `127.0.0.1:3090` directly, NOT through the proxy, because `/manage` is
admin-only and the admin is the local operator:

```sh
# 0) (Only) if you run from source during an M-round-trip smoke test, see the README of
#    kotlin-sdk, but for a real profile the plugin is loaded by DSH, which starts it bound
#    to loopback until enabled. Configure the listener explicitly to loopback anyway:
curl -i -s -H 'Origin: http://localhost:3080' -H 'Content-Type: application/json' \
  -X PUT localhost:3090/manage/remote/listener \
  -d '{"host":"127.0.0.1","port":3090}'

# 1) Authorize one root (path = absolute server dir you allow the phone to reach).
curl -i -s -H 'Origin: http://localhost:3080' -H 'Content-Type: application/json' \
  -X POST localhost:3090/manage/roots \
  -d '{"path":"/<abs>/<dir>","label":"Ashura-phone"}'

# 2) Enable remote access + create a single pairing for ONE root + read-mostly scopes.
curl -i -s -H 'Origin: http://localhost:3080' -H 'Content-Type: application/json' \
  -X POST localhost:3090/manage/remote/enable \
  -d '{"rootIds":["<ROOT_ID>"],"scopes":["chat.read","files.read"]}'

# 3) Create the 10-minute single-use pairing code (prints the code ONCE).
curl -i -s -H 'Origin: http://localhost:3080' -H 'Content-Type: application/json' \
  -X POST localhost:3090/manage/pairings \
  -d '{"rootIds":["<ROOT_ID>"],"scopes":["chat.read","files.read"]}'
```

Then on the phone: connect to `https://ashura.example.tld` (the proxy), enter the pairing
code and a device name. The app fulfills the exchange over the proxy:

```sh
curl -s -X POST https://ashura.example.tld/api/v1/pairings/exchange \
  -H 'Content-Type: application/json' \
  -d '{"code":"<CODE>","deviceName":"Operator-iPhone"}'
# → {"token":"<256-bit bearer>"}  shown ONCE; store it in the phone's Keystore-backed store.
```

**🚫 STOP — THIS FIRST REAL BIND IS THE OPERATOR-ONLY, SUPERVISED, IRREVERSIBLE STEP.**
Do not enable remote access, do not bind to anything but 127.0.0.1, do not expose the
plugin to a LAN IP (never `0.0.0.0`), do not proceed past pairing until you have watched the
§5 rejection proof and the operator confirms the deployment's proxy client-auth + bind. The
phone is a bearer credential: lost/stolen device = token steering risk → keep the single
root, read-mostly scopes (see `docs/project/API.md` scope table), revoke immediately if the
device is lost (`/manage/devices`).

## 7. Teardown / verification that nothing is listening

```sh
# Disable remote access (back to loopback-until-re-enabled) — from host shell:
curl -i -s -H 'Origin: http://localhost:3080' -X POST localhost:3090/manage/remote/disable
# Stop the proxy:
caddy stop
# Confirm no net-exposed socket remains (expect nothing on 0.0.0.0:3090; only an optional
# loopback 127.0.0.1:3090 while the DSH host keeps the plugin loaded):
lsof -nP -iTCP:3090 -sTCP:LISTEN
```
