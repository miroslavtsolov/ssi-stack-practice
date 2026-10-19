# Verifiable Diploma Demo

A minimal Issuer / Wallet / Verifier web app built on top of the
[walt.id Community Stack](https://github.com/walt-id/waltid-identity)
(Issuer2 / Wallet2 / Verifier2), demonstrating a full **OID4VCI** (issuance)
+ **OID4VP** (presentation) loop using a custom `UniversityDiploma`
credential type — not the pre-shipped demo credential.

Built as a hands-on lab for understanding how a real SSI (Self-Sovereign
Identity) stack works: issuer profiles, DIDs, credential offers, DCQL
queries, and verifier policies. Used Claude AI for script generation and troubleshooting research.

```
University (Issuer) ──issues──▶ Student (Wallet) ──presents──▶ Employer (Verifier)
```

---

## Architecture

```
 ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
 │  issuer.html   │     │  wallet.html   │     │ verifier.html  │
 └────────┬───────┘     └────────┬───────┘     └────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                      ┌──────────▼──────────┐
                      │     server.js       │
                      │ Express proxy :3000 │
                      └──────────┬──────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
 ┌────────▼───────┐    ┌─────────▼───────┐    ┌─────────▼───────┐
 │   Issuer2 API  │    │   Wallet2 API   │    │  Verifier2 API  │
 │     :7005      │    │     :7006       │    │     :7004       │
 └────────────────┘    └─────────────────┘    └─────────────────┘

       All three APIs run in the walt.id Community Stack
                    via docker-compose.
```

`server.js` exists purely to avoid CORS issues and keep API base URLs off
the browser — each HTML page calls `/api/...` on the same origin, and the
Node server forwards those calls to the real Issuer2/Wallet2/Verifier2
services running in Docker.

---

## Prerequisites

- Docker + Docker Compose
- Node.js 18+ (uses the built-in `fetch`, no extra HTTP client needed)
- git

---

## Setup

### 1. Clone and start the walt.id Community Stack

```bash
git clone https://github.com/walt-id/waltid-identity.git
cd waltid-identity/docker-compose
docker compose up -d
```

Confirm the three services are reachable:

| Service    | URL                     |
|------------|--------------------------|
| Issuer2    | `http://localhost:7005` |
| Wallet2    | `http://localhost:7006` |
| Verifier2  | `http://localhost:7004` |

### 2. Register the custom `UniversityDiploma` credential type

⚠️ **Important:** edit the config files under `docker-compose/issuer-api2/config/`
— **not** `waltid-services/waltid-issuer-api2/config/`. The compose file's
bind mount points at the former; edits to the latter are silently ignored.
(The header comments in `issuer-config/*.conf` point at the same, correct path.)

```bash
cd waltid-identity/docker-compose/issuer-api2/config
```

**In `credential-issuer-metadata.conf`**, add this inside the existing
`credentialConfigurations = { ... }` block:

```hocon
"UniversityDiploma_jwt_vc_json" = {
  format = "jwt_vc_json"
  scope = "UniversityDiploma_jwt_vc_json"
  cryptographic_binding_methods_supported = ["did:key", "did:jwk"]
  credential_signing_alg_values_supported = ["ES256", "EdDSA"]
  proof_types_supported = {
    jwt = {
      proof_signing_alg_values_supported = ["ES256", "EdDSA"]
    }
  }
  credential_definition = {
    type = ["VerifiableCredential", "UniversityDiploma"]
  }
  display = [
    {
      name = "University Diploma"
      locale = "en-US"
      background_color = "#1b2a4a"
      text_color = "#FFFFFF"
      description = "Verifiable proof of degree conferral"
    }
  ]
}
```

> `cryptographic_binding_methods_supported` must list specific DID methods
> (`did:key`, `did:jwk`, ...) — a bare `["did"]` is rejected at startup.
> `proof_types_supported` is **required** whenever
> `cryptographic_binding_methods_supported` is set — omitting it crashes
> the service with `proof_types_supported must be present when
> cryptographic_binding_methods_supported is set`.

**In `issuer2-profiles.conf`**, add this inside the existing
`profiles = { ... }` block:

```hocon
"university-diploma" = {
  name = "University Diploma"
  credentialConfigurationId = "UniversityDiploma_jwt_vc_json"
  issuerKey = ${defaultIssuerKey}
  issuerDid = ${defaultIssuerDid}

  credentialData = {
    "@context" = ["https://www.w3.org/2018/credentials/v1"]
    type = ["VerifiableCredential", "UniversityDiploma"]
    credentialSubject = {
      studentName = "Jane Doe"
      degree = "Bachelor of Science in Computer Science"
      graduationDate = "2026-06-15"
      gpa = "3.8"
    }
  }

  mapping = {
    id = "<uuid>"
    issuer = { id = "<issuerDid>" }
    credentialSubject = { id = "<subjectDid>" }
    issuanceDate = "<timestamp>"
  }
}
```

> **Use nested objects in `mapping`, not dotted keys.** In HOCON a *quoted*
> key is literal: `"issuer.id" = "<issuerDid>"` creates a key whose name
> contains a dot, it does **not** set `issuer.id`. The issuer then never fills
> in the issuer DID or the holder DID (`credentialSubject.id`), and the
> credential is issued without holder binding.
>
> Quote keys that contain special characters (profile ids like
> `"university-diploma"`, `"@context"`, `"UniversityDiploma_jwt_vc_json"`),
> and make sure every brace balances. A missing opening quote (e.g.
> `UniversityDiploma_jwt_vc_json" = {`) produces a `Could not parse config`
> error citing an unescaped newline — check that first if the service fails
> to start after an edit.

Recreate the issuer container so it picks up the new config:

```bash
cd waltid-identity/docker-compose
docker compose up -d --force-recreate issuer-api2
docker compose logs issuer-api2 --tail=30   # confirm no "Exception in thread main"
```

Verify the profile loaded:

```bash
curl -i http://localhost:7005/issuer2/profiles/university-diploma
# expect HTTP/1.1 200 OK + profile JSON
```

### 3. Turn off Wallet2 authentication

The compose config at the pinned commit enables the `auth` feature for
`wallet-api2`, so every wallet call (even `POST /wallet`) needs a login token
and fails with `401 Unauthorized (NoCredentials)`. This demo's proxy does no
login, so disable it:

```bash
cd waltid-identity/docker-compose
sed -i -E 's/^([[:space:]]*)auth([[:space:]]|$)/\1# auth\2/' wallet-api2/config/_features.conf
cat wallet-api2/config/_features.conf   # `auth` commented out; keep wallet2-persistence
docker compose up -d --force-recreate wallet-api2
curl -i -X POST http://localhost:7006/wallet -H 'Content-Type: application/json' -d '{}'
# expect 200 + {"walletId": "..."}
```

> With auth off, anyone who can reach port 7006 can use the wallet API.
> Fine for a lab on a trusted network; do not expose it publicly.

### 4. (Native Linux hosts only) Fix container-to-host DNS

The wallet needs to call back to the verifier at URLs like
`http://host.docker.internal:7004/...`. On Docker Desktop (Mac/Windows)
that hostname resolves automatically; on **native Linux** it does not, and
presentation will silently fail (verifier session stays `UNUSED` /
`attempted: false` forever, wallet-side call just times out or errors).

Check your `.env` first — if `SERVICE_HOST` is already set to
`host.docker.internal`, the existing `extra_hosts` entries referencing
`$SERVICE_HOST` already cover this and **no change is needed**:

```bash
grep SERVICE_HOST waltid-identity/docker-compose/.env
```

If it's set to something else (e.g. your host's LAN IP) and you still hit
`host.docker.internal` in generated URLs, add an explicit mapping to the
`extra_hosts:` block of `wallet-api2`, `verifier-api2`, and `issuer-api2`
in `docker-compose.yaml`:

