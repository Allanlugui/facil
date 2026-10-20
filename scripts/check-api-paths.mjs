/**
 * Guard contra divergencia de rotas entre cliente e worker.
 *
 * Motivo (P-07): o cliente chamava `/api/inventory` enquanto o worker montava
 * `/api/inventories`; nenhum teste de API pegava isso porque os testes chamam os
 * caminhos corretos diretamente. Este script extrai toda chamada literal
 * `/api/...` do cliente e confere, segmento a segmento, se existe rota
 * correspondente no worker (mounts de `src/worker/index.ts` + `router.*` de
 * `src/worker/routes/*.ts`).
 *
 * Uso: node scripts/check-api-paths.mjs   (parte de `npm run check`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const WORKER_DIR = join(ROOT, "src", "worker");
const CLIENT_DIR = join(ROOT, "src", "client");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Rotas do worker: monta pares (metodo nao importa aqui) path completo. */
function workerRoutes() {
  const index = readFileSync(join(WORKER_DIR, "index.ts"), "utf8");
  // mounts: ["authRoutes", "/api/auth"] -> arquivo routes/auth.ts (singular/plural tolerado)
  const mounts = [];
  for (const m of index.matchAll(/app\.route\(\s*"([^"]+)"\s*,\s*(\w+)/g)) {
    mounts.push({ path: m[1], stem: m[2].replace(/Routes$/, "").toLowerCase() });
  }
  const files = readdirSync(join(WORKER_DIR, "routes"))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ file, base: file.replace(/\.ts$/, "").toLowerCase() }));

  const routes = new Set();
  for (const m of index.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)) {
    routes.add(normalize(m[2]));
  }
  for (const mount of mounts) {
    const match = files.find(
      (entry) => entry.base === mount.stem || entry.base === `${mount.stem}s`,
    );
    if (!match) continue;
    const source = readFileSync(join(WORKER_DIR, "routes", match.file), "utf8");
    for (const m of source.matchAll(/router\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g)) {
      const sub = m[2] === "/" ? "" : m[2];
      routes.add(normalize(`${mount.path}${sub}`));
    }
  }
  return routes;
}

function normalize(path) {
  const clean = path.replace(/\/+$/, "");
  return clean.length === 0 ? "/" : clean;
}

/** Paths estaticos chamados pelo cliente: literal ate o primeiro `${`. */
function clientPaths() {
  const found = new Map();
  for (const file of walk(CLIENT_DIR)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/["'`](\/api\/[^"'`]*)/g)) {
      let path = m[1];
      path = path.split("${")[0];
      path = path.split("?")[0];
      path = normalize(path);
      if (path === "/api") continue;
      if (!found.has(path)) found.set(path, relative(ROOT, file));
    }
  }
  return found;
}

function matches(clientPath, routePath) {
  const clientSegs = clientPath.split("/").filter(Boolean);
  const routeSegs = routePath.split("/").filter(Boolean);
  if (clientSegs.length > routeSegs.length) return false;
  for (let i = 0; i < clientSegs.length; i++) {
    const routeSeg = routeSegs[i];
    if (routeSeg.startsWith(":")) continue;
    if (clientSegs[i] !== routeSeg) return false;
  }
  return true;
}

const routes = [...workerRoutes()];
const client = clientPaths();
const problems = [];
for (const [path, file] of client) {
  if (!routes.some((route) => matches(path, route))) {
    problems.push(`${path}  (chamado em ${file})`);
  }
}

if (problems.length > 0) {
  console.error("Rotas de API chamadas pelo cliente sem correspondencia no worker:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(`\n${problems.length} problema(s). Atualize o cliente ou a rota do worker.`);
  process.exit(1);
}

console.log(`check-api-paths: OK (${client.size} caminhos do cliente conferidos contra ${routes.length} rotas do worker)`);
