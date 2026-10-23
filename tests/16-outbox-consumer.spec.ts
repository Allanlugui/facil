import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { countRows, resetDatabase, setupAdmin } from "./helpers";
import { runOutboxConsumer } from "../src/worker/outbox-consumer";

/**
 * Consumidor do `integration_outbox`.
 *
 * Sem `TICKET_INTAKE_KEY`/`SERVICENOW_INSTANCE_URL` configurados, o consumidor
 * deve pular silenciosamente (não processar, não falhar o Worker), pois a
 * integração depende de credenciais que o titular ainda não informou.
 */
describe("outbox consumer", () => {
  beforeEach(async () => {
    await resetDatabase();
    await setupAdmin();
  });

  const fakeEnv = (overrides: Record<string, unknown> = {}) => ({
    DB: env.DB,
    TICKET_INTAKE_KEY: undefined,
    SERVICENOW_INSTANCE_URL: undefined,
    ...overrides,
  });

  it("sem chave de integracao, pula sem processar nada", async () => {
    const result = await runOutboxConsumer(fakeEnv());
    expect(result.skipped).toBeGreaterThanOrEqual(0);
    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("nao cria eventos nem altera o banco quando pula", async () => {
    const before = await countRows("SELECT COUNT(*) AS total FROM integration_outbox");
    await runOutboxConsumer(fakeEnv());
    const after = await countRows("SELECT COUNT(*) AS total FROM integration_outbox");
    expect(after).toBe(before);
  });
});
