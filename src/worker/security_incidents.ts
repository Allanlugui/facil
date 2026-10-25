/**
 * LGPD - Incidentes de segurança (Art. 48, Lei 13.709/2018).
 *
 * Regras centrais:
 *  - O controlador deve comunicar à autoridade nacional (ANPD) e ao titular a
 *    ocorrência de incidente de segurança que possa acarretar risco ou dano
 *    relevante aos titulares.
 *  - A comunicação deve mencionar: natureza dos dados afetados, titulares
 *    envolvidos, medidas de segurança utilizadas, riscos, motivo da demora e
 *    medidas de reversão/mitigação.
 *  - Nunca é apagado: apenas atualizado de status, preservando auditoria.
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
  SecurityIncident,
  SecurityIncidentCreate,
  SecurityIncidentUpdate,
} from "@shared/types";

/* -------------------------------------------------------------------------- */
/* Tipos auxiliares de leitura                                                */
/* -------------------------------------------------------------------------- */

interface IncidentRow {
  id: string;
  code: string;
  title: string;
  description: string;
  severity: string;
  detected_at: string;
  data_affected: string;
  subjects_affected: string;
  security_measures: string | null;
  risks: string | null;
  communication_delay_reason: string | null;
  mitigation_measures: string | null;
  status: string;
  anpd_notified_at: string | null;
  subjects_notified_at: string | null;
  notification_medium: string | null;
  responsible_user_id: string | null;
  responsible_user_name: string | null;
  resolved_at: string | null;
  resolution_summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toIncident(r: IncidentRow): SecurityIncident {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description,
    severity: r.severity,
    detected_at: r.detected_at,
    data_affected: r.data_affected,
    subjects_affected: r.subjects_affected,
    security_measures: r.security_measures ?? null,
    risks: r.risks ?? null,
    communication_delay_reason: r.communication_delay_reason ?? null,
    mitigation_measures: r.mitigation_measures ?? null,
    status: r.status,
    anpd_notified_at: r.anpd_notified_at ?? null,
    subjects_notified_at: r.subjects_notified_at ?? null,
    notification_medium: r.notification_medium ?? null,
    responsible_user_id: r.responsible_user_id ?? null,
    responsible_user_name: r.responsible_user_name ?? null,
    resolved_at: r.resolved_at ?? null,
    resolution_summary: r.resolution_summary ?? null,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

const SELECT_INCIDENT = `
  SELECT si.id, si.code, si.title, si.description, si.severity, si.detected_at,
         si.data_affected, si.subjects_affected, si.security_measures, si.risks,
         si.communication_delay_reason, si.mitigation_measures, si.status,
         si.anpd_notified_at, si.subjects_notified_at, si.notification_medium,
         si.responsible_user_id, u.name AS responsible_user_name,
         si.resolved_at, si.resolution_summary,
         si.created_by, si.created_at, si.updated_at
    FROM security_incidents si
    LEFT JOIN users u ON u.id = si.responsible_user_id
`;

/* -------------------------------------------------------------------------- */
/* Listagem                                                                   */
/* -------------------------------------------------------------------------- */

export async function listSecurityIncidents(
  db: D1Database,
  filters: {
    status?: string;
    severity?: string;
    search?: string;
  } = {},
): Promise<{ items: SecurityIncident[]; total: number }> {
  const w = new WhereBuilder();
  if (filters.status) w.add("si.status = ?", filters.status);
  if (filters.severity) w.add("si.severity = ?", filters.severity);
  if (filters.search) {
    w.add("(si.code LIKE ? OR si.title LIKE ?)", `%${filters.search}%`, `%${filters.search}%`);
  }

  const items = await allRows<IncidentRow>(
    db,
    `${SELECT_INCIDENT}
      ${w.sql()}
      ORDER BY si.detected_at DESC`,
    w.values(),
  );

  const total = await countRows(
    db,
    `SELECT COUNT(*) AS c FROM security_incidents si ${w.sql()}`,
    w.values(),
  );

  return { items: items.map(toIncident), total };
}

export async function getSecurityIncident(
  db: D1Database,
  id: string,
): Promise<SecurityIncident | null> {
  const row = await oneRow<IncidentRow>(db, `${SELECT_INCIDENT} WHERE si.id = ?`, [id]);
  if (!row) return null;
  return toIncident(row);
}

export async function getSecurityIncidentByCode(
  db: D1Database,
  code: string,
): Promise<SecurityIncident | null> {
  const row = await oneRow<IncidentRow>(db, `${SELECT_INCIDENT} WHERE si.code = ?`, [code]);
  if (!row) return null;
  return toIncident(row);
}

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

export async function createSecurityIncident(
  db: D1Database,
  input: SecurityIncidentCreate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SecurityIncident> {
  const counter = await requireCounter(db, "incident");
  const code = `INC-${new Date().getUTCFullYear()}-${String(counter).padStart(6, "0")}`;
  const id = uuid();
  const ts = nowIso();

  await insertStatement(db, "security_incidents", {
    id,
    code,
    title: input.title,
    description: input.description,
    severity: input.severity ?? "medium",
    detected_at: input.detected_at,
    data_affected: input.data_affected,
    subjects_affected: input.subjects_affected,
    security_measures: input.security_measures ?? null,
    risks: input.risks ?? null,
    communication_delay_reason: input.communication_delay_reason ?? null,
    mitigation_measures: input.mitigation_measures ?? null,
    status: "detected",
    anpd_notified_at: null,
    subjects_notified_at: null,
    notification_medium: null,
    responsible_user_id: input.responsible_user_id ?? null,
    resolved_at: null,
    resolution_summary: null,
    created_by: actorId,
    created_at: ts,
    updated_at: ts,
  }).run();

  await recordAudit(db, {
    actor: { id: actorId, name: actorName },
    module: "incident",
    action: "incident.create",
    entityType: "security_incident",
    entityId: id,
    after: { code, title: input.title, severity: input.severity ?? "medium" },
    ...meta,
  });

  const created = await getSecurityIncident(db, id);
  if (!created) throw new Error("Falha ao recuperar incidente após criação.");
  return created;
}

/* -------------------------------------------------------------------------- */
/* Atualização                                                                */
/* -------------------------------------------------------------------------- */

export async function updateSecurityIncident(
  db: D1Database,
  id: string,
  input: SecurityIncidentUpdate,
  actorId: string,
  actorName: string,
  meta: { ip: string | null; userAgent: string | null },
): Promise<SecurityIncident> {
  const existing = await getSecurityIncident(db, id);
  if (!existing) throw notFound("Incidente não encontrado.");

  // Incidente resolvido não aceita alteração de conteúdo (imutável como prova)
  if (existing.status === "resolved" && input.status !== undefined && input.status !== "resolved") {
    throw badRequest("Incidente resolvido não pode voltar a outro status.");
  }

  const before = { ...existing };
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.description !== undefined) data.description = input.description;
  if (input.severity !== undefined) data.severity = input.severity;
  if (input.detected_at !== undefined) data.detected_at = input.detected_at;
  if (input.data_affected !== undefined) data.data_affected = input.data_affected;
  if (input.subjects_affected !== undefined) data.subjects_affected = input.subjects_affected;
  if (input.security_measures !== undefined) data.security_measures = input.security_measures;
  if (input.risks !== undefined) data.risks = input.risks;
  if (input.communication_delay_reason !== undefined)
    data.communication_delay_reason = input.communication_delay_reason;
  if (input.mitigation_measures !== undefined)
    data.mitigation_measures = input.mitigation_measures;
  if (input.status !== undefined) data.status = input.status;
  if (input.anpd_notified_at !== undefined) data.anpd_notified_at = input.anpd_notified_at;
  if (input.subjects_notified_at !== undefined)
    data.subjects_notified_at = input.subjects_notified_at;
  if (input.notification_medium !== undefined)
    data.notification_medium = input.notification_medium;
  if (input.responsible_user_id !== undefined)
    data.responsible_user_id = input.responsible_user_id;
  if (input.resolved_at !== undefined) data.resolved_at = input.resolved_at;
  if (input.resolution_summary !== undefined) data.resolution_summary = input.resolution_summary;
  data.updated_at = nowIso();

  const changedKeys = Object.keys(data).filter((k) => k !== "updated_at");
  if (changedKeys.length > 0) {
    await updateStatement(db, "security_incidents", id, data).run();

    await recordAudit(db, {
      actor: { id: actorId, name: actorName },
      module: "incident",
      action: "incident.update",
      entityType: "security_incident",
      entityId: id,
      before,
      after: { ...existing, ...data },
      ...meta,
    });
  }

  const updated = await getSecurityIncident(db, id);
  if (!updated) throw notFound("Incidente não encontrado após atualização.");
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
