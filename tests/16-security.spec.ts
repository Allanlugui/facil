import { beforeEach, describe, expect, it } from "vitest";
import { Api, expectError, resetDatabase, setupAdmin, type Actor } from "./helpers";

/**
 * Endurecimento HTTP da 0.1.1:
 *   - cabeçalhos de segurança (CSP, frame, MIME, HSTS, cache);
 *   - escrita de navegador só com Origin do próprio host;
 *   - corpo JSON gigante recusado antes do Zod/DB.
 */
describe("16: segurança HTTP", () => {
  let admin: Actor;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
  });

  it("aplica os cabeçalhos de segurança também nas respostas da API", async () => {
    const response = await admin.api.fetchRaw("GET", "/api/health");
    expect(response.status).toBe(200);

    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("bloqueia escrita com Origin de outro host e aceita o mesmo host", async () => {
    const credentials = { email: "ninguem@exemplo.test", password: "SenhaDeTeste123" };

    const evil = await new Api().request("POST", "/api/auth/login", {
      body: credentials,
      headers: { origin: "https://evil.test" },
    });
    expectError(evil, "ORIGIN_NOT_ALLOWED");
    expect(evil.status).toBe(403);

    const same = await new Api().request("POST", "/api/auth/login", {
      body: credentials,
      headers: { origin: "https://facil.test" },
    });
    // Passou pelo guard de origem; a credencial é que não existe.
    expect(same.status).toBe(401);
    expectError(same, "UNAUTHORIZED");
  });

  it("recusa corpo JSON acima de 1 MB antes de validar o schema", async () => {
    const big = await admin.api.post("/api/support/requests", {
      kind: "help",
      name: "Teste de corpo grande",
      email: "teste@exemplo.test",
      reason: "x".repeat(1_100_000),
    });
    expect(big.status).toBe(413);
    expectError(big, "PAYLOAD_TOO_LARGE");
  });
});
