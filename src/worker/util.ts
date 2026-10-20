/* Utilitarios de tempo, identificadores e criptografia (WebCrypto nativo). */

export const APP_TIMEZONE = "America/Sao_Paulo";

/** Custo do PBKDF2. Elevado o suficiente para uso real, dentro do limite de CPU
 *  do Workers. Armazenado por usuário, permitindo aumentar depois sem quebrar
 *  hashes antigos (rehash automático no próximo login bem-sucedido). */
export const DEFAULT_PBKDF2_ITERATIONS = 100_000;

export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 horas

export function nowIso(): string {
  return new Date().toISOString();
}

/** Data (YYYY-MM-DD) no fuso da aplicação. Usada em períodos de consumo/inventário. */
export function isoDateInTimeZone(date: Date, timeZone = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function todayInAppTimeZone(): string {
  return isoDateInTimeZone(new Date());
}

export function addDaysIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Primeiro e último dia do mês de uma data YYYY-MM-DD. */
export function monthBounds(isoDate: string): { start: string; end: string } {
  const [y, m] = isoDate.split("-").map(Number);
  const year = y ?? 1970;
  const month = m ?? 1;
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start, end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

/** Deslocamento do fuso (ms) em um instante UTC. */
function zoneOffsetMillis(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const wallClockAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return wallClockAsUtc - timestamp;
}

/**
 * Normaliza um limite de período vindo da query string. Uma data do calendário
 * (`YYYY-MM-DD`) vale o dia inteiro no fuso da aplicação -- sem isso o valor
 * sozinho comparava como texto com os instantes ISO gravados e o filtro padrão
 * "até hoje" deixava de fora tudo o que aconteceu no dia. Um instante ISO
 * completo passa como está.
 */
export function normalizeRangeBound(value: string, endOfDay: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [y, m, d] = value.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(
    y ?? 1970,
    (m ?? 1) - 1,
    d ?? 1,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  // Duas passagens resolvem o deslocamento mesmo em virada de horário de verão.
  const firstGuess = wallClockAsUtc - zoneOffsetMillis(wallClockAsUtc, APP_TIMEZONE);
  return new Date(wallClockAsUtc - zoneOffsetMillis(firstGuess, APP_TIMEZONE)).toISOString();
}

/** Segunda-feira da semana que contem a data informada. */
export function weekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const dow = base.getUTCDay(); // 0 = domingo
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDaysIsoDate(isoDate, delta);
}

export function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Próximo valor de um contador sequencial. O UPDATE ... RETURNING e atômico no
 * SQLite, portanto não há corrida entre requisições concorrentes.
 */
export async function nextCounter(db: D1Database, name: string): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO counters (name, value) VALUES (?, 1)
       ON CONFLICT(name) DO UPDATE SET value = counters.value + 1
       RETURNING value`,
    )
    .bind(name)
    .first<{ value: number }>();
  if (!row) throw new Error(`Falha ao incrementar o contador "${name}".`);
  return row.value;
}

/** Código legível e sequencial: TCK-2026-000042 */
export function buildCode(prefix: string, value: number, year = new Date().getUTCFullYear()): string {
  return `${prefix}-${year}-${String(value).padStart(6, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Criptografia                                                               */
/* -------------------------------------------------------------------------- */

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

export async function hashPassword(
  password: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<PasswordHash> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const bits = await derivePasswordBits(password, salt, iterations);
  return { hash: bytesToBase64(bits), salt: bytesToBase64(salt), iterations };
}

async function derivePasswordBits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(derived);
}

export async function verifyPassword(
  password: string,
  stored: { hash: string; salt: string; iterations: number | null },
): Promise<boolean> {
  const iterations = stored.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  let saltBytes: Uint8Array;
  try {
    saltBytes = base64ToBytes(stored.salt);
  } catch {
    return false;
  }
  const derived = await derivePasswordBits(password, saltBytes, iterations);
  return timingSafeEqual(bytesToBase64(derived), stored.hash);
}

/** Comparação em tempo constante (sem retorno antecipado). */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* -------------------------------------------------------------------------- */
/* SQL                                                                        */
/* -------------------------------------------------------------------------- */

/** Identificador válido para nome de coluna/tabela (defesa contra injeção em
 *  trechos de SQL montados dinamicamente, como listas de ordenação). */
export function safeSqlIdentifier(value: string, allowed: readonly string[]): string {
  if (!allowed.includes(value)) throw new Error(`Identificador não permitido: ${value}`);
  return value;
}

/** Monta "?, ?, ?" para clausulas IN. */
export function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}
