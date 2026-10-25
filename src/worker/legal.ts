/**
 * LGPD - Registro de base legal para tratamento de dados pessoais (Art. 7º,
 * Lei 13.709/2018).
 *
 * Regras centrais:
 *  - Toda operação de tratamento deve estar vinculada a exatamente uma base
 *    legal ativa (Art. 7º).
 *  - Bases legais nunca são apagadas: são desativadas (is_active = 0) e
 *    preservadas para auditoria histórica.
 *  - Toda criação/edição/desativação grava trilha no audit_log (module 'legal').
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
  DataProcessingOperation,
  DataProcessingOperationCreate,
  DataProcessingOperationUpdate,
  LegalBase,
  LegalBaseCreate,
  LegalBaseUpdate,
} from "@shared/types";

/* -------------------------------------------------------------------------- */
/* Tipos auxiliares para leitura do banco (is_active vem como 0/1)            */
/* -------------------------------------------------------------------------- */

interface LegalBaseRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  article_ref: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface DataProcessingOperationRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  legal_base_id: string;
  legal_base_code: string | null;
  legal_base_name: string | null;
  purpose: string;
  data_categories_json: string;
  data_subjects_json: string;
  retention_period: string | null;
  retention_justification: string | null;
  controller: string | null;
  dpo_contact: string | null;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

/* -------------------------------------------------------------------------- */
/* Bases legais                                                               */
/* -------------------------------------------------------------------------- */

export async function listLegalBases(db: D1Database): Promise<LegalBase[]> {
  const rows = await allRows<LegalBaseRow>(
    db,
    `SELECT id, code, name, description, article_ref, is_active, created_at, updated_at
       FROM legal_bases
      ORDER BY code ASC`,
  );
  return rows.map((r) => toLegalBase(r));
}

function toLegalBase(r: LegalBaseRow): LegalBase {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    article_ref: r.article_ref,
    is_active: r.is_active === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function getLegalBase(db: D1Database, id: string): Promise<LegalBase | null> {
  const row = await oneRow<LegalBaseRow>(
    db,
    `SELECT id, code, name, description, article_ref, is_active, created_at, updated_at
       FROM legal_bases
      WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return toLegalBase(row);
}

export async function createLegalBase(
  db: D1Database,
  input: LegalBaseCreate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<LegalBase> {
  const existing = await oneRow<{ id: string }>(
    db,
    `SELECT id FROM legal_bases WHERE code = ?`,
    [input.code],
  );
  if (existing) throw conflict(`Já existe uma base legal com o código "${input.code}".`);

  const id = uuid();
  const ts = nowIso();
  await insertStatement(db, "legal_bases", {
    id,
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    article_ref: input.article_ref ?? null,
    is_active: 1,
    created_at: ts,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "legal",
    action: "legal_base.create",
    entityType: "legal_base",
    entityId: id,
    after: { code: input.code, name: input.name },
    ...meta,
  });

  const created = await getLegalBase(db, id);
  if (!created) throw new Error("Falha ao recuperar base legal após criação.");
  return created;
}

export async function updateLegalBase(
  db: D1Database,
  id: string,
  input: LegalBaseUpdate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<LegalBase> {
  const existing = await getLegalBase(db, id);
  if (!existing) throw notFound("Base legal não encontrada.");

  const before = { ...existing };
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.article_ref !== undefined) data.article_ref = input.article_ref;
  if (input.is_active !== undefined) data.is_active = input.is_active ? 1 : 0;
  data.updated_at = nowIso();

  const changedKeys = Object.keys(data).filter((k) => k !== "updated_at");
  if (changedKeys.length > 0) {
    await updateStatement(db, "legal_bases", id, data).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "legal",
      action: "legal_base.update",
      entityType: "legal_base",
      entityId: id,
      before,
      after: { ...existing, ...data },
      ...meta,
    });
  }

  const updated = await getLegalBase(db, id);
  if (!updated) throw notFound("Base legal não encontrada após atualização.");
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Operações de tratamento de dados pessoais                                  */
/* -------------------------------------------------------------------------- */

export async function listDataProcessingOperations(
  db: D1Database,
  { page, pageSize }: { page: number; pageSize: number },
  filters: {
    legalBaseId?: string;
    isActive?: boolean;
    search?: string;
  } = {},
): Promise<{ items: DataProcessingOperation[]; total: number }> {
  const w = new WhereBuilder();
  if (filters.legalBaseId) w.add("dpo.legal_base_id = ?", filters.legalBaseId);
  if (filters.isActive !== undefined) w.add("dpo.is_active = ?", filters.isActive ? 1 : 0);
  if (filters.search) {
    w.add("(dpo.name LIKE ? OR dpo.purpose LIKE ? OR dpo.code LIKE ?)", `%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }

  const offset = (page - 1) * pageSize;

  const items = await allRows<DataProcessingOperationRow>(
    db,
    `SELECT dpo.id, dpo.code, dpo.name, dpo.description, dpo.legal_base_id,
            lb.code AS legal_base_code, lb.name AS legal_base_name,
            dpo.purpose, dpo.data_categories AS data_categories_json,
            dpo.data_subjects AS data_subjects_json,
            dpo.retention_period, dpo.retention_justification,
            dpo.controller, dpo.dpo_contact,
            dpo.is_active, dpo.created_by, dpo.created_at, dpo.updated_at,
            dpo.deleted_at, dpo.deleted_by
       FROM data_processing_operations dpo
       JOIN legal_bases lb ON lb.id = dpo.legal_base_id
      ${w.sql()}
      ORDER BY dpo.created_at DESC
      LIMIT ? OFFSET ?`,
    [...w.values(), pageSize, offset],
  );

  const total = await countRows(
    db,
    `SELECT COUNT(*) AS c FROM data_processing_operations dpo ${w.sql()}`,
    w.values(),
  );

  return {
    items: items.map((r) => toDataProcessingOperation(r)),
    total,
  };
}

function toDataProcessingOperation(r: DataProcessingOperationRow): DataProcessingOperation {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    legal_base_id: r.legal_base_id,
    legal_base_code: r.legal_base_code ?? null,
    legal_base_name: r.legal_base_name ?? null,
    purpose: r.purpose,
    data_categories: JSON.parse(r.data_categories_json),
    data_subjects: JSON.parse(r.data_subjects_json),
    retention_period: r.retention_period ?? null,
    retention_justification: r.retention_justification ?? null,
    controller: r.controller ?? null,
    dpo_contact: r.dpo_contact ?? null,
    is_active: r.is_active === 1,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_at: r.deleted_at ?? null,
    deleted_by: r.deleted_by ?? null,
  };
}

