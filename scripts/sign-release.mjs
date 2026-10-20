/**
 * Assinatura de release do Facil (D-39).
 *
 * Gera um manifesto SHA-256 de todos os arquivos versionados (e novos ainda nao
 * commitados), assina o manifesto com a chave Ed25519 do autor e grava:
 *
 *   - SIGNATURE.json                       (manifesto + assinatura + chave publica)
 *   - src/client/public/build-info.json    (resumo publico servido pelo app)
 *   - src/worker/build-info.generated.ts   (usado pelo Worker para cabecalhos)
 *
 * A chave PRIVADA fica FORA do repositorio, em
 *   %USERPROFILE%\.facil-signing\facil-ed25519-private.pem
 * (ou no caminho de FACIL_SIGNING_KEY). A chave publica fica em
 *   signing/facil-ed25519-public.pem
 *
 * Uso: node scripts/sign-release.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, generateKeyPairSync, sign as edSign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const AUTHOR = {
  name: "Allan Luiz Silveira Lima",
  alias: "Allanlugui",
  company: "Corp Services Group",
};

const PROJECT = "Facil — Plataforma de Gestão de Facilities";
const SCHEMA = "facil.signature.v1";

const generated = new Set([
  "SIGNATURE.json",
  "src/client/public/build-info.json",
  "src/worker/build-info.generated.ts",
]);

// Notas operacionais e evidencias nao fazem parte do produto assinado.
const excludedPrefixes = ["memory/", "ux-shots/"];

const privateKeyPath =
  process.env.FACIL_SIGNING_KEY ??
  path.join(os.homedir(), ".facil-signing", "facil-ed25519-private.pem");
const publicKeyPath = path.join(root, "signing", "facil-ed25519-public.pem");

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Data/hora de Brasilia no formato ISO com fuso (o Brasil nao usa mais horario de verao). */
function brasiliaIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${pick("year")}-${pick("month")}-${pick("day")}T${pick("hour")}:${pick("minute")}:${pick("second")}-03:00`;
}

function ensureKeyPair() {
  if (fs.existsSync(privateKeyPath)) {
    const pem = fs.readFileSync(privateKeyPath, "utf8");
    return { privateKey: pem, created: false };
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(privateKeyPath, privatePem, { mode: 0o600 });
  fs.mkdirSync(path.dirname(publicKeyPath), { recursive: true });
  fs.writeFileSync(publicKeyPath, publicPem, { mode: 0o644 });

  fs.writeFileSync(
    path.join(path.dirname(privateKeyPath), "LEIA-ME.txt"),
    [
      "Chave privada de assinatura do projeto Facil.",
      "",
      `Criada em: ${brasiliaIso()}`,
      `Autor: ${AUTHOR.name}`,
      "",
      "Guarde este arquivo com cuidado: ele e a sua identidade digital neste projeto.",
      "Quem tiver esta chave pode assinar releases em seu nome.",
      "Nao copie este arquivo para o repositorio nem para o servidor.",
      "Faca backup em local seguro (gerenciador de senhas, cofre, pendrive cifrado).",
      "",
      "A chave publica correspondente fica em signing/facil-ed25519-public.pem no repositorio.",
    ].join("\n"),
    "utf8",
  );

  return { privateKey: privatePem, created: true };
}

function listFiles() {
  const raw = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => !generated.has(entry))
    .filter((entry) => !excludedPrefixes.some((prefix) => entry.startsWith(prefix)))
    .filter((entry) => fs.existsSync(path.join(root, entry)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function main() {
  const { privateKey, created } = ensureKeyPair();
  const publicPem = fs.readFileSync(publicKeyPath, "utf8");
  const publicKey = createPublicKey(publicPem);
  const spki = publicKey.export({ type: "spki", format: "der" });
  const keyFingerprint = sha256(spki)
    .toUpperCase()
    .match(/.{2}/g)
    .join(":");

  const files = listFiles().map((relative) => {
    const bytes = fs.readFileSync(path.join(root, relative));
    return { path: relative, sha256: sha256(bytes), bytes: bytes.length };
  });

  const treeHash = sha256(
    JSON.stringify(files.map((file) => [file.path, file.sha256])),
  );

  const payload = {
    schema: SCHEMA,
    project: PROJECT,
    version: pkg.version,
    author: AUTHOR.name,
    alias: AUTHOR.alias,
    company: AUTHOR.company,
    signedAt: brasiliaIso(),
    treeHash,
    fileCount: files.length,
  };

  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = edSign(null, payloadBytes, privateKey).toString("base64");

  const document = {
    schema: SCHEMA,
    algorithm: "Ed25519",
    keyFingerprint,
    publicKeyPem: publicPem,
    payload,
    signature,
    verify: "node scripts/verify-release.mjs",
    files,
  };
  fs.writeFileSync(
    path.join(root, "SIGNATURE.json"),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf8",
  );

  const publicInfo = {
    project: PROJECT,
    version: pkg.version,
    author: AUTHOR.name,
    alias: AUTHOR.alias,
    company: AUTHOR.company,
    signedAt: payload.signedAt,
    treeHash,
    fileCount: files.length,
    algorithm: "Ed25519",
    keyFingerprint,
    signature,
  };
  fs.writeFileSync(
    path.join(root, "src/client/public/build-info.json"),
    `${JSON.stringify(publicInfo, null, 2)}\n`,
    "utf8",
  );

  fs.writeFileSync(
    path.join(root, "src/worker/build-info.generated.ts"),
    [
      "/**",
      " * GERADO por scripts/sign-release.mjs — nao editar manualmente.",
      " * Cada release assina o manifesto do codigo e injeta aqui o resumo publico.",
      " */",
      `export const BUILD_INFO = ${JSON.stringify(publicInfo, null, 2)} as const;`,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(
    [
      created ? "Chave Ed25519 criada (fora do repositorio)." : "Chave Ed25519 existente.",
      `Fingerprint: ${keyFingerprint}`,
      `Arquivos assinados: ${files.length}`,
      `Tree SHA-256: ${treeHash}`,
      `Assinado em: ${payload.signedAt}`,
      `Autor: ${AUTHOR.name}`,
    ].join("\n"),
  );
}

main();
