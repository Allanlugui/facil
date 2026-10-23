import { Hono } from "hono";
import { z } from "zod";
import { PERMISSIONS } from "@shared/permissions";
import type { AppContext, AppEnv, AuthUser } from "../types";
import { currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo, recordAudit } from "../audit";
import { allRows, countRows, insertStatement, normalizePage, offsetOf, oneRow, updateStatement } from "../db";
import { ApiError, badRequest, conflict, forbidden, notFound, parseBody } from "../errors";
import {
  ALLOWED_MIME_PREFIXES,
  PUBLIC_ALLOWED_MIME_PREFIXES,
  attachmentDisposition,
  humanSize,
  mimeAllowed,
  normalizeMimeType,
} from "../files";
import { readMailConfig, mailConfigured, queueEmail, deliverOutbox, type QueuedEmailStatement } from "../mailer";
import { notificationStatements, usersWithPermission } from "../notify";
import { getSetting } from "./settings";
import { readCaptchaConfig, isCaptchaRequired, verifyCaptchaToken } from "../captcha";
import { buildCode, nextCounter, nowIso, randomToken, sha256Hex, uuid } from "../util";

/**
 * Central de suporte.
 *
 * Dois fluxos na mesma estrutura (`support_requests` + `support_messages`):
 *   - redefinição de senha, aberto pela tela de login por quem perdeu acesso;
 *   - ajuda geral, aberto dentro do sistema por quem já está logado.
 *
 * Regras centrais:
 *   - o token de acompanhamento (link) é a credencial de quem não tem sessão;
 *     só o hash é gravado, como nas sessões;
 *   - cada mensagem entra na fila de e-mails (`email_outbox`) na MESMA transação
 *     da conversa; o envio real depende do provedor configurado;
 *   - mensagens aceitam arquivos (prints, PDF, documentos): o binário vai para
 *     o bucket R2 (binding `ATTACHMENTS`) e os metadados para `attachments`
 *     (F-19); uploads sem sessão (token) têm teto menor e lista de tipos
 *     reduzida (D-18);
 *   - a fila é FIFO: quem pediu antes é atendido antes (posição exibida de
 *     forma discreta para o solicitante);
 *   - negativas de acesso e todas as ações ficam na trilha de auditoria.
 */

const router = new Hono<AppEnv>();

const MANAGE = PERMISSIONS.SUPPORT_MANAGE;

/* -------------------------------------------------------------------------- */
/* Tempo real (Durable Object por atendimento)                                */
/* -------------------------------------------------------------------------- */

function supportRoom(env: Env, requestId: string): DurableObjectStub {
  return env.SUPPORT_ROOM.get(env.SUPPORT_ROOM.idFromName(`support:${requestId}`));
}

/** Falha do Durable Object nunca derruba a mensagem já gravada no D1. */
async function broadcastRoom(env: Env, requestId: string, payload: unknown): Promise<void> {
  try {
    await supportRoom(env, requestId).fetch("https://support-room/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Sem sala (primeiro deploy ou manutenção): o polling de segurança cobre.
  }
}

async function upgradeRoom(
  c: AppContext,
  requestId: string,
  role: "staff" | "requester",
): Promise<Response> {
  const headers = new Headers(c.req.raw.headers);
  headers.set("Upgrade", "websocket");
  headers.set("x-room-role", role);
  return supportRoom(c.env, requestId).fetch(
    new Request("https://support-room/ws", { method: "GET", headers }),
  );
}

const typingBody = z.object({
  clientId: z.string().trim().max(80).optional(),
  typing: z.boolean().optional(),
});

const KIND_LABEL: Record<string, string> = {
  password_reset: "Redefinição de senha",
  help: "Ajuda geral",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Na fila de atendimento",
  in_progress: "Em atendimento",
  resolved: "Resolvido",
};

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

async function staffIds(db: D1Database): Promise<string[]> {
  return usersWithPermission(db, MANAGE);
}

async function staffEmails(db: D1Database): Promise<string[]> {
  const rows = await allRows<{ email: string }>(
    db,
    `SELECT DISTINCT u.email
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
      WHERE u.is_active = 1 AND rp.permission_code = ?`,
    [MANAGE],
  );
  return rows.map((row) => row.email);
}

function trackingUrl(origin: string, token: string): string {
  return `${origin}/suporte/acompanhar/${token}`;
}

async function queuePosition(db: D1Database, createdAt: string, id: string): Promise<number> {
  // Critério idêntico ao da listagem da fila (created_at, id), para a posição
  // mostrada ao solicitante bater com a ordem real de atendimento mesmo quando
  // dois pedidos entram no mesmo milissegundo.
  const ahead = await countRows(
    db,
    `SELECT COUNT(*) FROM support_requests
      WHERE status = 'queued' AND (created_at < ? OR (created_at = ? AND id < ?))`,
    [createdAt, createdAt, id],
  );
  return ahead + 1;
}

function mapRequest(row: Record<string, unknown>, position: number | null) {
  return {
    id: String(row.id),
    code: String(row.code),
    kind: String(row.kind),
    status: String(row.status),
    requesterName: String(row.requester_name),
    requesterEmail: String(row.requester_email),
    requesterSector: row.requester_sector ? String(row.requester_sector) : null,
    requesterRegistration: row.requester_registration ? String(row.requester_registration) : null,
    reason: String(row.reason),
    userId: row.user_id ? String(row.user_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    resolvedAt: row.resolved_at ? String(row.resolved_at) : null,
    position,
  };
}

type AttachmentUrlBuilder = (id: string) => string;

function mapMessage(
  row: Record<string, unknown>,
  attachments: MessageAttachmentRow[],
  attachmentUrl: AttachmentUrlBuilder,
) {
  return {
    id: String(row.id),
    authorType: String(row.author_type),
    authorName: String(row.author_name),
    body: String(row.body),
    createdAt: String(row.created_at),
    attachments: attachments.map((attachment) => ({
      id: String(attachment.id),
      filename: String(attachment.filename),
      mimeType: String(attachment.mime_type),
      sizeBytes: Number(attachment.size_bytes),
      url: attachmentUrl(String(attachment.id)),
    })),
  };
}

async function loadRequest(db: D1Database, id: string): Promise<Record<string, unknown>> {
  const row = await oneRow<Record<string, unknown>>(db, `SELECT * FROM support_requests WHERE id = ?`, [id]);
  if (!row) throw notFound("Pedido de suporte não encontrado.");
  return row;
}

function isStaff(user: AuthUser): boolean {
  return user.permissions.has(MANAGE);
}

function assertRequestAccess(user: AuthUser, row: Record<string, unknown>): void {
  if (isStaff(user)) return;
  if (row.user_id && String(row.user_id) === user.id) return;
  throw forbidden("Você só pode acessar os seus próprios pedidos de suporte.");
}

/* -------------------------------------------------------------------------- */
/* Anexos da conversa (R2 + metadados no D1)                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_MAX_BYTES = "20971520";
/** Uploads sem sessão (token) são mais restritos que os autenticados (D-18). */
const PUBLIC_MAX_FILES_PER_MESSAGE = 3;
const PUBLIC_MAX_BYTES_PER_FILE = 5 * 1024 * 1024;
const SESSION_MAX_FILES_PER_MESSAGE = 10;
const MAX_ATTACHMENTS_PER_REQUEST = 40;

export interface AttachmentLimits {
  maxFilesPerMessage: number;
  maxBytesPerFile: number;
  maxBytesPerMessage: number;
}

async function attachmentLimits(db: D1Database, anonymous: boolean): Promise<AttachmentLimits> {
  const configured = Number(await getSetting(db, "attachments.max_bytes", DEFAULT_MAX_BYTES));
  const maxBytesPerFile = anonymous ? Math.min(configured, PUBLIC_MAX_BYTES_PER_FILE) : configured;
  return {
    maxFilesPerMessage: anonymous ? PUBLIC_MAX_FILES_PER_MESSAGE : SESSION_MAX_FILES_PER_MESSAGE,
    maxBytesPerFile,
    // O total da mensagem usa o mesmo teto do arquivo: um arquivo grande ou
    // vários menores somando o mesmo limite (o corpo da requisição fica
    // sempre dentro do que um Worker aguenta ler).
    maxBytesPerMessage: maxBytesPerFile,
  };
}

const messageSchema = z.object({
  body: z.string().trim().min(1, "Escreva uma mensagem.").max(2000),
});

interface MessageInput {
  text: string;
  files: File[];
}

/**
 * Aceita `application/json` (campo `body`, como antes) ou
 * `multipart/form-data` (campo `body` opcional + `files` repetido).
 */
async function parseMessageInput(c: AppContext, limits: AttachmentLimits): Promise<MessageInput> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    // Recusa antes de materializar o FormData: multipart tem overhead de
    // boundary/campos, daí a folga de 1 MB sobre o limite da mensagem.
    const declaredLength = Number(c.req.header("content-length") ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > limits.maxBytesPerMessage + 1_048_576) {
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "Os arquivos enviados excedem o limite da mensagem.");
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw badRequest("Formulário inválido: não foi possível ler os arquivos enviados.");
    }
    const text = String(form.get("body") ?? "").trim();
    if (text.length > 2000) throw badRequest("A mensagem pode ter no máximo 2000 caracteres.");
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (text.length === 0 && files.length === 0) throw badRequest("Escreva uma mensagem ou anexe um arquivo.");
    return { text, files };
  }
  const body = await parseBody(c, messageSchema);
  return { text: body.body, files: [] };
}

