/**
 * LGPD - Consentimento para tratamento de dados pessoais (Art. 8º,
 * Lei 13.709/2018).
 *
 * Regras centrais:
 *  - Consentimento é manifestação de vontade por escrito ou outro meio que a
 *    demonstre (medium: written, electronic, verbal, form).
 *  - Quando por escrito, a cláusula de consentimento deve ser destacada
 *    (highlighted_clause).
 *  - Ônus da prova do controlador: o registro de consentimento é a prova;
 *    nunca é apagado, apenas revogado (status + data + motivo).
 *  - Finalidades determinadas: vincula a exatamente uma operação de
 *    tratamento (cuja base legal deve ser 'consentimento').
 *  - Revogação a qualquer momento: status 'revoked', data e responsável.
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
import { badRequest, conflict, notFound } from "./errors";
import { nowIso, uuid } from "./util";
import type {
  Consent,
  ConsentCreate,
  ConsentRevoke,
  ConsentUpdate,
  DataSubject,
  DataSubjectCreate,
  DataSubjectUpdate,
} from "@shared/types";

/* -------------------------------------------------------------------------- */
/* Tipos auxiliares de leitura                                                */
/* -------------------------------------------------------------------------- */

interface DataSubjectRow {
  id: string;
  code: string;
  name: string;
  email: string | null;
  document: string | null;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface ConsentRow {
  id: string;
  code: string;
  data_subject_id: string;
  data_subject_code: string | null;
  data_subject_name: string | null;
  operation_id: string;
  operation_code: string | null;
  operation_name: string | null;
  legal_base_id: string;
  legal_base_code: string | null;
  legal_base_name: string | null;
  medium: string;
  consented_at: string;
  consented_by: string;
  consented_by_name: string | null;
  text_version: string;
  highlighted_clause: number;
  ip_address: string | null;
  user_agent: string | null;
  status: string;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_by_name: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toDataSubject(r: DataSubjectRow): DataSubject {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    email: r.email,
    document: r.document,
    role: r.role,
    is_active: r.is_active === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function toConsent(r: ConsentRow): Consent {
  return {
    id: r.id,
    code: r.code,
    data_subject_id: r.data_subject_id,
    data_subject_code: r.data_subject_code ?? null,
    data_subject_name: r.data_subject_name ?? null,
    operation_id: r.operation_id,
    operation_code: r.operation_code ?? null,
    operation_name: r.operation_name ?? null,
    legal_base_id: r.legal_base_id,
    legal_base_code: r.legal_base_code ?? null,
    legal_base_name: r.legal_base_name ?? null,
    medium: r.medium,
    consented_at: r.consented_at,
    consented_by: r.consented_by,
    consented_by_name: r.consented_by_name ?? null,
    text_version: r.text_version,
    highlighted_clause: r.highlighted_clause === 1,
    ip_address: r.ip_address ?? null,
    user_agent: r.user_agent ?? null,
    status: r.status,
    revoked_at: r.revoked_at ?? null,
    revoked_by: r.revoked_by ?? null,
    revoked_by_name: r.revoked_by_name ?? null,
    revocation_reason: r.revocation_reason ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/* -------------------------------------------------------------------------- */
/* Titulares de dados                                                         */
/* -------------------------------------------------------------------------- */

export async function listDataSubjects(db: D1Database): Promise<DataSubject[]> {
  const rows = await allRows<DataSubjectRow>(
    db,
    `SELECT id, code, name, email, document, role, is_active, created_at, updated_at
       FROM data_subjects
      ORDER BY name ASC`,
  );
  return rows.map(toDataSubject);
}

export async function getDataSubject(db: D1Database, id: string): Promise<DataSubject | null> {
  const row = await oneRow<DataSubjectRow>(
    db,
    `SELECT id, code, name, email, document, role, is_active, created_at, updated_at
       FROM data_subjects
      WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return toDataSubject(row);
}

export async function getDataSubjectByCode(db: D1Database, code: string): Promise<DataSubject | null> {
  const row = await oneRow<DataSubjectRow>(
    db,
    `SELECT id, code, name, email, document, role, is_active, created_at, updated_at
       FROM data_subjects
      WHERE code = ?`,
    [code],
  );
  if (!row) return null;
  return toDataSubject(row);
}

export async function createDataSubject(
  db: D1Database,
  input: DataSubjectCreate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataSubject> {
  const existing = await oneRow<{ id: string }>(
    db,
    `SELECT id FROM data_subjects WHERE code = ?`,
    [input.code],
  );
  if (existing) throw conflict(`Já existe um titular com o código "${input.code}".`);

  const id = uuid();
  const ts = nowIso();
  await insertStatement(db, "data_subjects", {
    id,
    code: input.code,
    name: input.name,
    email: input.email ?? null,
    document: input.document ?? null,
    role: input.role ?? "cliente",
    is_active: 1,
    created_at: ts,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "consent",
    action: "data_subject.create",
    entityType: "data_subject",
    entityId: id,
    after: { code: input.code, name: input.name },
    ...meta,
  });

  const created = await getDataSubject(db, id);
  if (!created) throw new Error("Falha ao recuperar titular após criação.");
  return created;
}

export async function updateDataSubject(
  db: D1Database,
  id: string,
  input: DataSubjectUpdate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataSubject> {
  const existing = await getDataSubject(db, id);
  if (!existing) throw notFound("Titular não encontrado.");

  const before = { ...existing };
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) data.email = input.email;
  if (input.document !== undefined) data.document = input.document;
  if (input.role !== undefined) data.role = input.role;
  if (input.is_active !== undefined) data.is_active = input.is_active ? 1 : 0;
  data.updated_at = nowIso();

  const changedKeys = Object.keys(data).filter((k) => k !== "updated_at");
  if (changedKeys.length > 0) {
    await updateStatement(db, "data_subjects", id, data).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "consent",
      action: "data_subject.update",
      entityType: "data_subject",
      entityId: id,
      before,
      after: { ...existing, ...data },
      ...meta,
    });
  }

  const updated = await getDataSubject(db, id);
  if (!updated) throw notFound("Titular não encontrado após atualização.");
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Consentimentos                                                             */
/* -------------------------------------------------------------------------- */

export async function listConsents(
  db: D1Database,
  { page, pageSize }: { page: number; pageSize: number },
  filters: {
    dataSubjectId?: string;
    operationId?: string;
    status?: string;
    medium?: string;
    search?: string;
  } = {},
): Promise<{ items: Consent[]; total: number }> {
  const w = new WhereBuilder();
  if (filters.dataSubjectId) w.add("c.data_subject_id = ?", filters.dataSubjectId);
  if (filters.operationId) w.add("c.operation_id = ?", filters.operationId);
  if (filters.status) w.add("c.status = ?", filters.status);
  if (filters.medium) w.add("c.medium = ?", filters.medium);
  if (filters.search) {
    w.add("(c.code LIKE ? OR ds.name LIKE ? OR c.text_version LIKE ?)", `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }

  const offset = (page - 1) * pageSize;

  const items = await allRows<ConsentRow>(
    db,
    `SELECT c.id, c.code, c.data_subject_id,
            ds.code AS data_subject_code, ds.name AS data_subject_name,
            c.operation_id,
            dpo.code AS operation_code, dpo.name AS operation_name,
            c.legal_base_id,
            lb.code AS legal_base_code, lb.name AS legal_base_name,
            c.medium, c.consented_at, c.consented_by, u.name AS consented_by_name,
            c.text_version, c.highlighted_clause, c.ip_address, c.user_agent,
            c.status, c.revoked_at, c.revoked_by, ur.name AS revoked_by_name,
            c.revocation_reason, c.created_at, c.updated_at
       FROM consents c
       JOIN data_subjects ds ON ds.id = c.data_subject_id
       JOIN data_processing_operations dpo ON dpo.id = c.operation_id
       JOIN legal_bases lb ON lb.id = c.legal_base_id
       JOIN users u ON u.id = c.consented_by
       LEFT JOIN users ur ON ur.id = c.revoked_by
      ${w.sql()}
      ORDER BY c.consented_at DESC
      LIMIT ? OFFSET ?`,
    [...w.values(), pageSize, offset],
  );

  const total = await countRows(db, `SELECT COUNT(*) AS c FROM consents c ${w.sql()}`, w.values());

  return { items: items.map(toConsent), total };
}

export async function getConsent(db: D1Database, id: string): Promise<Consent | null> {
  const row = await oneRow<ConsentRow>(
    db,
    `SELECT c.id, c.code, c.data_subject_id,
            ds.code AS data_subject_code, ds.name AS data_subject_name,
            c.operation_id,
            dpo.code AS operation_code, dpo.name AS operation_name,
            c.legal_base_id,
            lb.code AS legal_base_code, lb.name AS legal_base_name,
            c.medium, c.consented_at, c.consented_by, u.name AS consented_by_name,
            c.text_version, c.highlighted_clause, c.ip_address, c.user_agent,
            c.status, c.revoked_at, c.revoked_by, ur.name AS revoked_by_name,
            c.revocation_reason, c.created_at, c.updated_at
       FROM consents c
       JOIN data_subjects ds ON ds.id = c.data_subject_id
       JOIN data_processing_operations dpo ON dpo.id = c.operation_id
       JOIN legal_bases lb ON lb.id = c.legal_base_id
       JOIN users u ON u.id = c.consented_by
       LEFT JOIN users ur ON ur.id = c.revoked_by
      WHERE c.id = ?`,
    [id],
  );
  if (!row) return null;
  return toConsent(row);
}

export async function getConsentByCode(db: D1Database, code: string): Promise<Consent | null> {
  const row = await oneRow<ConsentRow>(
    db,
    `SELECT c.id, c.code, c.data_subject_id,
            ds.code AS data_subject_code, ds.name AS data_subject_name,
            c.operation_id,
            dpo.code AS operation_code, dpo.name AS operation_name,
            c.legal_base_id,
            lb.code AS legal_base_code, lb.name AS legal_base_name,
            c.medium, c.consented_at, c.consented_by, u.name AS consented_by_name,
            c.text_version, c.highlighted_clause, c.ip_address, c.user_agent,
            c.status, c.revoked_at, c.revoked_by, ur.name AS revoked_by_name,
            c.revocation_reason, c.created_at, c.updated_at
       FROM consents c
       JOIN data_subjects ds ON ds.id = c.data_subject_id
       JOIN data_processing_operations dpo ON dpo.id = c.operation_id
       JOIN legal_bases lb ON lb.id = c.legal_base_id
       JOIN users u ON u.id = c.consented_by
       LEFT JOIN users ur ON ur.id = c.revoked_by
      WHERE c.code = ?`,
    [code],
  );
  if (!row) return null;
  return toConsent(row);
}

export async function listConsentsForSubject(
  db: D1Database,
  subjectId: string,
): Promise<Consent[]> {
  const rows = await allRows<ConsentRow>(
    db,
    `SELECT c.id, c.code, c.data_subject_id,
            ds.code AS data_subject_code, ds.name AS data_subject_name,
            c.operation_id,
            dpo.code AS operation_code, dpo.name AS operation_name,
            c.legal_base_id,
            lb.code AS legal_base_code, lb.name AS legal_base_name,
            c.medium, c.consented_at, c.consented_by, u.name AS consented_by_name,
            c.text_version, c.highlighted_clause, c.ip_address, c.user_agent,
            c.status, c.revoked_at, c.revoked_by, ur.name AS revoked_by_name,
            c.revocation_reason, c.created_at, c.updated_at
       FROM consents c
       JOIN data_subjects ds ON ds.id = c.data_subject_id
       JOIN data_processing_operations dpo ON dpo.id = c.operation_id
       JOIN legal_bases lb ON lb.id = c.legal_base_id
       JOIN users u ON u.id = c.consented_by
       LEFT JOIN users ur ON ur.id = c.revoked_by
      WHERE c.data_subject_id = ?
      ORDER BY c.consented_at DESC`,
    [subjectId],
  );
  return rows.map(toConsent);
}

export async function createConsent(
  db: D1Database,
  input: ConsentCreate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<Consent> {
  // Valida titular
  const subject = await getDataSubject(db, input.data_subject_id);
  if (!subject) throw badRequest("Titular informado não existe.");
  if (!subject.is_active) throw badRequest("O titular informado está inativo.");

  // Valida operação
  const operationRow = await oneRow<{ id: string; legal_base_id: string; is_active: number }>(
    db,
    `SELECT dpo.id, dpo.legal_base_id, lb.is_active
       FROM data_processing_operations dpo
       JOIN legal_bases lb ON lb.id = dpo.legal_base_id
      WHERE dpo.id = ?`,
    [input.operation_id],
  );
  if (!operationRow) throw badRequest("Operação de tratamento informada não existe.");
  if (!operationRow.is_active) throw badRequest("A operação de tratamento informada está inativa.");

  // Valida base legal: deve ser consentimento e ativa
  const baseRow = await oneRow<{ id: string; code: string; is_active: number }>(
    db,
    `SELECT id, code, is_active FROM legal_bases WHERE id = ?`,
    [input.legal_base_id],
  );
  if (!baseRow) throw badRequest("Base legal informada não existe.");
  if (!baseRow.is_active) throw badRequest("A base legal informada está inativa.");
  if (baseRow.code !== "CONSENTIMENTO") {
    throw badRequest("Consentimento só pode ser registrado com base legal 'Consentimento'.");
  }

  // Não permite consentimento ativo duplicado para a mesma operação do mesmo titular
  const existingActive = await oneRow<{ id: string }>(
    db,
    `SELECT id FROM consents
      WHERE data_subject_id = ? AND operation_id = ? AND status = 'active'`,
    [input.data_subject_id, input.operation_id],
  );
  if (existingActive) {
    throw conflict("Já existe um consentimento ativo para este titular nesta operação.");
  }

  const counter = await requireCounter(db, "consent");
  const code = `CONS-${new Date().getUTCFullYear()}-${String(counter).padStart(6, "0")}`;
  const id = uuid();
  const ts = nowIso();
  const medium = input.medium;
  const highlighted = input.highlighted_clause ? 1 : 0;

  // Regras do Art. 8º: se por escrito, cláusula destacada é obrigatória
  if (medium === "written" && !highlighted) {
    throw badRequest("Consentimento por escrito exige cláusula destacada (highlighted_clause).");
  }

  await insertStatement(db, "consents", {
    id,
    code,
    data_subject_id: input.data_subject_id,
    operation_id: input.operation_id,
    legal_base_id: input.legal_base_id,
    medium,
    consented_at: ts,
    consented_by: actorId,
    text_version: input.text_version,
    highlighted_clause: highlighted,
    ip_address: input.ip_address ?? null,
    user_agent: input.user_agent ?? null,
    status: "active",
    revoked_at: null,
    revoked_by: null,
    revocation_reason: null,
    created_at: ts,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "consent",
    action: "consent.create",
    entityType: "consent",
    entityId: id,
    after: { code, data_subject_id: input.data_subject_id, operation_id: input.operation_id, medium },
    ...meta,
  });

  const created = await getConsent(db, id);
  if (!created) throw new Error("Falha ao recuperar consentimento após criação.");
  return created;
}

export async function updateConsent(
  db: D1Database,
  id: string,
  input: ConsentUpdate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<Consent> {
  const existing = await getConsent(db, id);
  if (!existing) throw notFound("Consentimento não encontrado.");

  // Somente consentimentos ativos podem ser editados (revogados ficam imutáveis como prova)
  if (existing.status !== "active") {
    throw badRequest("Consentimento não ativo não pode ser alterado.");
  }

  const before = { ...existing };
  const data: Record<string, unknown> = {};
  if (input.medium !== undefined) data.medium = input.medium;
  if (input.text_version !== undefined) data.text_version = input.text_version;
  if (input.highlighted_clause !== undefined) data.highlighted_clause = input.highlighted_clause ? 1 : 0;
  if (input.ip_address !== undefined) data.ip_address = input.ip_address;
  if (input.user_agent !== undefined) data.user_agent = input.user_agent;
  data.updated_at = nowIso();

  // Regras do Art. 8º: se por escrito, cláusula destacada é obrigatória
  if (data.medium === "written" && !data.highlighted_clause) {
    throw badRequest("Consentimento por escrito exige cláusula destacada (highlighted_clause).");
  }

  const changedKeys = Object.keys(data).filter((k) => k !== "updated_at");
  if (changedKeys.length > 0) {
    await updateStatement(db, "consents", id, data).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "consent",
      action: "consent.update",
      entityType: "consent",
      entityId: id,
      before,
      after: { ...existing, ...data },
      ...meta,
    });
  }

  const updated = await getConsent(db, id);
  if (!updated) throw notFound("Consentimento não encontrado após atualização.");
  return updated;
}

export async function revokeConsent(
  db: D1Database,
  id: string,
  input: ConsentRevoke,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<Consent> {
  const existing = await getConsent(db, id);
  if (!existing) throw notFound("Consentimento não encontrado.");

  if (existing.status !== "active") {
    throw badRequest(`Consentimento já está ${existing.status}.`);
  }

  const ts = nowIso();
  await updateStatement(db, "consents", id, {
    status: "revoked",
    revoked_at: ts,
    revoked_by: actorId,
    revocation_reason: input.revocation_reason ?? null,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "consent",
    action: "consent.revoke",
    entityType: "consent",
    entityId: id,
    before: { status: existing.status },
    after: { status: "revoked", revoked_at: ts, revoked_by: actorId, revocation_reason: input.revocation_reason ?? null },
    ...meta,
  });

  const revoked = await getConsent(db, id);
  if (!revoked) throw notFound("Consentimento não encontrado após revogação.");
  return revoked;
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