export async function getDataProcessingOperation(db: D1Database, id: string): Promise<DataProcessingOperation | null> {
  const row = await oneRow<DataProcessingOperationRow>(
    db,
    `SELECT dpo.id, dpo.code, dpo.name, dpo.description, dpo.legal_base_id,
            lb.code AS legal_base_code, lb.name AS legal_base_name,
            dpo.purpose, dpo.data_categories AS data_categories_json,
            dpo.data_subjects AS data_subjects_json,
            dpo.retention_period, dpo.retention_justification,
            dpo.controller, dpo.dpo_contact,
            dpo.is_active, dpo.created_by, dpo.created_at, dpo.updated_at,
            dpo.deleted_at, dpo.deleted_by
       FROM data_processing_operations dpo
       JOIN legal_bases lb ON lb.id = dpo.legal_base_id
      WHERE dpo.id = ?`,
    [id],
  );
  if (!row) return null;
  return toDataProcessingOperation(row);
}

export async function createDataProcessingOperation(
  db: D1Database,
  input: DataProcessingOperationCreate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataProcessingOperation> {
  const base = await getLegalBase(db, input.legal_base_id);
  if (!base) throw badRequest("Base legal informada não existe.");
  if (!base.is_active) throw badRequest("A base legal informada está inativa.");

  const counter = await requireCounter(db, "legal_op");
  const code = `LGP-${new Date().getUTCFullYear()}-${String(counter).padStart(6, "0")}`;
  const id = uuid();
  const ts = nowIso();

  await insertStatement(db, "data_processing_operations", {
    id,
    code,
    name: input.name,
    description: input.description ?? null,
    legal_base_id: input.legal_base_id,
    purpose: input.purpose,
    data_categories: JSON.stringify(input.data_categories),
    data_subjects: JSON.stringify(input.data_subjects),
    retention_period: input.retention_period ?? null,
    retention_justification: input.retention_justification ?? null,
    controller: input.controller ?? null,
    dpo_contact: input.dpo_contact ?? null,
    is_active: 1,
    created_by: actorId,
    created_at: ts,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "legal",
    action: "data_processing_operation.create",
    entityType: "data_processing_operation",
    entityId: id,
    after: { code, name: input.name, legal_base_id: input.legal_base_id },
    ...meta,
  });

  const created = await getDataProcessingOperation(db, id);
  if (!created) throw new Error("Falha ao recuperar operação após criação.");
  return created;
}

export async function updateDataProcessingOperation(
  db: D1Database,
  id: string,
  input: DataProcessingOperationUpdate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataProcessingOperation> {
  const existing = await getDataProcessingOperation(db, id);
  if (!existing) throw notFound("Operação de tratamento não encontrada.");

  const before = { ...existing };
  const data: Record<string, unknown> = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.legal_base_id !== undefined && input.legal_base_id !== null) {
    const base = await getLegalBase(db, input.legal_base_id);
    if (!base) throw badRequest("Base legal informada não existe.");
    if (!base.is_active) throw badRequest("A base legal informada está inativa.");
    data.legal_base_id = input.legal_base_id;
  }
  if (input.purpose !== undefined) data.purpose = input.purpose;
  if (input.data_categories !== undefined) {
    data.data_categories = JSON.stringify(input.data_categories);
  }
  if (input.data_subjects !== undefined) {
    data.data_subjects = JSON.stringify(input.data_subjects);
  }
  if (input.retention_period !== undefined) data.retention_period = input.retention_period;
  if (input.retention_justification !== undefined) data.retention_justification = input.retention_justification;
  if (input.controller !== undefined) data.controller = input.controller;
  if (input.dpo_contact !== undefined) data.dpo_contact = input.dpo_contact;
  if (input.is_active !== undefined) data.is_active = input.is_active ? 1 : 0;
  data.updated_at = nowIso();

  const changedKeys = Object.keys(data).filter((k) => k !== "updated_at");
  if (changedKeys.length > 0) {
    await updateStatement(db, "data_processing_operations", id, data).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "legal",
      action: "data_processing_operation.update",
      entityType: "data_processing_operation",
      entityId: id,
      before,
      after: { ...existing, ...data },
      ...meta,
    });
  }

  const updated = await getDataProcessingOperation(db, id);
  if (!updated) throw notFound("Operação de tratamento não encontrada após atualização.");
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