async function validateAttachments(
  db: D1Database,
  requestId: string,
  files: File[],
  anonymous: boolean,
): Promise<void> {
  if (files.length === 0) return;
  const limits = await attachmentLimits(db, anonymous);

  if (files.length > limits.maxFilesPerMessage) {
    throw badRequest(
      `Cada mensagem aceita no máximo ${limits.maxFilesPerMessage} arquivos.`,
      { maxFilesPerMessage: limits.maxFilesPerMessage },
    );
  }

  const allowed = anonymous ? PUBLIC_ALLOWED_MIME_PREFIXES : ALLOWED_MIME_PREFIXES;
  let total = 0;
  for (const file of files) {
    const name = file.name || "anexo";
    const mimeType = normalizeMimeType(file.type || "application/octet-stream");
    if (file.size === 0) throw badRequest(`O arquivo "${name}" está vazio.`);
    if (file.size > limits.maxBytesPerFile) {
      throw badRequest(
        `"${name}" tem ${humanSize(file.size)} e excede o limite de ${humanSize(limits.maxBytesPerFile)} por arquivo.`,
        { maxBytesPerFile: limits.maxBytesPerFile },
      );
    }
    if (!mimeAllowed(allowed, mimeType)) {
      throw badRequest(
        anonymous
          ? `Tipo de arquivo não permitido no acompanhamento público: ${mimeType}. Anexe imagem, PDF ou texto.`
          : `Tipo de arquivo não permitido: ${mimeType}.`,
        { allowed },
      );
    }
    total += file.size;
  }
  if (total > limits.maxBytesPerMessage) {
    throw badRequest(
      `Os arquivos somam ${humanSize(total)} e excedem o limite de ${humanSize(limits.maxBytesPerMessage)} por mensagem.`,
      { maxBytesPerMessage: limits.maxBytesPerMessage },
    );
  }

  const existing = await countRows(
    db,
    `SELECT COUNT(*) FROM attachments a
       JOIN support_messages m ON m.id = a.entity_id
      WHERE a.entity_type = 'support_message' AND m.request_id = ?`,
    [requestId],
  );
  if (existing + files.length > MAX_ATTACHMENTS_PER_REQUEST) {
    throw conflict(
      `Este atendimento já tem ${existing} anexos e o limite é ${MAX_ATTACHMENTS_PER_REQUEST}. Abra um novo pedido se precisar enviar mais arquivos.`,
    );
  }
}

function attachmentEmailLines(files: File[]): string[] {
  if (files.length === 0) return [];
  return [
    "",
    `Anexos (${files.length}):`,
    ...files.map((file) => `- ${file.name || "anexo"} (${humanSize(file.size)})`),
    "Abra o atendimento no sistema para baixar os arquivos.",
  ];
}

/**
 * Anexos do suporte vivem no R2. Se o bucket ainda não existir (R2 não
 * habilitado na conta) devolvemos 503 com mensagem clara, em vez de 500.
 */
