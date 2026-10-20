import { Hono } from "hono";
import { PERMISSIONS } from "@shared/permissions";
import type { AppEnv } from "../types";
import { currentUser, requireAuth, requirePermission } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, oneRow } from "../db";
import { badRequest, forbidden, notFound } from "../errors";
import { ALLOWED_MIME_PREFIXES, mimeAllowed } from "../files";
import { getSetting } from "./settings";
import { nowIso, uuid } from "../util";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/**
 * Anexos destes módulos ficam no próprio banco (D1) com limite de tamanho
 * configurável (`attachments.max_bytes`, padrão 20 MB desde o F-19). O limite
 * existe porque D1 impoe limite por valor; a Central de Suporte, que precisa de
 * arquivos grandes e upload sem sessão (token), grava o binário no R2 e usa as
 * próprias rotas -- nunca estas.
 *
 * A permissão de leitura/escrita e derivada do tipo de entidade: não existe
 * "permissão de anexo" separada, porque anexo de ticket deve seguir a regra do
 * ticket. Tipos fora do mapa (ex.: `support_message`) são recusados aqui de
 * propósito: quem manda é o módulo de origem.
 */

const ENTITY_PERMISSIONS: Record<string, string> = {
  ticket: PERMISSIONS.TICKETS_VIEW,
  work_order: PERMISSIONS.WORKORDERS_VIEW,
  // Fotos por etapa do checklist do técnico (F-09): mesma regra da OS.
  work_order_checklist_item: PERMISSIONS.WORKORDERS_VIEW,
  purchase_request: PERMISSIONS.PURCHASES_VIEW,
  purchase_receipt: PERMISSIONS.PURCHASES_VIEW,
  inventory: PERMISSIONS.INVENTORY_VIEW,
  consumption_record: PERMISSIONS.CONSUMPTION_VIEW,
  product: PERMISSIONS.CATALOG_VIEW,
  location: PERMISSIONS.STRUCTURE_VIEW,
};

function entityPermission(entityType: string): string {
  const permission = ENTITY_PERMISSIONS[entityType];
  if (!permission) {
    throw badRequest(
      `Tipo de entidade não aceita anexo: ${entityType}.`,
      { accepted: Object.keys(ENTITY_PERMISSIONS) },
    );
  }
  return permission;
}

/**
 * Entidades em que documento (não-imagem) exige `attachments.documents` (F-08):
 * chamado e OS são acompanhados pela gestão; o técnico executante usa a câmera
 * no fluxo de execução (F-07).
 */
const DOCUMENT_RESTRICTED_ENTITIES = new Set(["ticket", "work_order", "work_order_checklist_item"]);

/**
 * Entidades com armazenamento próprio (ex.: conversa do suporte em R2) não
 * passam por este módulo nem para leitura nem para remoção -- as regras de
 * acesso delas são outras (token de acompanhamento) e o binário não vive no D1.
 */
function assertGenericEntity(entityType: string): string {
  const permission = ENTITY_PERMISSIONS[entityType];
  if (!permission) {
    throw forbidden(
      `Anexos deste tipo são gerenciados pelo módulo de origem (${entityType}). Use a Central de Suporte para baixar ou remover.`,
    );
  }
  return permission;
}

function normalizeEntityType(value: string | null): string {
  return (value ?? "").trim().toLowerCase().replace(/[^a-z_]/g, "_");
}

router.get("/", requirePermission(PERMISSIONS.TICKETS_VIEW), async (c) => {
  // A permissão fina e checada por entidade; o filtro exige `entityType`.
  const user = currentUser(c);
  const url = new URL(c.req.url);
  const entityType = normalizeEntityType(url.searchParams.get("entityType"));
  const entityId = url.searchParams.get("entityId")?.trim();
  if (!entityType || !entityId) throw badRequest("Informe entityType e entityId.");

  const permission = entityPermission(entityType);
  if (!user.permissions.has(permission)) {
    throw forbidden(`Permissão necessária: ${permission}.`);
  }

  const rows = await allRows<Record<string, unknown>>(
    c.env.DB,
    `SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.uploaded_by, a.created_at, u.name AS uploaded_by_name
       FROM attachments a JOIN users u ON u.id = a.uploaded_by
      WHERE a.entity_type = ? AND a.entity_id = ?
      ORDER BY a.created_at DESC`,
    [entityType, entityId],
  );

  return c.json({
    items: rows.map((row) => ({
      id: String(row.id),
      filename: String(row.filename),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      uploadedBy: String(row.uploaded_by),
      uploadedByName: String(row.uploaded_by_name),
      createdAt: String(row.created_at),
      url: `/api/attachments/${row.id}`,
    })),
  });
});

router.get("/:id", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await oneRow<{
    id: string;
    entity_type: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    content: ArrayBuffer | Uint8Array | number[] | null;
    uploaded_by: string;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, entity_type, filename, mime_type, size_bytes, content, uploaded_by, created_at
       FROM attachments WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound("Anexo não encontrado.");

  // Tipos fora do mapa (ex.: `support_message`, guardado em R2) não são
  // servidos por aqui: quem cuida deles é o módulo de origem.
  const permission = assertGenericEntity(row.entity_type);
  if (!user.permissions.has(permission)) {
    throw forbidden(`Permissão necessária: ${permission}.`);
  }

  if (row.content === null) {
    throw notFound("O arquivo deste anexo não está armazenado neste módulo.");
  }

  const bytes =
    row.content instanceof ArrayBuffer
      ? new Uint8Array(row.content)
      : row.content instanceof Uint8Array
        ? row.content
        : new Uint8Array(row.content);

  return new Response(bytes, {
    headers: {
      "content-type": row.mime_type,
      "content-length": String(bytes.byteLength),
      "content-disposition": `inline; filename="${encodeURIComponent(row.filename)}"`,
      "cache-control": "private, max-age=300",
    },
  });
});

