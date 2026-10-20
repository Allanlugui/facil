/**
 * Verifica a assinatura de uma release do Facil.
 *
 * Uso:
 *   node scripts/verify-release.mjs            # verifica o diretorio atual
 *   node scripts/verify-release.mjs --signed   # so confere a assinatura Ed25519
 *
 * O modo completo recalcula o SHA-256 de cada arquivo listado e compara com o
 * manifesto; o modo --signed confere apenas a assinatura do manifesto (util
 * quando o codigo foi copiado/alterado, mas se quer validar a origem).
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const signatureFile = path.join(root, "SIGNATURE.json");

function fail(message) {
  console.error(`FALHOU: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(signatureFile)) {
  fail("SIGNATURE.json nao encontrado. Rode `npm run sign` para assinar a release.");
}

const document = JSON.parse(fs.readFileSync(signatureFile, "utf8"));
const payloadBytes = Buffer.from(JSON.stringify(document.payload), "utf8");
const publicKey = createPublicKey(document.publicKeyPem);

const ok = edVerify(null, payloadBytes, publicKey, Buffer.from(document.signature, "base64"));
if (!ok) fail("assinatura Ed25519 invalida.");
console.log(`assinatura Ed25519 valida (${document.algorithm})`);
console.log(`autor: ${document.payload.author} <${document.payload.email}>`);
console.log(`assinado em: ${document.payload.signedAt}`);
console.log(`tree SHA-256: ${document.payload.treeHash}`);
console.log(`fingerprint: ${document.keyFingerprint}`);

if (!process.argv.includes("--signed")) {
  let changed = 0;
  let missing = 0;
  for (const file of document.files) {
    const full = path.join(root, file.path);
    if (!fs.existsSync(full)) {
      console.error(`AUSENTE: ${file.path}`);
      missing++;
      continue;
    }
    const digest = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    if (digest !== file.sha256) {
      console.error(`ALTERADO: ${file.path}`);
      changed++;
    }
  }
  if (missing || changed) {
    fail(`${missing} arquivo(s) ausente(s) e ${changed} alterado(s) desde a assinatura.`);
  }
  console.log(`manifesto intacto: ${document.files.length} arquivos conferidos.`);
}