function attachmentsBucket(env: Env): R2Bucket {
  // O binding e opcional na configuracao (R2 pode nao estar habilitado na conta).
  const bucket = optionalBucket(env);
  if (!bucket) {
    throw new ApiError(
      503,
      "R2_UNAVAILABLE",
      "Anexos do suporte indisponíveis: o bucket R2 não está configurado neste ambiente.",
    );
  }
  return bucket;
}

function optionalBucket(env: Env): R2Bucket | undefined {
  return (env as { ATTACHMENTS?: R2Bucket }).ATTACHMENTS;
}

/**
 * Envia os binários ao R2 e devolve os INSERTs (entram no MESMO batch da
 * mensagem) + as chaves gravadas, para limpeza se o batch falhar.
 */
async function storeAttachments(
  env: Env,
  messageId: string,
  files: File[],
  author: { userId: string | null; name: string },
  ts: string,
): Promise<{ statements: D1PreparedStatement[]; keys: string[] }> {
  const statements: D1PreparedStatement[] = [];
  const keys: string[] = [];
  try {
    for (const file of files) {
      const id = uuid();
      const key = `anexos/${id}`;
      const mimeType = normalizeMimeType(file.type || "application/octet-stream");
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        await attachmentsBucket(env).put(key, bytes, { httpMetadata: { contentType: mimeType } });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          503,
          "R2_UNAVAILABLE",
          "Não foi possível gravar o anexo no R2. Verifique se o bucket facil-attachments foi criado.",
        );
      }
      keys.push(key);
      statements.push(
        env.DB.prepare(
          `INSERT INTO attachments
             (id, entity_type, entity_id, filename, mime_type, size_bytes, content, storage, r2_key, uploaded_by, author_name, created_at)
           VALUES (?,?,?,?,?,?,NULL,'r2',?,?,?,?)`,
        ).bind(
          id,
          "support_message",
          messageId,
          file.name || "anexo",
          mimeType,
          bytes.byteLength,
          key,
          author.userId,
          author.name,
          ts,
        ),
      );
    }
  } catch (error) {
    // Nenhum metadado foi gravado ainda; remove o que subiu para não deixar órfãos.
    await Promise.allSettled(keys.map((key) => optionalBucket(env)?.delete(key)));
    throw error;
  }
  return { statements, keys };
}

interface MessageAttachmentRow {
  id: string;
  entity_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

/** Anexos das mensagens do atendimento, agrupados por mensagem. */
async function messageAttachments(
  db: D1Database,
  requestId: string,
): Promise<Map<string, MessageAttachmentRow[]>> {
  const rows = await allRows<MessageAttachmentRow>(
    db,
    `SELECT a.id, a.entity_id, a.filename, a.mime_type, a.size_bytes
       FROM attachments a
       JOIN support_messages m ON m.id = a.entity_id
      WHERE a.entity_type = 'support_message' AND m.request_id = ?
      ORDER BY a.created_at`,
    [requestId],
  );
  const grouped = new Map<string, MessageAttachmentRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.entity_id) ?? [];
    list.push(row);
    grouped.set(row.entity_id, list);
  }
  return grouped;
}

interface SupportAttachmentRow {
  id: string;
  entity_type: string;
  entity_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  content: ArrayBuffer | Uint8Array | number[] | null;
  storage: string;
  r2_key: string | null;
}

async function loadSupportAttachment(db: D1Database, id: string): Promise<SupportAttachmentRow> {
  const row = await oneRow<SupportAttachmentRow>(
    db,
    `SELECT id, entity_type, entity_id, filename, mime_type, size_bytes, content, storage, r2_key
       FROM attachments WHERE id = ?`,
    [id],
  );
  if (!row || row.entity_type !== "support_message") throw notFound("Anexo não encontrado.");
  return row;
}

async function messageRequestId(db: D1Database, messageId: string): Promise<string> {
  const row = await oneRow<{ request_id: string }>(
    db,
    `SELECT request_id FROM support_messages WHERE id = ?`,
    [messageId],
  );
  if (!row) throw notFound("Anexo não encontrado.");
  return row.request_id;
}

async function sendSupportAttachment(env: Env, row: SupportAttachmentRow): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": row.mime_type,
    // SVG e formatos não visuais nunca abrem inline; o navegador baixa.
    "content-disposition": `${attachmentDisposition(row.mime_type)}; filename="${encodeURIComponent(row.filename)}"`,
    "cache-control": "private, no-store",
  };

  if (row.storage === "r2" && row.r2_key) {
    let object: R2ObjectBody | null;
    try {
      object = await attachmentsBucket(env).get(row.r2_key);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, "R2_UNAVAILABLE", "Armazenamento de anexos indisponível (R2).");
    }
    if (!object) throw notFound("Arquivo não encontrado no armazenamento.");
    return new Response(object.body, {
      headers: { ...headers, "content-length": String(object.size), etag: object.httpEtag },
    });
  }

  if (row.content === null) throw notFound("Arquivo não encontrado.");
  const bytes =
    row.content instanceof ArrayBuffer
      ? new Uint8Array(row.content)
      : row.content instanceof Uint8Array
        ? row.content
        : new Uint8Array(row.content);
  return new Response(bytes, {
    headers: { ...headers, "content-length": String(bytes.byteLength) },
  });
}

/* -------------------------------------------------------------------------- */
/* Base de conhecimento (artigos)                                             */
/* -------------------------------------------------------------------------- */

const articleSchema = z.object({
  title: z.string().trim().min(3, "Informe um título.").max(160),
  category: z.enum(["general", "security", "news", "faq"]).optional().default("general"),
  summary: z.string().trim().max(300).nullish(),
  body: z.string().trim().min(10, "Escreva o conteúdo do artigo.").max(20000),
  pinned: z.boolean().optional().default(false),
  published: z.boolean().optional().default(true),
});

const articleUpdateSchema = z.object({
  // Sem `.partial()` aqui de propósito: o partial do zod reaplicaria os
  // defaults do schema de criação e sobrescreveria campos não enviados.
  title: z.string().trim().min(3, "Informe um título.").max(160).optional(),
  category: z.enum(["general", "security", "news", "faq"]).optional(),
  summary: z.string().trim().max(300).nullish(),
  body: z.string().trim().min(10, "Escreva o conteúdo do artigo.").max(20000).optional(),
  pinned: z.boolean().optional(),
  published: z.boolean().optional(),
});