```yaml
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Then:

```bash
docker compose up -d --force-recreate wallet-api2 verifier-api2 issuer-api2
docker compose exec wallet-api2 getent hosts host.docker.internal  # should return an IP
```

### 5. Run the demo app

```bash
git clone <this-repo-url> ssi-stack-practice   # or unzip if you downloaded it directly
cd ssi-stack-practice
npm install
npm start
```

Open `http://localhost:3000`.

> The demo proxy has **no authentication**, so it listens on `127.0.0.1` only.
> If the stack runs in a VM and you browse from another machine, start it with
> `HOST=0.0.0.0 npm start` (or use an SSH tunnel: `ssh -L 3000:localhost:3000 user@vm`)
> and only do this on a trusted, isolated network.

---

## Using the demo

**Open all three role pages as separate browser tabs, directly by URL, and
keep them open for the whole session:**

```
http://<host>:3000/issuer.html
http://<host>:3000/wallet.html
http://<host>:3000/verifier.html
```

> ℹ️ Session state is kept per browser: the wallet ID in `localStorage`
> (shared by all tabs) and the verifier's `sessionId` in `sessionStorage`
> (per tab). Reloading or navigating back therefore keeps the wallet and
> restores the last verifier session. The issuer page holds no state. Still,
> keeping the three pages open in separate tabs is the smoothest way to walk
> the flow. Use **Create Verification Request** again to start a fresh session.

