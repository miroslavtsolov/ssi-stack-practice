// server.js
// Thin proxy + static file server. Keeps API base URLs and CORS off the
// browser's plate, and gives one place to add logging when you're
// debugging the flow.

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const ISSUER_URL = process.env.ISSUER_URL || "http://localhost:7005";
const WALLET_URL = process.env.WALLET_URL || "http://localhost:7006";
const VERIFIER_URL = process.env.VERIFIER_URL || "http://localhost:7004";

// Path ids are interpolated into upstream URLs, so only allow safe characters.
app.param("id", (req, res, next, id) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    return res.status(400).json({ error: "invalid_id" });
  }
  next();
});

// Small helper: forward a JSON request, return the JSON response (or an error body).
async function forward(res, url, options) {
  try {
    const upstream = await fetch(url, options);
    const text = await upstream.text();
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    res.status(upstream.status).json(body);
  } catch (err) {
    console.error("Proxy error calling", url, err);
    res.status(502).json({ error: "upstream_unreachable", detail: String(err) });
  }
}

// ---------- Issuer ----------
app.post("/api/issuer/offer", (req, res) => {
  const { profileId = "university-diploma", authMethod = "PRE_AUTHORIZED" } = req.body || {};
  forward(res, `${ISSUER_URL}/issuer2/credential-offers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profileId, authMethod }),
  });
});

// ---------- Wallet ----------
app.post("/api/wallet/create", (req, res) => {
  forward(res, `${WALLET_URL}/wallet`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
});

app.post("/api/wallet/:id/key", (req, res) => {
  forward(res, `${WALLET_URL}/wallet/${req.params.id}/keys/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // secp256r1 (ES256) is what walt.id recommends; Ed25519 can fail with
    // invalid_proof against default Issuer2 metadata.
    body: JSON.stringify({ backend: "jwk", keyType: "secp256r1" }),
  });
});

app.post("/api/wallet/:id/did", (req, res) => {
  forward(res, `${WALLET_URL}/wallet/${req.params.id}/dids/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method: "key" }),
  });
});

app.post("/api/wallet/:id/receive", (req, res) => {
  forward(res, `${WALLET_URL}/wallet/${req.params.id}/credentials/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offerUrl: req.body.offerUrl }),
  });
});

app.get("/api/wallet/:id/credentials", (req, res) => {
  forward(res, `${WALLET_URL}/wallet/${req.params.id}/credentials`, { method: "GET" });
});

app.post("/api/wallet/:id/present", (req, res) => {
  forward(res, `${WALLET_URL}/wallet/${req.params.id}/credentials/present`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestUrl: req.body.requestUrl }),
  });
});

// ---------- Verifier ----------
app.post("/api/verifier/session", (req, res) => {
  forward(res, `${VERIFIER_URL}/verification-session/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      flow_type: "cross_device",
      core_flow: {
        dcql_query: {
          credentials: [
            {
              id: "diploma",
              format: "jwt_vc_json",
              meta: { type_values: [["VerifiableCredential", "UniversityDiploma"]] },
            },
          ],
        },
        policies: { vc_policies: [{ policy: "signature" }] },
      },
    }),
  });
});

app.get("/api/verifier/session/:id", (req, res) => {
  forward(res, `${VERIFIER_URL}/verification-session/${req.params.id}/info`, { method: "GET" });
});

const PORT = process.env.PORT || 3000;
// This demo proxy has no authentication, so it only listens on localhost by
// default. Set HOST=0.0.0.0 only on a trusted/isolated network.
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => {
  console.log(`Diploma demo running at http://${HOST}:${PORT}`);
  console.log(`Proxying -> issuer2:${ISSUER_URL}  wallet2:${WALLET_URL}  verifier2:${VERIFIER_URL}`);
});