function mapArticle(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    category: String(row.category),
    summary: row.summary ? String(row.summary) : null,
    body: String(row.body),
    pinned: Number(row.pinned) === 1,
    published: Number(row.published) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

/** Publico: qualquer visitante ve os artigos publicados; staff ve tambem rascunhos. */
router.get("/articles", async (c) => {
  const user = c.get("user");
  const manager = user ? isStaff(user) : false;
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, title, category, summary, body, pinned, published, created_at, updated_at
       FROM support_articles
      ${manager ? "" : "WHERE published = 1"}
      ORDER BY pinned DESC, updated_at DESC`,
  );
  return c.json({ items: rows.map(mapArticle) });
});

router.post("/articles", requirePermission(MANAGE), async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, articleSchema);
  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    insertStatement(c.env.DB, "support_articles", {
      id,
      title: body.title,
      category: body.category,
      summary: body.summary ?? null,
      body: body.body,
      pinned: body.pinned ? 1 : 0,
      published: body.published ? 1 : 0,
      created_by: user.id,
      created_at: ts,
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "support",
      action: "support.article.create",
      entityType: "support_article",
      entityId: id,
      after: { title: body.title, category: body.category, published: body.published },
      ...info,
    }),
  ]);
  return c.json({ id }, 201);
});

router.patch("/articles/:id", requirePermission(MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, articleUpdateSchema);

  const existing = await oneRow<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, title, category, published FROM support_articles WHERE id = ?`,
    [id],
  );
  if (!existing) throw notFound("Artigo não encontrado.");

  const ts = nowIso();
  const info = clientInfo(c);
  await c.env.DB.batch([
    updateStatement(c.env.DB, "support_articles", id, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.summary !== undefined ? { summary: body.summary ?? null } : {}),
      ...(body.body !== undefined ? { body: body.body } : {}),
      ...(body.pinned !== undefined ? { pinned: body.pinned ? 1 : 0 } : {}),
      ...(body.published !== undefined ? { published: body.published ? 1 : 0 } : {}),
      updated_at: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "support",
      action: "support.article.update",
      entityType: "support_article",
      entityId: id,
      before: { title: existing.title, category: existing.category, published: Number(existing.published) === 1 },
      after: body,
      ...info,
    }),
  ]);
  return c.json({ ok: true });
});

router.delete("/articles/:id", requirePermission(MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const existing = await oneRow<{ id: string; title: string }>(
    c.env.DB,
    `SELECT id, title FROM support_articles WHERE id = ?`,
    [id],
  );
  if (!existing) throw notFound("Artigo não encontrado.");
  const info = clientInfo(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM support_articles WHERE id = ?`).bind(id),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "support",
      action: "support.article.delete",
      entityType: "support_article",
      entityId: id,
      before: { title: existing.title },
      ...info,
    }),
  ]);
  return c.json({ ok: true });
});

/* -------------------------------------------------------------------------- */
/* Pedidos: criação (com ou sem sessão)                                       */
/* -------------------------------------------------------------------------- */

const createSchema = z.object({
  kind: z.enum(["password_reset", "help"]),
  name: z.string().trim().min(3, "Informe o seu nome completo.").max(120),
  email: z.string().trim().toLowerCase().email("E-mail inválido.").max(160),
  sector: z.string().trim().max(120).nullish(),
  registration: z.string().trim().max(60).nullish(),
  reason: z.string().trim().min(10, "Descreva o motivo com pelo menos 10 caracteres.").max(2000),
  // Captcha (camada final, D-15): exigido somente quando habilitado e o
  // solicitante nao tem sessao (canal publico).
  captcha_token: z.string().optional(),
});

const MAX_OPEN_PER_EMAIL = 3;
const MAX_MESSAGES_PER_REQUEST = 80;
/** Freio por IP para pedidos anônimos enquanto o captcha não existe. */
const PUBLIC_REQUESTS_PER_HOUR = 10;

router.post("/requests", async (c) => {
  const user = c.get("user");
  const info = clientInfo(c);

  if (!user && info.ip) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await countRows(
      c.env.DB,
      `SELECT COUNT(*) FROM audit_log
        WHERE action = 'support.request.create' AND ip = ? AND created_at >= ?`,
      [info.ip, since],
    );
    if (recent >= PUBLIC_REQUESTS_PER_HOUR) {
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "Muitos pedidos de suporte deste endereço. Aguarde alguns minutos e tente de novo.",
      );
    }
  }

  const body = await parseBody(c, createSchema);

  // Captcha (camada final, D-15): canal publico (sem sessao) exige token valido
  // quando o administrador habilitou. Usuarios logados nao precisam.
  if (!user && info.ip) {
    const captchaRows = await allRows<{ key: string; value: string }>(
      c.env.DB,
      `SELECT key, value FROM settings WHERE key IN ('captcha.enabled','captcha.site_key','captcha.secret_key')`,
    );
    const captchaConfig = readCaptchaConfig(
      Object.fromEntries(captchaRows.map((row) => [String(row.key), String(row.value)])),
    );
    if (isCaptchaRequired(captchaConfig)) {
      const ok = await verifyCaptchaToken(captchaConfig.secretKey, body.captcha_token ?? "", info.ip);
      if (!ok) {
        await recordAudit(c.env.DB, {
          actor: null,
          module: "support",
          action: "support.request.captcha_failed",
          entityType: "email",
          entityId: body.email,
          result: "failure",
          reason: "Captcha invalido ou ausente.",
          ...info,
        });
        throw new ApiError(400, "CAPTCHA_REQUIRED", "Preencha o captcha e tente novamente.");
      }
    }
  }

  const sector = body.sector?.trim() || null;
  const registration = body.registration?.trim() || null;

  if (body.kind === "password_reset" && (!sector || !registration)) {
    throw badRequest("Para redefinição de senha, informe setor e matrícula para confirmarmos a sua identidade.");
  }

  // Freio simples anti-duplicidade enquanto o captcha não existe (etapa final
  // de segurança combinada com o usuário): mesmo e-mail não acumula pedidos.
  const open = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM support_requests
      WHERE requester_email = ? AND status IN ('queued','in_progress')`,
    [body.email],
  );
  if (open >= MAX_OPEN_PER_EMAIL) {
    throw conflict(
      "Você já tem pedidos de suporte em aberto. Acompanhe pelo link recebido ou aguarde o atendimento.",
    );
  }

  const id = uuid();
  const ts = nowIso();
  const code = buildCode("SUP", await nextCounter(c.env.DB, "support"));
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  const origin = new URL(c.req.url).origin;

  const staff = await staffIds(c.env.DB);
  const emails = await staffEmails(c.env.DB);

  const mailRequester = queueEmail(c.env.DB, {
    to: body.email,
    subject: `[Suporte ${code}] Recebemos o seu pedido`,
    body: [
      `Olá, ${body.name}!`,
      ``,
      `Recebemos o seu pedido de ${KIND_LABEL[body.kind]} (${code}).`,
      ``,
      `Acompanhe o status, veja a sua posição na fila e converse com o suporte pelo link:`,
      trackingUrl(origin, token),
      ``,
      `Guarde este link: ele é a sua chave de acesso ao atendimento.`,
      ``,
      `Equipe de suporte — Facil`,
    ].join("\n"),
    kind: "support_request",
    relatedId: id,
  });

  const mailStaff: QueuedEmailStatement[] = emails.map((email) =>
    queueEmail(c.env.DB, {
      to: email,
      subject: `[Suporte ${code}] Novo pedido — ${KIND_LABEL[body.kind]}`,
      body: [
        `Novo pedido de suporte ${code}.`,
        ``,
        `Tipo: ${KIND_LABEL[body.kind]}`,
        `Solicitante: ${body.name}`,
        `E-mail: ${body.email}`,
        sector ? `Setor: ${sector}` : null,
        registration ? `Matrícula: ${registration}` : null,
        ``,
        `Motivo:`,
        body.reason,
        ``,
        `Atenda na fila: ${origin}/ajuda/${id}`,
      ]
        .filter((line): line is string => line !== null)
        .join("\n"),
      kind: "support_request",
      relatedId: id,
    }),
  );

  await c.env.DB.batch([
    insertStatement(c.env.DB, "support_requests", {
      id,
      code,
      kind: body.kind,
      status: "queued",
      requester_name: body.name,
      requester_email: body.email,
      requester_sector: sector,
      requester_registration: registration,
      reason: body.reason,
      user_id: user?.id ?? null,
      token_hash: tokenHash,
      created_at: ts,
      updated_at: ts,
      resolved_at: null,
      resolved_by: null,
    }),
    insertStatement(c.env.DB, "support_messages", {
      id: uuid(),
      request_id: id,
      author_type: "requester",
      author_name: body.name,
      user_id: user?.id ?? null,
      body: body.reason,
      created_at: ts,
    }),
    ...notificationStatements(c.env.DB, staff, {
      type: "support_request",
      title: `Novo pedido de suporte ${code}`,
      body: `${KIND_LABEL[body.kind]} — ${body.name}`,
      link: `/ajuda/${id}`,
      entityType: "support_request",
      entityId: id,
      createdAt: ts,
    }),
    auditStatement(c.env.DB, {
      actor: user ? { id: user.id, name: user.name } : null,
      module: "support",
      action: "support.request.create",
      entityType: "support_request",
      entityId: id,
      after: { code, kind: body.kind, name: body.name },
      ...info,
    }),
    mailRequester.statement,
    ...mailStaff.map((mail) => mail.statement),
  ]);

  await deliverOutbox(c.env.DB, [mailRequester.id, ...mailStaff.map((mail) => mail.id)]);

  const position = await queuePosition(c.env.DB, ts, id);
  return c.json({ id, code, token, status: "queued", position }, 201);
});

