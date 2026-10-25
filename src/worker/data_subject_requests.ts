/**
 * LGPD - Direitos do titular (Arts. 18 e 19, Lei 13.709/2018).
 *
 * Regras centrais:
 *  - O titular tem direito, a qualquer momento e mediante requisição, a:
 *    (I) confirmação de existência de tratamento; (II) acesso aos dados;
 *    (III) correção de dados incompletos/inexatos/desatualizados;
 *    (IV) anonimização, bloqueio ou eliminação de dados desnecessários,
 *    excessivos ou tratados em desconformidade; (V) portabilidade dos dados;
 *    (VI) eliminação dos dados tratados com consentimento; (VII) informação
 *    das entidades com as quais houve uso compartilhado; (VIII) informação
 *    sobre a possibilidade de não fornecer consentimento e as consequências;
 *    (IX) revogação do consentimento.
 *  - A confirmação de existência ou o acesso será providenciada em formato
 *    simplificado, imediatamente, ou por declaração clara e completa em até
 *    15 dias (Art. 19).
 *  - As solicitações nunca são apagadas: apenas atualizadas de status e
 *    resposta, preservando auditoria para provar o cumprimento do prazo.
 */

import {
  allRows,
  countRows,
  insertStatement,
  oneRow,
  updateStatement,
  WhereBuilder,
} from "./db";
import { recordAudit } from "./audit";
import { badRequest, notFound } from "./errors";
import { nowIso, uuid } from "./util";
import type {
  DataSubjectRequest,
  DataSubjectRequestCreate,
  DataSubjectRequestUpdate,
} from "@shared/types";

/* -------------------------------------------------------------------------- */
/* Tipos auxiliares de leitura                                                */
/* -------------------------------------------------------------------------- */