### Full flow

1. **Wallet tab** → click **Reset Wallet** → confirm.
   Creates a fresh wallet + `secp256r1` (ES256) signing key + `did:key` DID.
   (Skip this step on a first run: the page creates a wallet automatically.
   On load it also checks that the stored wallet still exists server-side and
   creates a new one if not, e.g. after `wallet-api2` was recreated without a
   persistent data volume.) The action buttons stay disabled until the wallet
   is ready.

2. **Issuer tab** → click **Issue Diploma Credential**.
   Calls Issuer2 to create a `PRE_AUTHORIZED` OID4VCI credential offer from
   the `university-diploma` profile. A QR code and the raw offer URL
   appear.

3. **Wallet tab** → paste the offer URL into "Receive a credential" →
   click **Receive Credential**.
   The wallet redeems the offer, and the diploma shows up under
   "Stored credentials."

4. **Verifier tab** → click **Create Verification Request**.
   Calls Verifier2 to create a `cross_device` OID4VP session with a DCQL
   query asking for a `UniversityDiploma` credential. A QR code and the
   raw request URL appear.

5. **Wallet tab** → paste the request URL into "Present a credential" →
   click **Present Credential**.
   The wallet builds a Verifiable Presentation from the stored diploma and
   submits it to the verifier's `response_uri`.

6. **Verifier tab** → click **Check Result**.
   Polls the verification session. Status should read `SUCCESSFUL`, with
   the verified claims (student name, degree, GPA, etc.) printed below.

That `SUCCESSFUL` result is the complete, cryptographically-verified
issuer → holder → verifier loop.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Credential profile not found: university-diploma` | Edited the wrong config file — checked with `docker compose config \| grep -A5 issuer-api2` to see the actual mounted path. |
| `Could not parse config ... unescaped newline` | A HOCON key is missing its opening or closing quote. |
| `Unsupported cryptographic binding method: did` | Use a specific DID method (`did:key`, `did:jwk`, ...), not the bare string `did`. |
| `proof_types_supported must be present when cryptographic_binding_methods_supported is set` | Add a `proof_types_supported` block to the credential configuration. |
| `code length overflow` / `Too long data` when rendering a QR | The QR library's default error-correction level is too small for a long `request_uri`/offer URL. `correctLevel: QRCode.CorrectLevel.L` is applied in both `issuer.html` and `verifier.html`; qrcodejs still tops out around 650 bytes, so for longer URLs the QR is skipped and you copy the URL text instead. |
| `transmission_success=false`, verifier session stuck at `UNUSED`/`attempted: false` | The wallet container can't reach `host.docker.internal` (native Linux Docker doesn't resolve it by default). See step 4 above. |
| `Unauthorized (NoCredentials)` / HTTP 401 on wallet create | `wallet-api2` has the `auth` feature enabled in `_features.conf`. Comment it out and recreate the container, see step 3. |
| `Wallet '<id>' not found` | The wallet container was recreated without a persistent data volume, wiping its wallets. The wallet page now detects this on load and creates a new wallet; click **Reset Wallet** to force it, then re-issue/re-receive the credential. |
| `invalid_proof` when receiving a credential | The wallet key type isn't accepted by the issuer. This repo generates `secp256r1` (ES256) keys; if you changed the key type to `Ed25519`, switch back (or click **Reset Wallet**). |
| Credential issues but has no issuer/holder DID, or `Cannot find in context: subjectDid` | The profile `mapping` uses quoted dotted keys (`"issuer.id"`). Use nested objects (`issuer = { id = "<issuerDid>" }`), see step 2. |
| `services.<name>.extra_hosts must be a mapping` | Duplicate host entry or a duplicate service block in `docker-compose.yaml` — Compose's merge logic on `extra_hosts` breaks on duplicates. |

---

## Project structure

```
ssi-stack-practice/
├── README.md
├── package.json
├── server.js                 — Express proxy to Issuer2/Wallet2/Verifier2
├── public/
│   ├── index.html             — role picker
│   ├── issuer.html            — create credential offers, render QR
│   ├── wallet.html             — create wallet/DID, receive & present credentials
│   ├── qrcode.min.js           - is the qrcodejs library (MIT license), included for offline use.
│   └── verifier.html          — create verification requests, poll results
└── issuer-config/
    ├── credential-issuer-metadata-addition.conf   — reference snippet
    └── issuer2-profiles-addition.conf             — reference snippet
```