/* -------------------------------------------------------------------------- */
/* Acompanhamento publico (token)                                             */
/* -------------------------------------------------------------------------- */

async function requestByToken(db: D1Database, token: string): Promise<Record<string, unknown>> {
  const row = await oneRow<Record<string, unknown>>(
    db,
    `SELECT * FROM support_requests WHERE token_hash = ?`,
    [await sha256Hex(token)],
  );
  if (!row) throw notFound("Acompanhamento não encontrado. Confira o link recebido.");
  return row;
}

router.get("/track/:token", async (c) => {
  const token = c.req.param("token");
  const row = await requestByToken(c.env.DB, token);
  const messages = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, author_type, author_name, body, created_at
       FROM support_messages WHERE request_id = ? ORDER BY created_at`,
    [String(row.id)],
  );
  const attachments = await messageAttachments(c.env.DB, String(row.id));
  const position =
    String(row.status) === "queued"
      ? await queuePosition(c.env.DB, String(row.created_at), String(row.id))
      : null;
  const attachmentUrl = (id: string) =>
    `/api/support/track/${encodeURIComponent(token)}/attachments/${id}`;
  return c.json({
    request: mapRequest(row, position),
    messages: messages.map((message) =>
      mapMessage(message, attachments.get(String(message.id)) ?? [], attachmentUrl),
    ),
    limits: await attachmentLimits(c.env.DB, true),
  });
});

/* -------------------------------------------------------------------------- */
/* Tempo real do acompanhamento público                                       */
/* -------------------------------------------------------------------------- */

router.get("/track/:token/socket", async (c) => {
  const row = await requestByToken(c.env.DB, c.req.param("token"));
  return upgradeRoom(c, String(row.id), "requester");
});

router.post("/track/:token/typing", async (c) => {
  const row = await requestByToken(c.env.DB, c.req.param("token"));
  if (String(row.status) !== "resolved") {
    const body = await parseBody(c, typingBody);
    await broadcastRoom(c.env, String(row.id), {
      type: "typing",
      requestId: String(row.id),
      authorType: "requester",
      authorName: String(row.requester_name),
      clientId: body.clientId ?? null,
      at: nowIso(),
    });
  }
  return c.body(null, 204);
});

router.post("/track/:token/messages", async (c) => {
  const token = c.req.param("token");
  const row = await requestByToken(c.env.DB, token);
  if (String(row.status) === "resolved") {
    throw conflict("Este atendimento foi encerrado. Se precisar, abra um novo pedido de suporte.");
  }
  const limits = await attachmentLimits(c.env.DB, true);
  const input = await parseMessageInput(c, limits);
  const requestId = String(row.id);

  const total = await countRows(
    c.env.DB,
    `SELECT COUNT(*) FROM support_messages WHERE request_id = ?`,
    [requestId],
  );
  if (total >= MAX_MESSAGES_PER_REQUEST) {
    throw conflict("Limite de mensagens deste atendimento atingido. Aguarde o retorno do suporte.");
  }

  await validateAttachments(c.env.DB, requestId, input.files, true);

  const id = uuid();
  const ts = nowIso();
  const origin = new URL(c.req.url).origin;
  const info = clientInfo(c);
  const authorName = String(row.requester_name);
  const emailText = input.text || "(sem texto — confira os anexos no acompanhamento)";

  const staff = await staffIds(c.env.DB);
  const emails = await staffEmails(c.env.DB);
  const mailStaff: QueuedEmailStatement[] = emails.map((email) =>
    queueEmail(c.env.DB, {
      to: email,
      subject: `[Suporte ${String(row.code)}] Nova mensagem de ${authorName}`,
      body: [
        `Mensagem de ${authorName} no atendimento ${String(row.code)}:`,
        ``,
        emailText,
        ...attachmentEmailLines(input.files),
        ``,
        `Responda pelo sistema: ${origin}/ajuda/${requestId}`,
      ].join("\n"),
      kind: "support_message",
      relatedId: requestId,
    }),
  );

  const stored = await storeAttachments(
    c.env,
    id,
    input.files,
    { userId: row.user_id ? String(row.user_id) : null, name: authorName },
    ts,
  );

  try {
    await c.env.DB.batch([
      insertStatement(c.env.DB, "support_messages", {
        id,
        request_id: requestId,
        author_type: "requester",
        author_name: authorName,
        user_id: row.user_id ? String(row.user_id) : null,
        body: input.text,
        created_at: ts,
      }),
      c.env.DB.prepare(`UPDATE support_requests SET updated_at = ? WHERE id = ?`).bind(ts, requestId),
      ...notificationStatements(c.env.DB, staff, {
        type: "support_message",
        title: `Nova mensagem no atendimento ${String(row.code)}`,
        body:
          input.files.length > 0
            ? `${authorName} enviou uma mensagem com ${input.files.length} anexo(s).`
            : `${authorName} enviou uma mensagem.`,
        link: `/ajuda/${requestId}`,
        entityType: "support_request",
        entityId: requestId,
        createdAt: ts,
      }),
      auditStatement(c.env.DB, {
        actor: null,
        module: "support",
        action: "support.message",
        entityType: "support_request",
        entityId: requestId,
        after: { authorType: "requester", attachments: input.files.length },
        ...info,
      }),
      ...mailStaff.map((mail) => mail.statement),
      ...stored.statements,
    ]);
  } catch (error) {
    await Promise.allSettled(stored.keys.map((key) => optionalBucket(c.env)?.delete(key)));
    throw error;
  }

  await deliverOutbox(c.env.DB, mailStaff.map((mail) => mail.id));
  await broadcastRoom(c.env, requestId, {
    type: "message",
    requestId,
    messageId: id,
    authorType: "requester",
    authorName,
    at: ts,
  });
  return c.json({ id }, 201);
});

/* -------------------------------------------------------------------------- */
/* Consultas com sessão                                                       */
/* -------------------------------------------------------------------------- */

const QUEUE_SELECT = `
  SELECT s.id, s.code, s.kind, s.status, s.requester_name, s.requester_email,
         s.requester_sector, s.requester_registration, s.reason, s.user_id,
         s.created_at, s.updated_at, s.resolved_at,
         (SELECT COUNT(*) FROM support_messages m WHERE m.request_id = s.id) AS message_count,
         (SELECT MAX(m.created_at) FROM support_messages m WHERE m.request_id = s.id) AS last_message_at,
         (SELECT COUNT(*) FROM support_requests s2
            WHERE s2.status = 'queued'
              AND (s2.created_at < s.created_at OR (s2.created_at = s.created_at AND s2.id < s.id))) + 1 AS queue_position
    FROM support_requests s`;

function mapQueueItem(row: Record<string, unknown>) {
  return {
    ...mapRequest(row, String(row.status) === "queued" ? Number(row.queue_position ?? 1) : null),
    messageCount: Number(row.message_count ?? 0),
    lastMessageAt: row.last_message_at ? String(row.last_message_at) : null,
  };
}

router.get("/my", requireAuth, async (c) => {
  const user = currentUser(c);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${QUEUE_SELECT} WHERE s.user_id = ? ORDER BY s.created_at DESC LIMIT 100`,
    [user.id],
  );
  return c.json({ items: rows.map(mapQueueItem) });
});

