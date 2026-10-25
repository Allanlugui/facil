/**
 * LGPD - Rotas de API para medidas de segurança (Arts. 46 e 49, Lei 13.709/2018).
 *
 * Permissões:
 *  - sec.view: leitura do inventário de medidas de segurança
 *  - sec.manage: criação, edição e desativação
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { requireAuth, requirePermission } from "../auth";
import { badRequest, conflict, parseBody, parseQuery } from "../errors";
import {
  createSecurityMeasure,
  deactivateSecurityMeasure,
  getActiveSecurityMeasures,
  listSecurityMeasures,
  updateSecurityMeasure,
} from "../security_measures";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas de validação                                                      */
/* -------------------------------------------------------------------------- */

const TYPE_VALUES = ["technical", "administrative"] as const;
const CATEGORY_VALUES = [
  "encryption",
  "access_control",
  "backup",
  "logging",
  "training",
  "incident_response",
  "governance",
  "network",
  "other",
] as const;
const STATUS_VALUES = ["implemented", "partially", "planned", "not_implemented"] as const;

const secCreateSchema = z.object({
  code: z.string().trim().min(1, "Informe o código da medida.").max(40),
  name: z.string().trim().min(2, "Informe o nome da medida.").max(160),
  description: z.string().trim().max(2000).nullish(),
  type: z.enum(TYPE_VALUES),
  category: z.enum(CATEGORY_VALUES),
  implementation_status: z.enum(STATUS_VALUES).nullish(),
  responsible_user_id: z.string().trim().min(1).nullish(),
  review_frequency: z.string().trim().max(40).nullish(),
  last_review_at: z.string().trim().max(10).nullish(),
  next_review_at: z.string().trim().max(10).nullish(),
  evidence: z.string().trim().max(2000).nullish(),
});

const secUpdateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da medida.").max(160).nullish(),
  description: z.string().trim().max(2000).nullish(),
  type: z.enum(TYPE_VALUES).nullish(),
  category: z.enum(CATEGORY_VALUES).nullish(),
  implementation_status: z.enum(STATUS_VALUES).nullish(),
  responsible_user_id: z.string().trim().min(1).nullish(),
  review_frequency: z.string().trim().max(40).nullish(),
  last_review_at: z.string().trim().max(10).nullish(),
  next_review_at: z.string().trim().max(10).nullish(),
  evidence: z.string().trim().max(2000).nullish(),
  is_active: z.boolean().nullish(),
});

const listSecQuery = z.object({
  type: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
  is_active: z.string().optional().transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
  search: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Listagem                                                                   */
/* -------------------------------------------------------------------------- */

router.get("/", requirePermission("sec.view"), async (c) => {
  const { type, category, status, is_active, search } = parseQuery(c, listSecQuery);

  const { items, total } = await listSecurityMeasures(c.env.DB, {
    type,
    category,
    implementationStatus: status,
    isActive: is_active,
    search,
  });
  return c.json({ items, total });
});

router.get("/active", requirePermission("sec.view"), async (c) => {
  const { items, total } = await getActiveSecurityMeasures(c.env.DB);
  return c.json({ items, total });
});

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

router.post("/", requirePermission("sec.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const input = await parseBody(c, secCreateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  try {
    const created = await createSecurityMeasure(c.env.DB, input, user.id, user.name, meta);
    return c.json({ item: created }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Já existe")) {
      throw conflict(err.message);
    }
    throw err;
  }
});

/* -------------------------------------------------------------------------- */
/* Atualização / desativação                                                  */
/* -------------------------------------------------------------------------- */

router.patch("/:id", requirePermission("sec.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador da medida é obrigatório.");
  const input = await parseBody(c, secUpdateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const updated = await updateSecurityMeasure(c.env.DB, param, input, user.id, user.name, meta);
  return c.json({ item: updated });
});

router.post("/:id/deactivate", requirePermission("sec.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador da medida é obrigatório.");

  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason : null;
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const deactivated = await deactivateSecurityMeasure(c.env.DB, param, reason, user.id, user.name, meta);
  return c.json({ item: deactivated });
});

export default router;