interface DsrRow {
  id: string;
  code: string;
  data_subject_id: string;
  data_subject_code: string | null;
  data_subject_name: string | null;
  request_type: string;
  status: string;
  requested_at: string;
  due_date: string;
  responded_at: string | null;
  response_summary: string | null;
  response_details: string | null;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toDsr(r: DsrRow): DataSubjectRequest {
  return {
    id: r.id,
    code: r.code,
    data_subject_id: r.data_subject_id,
    data_subject_code: r.data_subject_code ?? null,
    data_subject_name: r.data_subject_name ?? null,
    request_type: r.request_type,
    status: r.status,
    requested_at: r.requested_at,
    due_date: r.due_date,
    responded_at: r.responded_at ?? null,
    response_summary: r.response_summary ?? null,
    response_details: r.response_details ?? null,
    responsible_user_id: r.responsible_user_id ?? null,
    responsible_user_name: r.responsible_user_name ?? null,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Listagem                                                                   */
/* -------------------------------------------------------------------------- */

export async function listDataSubjectRequests(
  db: D1Database,
  filters: {
    dataSubjectId?: string;
    status?: string;
    requestType?: string;
    search?: string;
  } = {},
): Promise<{ items: DataSubjectRequest[]; total: number }> {
  const w = new WhereBuilder();
  if (filters.dataSubjectId) w.add("dsr.data_subject_id = ?", filters.dataSubjectId);
  if (filters.status) w.add("dsr.status = ?", filters.status);
  if (filters.requestType) w.add("dsr.request_type = ?", filters.requestType);
  if (filters.search) {
    w.add("(dsr.code LIKE ? OR ds.name LIKE ?)", `%${filters.search}%`, `%${filters.search}%`);
  }

  const items = await allRows<DsrRow>(
    db,
    `SELECT dsr.id, dsr.code, dsr.data_subject_id,
            ds.code AS data_subject_code, ds.name AS data_subject_name,
            dsr.request_type, dsr.status, dsr.requested_at, dsr.due_date,
            dsr.responded_at, dsr.response_summary, dsr.response_details,
            dsr.responsible_user_id, ru.name AS responsible_user_name,
            dsr.created_by, dsr.created_at, dsr.updated_at
       FROM data_subject_requests dsr
       JOIN data_subjects ds ON ds.id = dsr.data_subject_id
       LEFT JOIN users ru ON ru.id = dsr.responsible_user_id
      ${w.sql()}
      ORDER BY dsr.requested_at DESC`,
    w.values(),
  );

  const total = await countRows(
    db,
    `SELECT COUNT(*) AS c FROM data_subject_requests dsr ${w.sql()}`,
    w.values(),
  );

  return { items: items.map(toDsr), total };
}

export async function getDataSubjectRequest(
  db: D1Database,
  id: string,
): Promise<DataSubjectRequest | null> {
  const row = await oneRow<DsrRow>(
    db,
    `SELECT dsr.id, dsr.code, dsr.data_subject_id,
            ds.code AS data_subject_code, ds.name AS data_subject_name,
            dsr.request_type, dsr.status, dsr.requested_at, dsr.due_date,
            dsr.responded_at, dsr.response_summary, dsr.response_details,
            dsr.responsible_user_id, ru.name AS responsible_user_name,
            dsr.created_by, dsr.created_at, dsr.updated_at
       FROM data_subject_requests dsr
       JOIN data_subjects ds ON ds.id = dsr.data_subject_id
       LEFT JOIN users ru ON ru.id = dsr.responsible_user_id
      WHERE dsr.id = ?`,
    [id],
  );
  if (!row) return null;
  return toDsr(row);
}

export async function getDataSubjectRequestByCode(
  db: D1Database,
  code: string,
): Promise<DataSubjectRequest | null> {
  const row = await oneRow<DsrRow>(
    db,
    `SELECT dsr.id, dsr.code, dsr.data_subject_id,
            ds.code AS data_subject_code, ds.name AS data_subject_name,
            dsr.request_type, dsr.status, dsr.requested_at, dsr.due_date,
            dsr.responded_at, dsr.response_summary, dsr.response_details,
            dsr.responsible_user_id, ru.name AS responsible_user_name,
            dsr.created_by, dsr.created_at, dsr.updated_at
       FROM data_subject_requests dsr
       JOIN data_subjects ds ON ds.id = dsr.data_subject_id
       LEFT JOIN users ru ON ru.id = dsr.responsible_user_id
      WHERE dsr.code = ?`,
    [code],
  );
  if (!row) return null;
  return toDsr(row);
}

export async function listDataSubjectRequestsForSubject(
  db: D1Database,
  subjectId: string,
): Promise<DataSubjectRequest[]> {
  const rows = await allRows<DsrRow>(
    db,
    `SELECT dsr.id, dsr.code, dsr.data_subject_id,
            ds.code AS data_subject_code, ds.name AS data_subject_name,
            dsr.request_type, dsr.status, dsr.requested_at, dsr.due_date,
            dsr.responded_at, dsr.response_summary, dsr.response_details,
            dsr.responsible_user_id, ru.name AS responsible_user_name,
            dsr.created_by, dsr.created_at, dsr.updated_at
       FROM data_subject_requests dsr
       JOIN data_subjects ds ON ds.id = dsr.data_subject_id
       LEFT JOIN users ru ON ru.id = dsr.responsible_user_id
      WHERE dsr.data_subject_id = ?
      ORDER BY dsr.requested_at DESC`,
    [subjectId],
  );
  return rows.map(toDsr);
}

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

export async function createDataSubjectRequest(
  db: D1Database,
  input: DataSubjectRequestCreate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataSubjectRequest> {
  // Valida titular
  const subject = await oneRow<{ id: string; is_active: number }>(
    db,
    `SELECT id, is_active FROM data_subjects WHERE id = ?`,
    [input.data_subject_id],
  );
  if (!subject) throw badRequest("Titular informado não existe.");
  if (!subject.is_active) throw badRequest("O titular informado está inativo.");

  // Calcula prazo de 15 dias (Art. 19)
  const requestedAt = input.requested_at || nowIso();
  const dueDate = addDaysIsoDate(requestedAt, 15);

  const counter = await requireCounter(db, "dsr");
  const code = `DSR-${new Date().getUTCFullYear()}-${String(counter).padStart(6, "0")}`;
  const id = uuid();
  const ts = nowIso();

  await insertStatement(db, "data_subject_requests", {
    id,
    code,
    data_subject_id: input.data_subject_id,
    request_type: input.request_type,
    status: "received",
    requested_at: requestedAt,
    due_date: dueDate,
    responded_at: null,
    response_summary: input.response_summary ?? null,
    response_details: input.response_details ?? null,
    responsible_user_id: input.responsible_user_id ?? null,
    created_by: actorId,
    created_at: ts,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "dsr",
    action: "dsr.create",
    entityType: "data_subject_request",
    entityId: id,
    after: { code, data_subject_id: input.data_subject_id, request_type: input.request_type },
    ...meta,
  });

  const created = await getDataSubjectRequest(db, id);
  if (!created) throw new Error("Falha ao recuperar solicitação após criação.");
  return created;
}

/* -------------------------------------------------------------------------- */
/* Atualização                                                                */
/* -------------------------------------------------------------------------- */

export async function updateDataSubjectRequest(
  db: D1Database,
  id: string,
  input: DataSubjectRequestUpdate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataSubjectRequest> {
  const existing = await getDataSubjectRequest(db, id);
  if (!existing) throw notFound("Solicitação não encontrada.");

  const before = { ...existing };
  const data: Record<string, unknown> = {};
  if (input.status !== undefined) data.status = input.status;
  if (input.response_summary !== undefined) data.response_summary = input.response_summary;
  if (input.response_details !== undefined) data.response_details = input.response_details;
  if (input.responsible_user_id !== undefined)
    data.responsible_user_id = input.responsible_user_id;
  if (input.responded_at !== undefined) data.responded_at = input.responded_at;
  data.updated_at = nowIso();

  const changedKeys = Object.keys(data).filter((k) => k !== "updated_at");
  if (changedKeys.length > 0) {
    await updateStatement(db, "data_subject_requests", id, data).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "dsr",
      action: "dsr.update",
      entityType: "data_subject_request",
      entityId: id,
      before,
      after: { ...existing, ...data },
      ...meta,
    });
  }

  const updated = await getDataSubjectRequest(db, id);
  if (!updated) throw notFound("Solicitação não encontrada após atualização.");
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Contador                                                                   */
/* -------------------------------------------------------------------------- */

async function requireCounter(db: D1Database, name: string): Promise<number> {
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

/* -------------------------------------------------------------------------- */
/* Utils                                                                      */
/* -------------------------------------------------------------------------- */

/** Adiciona N dias a uma data ISO (YYYY-MM-DD), retornando YYYY-MM-DD. */
function addDaysIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