/**
 * Aceita `multipart/form-data` (campo `file`, mais `entityType`/`entityId`) ou
 * corpo binário cru com os metadados na query string.
 */
router.post("/", requirePermission(PERMISSIONS.TICKETS_VIEW), async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);

  let entityType = normalizeEntityType(url.searchParams.get("entityType"));
  let entityId = url.searchParams.get("entityId")?.trim() ?? "";
  let filename = url.searchParams.get("filename")?.trim() ?? "";
  let mimeType = url.searchParams.get("mimeType")?.trim() ?? "";
  let bytes: Uint8Array;

  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw badRequest("Formulário inválido: não foi possível ler o arquivo enviado.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Envie o arquivo no campo `file`.");
    entityType = normalizeEntityType(String(form.get("entityType") ?? entityType));
    entityId = String(form.get("entityId") ?? entityId).trim();
    filename = file.name || filename || "anexo";
    mimeType = file.type || mimeType || "application/octet-stream";
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const buffer = await c.req.arrayBuffer();
    bytes = new Uint8Array(buffer);
    filename = filename || "anexo";
    mimeType = mimeType || c.req.header("content-type") || "application/octet-stream";
  }

  if (!entityType || !entityId) throw badRequest("Informe entityType e entityId.");
  const permission = entityPermission(entityType);
  if (!user.permissions.has(permission)) throw forbidden(`Permissão necessária: ${permission}.`);

  const maxBytes = Number(await getSetting(c.env.DB, "attachments.max_bytes", "20971520"));
  if (bytes.byteLength === 0) throw badRequest("O arquivo enviado esta vazio.");
  if (bytes.byteLength > maxBytes) {
    throw badRequest(
      `O arquivo tem ${bytes.byteLength} bytes e excede o limite de ${maxBytes} bytes.`,
      { maxBytes },
    );
  }
  if (!mimeAllowed(ALLOWED_MIME_PREFIXES, mimeType)) {
    throw badRequest(`Tipo de arquivo não permitido: ${mimeType}.`, { allowed: ALLOWED_MIME_PREFIXES });
  }

  // F-08: documento (PDF/planilha/texto) em chamado ou ordem de serviço é
  // anexo de acompanhamento — restrito a quem não é o técnico executante
  // (permissão própria, migration 0017). A imagem continua livre: é a
  // evidência de campo, capturada pela câmera no fluxo de execução (F-07).
  if (
    DOCUMENT_RESTRICTED_ENTITIES.has(entityType) &&
    !mimeType.startsWith("image/") &&
    !user.permissions.has(PERMISSIONS.ATTACHMENTS_DOCUMENTS)
  ) {
    throw forbidden(
      "Documentos em chamados e ordens de serviço são anexados pela gestão. No fluxo de execução, registre a evidência pela câmera (foto da etapa).",
    );
  }

  await assertEntityExists(c.env.DB, entityType, entityId);

  const id = uuid();
  const ts = nowIso();
  const info = clientInfo(c);

  const insert = c.env.DB
    .prepare(
      `INSERT INTO attachments (id, entity_type, entity_id, filename, mime_type, size_bytes, content, uploaded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(id, entityType, entityId, filename, mimeType, bytes.byteLength, bytes, user.id, ts);

  await c.env.DB.batch([
    insert,
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "attachments",
      action: "attachment.upload",
      entityType,
      entityId,
      after: { attachmentId: id, filename, mimeType, sizeBytes: bytes.byteLength },
      ...info,
    }),
  ]);

  return c.json({ id, filename, mimeType, sizeBytes: bytes.byteLength, url: `/api/attachments/${id}` }, 201);
});

router.delete("/:id", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const row = await oneRow<{ id: string; entity_type: string; entity_id: string; uploaded_by: string | null; filename: string }>(
    c.env.DB,
    `SELECT id, entity_type, entity_id, uploaded_by, filename FROM attachments WHERE id = ?`,
    [id],
  );
  if (!row) throw notFound("Anexo não encontrado.");

  // Anexos com armazenamento próprio (suporte em R2) saem pelo módulo de
  // origem, que também apaga o objeto no bucket -- aqui só entrariam órfãos.
  assertGenericEntity(row.entity_type);

  const isOwner = row.uploaded_by === user.id;
  const canManage = user.permissions.has(PERMISSIONS.SETTINGS_MANAGE);
  if (!isOwner && !canManage) throw forbidden("Somente quem enviou o anexo (ou um administrador) pode remove-lo.");

  const info = clientInfo(c);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM attachments WHERE id = ?`).bind(id),
    auditStatement(c.env.DB, {
      actor: { id: user.id, name: user.name },
      module: "attachments",
      action: "attachment.delete",
      entityType: row.entity_type,
      entityId: row.entity_id,
      before: { attachmentId: id, filename: row.filename },
      ...info,
    }),
  ]);

  return c.json({ ok: true });
});

async function assertEntityExists(db: D1Database, entityType: string, entityId: string): Promise<void> {
  const table = ENTITY_TABLES[entityType];
  if (!table) return;
  const row = await oneRow<{ id: string }>(db, `SELECT id FROM ${table} WHERE id = ?`, [entityId]);
  if (!row) throw notFound("O registro informado não existe.");
}

const ENTITY_TABLES: Record<string, string> = {
  ticket: "tickets",
  work_order: "work_orders",
  work_order_checklist_item: "work_order_checklist_items",
  purchase_request: "purchase_requests",
  purchase_receipt: "purchase_receipts",
  inventory: "inventories",
  consumption_record: "consumption_records",
  product: "products",
  location: "locations",
};

export default router;
