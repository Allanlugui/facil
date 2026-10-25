/**
 * LGPD - Rotas de API para Encarregado (DPO) (Art. 41, Lei 13.709/2018).
 *
 * Permissões:
 *  - dpo.view: leitura do encarregado
 *  - dpo.manage: criação, edição e desativação
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { requireAuth, requirePermission } from "../auth";
import { badRequest, conflict, parseBody } from "../errors";
import {
  createDpo,
  deactivateDpo,
  getActiveDpo,
  listDpo,
  updateDpo,
} from "../dpo";


const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas de validação                                                      */
/* -------------------------------------------------------------------------- */

const dpoCreateSchema = z.object({
  code: z.string().trim().min(1, "Informe o código do encarregado.").max(40),
  name: z.string().trim().min(2, "Informe o nome do encarregado.").max(160),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(30).nullish(),
  department: z.string().trim().max(80).nullish(),
  active_from: z.string().trim().min(1, "Informe a data de início da designação."),
  active_until: z.string().trim().max(10).nullish(),
});

const dpoUpdateSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do encarregado.").max(160).nullish(),
  email: z.string().trim().email().max(200).nullish(),
  phone: z.string().trim().max(30).nullish(),
  department: z.string().trim().max(80).nullish(),
  active_from: z.string().trim().max(10).nullish(),
  active_until: z.string().trim().max(10).nullish(),
  is_active: z.boolean().nullish(),
});

/* -------------------------------------------------------------------------- */
/* Listagem / ativo                                                           */
/* -------------------------------------------------------------------------- */

router.get("/", requirePermission("dpo.view"), async (c) => {
  const dpos = await listDpo(c.env.DB);
  return c.json({ items: dpos, total: dpos.length });
});

router.get("/active", requirePermission("dpo.view"), async (c) => {
  const active = await getActiveDpo(c.env.DB);
  return c.json({ item: active });
});

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

router.post("/", requirePermission("dpo.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const input = await parseBody(c, dpoCreateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  try {
    const created = await createDpo(c.env.DB, input, user.id, user.name, meta);
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

router.patch("/:id", requirePermission("dpo.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador do encarregado é obrigatório.");
  const input = await parseBody(c, dpoUpdateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const updated = await updateDpo(c.env.DB, param, input, user.id, user.name, meta);
  return c.json({ item: updated });
});

router.post("/:id/deactivate", requirePermission("dpo.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador do encarregado é obrigatório.");

  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason : null;
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const deactivated = await deactivateDpo(c.env.DB, param, reason, user.id, user.name, meta);
  return c.json({ item: deactivated });
});

export default router;
