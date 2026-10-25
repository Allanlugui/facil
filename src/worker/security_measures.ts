/**
 * LGPD - Medidas de segurança técnica e administrativa (Arts. 46 e 49,
 * Lei 13.709/2018).
 *
 * Regras centrais:
 *  - Inventário das medidas aptas a proteger dados pessoais de acessos não
 *    autorizados e de situações acidentais ou ilícitas (Art. 46).
 *  - Medidas devem ser observadas desde a concepção do produto até a execução
 *    (Art. 46, §2º).
 *  - Sistemas devem atender requisitos de segurança, boas práticas e governança
 *    (Art. 49).
 *  - Nunca é apagada: medida substituída é desativada com data, responsável e
 *    motivo, preservando o histórico.
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
  SecurityMeasure,
  SecurityMeasureCreate,
  SecurityMeasureUpdate,
} from "@shared/types";

/* -------------------------------------------------------------------------- */
/* Tipos auxiliares de leitura                                                */
/* -------------------------------------------------------------------------- */

interface SecurityMeasureRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  category: string;
  implementation_status: string;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  review_frequency: string | null;
  last_review_at: string | null;
  next_review_at: string | null;
  evidence: string | null;
  is_active: number;
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toSecurityMeasure(r: SecurityMeasureRow): SecurityMeasure {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description ?? null,
    type: r.type,
    category: r.category,
    implementation_status: r.implementation_status,
    responsible_user_id: r.responsible_user_id ?? null,
    responsible_user_name: r.responsible_user_name ?? null,
    review_frequency: r.review_frequency ?? null,
    last_review_at: r.last_review_at ?? null,
    next_review_at: r.next_review_at ?? null,
    evidence: r.evidence ?? null,
    is_active: r.is_active === 1,
    deactivated_at: r.deactivated_at ?? null,
    deactivated_by: r.deactivated_by ?? null,
    deactivation_reason: r.deactivation_reason ?? null,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const SELECT_MEASURE = `
  SELECT sm.id, sm.code, sm.name, sm.description, sm.type, sm.category,
         sm.implementation_status, sm.responsible_user_id, u.name AS responsible_user_name,
         sm.review_frequency, sm.last_review_at, sm.next_review_at, sm.evidence,
         sm.is_active, sm.deactivated_at, sm.deactivated_by, sm.deactivation_reason,
         sm.created_by, sm.created_at, sm.updated_at
    FROM security_measures sm
    LEFT JOIN users u ON u.id = sm.responsible_user_id
`;

/* -------------------------------------------------------------------------- */
/* Listagem                                                                   */
/* -------------------------------------------------------------------------- */

export async function listSecurityMeasures(
  db: D1Database,
  filters: {
    type?: string;
    category?: string;
    implementationStatus?: string;
    isActive?: boolean;
    search?: string;
  } = {},
): Promise<{ items: SecurityMeasure[]; total: number }> {
  const w = new WhereBuilder();
  if (filters.type) w.add("sm.type = ?", filters.type);
  if (filters.category) w.add("sm.category = ?", filters.category);
  if (filters.implementationStatus)
    w.add("sm.implementation_status = ?", filters.implementationStatus);
  if (filters.isActive !== undefined) w.add("sm.is_active = ?", filters.isActive ? 1 : 0);
  if (filters.search) {
    w.add("(sm.code LIKE ? OR sm.name LIKE ?)", `%${filters.search}%`, `%${filters.search}%`);
  }

  const items = await allRows<SecurityMeasureRow>(
    db,
    `${SELECT_MEASURE}
      ${w.sql()}
      ORDER BY sm.code ASC`,
    w.values(),
  );

  const total = await countRows(
    db,
    `SELECT COUNT(*) AS c FROM security_measures sm ${w.sql()}`,
    w.values(),
  );

  return { items: items.map(toSecurityMeasure), total };
}

export async function getSecurityMeasure(
  db: D1Database,
  id: string,
): Promise<SecurityMeasure | null> {
  const row = await oneRow<SecurityMeasureRow>(
    db,
    `${SELECT_MEASURE} WHERE sm.id = ?`,
    [id],
  );
  if (!row) return null;
  return toSecurityMeasure(row);
}

export async function getSecurityMeasureByCode(
  db: D1Database,
  code: string,
): Promise<SecurityMeasure | null> {
  const row = await oneRow<SecurityMeasureRow>(
    db,
    `${SELECT_MEASURE} WHERE sm.code = ?`,
    [code],
  );
  if (!row) return null;
  return toSecurityMeasure(row);
}

export async function getActiveSecurityMeasures(
  db: D1Database,
): Promise<{ items: SecurityMeasure[]; total: number }> {
  const rows = await allRows<SecurityMeasureRow>(
    db,
    `${SELECT_MEASURE}
      WHERE sm.is_active = 1
      ORDER BY sm.code ASC`,
  );
  return { items: rows.map(toSecurityMeasure), total: rows.length };
}

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

export async function createSecurityMeasure(
  db: D1Database,
  input: SecurityMeasureCreate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SecurityMeasure> {
  const existing = await oneRow<{ id: string }>(
    db,
    `SELECT id FROM security_measures WHERE code = ?`,
    [input.code],
  );
  if (existing) throw conflict(`Já existe uma medida com o código "${input.code}".`);

  const id = uuid();
  const ts = nowIso();
  await insertStatement(db, "security_measures", {
    id,
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    category: input.category,
    implementation_status: input.implementation_status ?? "planned",
    responsible_user_id: input.responsible_user_id ?? null,
    review_frequency: input.review_frequency ?? null,
    last_review_at: input.last_review_at ?? null,
    next_review_at: input.next_review_at ?? null,
    evidence: input.evidence ?? null,
    is_active: 1,
    created_by: actorId,
    created_at: ts,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "sec",
    action: "security_measure.create",
    entityType: "security_measure",
    entityId: id,
    after: { code: input.code, name: input.name, type: input.type, category: input.category },
    ...meta,
  });

  const created = await getSecurityMeasure(db, id);
  if (!created) throw new Error("Falha ao recuperar medida após criação.");
  return created;
}

/* -------------------------------------------------------------------------- */
/* Atualização                                                                */
/* -------------------------------------------------------------------------- */

export async function updateSecurityMeasure(
  db: D1Database,
  id: string,
  input: SecurityMeasureUpdate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SecurityMeasure> {
  const existing = await getSecurityMeasure(db, id);
  if (!existing) throw notFound("Medida de segurança não encontrada.");

  const before = { ...existing };
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.type !== undefined) data.type = input.type;
  if (input.category !== undefined) data.category = input.category;
  if (input.implementation_status !== undefined)
    data.implementation_status = input.implementation_status;
  if (input.responsible_user_id !== undefined)
    data.responsible_user_id = input.responsible_user_id;
  if (input.review_frequency !== undefined) data.review_frequency = input.review_frequency;
  if (input.last_review_at !== undefined) data.last_review_at = input.last_review_at;
  if (input.next_review_at !== undefined) data.next_review_at = input.next_review_at;
  if (input.evidence !== undefined) data.evidence = input.evidence;
  if (input.is_active !== undefined) data.is_active = input.is_active ? 1 : 0;
  data.updated_at = nowIso();

  const changedKeys = Object.keys(data).filter((k) => k !== "updated_at");
  if (changedKeys.length > 0) {
    await updateStatement(db, "security_measures", id, data).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "sec",
      action: "security_measure.update",
      entityType: "security_measure",
      entityId: id,
      before,
      after: { ...existing, ...data },
      ...meta,
    });
  }

  const updated = await getSecurityMeasure(db, id);
  if (!updated) throw notFound("Medida de segurança não encontrada após atualização.");
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Desativação                                                                */
/* -------------------------------------------------------------------------- */

export async function deactivateSecurityMeasure(
  db: D1Database,
  id: string,
  reason: string | null,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SecurityMeasure> {
  const existing = await getSecurityMeasure(db, id);
  if (!existing) throw notFound("Medida de segurança não encontrada.");
  if (!existing.is_active) throw badRequest("A medida já está desativada.");

  const ts = nowIso();
  await updateStatement(db, "security_measures", id, {
    is_active: 0,
    deactivated_at: ts,
    deactivated_by: actorId,
    deactivation_reason: reason ?? null,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "sec",
    action: "security_measure.deactivate",
    entityType: "security_measure",
    entityId: id,
    before: { is_active: true },
    after: { is_active: false, deactivated_at: ts, deactivated_by: actorId, deactivation_reason: reason ?? null },
    ...meta,
  });

  const deactivated = await getSecurityMeasure(db, id);
  if (!deactivated) throw notFound("Medida de segurança não encontrada após desativação.");
  return deactivated;
}