router.get("/queue", requirePermission(MANAGE), async (c) => {
  const url = new URL(c.req.url);
  const page = normalizePage({
    page: Number(url.searchParams.get("page") ?? 1),
    pageSize: Number(url.searchParams.get("pageSize") ?? 25),
  });

  const clauses: string[] = [];
  const params: (string | number)[] = [];

  const status = url.searchParams.get("status")?.trim();
  if (status) {
    if (!["queued", "in_progress", "resolved"].includes(status)) throw badRequest("Status inválido.");
    clauses.push("s.status = ?");
    params.push(status);
  }
  const kind = url.searchParams.get("kind")?.trim();
  if (kind) {
    if (!["password_reset", "help"].includes(kind)) throw badRequest("Tipo inválido.");
    clauses.push("s.kind = ?");
    params.push(kind);
  }
  const search = url.searchParams.get("search")?.trim();
  if (search) {
    clauses.push(
      `(s.requester_name LIKE ? OR s.requester_email LIKE ? OR s.code LIKE ? OR s.reason LIKE ?)`,
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = await countRows(c.env.DB, `SELECT COUNT(*) FROM support_requests s ${where}`, params);
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `${QUEUE_SELECT} ${where}
      ORDER BY CASE s.status WHEN 'queued' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
               s.created_at ASC, s.id ASC
      LIMIT ? OFFSET ?`,
    [...params, page.pageSize, offsetOf(page)],
  );

  const facetRows = await allRows<{ status: string; total: number }>(
    c.env.DB,
    `SELECT status, COUNT(*) AS total FROM support_requests GROUP BY status`,
  );
  const counts: Record<string, number> = { queued: 0, in_progress: 0, resolved: 0 };
  for (const facet of facetRows) counts[facet.status] = Number(facet.total);

  return c.json({
    items: rows.map(mapQueueItem),
    total,
    page: page.page,
    pageSize: page.pageSize,
    counts,
  });
});

router.get("/requests/:id", requireAuth, async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await loadRequest(c.env.DB, id);
  assertRequestAccess(user, row);

  const messages = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, author_type, author_name, body, created_at
       FROM support_messages WHERE request_id = ? ORDER BY created_at`,
    [id],
  );
  const attachments = await messageAttachments(c.env.DB, id);
  const attachmentUrl = (attachmentId: string) => `/api/support/attachments/${attachmentId}`;

  const position =
    String(row.status) === "queued"
      ? await queuePosition(c.env.DB, String(row.created_at), String(row.id))
      : null;

  const emails = isStaff(user)
    ? await allRows<Record<string, unknown>>(
        c.env.DB,
        `SELECT id, to_email, subject, status, error, created_at, sent_at
           FROM email_outbox WHERE related_id = ? ORDER BY created_at`,
        [id],
      )
    : [];

  return c.json({
    request: mapRequest(row, position),
    messages: messages.map((message) =>
      mapMessage(message, attachments.get(String(message.id)) ?? [], attachmentUrl),
    ),
    limits: await attachmentLimits(c.env.DB, false),
    emails: emails.map((email) => ({
      id: String(email.id),
      toEmail: String(email.to_email),
      subject: String(email.subject),
      status: String(email.status),
      error: email.error ? String(email.error) : null,
      createdAt: String(email.created_at),
      sentAt: email.sent_at ? String(email.sent_at) : null,
    })),
  });
});

/* -------------------------------------------------------------------------- */
/* Tempo real do atendimento interno                                          */
/* -------------------------------------------------------------------------- */

router.get("/requests/:id/socket", requireAuth, async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await loadRequest(c.env.DB, id);
  assertRequestAccess(user, row);
  return upgradeRoom(c, id, isStaff(user) ? "staff" : "requester");
});

router.post("/requests/:id/typing", requireAuth, async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await loadRequest(c.env.DB, id);
  assertRequestAccess(user, row);
  if (String(row.status) !== "resolved") {
    const body = await parseBody(c, typingBody);
    await broadcastRoom(c.env, id, {
      type: "typing",
      requestId: id,
      authorType: isStaff(user) ? "staff" : "requester",
      authorName: user.name,
      clientId: body.clientId ?? null,
      at: nowIso(),
    });
  }
  return c.body(null, 204);
});

router.post("/requests/:id/messages", requireAuth, async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await loadRequest(c.env.DB, id);
  assertRequestAccess(user, row);

  if (String(row.status) === "resolved") {
    throw conflict("Este atendimento foi encerrado. Reabra com um novo pedido se precisar.");
  }

  const limits = await attachmentLimits(c.env.DB, false);
  const input = await parseMessageInput(c, limits);
  await validateAttachments(c.env.DB, id, input.files, false);

  const fromStaff = isStaff(user);
  const authorType = fromStaff ? "staff" : "requester";
  const messageId = uuid();
  const ts = nowIso();
  const origin = new URL(c.req.url).origin;
  const info = clientInfo(c);
  const emailText = input.text || "(sem texto — confira os anexos no atendimento)";

  const mailStatements: QueuedEmailStatement[] = [];
  const notifyUserIds: string[] = [];

  if (fromStaff) {
    if (row.user_id) notifyUserIds.push(String(row.user_id));
    mailStatements.push(
      queueEmail(c.env.DB, {
        to: String(row.requester_email),
        subject: `[Suporte ${String(row.code)}] Nova mensagem do suporte`,
        body: [
          `O suporte respondeu o seu atendimento ${String(row.code)}:`,
          ``,
          emailText,
          ...attachmentEmailLines(input.files),
          ``,
          `Acompanhe e responda pelo link que você recebeu ao abrir o pedido.`,
          ``,
          `Equipe de suporte — Facil`,
        ].join("\n"),
        kind: "support_message",
        relatedId: id,
      }),
    );
  } else {
    notifyUserIds.push(...(await staffIds(c.env.DB)));
    const emails = await staffEmails(c.env.DB);
    mailStatements.push(
      ...emails.map((email) =>
        queueEmail(c.env.DB, {
          to: email,
          subject: `[Suporte ${String(row.code)}] Nova mensagem de ${String(row.requester_name)}`,
          body: [
            `Mensagem de ${String(row.requester_name)} no atendimento ${String(row.code)}:`,
            ``,
            emailText,
            ...attachmentEmailLines(input.files),
            ``,
            `Responda pelo sistema: ${origin}/ajuda/${id}`,
          ].join("\n"),
          kind: "support_message",
          relatedId: id,
        }),
      ),
    );
  }

  const stored = await storeAttachments(
    c.env,
    messageId,
    input.files,
    { userId: user.id, name: user.name },
    ts,
  );

  const attachmentSuffix =
    input.files.length > 0 ? ` (com ${input.files.length} anexo(s))` : "";

  try {
    await c.env.DB.batch([
      insertStatement(c.env.DB, "support_messages", {
        id: messageId,
        request_id: id,
        author_type: authorType,
        author_name: user.name,
        user_id: user.id,
        body: input.text,
        created_at: ts,
      }),
      c.env.DB.prepare(`UPDATE support_requests SET updated_at = ? WHERE id = ?`).bind(ts, id),
      ...notificationStatements(c.env.DB, notifyUserIds, {
        type: "support_message",
        title: `Nova mensagem no atendimento ${String(row.code)}`,
        body: fromStaff
          ? `O suporte enviou uma mensagem${attachmentSuffix}.`
          : `${user.name} enviou uma mensagem${attachmentSuffix}.`,
        link: `/ajuda/${id}`,
        entityType: "support_request",
        entityId: id,
        createdAt: ts,
      }),
      auditStatement(c.env.DB, {
        actor: { id: user.id, name: user.name },
        module: "support",
        action: "support.message",
        entityType: "support_request",
        entityId: id,
        after: { authorType, attachments: input.files.length },
        ...info,
      }),
      ...mailStatements.map((mail) => mail.statement),
      ...stored.statements,
    ]);
  } catch (error) {
    await Promise.allSettled(stored.keys.map((key) => optionalBucket(c.env)?.delete(key)));
    throw error;
  }

  await deliverOutbox(c.env.DB, mailStatements.map((mail) => mail.id));
  await broadcastRoom(c.env, id, {
    type: "message",
    requestId: id,
    messageId,
    authorType,
    authorName: user.name,
    at: ts,
  });

  return c.json({ id: messageId }, 201);
});

/* -------------------------------------------------------------------------- */
/* Anexos: download (sessão ou token) e remoção (staff)                       */
/* -------------------------------------------------------------------------- */

router.get("/attachments/:id", requireAuth, async (c) => {
  const user = currentUser(c);
  const row = await loadSupportAttachment(c.env.DB, c.req.param("id"));
  const request = await loadRequest(c.env.DB, await messageRequestId(c.env.DB, row.entity_id));
  assertRequestAccess(user, request);
  return sendSupportAttachment(c.env, row);
});

router.get("/track/:token/attachments/:id", async (c) => {
  const tracked = await requestByToken(c.env.DB, c.req.param("token"));
  const row = await loadSupportAttachment(c.env.DB, c.req.param("id"));
  if ((await messageRequestId(c.env.DB, row.entity_id)) !== String(tracked.id)) {
    throw notFound("Anexo não encontrado.");
  }
  return sendSupportAttachment(c.env, row);
});

router.delete("/attachments/:id", requirePermission(MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await loadSupportAttachment(c.env.DB, id);

  if (row.r2_key) {
    try {
      await optionalBucket(c.env)?.delete(row.r2_key);
    } catch {
      // Bucket ausente/indisponível: remove só os metadados (o binário não existe mais).
    }
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM attachments WHERE id = ?`).bind(id),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "support",
      action: "support.attachment.delete",
      entityType: "support_message",
      entityId: row.entity_id,
      before: { attachmentId: id, filename: row.filename, sizeBytes: row.size_bytes },
      ...clientInfo(c),
    }),
  ]);

  return c.json({ ok: true });
});

