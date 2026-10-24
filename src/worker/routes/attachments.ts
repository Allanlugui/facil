import { Hono } from "hono";
import { PERMISSIONS } from "@shared/permissions";
import type { AppEnv, AuthUser } from "../types";
import { assertLocationAllowed, currentUser, requireAuth } from "../auth";
import { auditStatement, clientInfo } from "../audit";
import { allRows, oneRow } from "../db";
import { ApiError, badRequest, forbidden, notFound } from "../errors";
import {
  ALLOWED_MIME_PREFIXES,
  attachmentDisposition,
  mimeAllowed,
  normalizeMimeType,
} from "../files";
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
  asset: PERMISSIONS.ASSETS_VIEW,
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

router.get("/", requireAuth, async (c) => {
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
  await assertEntityAccess(c.env.DB, user, entityType, entityId);

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
    entity_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    content: ArrayBuffer | Uint8Array | number[] | null;
    uploaded_by: string;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, entity_type, entity_id, filename, mime_type, size_bytes, content, uploaded_by, created_at
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
  await assertEntityAccess(c.env.DB, user, row.entity_type, row.entity_id);

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
      // SVG e formatos não visuais nunca abrem inline; o navegador baixa.
      "content-disposition": `${attachmentDisposition(row.mime_type)}; filename="${encodeURIComponent(row.filename)}"`,
      "cache-control": "private, no-store",
    },
  });
});

/**
 * Aceita `multipart/form-data` (campo `file`, mais `entityType`/`entityId`) ou
 * corpo binário cru com os metadados na query string.
 */
router.post("/", requireAuth, async (c) => {
  const user = currentUser(c);
  const url = new URL(c.req.url);

  let entityType = normalizeEntityType(url.searchParams.get("entityType"));
  let entityId = url.searchParams.get("entityId")?.trim() ?? "";
  let filename = url.searchParams.get("filename")?.trim() ?? "";
  let mimeType = url.searchParams.get("mimeType")?.trim() ?? "";
  let bytes: Uint8Array;

  // O limite é lido antes de materializar o corpo: um Content-Length acima do
  // teto é recusado sem carregar o arquivo inteiro na memória do Worker.
  const maxBytes = Number(await getSetting(c.env.DB, "attachments.max_bytes", "20971520"));
  const declaredLength = Number(c.req.header("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes + 1_048_576) {
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "O arquivo enviado excede o limite configurado.");
  }

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
    mimeType = normalizeMimeType(file.type || mimeType || "application/octet-stream");
    bytes = new Uint8Array(await file.arrayBuffer());
  } else {
    const buffer = await c.req.arrayBuffer();
    bytes = new Uint8Array(buffer);
    filename = filename || "anexo";
    mimeType = normalizeMimeType(mimeType || c.req.header("content-type") || "application/octet-stream");
  }

  if (!entityType || !entityId) throw badRequest("Informe entityType e entityId.");
  const permission = entityPermission(entityType);
  if (!user.permissions.has(permission)) throw forbidden(`Permissão necessária: ${permission}.`);

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

  await assertEntityAccess(c.env.DB, user, entityType, entityId);

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
  await assertEntityAccess(c.env.DB, user, row.entity_type, row.entity_id);

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

/**
 * A permissão do módulo não basta: o anexo segue a visibilidade da entidade.
 * Sem isso, conhecer o UUID de um ticket/OS alheio permitiria listar e baixar
 * os arquivos correspondentes.
 */
async function assertEntityAccess(
  db: D1Database,
  user: AuthUser,
  entityType: string,
  entityId: string,
): Promise<void> {
  const location = async (row: { location_id: string | null } | null): Promise<void> => {
    if (!row) throw notFound("O registro informado não existe.");
    assertLocationAllowed(user, row.location_id);
  };

  switch (entityType) {
    case "ticket": {
      const row = await oneRow<{ requester_id: string; assignee_id: string | null; location_id: string | null }>(
        db,
        `SELECT requester_id, assignee_id, location_id FROM tickets WHERE id = ?`,
        [entityId],
      );
      if (!row) throw notFound("Ticket não encontrado.");
      const seesAll = user.permissions.has(PERMISSIONS.TICKETS_VIEW_ALL);
      if (!seesAll && row.requester_id !== user.id && row.assignee_id !== user.id) {
        throw forbidden("Você só pode acessar anexos dos tickets que abriu ou que lhe foram atribuídos.");
      }
      assertLocationAllowed(user, row.location_id);
      return;
    }
    case "work_order":
      await location(
        await oneRow<{ location_id: string | null }>(db, `SELECT location_id FROM work_orders WHERE id = ?`, [
          entityId,
        ]),
      );
      return;
    case "work_order_checklist_item":
      await location(
        await oneRow<{ location_id: string | null }>(
          db,
          `SELECT w.location_id FROM work_order_checklist_items ci
             JOIN work_orders w ON w.id = ci.work_order_id WHERE ci.id = ?`,
          [entityId],
        ),
      );
      return;
    case "purchase_request":
      await location(
        await oneRow<{ location_id: string | null }>(
          db,
          `SELECT location_id FROM purchase_requests WHERE id = ?`,
          [entityId],
        ),
      );
      return;
    case "purchase_receipt":
      await location(
        await oneRow<{ location_id: string | null }>(
          db,
          `SELECT r.location_id FROM purchase_receipts rc
             LEFT JOIN purchase_requests r ON r.id = rc.request_id WHERE rc.id = ?`,
          [entityId],
        ),
      );
      return;
    case "inventory":
      await location(
        await oneRow<{ location_id: string | null }>(db, `SELECT location_id FROM inventories WHERE id = ?`, [
          entityId,
        ]),
      );
      return;
    case "consumption_record":
      await location(
        await oneRow<{ location_id: string | null }>(
          db,
          `SELECT location_id FROM consumption_records WHERE id = ?`,
          [entityId],
        ),
      );
      return;
    case "location": {
      const row = await oneRow<{ id: string }>(db, `SELECT id FROM locations WHERE id = ?`, [entityId]);
      if (!row) throw notFound("Local não encontrado.");
      assertLocationAllowed(user, entityId);
      return;
    }
    case "product": {
      const row = await oneRow<{ id: string }>(db, `SELECT id FROM products WHERE id = ?`, [entityId]);
      if (!row) throw notFound("Produto não encontrado.");
      return;
    }
    case "asset": {
      await location(
        await oneRow<{ location_id: string | null }>(db, `SELECT location_id FROM assets WHERE id = ?`, [
          entityId,
        ]),
      );
      return;
    }
    default:
      return;
  }
}

export default router;
