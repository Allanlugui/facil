import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../types";
import { currentUser, requireAuth } from "../auth";
import { clientInfo } from "../audit";
import {
  CONTROL_ENTITIES,
  analyzeImpact,
  assertControlPermission,
  deleteControlled,
  findEntity,
  listControlled,
} from "../control";
import { parseBody } from "../errors";

const router = new Hono<AppEnv>();
router.use("*", requireAuth);

const deleteBody = z.object({
  reason: z.string().trim().max(500).nullish(),
});

/** Catálogo de cadastros controláveis, filtrado pelo que o usuário pode gerenciar. */
router.get("/entities", (c) => {
  const user = currentUser(c);
  return c.json({
    items: CONTROL_ENTITIES.filter((entity) => user.permissions.has(entity.permission)).map((entity) => ({
      key: entity.key,
      label: entity.label,
      plural: entity.plural,
      permission: entity.permission,
      alwaysArchive: Boolean(entity.alwaysArchive),
    })),
  });
});

router.get("/:entity", async (c) => {
  const user = currentUser(c);
  const entity = findEntity(c.req.param("entity"));
  assertControlPermission(entity, user.permissions);

  const url = new URL(c.req.url);
  const items = await listControlled(c.env.DB, entity, {
    search: url.searchParams.get("search")?.trim() || undefined,
    includeDeleted: url.searchParams.get("includeDeleted") === "1",
    limit: Number(url.searchParams.get("limit") ?? 200),
  });
  return c.json({ items });
});

/** Prévia do impacto: o que existe hoje apontando para o registro. */
router.get("/:entity/:id/impact", async (c) => {
  const user = currentUser(c);
  const entity = findEntity(c.req.param("entity"));
  assertControlPermission(entity, user.permissions);
  return c.json(await analyzeImpact(c.env.DB, entity, c.req.param("id")));
});

/**
 * Exclusão. O servidor recalcula o impacto na hora -- o cliente só envia o
 * motivo. Sem histórico a linha sai de verdade; com histórico ela é arquivada.
 */
router.post("/:entity/:id/delete", async (c) => {
  const user = currentUser(c);
  const entity = findEntity(c.req.param("entity"));
  assertControlPermission(entity, user.permissions);
  const body = await parseBody(c, deleteBody);
  const info = clientInfo(c);

  const result = await deleteControlled(c.env.DB, entity, c.req.param("id"), {
    actor: { id: user.id, name: user.name },
    ip: info.ip,
    userAgent: info.userAgent,
    reason: body.reason ?? null,
  });

  return c.json({
    ok: true,
    mode: result.mode,
    message: result.impact.message,
    impact: result.impact,
  });
});

export default router;