router.patch("/requests/:id", requirePermission(MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, z.object({ status: z.enum(["queued", "in_progress", "resolved"]) }));
  const row = await loadRequest(c.env.DB, id);

  const previous = String(row.status);
  if (previous === body.status) return c.json({ ok: true, status: body.status });

  const ts = nowIso();
  const info = clientInfo(c);
  const resolved = body.status === "resolved";

  const notifyUserIds = row.user_id ? [String(row.user_id)] : [];
  const mail = queueEmail(c.env.DB, {
    to: String(row.requester_email),
    subject: `[Suporte ${String(row.code)}] Atualização: ${STATUS_LABEL[body.status]}`,
    body: [
      `O seu atendimento ${String(row.code)} foi atualizado: ${STATUS_LABEL[body.status]}.`,
      ``,
      resolved
        ? "Se o problema foi resolvido, não é preciso fazer nada. Se precisar de algo mais, abra um novo pedido."
        : "Acompanhe a conversa pelo link recebido ao abrir o pedido.",
      ``,
      `Equipe de suporte — Facil`,
    ].join("\n"),
    kind: "support_status",
    relatedId: id,
  });

  await c.env.DB.batch([
    updateStatement(c.env.DB, "support_requests", id, {
      status: body.status,
      updated_at: ts,
      resolved_at: resolved ? ts : null,
      resolved_by: resolved ? user.id : null,
    }),
    ...notificationStatements(c.env.DB, notifyUserIds, {
      type: "support_status",
      title: `Atendimento ${String(row.code)}: ${STATUS_LABEL[body.status]}`,
      link: `/ajuda/${id}`,
      entityType: "support_request",
      entityId: id,
      createdAt: ts,
    }),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "support",
      action: "support.request.update",
      entityType: "support_request",
      entityId: id,
      before: { status: previous },
      after: { status: body.status },
      ...info,
    }),
    mail.statement,
  ]);

  await deliverOutbox(c.env.DB, [mail.id]);

  return c.json({ ok: true, status: body.status });
});

