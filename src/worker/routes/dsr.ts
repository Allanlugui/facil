/**
 * LGPD - Rotas de API para direitos do titular (Arts. 18 e 19, Lei 13.709/2018).
 *
 * Permissões:
 *  - dsr.view: leitura de solicitações de direitos do titular
 *  - dsr.manage: criação, edição e resposta
 */

import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { requireAuth, requirePermission } from "../auth";
import { badRequest, conflict, parseBody, parseQuery } from "../errors";
import {
  createDataSubjectRequest,
  listDataSubjectRequests,
  listDataSubjectRequestsForSubject,
  updateDataSubjectRequest,
} from "../data_subject_requests";
const router = new Hono<AppEnv>();
router.use("*", requireAuth);

/* -------------------------------------------------------------------------- */
/* Esquemas de validação                                                      */
/* -------------------------------------------------------------------------- */

const dsrCreateSchema = z.object({
  data_subject_id: z.string().trim().min(1, "Selecione o titular."),
  request_type: z.enum([
    "access", "correction", "deletion", "portability",
    "revocation", "information", "consequences", "other",
  ]),
  requested_at: z.string().trim().min(1, "Informe a data da solicitação."),
  response_summary: z.string().trim().max(1000).nullish(),
  response_details: z.string().trim().max(5000).nullish(),
  responsible_user_id: z.string().trim().min(1, "Informe o responsável.").nullish(),
});

const dsrUpdateSchema = z.object({
  status: z.enum(["received", "in_progress", "responded", "rejected"]).nullish(),
  response_summary: z.string().trim().max(1000).nullish(),
  response_details: z.string().trim().max(5000).nullish(),
  responsible_user_id: z.string().trim().min(1, "Informe o responsável.").nullish(),
  responded_at: z.string().trim().max(10).nullish(),
});

const listDsrQuery = z.object({
  data_subject_id: z.string().optional(),
  status: z.string().optional(),
  request_type: z.string().optional(),
  search: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Listagem                                                                   */
/* -------------------------------------------------------------------------- */

router.get("/", requirePermission("dsr.view"), async (c) => {
  const { data_subject_id, status, request_type, search } = parseQuery(c, listDsrQuery);

  const { items, total } = await listDataSubjectRequests(c.env.DB, {
    dataSubjectId: data_subject_id,
    status,
    requestType: request_type,
    search,
  });
  return c.json({ items, total });
});

router.get("/subjects/:subjectId", requirePermission("dsr.view"), async (c) => {
  const { subjectId } = c.req.param();
  if (!subjectId || !subjectId.trim()) throw badRequest("Identificador do titular é obrigatório.");
  const items = await listDataSubjectRequestsForSubject(c.env.DB, subjectId);
  return c.json({ items, total: items.length });
});

/* -------------------------------------------------------------------------- */
/* Criação                                                                    */
/* -------------------------------------------------------------------------- */

router.post("/", requirePermission("dsr.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const input = await parseBody(c, dsrCreateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  try {
    const created = await createDataSubjectRequest(c.env.DB, input, user.id, user.name, meta);
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

router.patch("/:id", requirePermission("dsr.manage"), async (c) => {
  const user = c.get("user");
  if (!user) throw new Error("Usuário não autenticado.");
  const param = c.req.param("id") as string;
  if (!param || !param.trim()) throw badRequest("Identificador da solicitação é obrigatório.");
  const input = await parseBody(c, dsrUpdateSchema);
  const meta = { ip: c.req.header("cf-connecting-ip") ?? null, userAgent: c.req.header("user-agent") ?? null };

  const updated = await updateDataSubjectRequest(c.env.DB, param, input, user.id, user.name, meta);
  return c.json({ item: updated });
});

export default router;
