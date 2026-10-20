import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Api,
  assert,
  countRows,
  queryAll,
  queryOne,
  resetDatabase,
  setupAdmin,
  type Actor,
} from "./helpers";

/**
 * Provedor `relay` (F-13): a caixa de saída entrega cada e-mail a uma URL
 * HTTPS -- por exemplo, o Web App do Google Apps Script que envia pela conta
 * Gmail (custo zero, qualquer destinatário).
 *
 * O destino é interceptado com um stub de `fetch`, então o teste verifica o
 * contrato do payload e as transições de status reais no banco: `sent` só
 * quando o relay confirma (`{"ok": true}`); qualquer outra resposta vira
 * `failed` com o motivo registrado.
 */
describe("12: e-mails — provedor relay (Google Apps Script)", () => {
  let admin: Actor;
  const relayCalls: { url: string; payload: Record<string, unknown> }[] = [];

  const RELAY_URL = "https://script.google.com/macros/s/teste/exec";
  const RELAY_SECRET = "segredo-de-teste";

  const requestBody = {
    kind: "password_reset",
    name: "Maria Souza",
    email: "maria@exemplo.test",
    sector: "Recepção",
    registration: "MAT-1234",
    reason: "Esqueci a senha e preciso de acesso para trabalhar.",
  };

  interface StubReply {
    status?: number;
    body?: string;
    contentType?: string;
  }

  function stubRelay(reply: StubReply | ((payload: Record<string, unknown>) => StubReply)): void {
    vi.stubGlobal(
      "fetch",
      (async (input: unknown, init?: { body?: unknown }) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : String((input as Request).url);
        const payload = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        relayCalls.push({ url, payload });
        const resolved = typeof reply === "function" ? reply(payload) : reply;
        // Um Response novo por chamada: o workerd não deixa um handler ler I/O
        // criado no contexto de outra requisição.
        return new Response(resolved.body ?? "", {
          status: resolved.status ?? 200,
          headers: { "content-type": resolved.contentType ?? "application/json" },
        });
      }) as typeof fetch,
    );
  }

  const okReply = (): StubReply => ({ body: JSON.stringify({ ok: true }) });

  async function configureRelay(values: Record<string, string> = {}): Promise<void> {
    const response = await admin.api.patch("/api/settings", {
      values: {
        "mail.enabled": "true",
        "mail.provider": "relay",
        "mail.relay_url": RELAY_URL,
        "mail.relay_secret": RELAY_SECRET,
        ...values,
      },
    });
    expect(response.status).toBe(200);
  }

  beforeEach(async () => {
    relayCalls.length = 0;
    await resetDatabase();
    admin = await setupAdmin();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("entrega um e-mail pendente com o payload combinado (segredo, destinatário, texto e nome)", async () => {
    const anon = new Api();
    const created = await anon.post<{ id: string }>("/api/support/requests", requestBody);
    expect(created.status).toBe(201);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM email_outbox WHERE related_id = ? AND status = 'pending'", [
        created.body.id,
      ]),
    ).toBe(2);

    // Provedor relay sem URL/segredo não conta como configurado.
    await configureRelay({ "mail.relay_url": "", "mail.relay_secret": "" });
    const unconfigured = await admin.api.get<{ mail: { configured: boolean } }>("/api/support/outbox");
    expect(unconfigured.body.mail.configured).toBe(false);

    await configureRelay();
    const outbox = await admin.api.get<{
      items: { id: string; toEmail: string; subject: string; status: string }[];
      mail: { configured: boolean; provider: string };
    }>("/api/support/outbox");
    expect(outbox.body.mail.configured).toBe(true);
    expect(outbox.body.mail.provider).toBe("relay");

    const target = outbox.body.items[0];
    assert(target, "e-mail na caixa de saída");
    expect(target.status).toBe("pending");

    stubRelay(okReply());
    const retry = await admin.api.post<{ status: string; skipped: boolean }>(
      `/api/support/outbox/${target.id}/retry`,
      {},
    );
    expect(retry.status).toBe(200);
    expect(retry.body.skipped).toBe(false);
    expect(retry.body.status).toBe("sent");

    const row = await queryOne<{ status: string; sent_at: string | null; error: string | null }>(
      "SELECT status, sent_at, error FROM email_outbox WHERE id = ?",
      [target.id],
    );
    expect(row?.status).toBe("sent");
    expect(row?.error).toBeNull();
    expect(row?.sent_at).not.toBeNull();

    expect(relayCalls).toHaveLength(1);
    const call = relayCalls[0];
    assert(call, "chamada ao relay");
    expect(call.url).toBe(RELAY_URL);
    expect(call.payload.secret).toBe(RELAY_SECRET);
    expect(call.payload.to).toBe(target.toEmail);
    expect(call.payload.subject).toBe(target.subject);
    expect(String(call.payload.text).length).toBeGreaterThan(0);
    expect(call.payload.name).toBe("Empresa Teste");
  });

  it("envia na hora quando o relay já está configurado ao abrir o pedido", async () => {
    await configureRelay();
    stubRelay(okReply());

    const anon = new Api();
    const created = await anon.post<{ id: string }>("/api/support/requests", requestBody);
    expect(created.status).toBe(201);

    const rows = await queryAll<{ status: string }>(
      "SELECT status FROM email_outbox WHERE related_id = ?",
      [created.body.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "sent")).toBe(true);
    expect(relayCalls).toHaveLength(2);
  });

  it("marca falha quando o relay recusa, devolve erro HTTP ou resposta inesperada — e recupera no reenvio", async () => {
    await configureRelay();

    // Recusa de negócio: HTTP 200 com {"ok": false} (ex.: segredo trocado).
    stubRelay({ body: JSON.stringify({ ok: false, error: "Segredo incorreto." }) });
    const anon = new Api();
    const created = await anon.post<{ id: string }>("/api/support/requests", requestBody);
    expect(created.status).toBe(201);

    const failed = await queryAll<{ id: string; status: string; error: string | null }>(
      "SELECT id, status, error FROM email_outbox WHERE related_id = ?",
      [created.body.id],
    );
    expect(failed).toHaveLength(2);
    expect(failed.every((row) => row.status === "failed")).toBe(true);
    expect(failed[0]?.error).toContain("Relay não confirmou o envio: Segredo incorreto.");

    const target = failed[0];
    assert(target, "e-mail com falha");

    // Erro HTTP do relay (ex.: cota do Google estourada).
    stubRelay({ status: 500, body: "instável" });
    await admin.api.post(`/api/support/outbox/${target.id}/retry`, {});
    let row = await queryOne<{ status: string; error: string | null }>(
      "SELECT status, error FROM email_outbox WHERE id = ?",
      [target.id],
    );
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("Relay respondeu 500");

    // Resposta que não é o JSON combinado (ex.: página de login do Google).
    stubRelay({ body: "<html>login</html>", contentType: "text/html" });
    await admin.api.post(`/api/support/outbox/${target.id}/retry`, {});
    row = await queryOne<{ status: string; error: string | null }>(
      "SELECT status, error FROM email_outbox WHERE id = ?",
      [target.id],
    );
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("Relay não confirmou o envio");

    // Relay respondendo certo: o reenvio conclui e limpa o erro.
    stubRelay(okReply());
    const retry = await admin.api.post<{ status: string }>(`/api/support/outbox/${target.id}/retry`, {});
    expect(retry.body.status).toBe("sent");
    row = await queryOne<{ status: string; error: string | null }>(
      "SELECT status, error FROM email_outbox WHERE id = ?",
      [target.id],
    );
    expect(row?.status).toBe("sent");
    expect(row?.error).toBeNull();
  });
});