/* -------------------------------------------------------------------------- */
/* Caixa de saida (administrador)                                             */
/* -------------------------------------------------------------------------- */

router.get("/outbox", requirePermission(MANAGE), async (c) => {
  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT id, to_email, subject, kind, related_id, status, error, created_at, sent_at
       FROM email_outbox ORDER BY created_at DESC LIMIT 100`,
  );
  const config = await readMailConfig(c.env.DB);
  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      toEmail: String(row.to_email),
      subject: String(row.subject),
      kind: String(row.kind),
      relatedId: row.related_id ? String(row.related_id) : null,
      status: String(row.status),
      error: row.error ? String(row.error) : null,
      createdAt: String(row.created_at),
      sentAt: row.sent_at ? String(row.sent_at) : null,
    })),
    mail: {
      configured: mailConfigured(config),
      enabled: config.enabled,
      provider: config.provider,
      from: config.from,
    },
  });
});

router.post("/outbox/:id/retry", requirePermission(MANAGE), async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const existing = await oneRow<{ id: string; status: string }>(
    c.env.DB,
    `SELECT id, status FROM email_outbox WHERE id = ?`,
    [id],
  );
  if (!existing) throw notFound("E-mail não encontrado.");
  if (existing.status === "sent") throw conflict("Este e-mail já foi enviado.");

  const result = await deliverOutbox(c.env.DB, [id]);

  await auditStatement(c.env.DB, {
    actor: { id: user.id, name: user.name },
    module: "support",
    action: "support.outbox.retry",
    entityType: "email_outbox",
    entityId: id,
    after: { skipped: result.skipped, sent: result.sent, failed: result.failed },
    ...clientInfo(c),
  }).run();

  const updated = await oneRow<{ status: string; error: string | null }>(
    c.env.DB,
    `SELECT status, error FROM email_outbox WHERE id = ?`,
    [id],
  );
  return c.json({
    status: updated?.status ?? existing.status,
    error: updated?.error ?? null,
    skipped: result.skipped,
  });
});

export default router;
