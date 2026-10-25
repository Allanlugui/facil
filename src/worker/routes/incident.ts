/**
 * LGPD - Rotas de API para incidentes de segurança (Art. 48, Lei 13.709/2018).
 *
 * Permissões:
 *  - incident.view: leitura de incidentes
 *  - incident.manage: registro, atualização e comunicação
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { requireAuth, requirePermission } from "../auth";
import { badRequest, conflict, parseBody, parseQuery } from "../errors";
import {
  createSecurityIncident,
  listSecurityIncidents,
  updateSecurityIncident,
} from "../security_incidents";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas de validação                                                      */
/* -------------------------------------------------------------------------- */

const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
const STATUS_VALUES = [
  "detected",
  "in_analysis",
  "communicating",
  "communicated",
  "resolved",
] as const;

const incidentCreateSchema = z.object({
  title: z.string().trim().min(2, "Informe o título do incidente.").max(160),
  description: z.string().trim().min(5, "Descreva a natureza do incidente.").max(5000),
  severity: z.enum(SEVERITY_VALUES).nullish(),
  detected_at: z.string().trim().min(1, "Informe a data/hora da detecção."),
  data_affected: z.string().trim().min(1, "Descreva a natureza dos dados afetados.").max(2000),
  subjects_affected: z.string().trim().min(1, "Descreva os titulares envolvidos.").max(2000),
  security_measures: z.string().trim().max(2000).nullish(),
  risks: z.string().trim().max(2000).nullish(),
  communication_delay_reason: z.string().trim().max(2000).nullish(),
  mitigation_measures: z.string().trim().max(2000).nullish(),
  responsible_user_id: z.string().trim().min(1).nullish(),
});

const incidentUpdateSchema = z.object({
  title: z.string().trim().min(2, "Informe o título do incidente.").max(160).nullish(),
  description: z.string().trim().min(5, "Descreva a natureza do incidente.").max(5000).nullish(),
  severity: z.enum(SEVERITY_VALUES).nullish(),
  detected_at: z.string().trim().min(1).nullish(),
  data_affected: z.string().trim().min(1).max(2000).nullish(),
  subjects_affected: z.string().trim().min(1).max(2000).nullish(),
  security_measures: z.string().trim().max(2000).nullish(),
  risks: z.string().trim().max(2000).nullish(),
  communication_delay_reason: z.string().trim().max(2000).nullish(),
  mitigation_measures: z.string().trim().max(2000).nullish(),
  status: z.enum(STATUS_VALUES).nullish(),
  anpd_notified_at: z.string().trim().max(30).nullish(),
  subjects_notified_at: z.string().trim().max(30).nullish(),
  notification_medium: z.string().trim().max(200).nullish(),
  responsible_user_id: z.string().trim().min(1).nullish(),
  resolved_at: z.string().trim().max(30).nullish(),
  resolution_summary: z.string().trim().max(5000).nullish(),
});

const listIncidentQuery = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  search: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Listagem                                                                   */
/* -------------------------------------------------------------------------- */

router.get("/", requirePermission("incident.view"), async (c) => {
  const { status, severity, search } = parseQuery(c, listIncidentQuery);

  const { items, total } = await listSecurityIncidents(c.env.DB, { status, severity, search });
  return c.json({ items, total });
});

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

router.post("/", requirePermission("incident.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const input = await parseBody(c, incidentCreateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  try {
    const created = await createSecurityIncident(c.env.DB, input, user.id, user.name, meta);
    return c.json({ item: created }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Já existe")) {
      throw conflict(err.message);
    }
    throw err;
  }
});

/* -------------------------------------------------------------------------- */
/* Atualização                                                                */
/* -------------------------------------------------------------------------- */

router.patch("/:id", requirePermission("incident.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador do incidente é obrigatório.");
  const input = await parseBody(c, incidentUpdateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const updated = await updateSecurityIncident(c.env.DB, param, input, user.id, user.name, meta);
  return c.json({ item: updated });
});

export default router;
