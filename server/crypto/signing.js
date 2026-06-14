const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Ed25519 signing for edge OMR records. The private key belongs to the issuing
// authority (here, the server) and signs each edge data string at scan time.
// Anyone holding the public key can later verify a record was produced by the
// authority and has not been altered — independent of trusting the database.
//
// In production the private key should be injected via SIGNING_PRIVATE_KEY (PEM)
// and ideally held in an HSM; the dev fallback generates and persists a local
// keypair on first run.

const KEY_DIR  = path.join(__dirname, 'keys');
const PRIV_PATH = path.join(KEY_DIR, 'edge_private.pem');
const PUB_PATH  = path.join(KEY_DIR, 'edge_public.pem');

let privateKey;
let publicKey;

function load() {
  if (process.env.SIGNING_PRIVATE_KEY && process.env.SIGNING_PUBLIC_KEY) {
    privateKey = process.env.SIGNING_PRIVATE_KEY;
    publicKey  = process.env.SIGNING_PUBLIC_KEY;
    return;
  }
  if (fs.existsSync(PRIV_PATH) && fs.existsSync(PUB_PATH)) {
    privateKey = fs.readFileSync(PRIV_PATH, 'utf8');
    publicKey  = fs.readFileSync(PUB_PATH, 'utf8');
    return;
  }
  const pair = crypto.generateKeyPairSync('ed25519');
  privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  publicKey  = pair.publicKey.export({ type: 'spki', format: 'pem' });
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(PRIV_PATH, privateKey, { mode: 0o600 });
  fs.writeFileSync(PUB_PATH, publicKey);
  console.log('[Signing] Generated new Ed25519 keypair at server/crypto/keys/');
}

load();

function signData(data) {
  return crypto.sign(null, Buffer.from(data, 'utf8'), privateKey).toString('base64');
}

function verifyData(data, signatureB64) {
  if (!signatureB64) return false;
  try {
    return crypto.verify(null, Buffer.from(data, 'utf8'), publicKey, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

function getPublicKey() {
  return publicKey;
}

module.exports = { signData, verifyData, getPublicKey };
