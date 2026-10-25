/**
 * LGPD - Encarregado (DPO) pelo tratamento de dados pessoais (Art. 41,
 * Lei 13.709/2018).
 *
 * Regras centrais:
 *  - O controlador deverá indicar encarregado pelo tratamento de dados pessoais.
 *  - A identidade e contato devem ser divulgados publicamente.
 *  - Só um encarregado ativo por vez (regra de negócio).
 *  - Nunca é apagado: desativado (is_active = 0) com data e motivo, preservando
 *    o histórico para auditoria.
 */

import {
  allRows,
  insertStatement,
  oneRow,
  updateStatement,
} from "./db";
import { recordAudit } from "./audit";
import { badRequest, conflict, notFound } from "./errors";
import { nowIso, uuid } from "./util";
import type {
  DataProtectionOfficer,
  DataProtectionOfficerCreate,
  DataProtectionOfficerUpdate,
} from "@shared/types";

/* -------------------------------------------------------------------------- */
/* Tipos auxiliares de leitura                                                */
/* -------------------------------------------------------------------------- */

interface DpoRow {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  active_from: string;
  active_until: string | null;
  is_active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toDpo(r: DpoRow): DataProtectionOfficer {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    email: r.email,
    phone: r.phone,
    department: r.department,
    active_from: r.active_from,
    active_until: r.active_until ?? null,
    is_active: r.is_active === 1,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deactivated_at: r.deactivated_at ?? null,
    deactivated_by: r.deactivated_by ?? null,
    deactivation_reason: r.deactivation_reason ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* Listagem                                                                   */
/* -------------------------------------------------------------------------- */

export async function listDpo(db: D1Database): Promise<DataProtectionOfficer[]> {
  const rows = await allRows<DpoRow>(
    db,
    `SELECT id, code, name, email, phone, department, active_from, active_until,
            is_active, created_by, created_at, updated_at,
            deactivated_at, deactivated_by, deactivation_reason
       FROM data_protection_officers
      ORDER BY active_from DESC, name ASC`,
  );
  return rows.map(toDpo);
}

export async function getDpo(db: D1Database, id: string): Promise<DataProtectionOfficer | null> {
  const row = await oneRow<DpoRow>(
    db,
    `SELECT id, code, name, email, phone, department, active_from, active_until,
            is_active, created_by, created_at, updated_at,
            deactivated_at, deactivated_by, deactivation_reason
       FROM data_protection_officers
      WHERE id = ?`,
    [id],
  );
  if (!row) return null;
  return toDpo(row);
}

export async function getDpoByCode(db: D1Database, code: string): Promise<DataProtectionOfficer | null> {
  const row = await oneRow<DpoRow>(
    db,
    `SELECT id, code, name, email, phone, department, active_from, active_until,
            is_active, created_by, created_at, updated_at,
            deactivated_at, deactivated_by, deactivation_reason
       FROM data_protection_officers
      WHERE code = ?`,
    [code],
  );
  if (!row) return null;
  return toDpo(row);
}

export async function getActiveDpo(db: D1Database): Promise<DataProtectionOfficer | null> {
  const row = await oneRow<DpoRow>(
    db,
    `SELECT id, code, name, email, phone, department, active_from, active_until,
            is_active, created_by, created_at, updated_at,
            deactivated_at, deactivated_by, deactivation_reason
       FROM data_protection_officers
      WHERE is_active = 1
      ORDER BY active_from DESC
      LIMIT 1`,
  );
  if (!row) return null;
  return toDpo(row);
}

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

export async function createDpo(
  db: D1Database,
  input: DataProtectionOfficerCreate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataProtectionOfficer> {
  const existingCode = await oneRow<{ id: string }>(
    db,
    `SELECT id FROM data_protection_officers WHERE code = ?`,
    [input.code],
  );
  if (existingCode) throw conflict(`Já existe um encarregado com o código "${input.code}".`);

  const existingEmail = await oneRow<{ id: string }>(
    db,
    `SELECT id FROM data_protection_officers WHERE email = ?`,
    [input.email],
  );
  if (existingEmail) throw conflict(`Já existe um encarregado com o e-mail "${input.email}".`);

  // Só um encarregado ativo por vez: desativa o anterior, se houver.
  const currentActive = await getActiveDpo(db);
  if (currentActive) {
    await updateStatement(db, "data_protection_officers", currentActive.id, {
      is_active: 0,
      deactivated_at: nowIso(),
      deactivated_by: actorId,
      deactivation_reason: "Substituído por novo encarregado designado.",
      updated_at: nowIso(),
    }).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "dpo",
      action: "dpo.deactivate",
      entityType: "data_protection_officer",
      entityId: currentActive.id,
      before: { is_active: true },
      after: { is_active: false, deactivated_at: nowIso(), deactivated_by: actorId },
      ...meta,
    });
  }

  const id = uuid();
  const ts = nowIso();
  await insertStatement(db, "data_protection_officers", {
    id,
    code: input.code,
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    department: input.department ?? null,
    active_from: input.active_from,
    active_until: input.active_until ?? null,
    is_active: 1,
    created_by: actorId,
    created_at: ts,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "dpo",
    action: "dpo.create",
    entityType: "data_protection_officer",
    entityId: id,
    after: { code: input.code, name: input.name, email: input.email },
    ...meta,
  });

  const created = await getDpo(db, id);
  if (!created) throw new Error("Falha ao recuperar encarregado após criação.");
  return created;
}

/* -------------------------------------------------------------------------- */
/* Atualização                                                                */
/* -------------------------------------------------------------------------- */

export async function updateDpo(
  db: D1Database,
  id: string,
  input: DataProtectionOfficerUpdate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataProtectionOfficer> {
  const existing = await getDpo(db, id);
  if (!existing) throw notFound("Encarregado não encontrado.");

  const before = { ...existing };
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) data.email = input.email;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.department !== undefined) data.department = input.department;
  if (input.active_from !== undefined) data.active_from = input.active_from;
  if (input.active_until !== undefined) data.active_until = input.active_until;
  if (input.is_active !== undefined) data.is_active = input.is_active ? 1 : 0;
  data.updated_at = nowIso();

  const changedKeys = Object.keys(data).filter((k) => k !== "updated_at");
  if (changedKeys.length > 0) {
    await updateStatement(db, "data_protection_officers", id, data).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "dpo",
      action: "dpo.update",
      entityType: "data_protection_officer",
      entityId: id,
      before,
      after: { ...existing, ...data },
      ...meta,
    });
  }

  const updated = await getDpo(db, id);
  if (!updated) throw notFound("Encarregado não encontrado após atualização.");
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Desativação                                                                */
/* -------------------------------------------------------------------------- */

export async function deactivateDpo(
  db: D1Database,
  id: string,
  reason: string | null,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<DataProtectionOfficer> {
  const existing = await getDpo(db, id);
  if (!existing) throw notFound("Encarregado não encontrado.");
  if (!existing.is_active) throw badRequest("O encarregado já está desativado.");

  const ts = nowIso();
  await updateStatement(db, "data_protection_officers", id, {
    is_active: 0,
    deactivated_at: ts,
    deactivated_by: actorId,
    deactivation_reason: reason ?? null,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "dpo",
    action: "dpo.deactivate",
    entityType: "data_protection_officer",
    entityId: id,
    before: { is_active: true },
    after: { is_active: false, deactivated_at: ts, deactivated_by: actorId, deactivation_reason: reason ?? null },
    ...meta,
  });

  const deactivated = await getDpo(db, id);
  if (!deactivated) throw notFound("Encarregado não encontrado após desativação.");
  return deactivated;
}

