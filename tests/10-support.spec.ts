import { beforeEach, describe, expect, it } from "vitest";
import {
  Api,
  assert,
  countRows,
  createUser,
  expectError,
  findRoleId,
  queryAll,
  queryOne,
  resetDatabase,
  setupAdmin,
  type Actor,
} from "./helpers";

/**
 * Central de suporte: pedidos públicos (redefinição de senha / ajuda), fila
 * FIFO, conversa por token, artigos e caixa de saída de e-mails.
 *
 * Sem provedor de e-mail configurado, os e-mails ficam `pending` na caixa de
 * saída — os testes verificam exatamente esse contrato (nada de envio real).
 */
describe("10: suporte — pedidos, fila, conversa, artigos e e-mails", () => {
  let admin: Actor;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
  });

  const requestBody = (overrides: Record<string, unknown> = {}) => ({
    kind: "password_reset",
    name: "Maria Souza",
    email: "maria@exemplo.test",
    sector: "Recepção",
    registration: "MAT-1234",
    reason: "Esqueci a senha e preciso de acesso para trabalhar.",
    ...overrides,
  });

  interface CreatedRequest {
    id: string;
    code: string;
    token: string;
    position: number;
  }

  async function openRequest(
    overrides: Record<string, unknown> = {},
    api: Api = admin.api,
  ): Promise<CreatedRequest> {
    const created = await api.post<CreatedRequest>("/api/support/requests", requestBody(overrides));
    expect(created.status).toBe(201);
    return created.body;
  }

  /* ------------------------------------------------------------------------ */
  /* Fluxo público de redefinição de senha                                    */
  /* ------------------------------------------------------------------------ */

  it("abre pedido de senha sem sessão, com token, fila, conversa e e-mails pendentes", async () => {
    const anon = new Api();
    const created = await openRequest({}, anon);

    expect(created.code).toBe("SUP-2026-000001");
    expect(created.position).toBe(1);
    expect(created.token.length).toBeGreaterThanOrEqual(20);

    const row = await queryOne<{ status: string; token_hash: string; user_id: string | null }>(
      "SELECT status, token_hash, user_id FROM support_requests WHERE id = ?",
      [created.id],
    );
    assert(row, "pedido gravado");
    expect(row.status).toBe("queued");
    expect(row.user_id).toBeNull();
    // Só o hash do token é persistido; o token em claro nunca vai ao banco.
    expect(row.token_hash).not.toBe(created.token);
    expect(row.token_hash).toHaveLength(64);

    // O motivo vira a primeira mensagem da conversa.
    expect(
      await countRows("SELECT COUNT(*) AS total FROM support_messages WHERE request_id = ?", [created.id]),
    ).toBe(1);

    // Um e-mail para o solicitante e um para o administrador (staff).
    expect(
      await countRows("SELECT COUNT(*) AS total FROM email_outbox WHERE related_id = ?", [created.id]),
    ).toBe(2);
    const outbox = await queryAll<{ status: string }>(
      "SELECT status FROM email_outbox WHERE related_id = ?",
      [created.id],
    );
    expect(outbox.every((rowOut) => rowOut.status === "pending")).toBe(true);

    // Notificação interna para quem atende e trilha de auditoria.
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE entity_id = ? AND type = 'support_request'",
        [created.id],
      ),
    ).toBe(1);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM audit_log WHERE entity_id = ? AND action = 'support.request.create'",
        [created.id],
      ),
    ).toBe(1);

    // Acompanhamento pelo token (sem sessão).
    const tracked = await anon.get<{
      request: { code: string; status: string; position: number | null };
      messages: { authorType: string; body: string }[];
    }>(`/api/support/track/${created.token}`);
    expect(tracked.status).toBe(200);
    expect(tracked.body.request.code).toBe("SUP-2026-000001");
    expect(tracked.body.request.position).toBe(1);
    expect(tracked.body.messages).toHaveLength(1);

    // Solicita nova mensagem pelo acompanhamento.
    const followUp = await anon.post(`/api/support/track/${created.token}/messages`, {
      body: "Alguma novidade sobre o meu acesso?",
    });
    expect(followUp.status).toBe(201);

    // Resposta do administrador: mensagem de staff + e-mail para o solicitante.
    const staffReply = await admin.api.post<{ id: string }>(`/api/support/requests/${created.id}/messages`, {
      body: "Recebido! Vamos validar os seus dados e redefinir a senha.",
    });
    expect(staffReply.status).toBe(201);
    const staffMessage = await queryOne<{ author_type: string }>(
      "SELECT author_type FROM support_messages WHERE id = ?",
      [staffReply.body.id],
    );
    expect(staffMessage?.author_type).toBe("staff");

    const trackedAgain = await anon.get<{ messages: unknown[] }>(`/api/support/track/${created.token}`);
    expect(trackedAgain.body.messages).toHaveLength(3);
    // 2 no pedido + 1 da mensagem do solicitante + 1 da resposta do suporte.
    expect(
      await countRows("SELECT COUNT(*) AS total FROM email_outbox WHERE related_id = ?", [created.id]),
    ).toBe(4);

    // Resolução encerra a conversa.
    const resolved = await admin.api.patch(`/api/support/requests/${created.id}`, { status: "resolved" });
    expect(resolved.status).toBe(200);

    const afterResolve = await anon.get<{ request: { status: string } }>(
      `/api/support/track/${created.token}`,
    );
    expect(afterResolve.body.request.status).toBe("resolved");

    const blocked = await anon.post(`/api/support/track/${created.token}/messages`, { body: "E agora?" });
    expectError(blocked, "CONFLICT");
  });

  it("válida dados do pedido de senha e o token de acompanhamento", async () => {
    const anon = new Api();

    // Setor e matrícula são obrigatórios na redefinição de senha (identidade).
    const missingIdentity = await anon.post(
      "/api/support/requests",
      requestBody({ sector: "", registration: "" }),
    );
    expectError(missingIdentity, "BAD_REQUEST");

    const badEmail = await anon.post("/api/support/requests", requestBody({ email: "não-é-email" }));
    expectError(badEmail, "VALIDATION_ERROR");

    const shortReason = await anon.post("/api/support/requests", requestBody({ reason: "curto" }));
    expectError(shortReason, "VALIDATION_ERROR");

    const unknownToken = await anon.get("/api/support/track/token-inexistente");
    expectError(unknownToken, "NOT_FOUND");
  });

  it("limita pedidos abertos por e-mail enquanto o captcha não existe", async () => {
    const anon = new Api();
    await openRequest({}, anon);
    await openRequest({ reason: "Segundo pedido da mesma pessoa." }, anon);
    await openRequest({ reason: "Terceiro pedido da mesma pessoa." }, anon);

    const fourth = await anon.post("/api/support/requests", requestBody({ reason: "Quarto pedido seguido esbarra no limite." }));
    expectError(fourth, "CONFLICT");
  });

  /* ------------------------------------------------------------------------ */
  /* Fila, acesso e Meus pedidos                                              */
  /* ------------------------------------------------------------------------ */

  it("mantém a fila FIFO com posição consistente e restringe a consulta", async () => {
    const anon = new Api();
    const first = await openRequest({ email: "ana@exemplo.test", name: "Ana Lima" }, anon);
    const second = await openRequest({ email: "bruno@exemplo.test", name: "Bruno Dias" }, anon);

    expect(first.position).toBe(1);
    expect(second.position).toBe(2);

    const queue = await admin.api.get<{
      items: { id: string; position: number | null }[];
      counts: Record<string, number>;
    }>("/api/support/queue");
    expect(queue.status).toBe(200);
    expect(queue.body.items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(queue.body.items[0]?.position).toBe(1);
    expect(queue.body.items[1]?.position).toBe(2);
    expect(queue.body.counts.queued).toBe(2);

    // Usuário comum não enxerga a fila nem pedidos de terceiros.
    const requester = await createUser(admin, {
      name: "Clara Nunes",
      email: "clara@exemplo.test",
      roleId: await findRoleId("requester"),
    });
    expectError(await requester.api.get("/api/support/queue"), "FORBIDDEN");
    expectError(await requester.api.get(`/api/support/requests/${first.id}`), "FORBIDDEN");
    expectError(
      await requester.api.post(`/api/support/requests/${first.id}/messages`, { body: "Deixa eu ver?" }),
      "FORBIDDEN",
    );
  });

  it("vincula pedido de usuário logado a Meus pedidos e avisa o solicitante", async () => {
    const requester = await createUser(admin, {
      name: "Joana Alves",
      email: "joana@exemplo.test",
      roleId: await findRoleId("requester"),
    });

    const created = await openRequest(
      {
        kind: "help",
        name: "Joana Alves",
        email: "joana@exemplo.test",
        sector: null,
        registration: null,
        reason: "O relatório de consumo não abre para mim.",
      },
      requester.api,
    );

    const row = await queryOne<{ user_id: string | null }>(
      "SELECT user_id FROM support_requests WHERE id = ?",
      [created.id],
    );
    expect(row?.user_id).toBe(requester.id);

    const mine = await requester.api.get<{ items: { id: string; position: number | null }[] }>(
      "/api/support/my",
    );
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((item) => item.id)).toEqual([created.id]);
    expect(mine.body.items[0]?.position).toBe(1);

    // O dono do pedido acessa o atendimento; outro usuário comum, não.
    const detail = await requester.api.get(`/api/support/requests/${created.id}`);
    expect(detail.status).toBe(200);

    const other = await createUser(admin, {
      name: "Pedro Rocha",
      email: "pedro@exemplo.test",
      roleId: await findRoleId("requester"),
    });
    expectError(await other.api.get(`/api/support/requests/${created.id}`), "FORBIDDEN");

    // Resposta do suporte notifica o solicitante logado.
    await admin.api.post(`/api/support/requests/${created.id}/messages`, { body: "Vamos verificar o seu acesso." });
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND entity_id = ?",
        [requester.id, created.id],
      ),
    ).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Artigos (base de conhecimento)                                           */
  /* ------------------------------------------------------------------------ */

  it("publica artigos: rascunho invisível ao público e CRUD restrito a quem atende", async () => {
    const anon = new Api();
    const published = await admin.api.post<{ id: string }>("/api/support/articles", {
      title: "Manutenção programada do elevador",
      category: "news",
      summary: "Aviso de manutenção.",
      body: "O elevador ficará parado na sexta-feira das 8h às 12h.",
      published: true,
    });
    expect(published.status).toBe(201);

    const draft = await admin.api.post<{ id: string }>("/api/support/articles", {
      title: "Rascunho de FAQ",
      category: "faq",
      body: "Conteúdo ainda em revisão, não deve aparecer para os usuários.",
      published: false,
    });
    expect(draft.status).toBe(201);

    const publicList = await anon.get<{ items: { id: string }[] }>("/api/support/articles");
    expect(publicList.status).toBe(200);
    expect(publicList.body.items.map((item) => item.id)).toEqual([published.body.id]);

    const staffList = await admin.api.get<{ items: { id: string }[] }>("/api/support/articles");
    expect(staffList.body.items).toHaveLength(2);

    // Publicar o rascunho o expõe; remover tira da lista. O PATCH não pode
    // sobrescrever campos não enviados (categoria continua "faq").
    const updated = await admin.api.patch(`/api/support/articles/${draft.body.id}`, { published: true });
    expect(updated.status).toBe(200);
    const draftRow = await queryOne<{ category: string }>(
      "SELECT category FROM support_articles WHERE id = ?",
      [draft.body.id],
    );
    expect(draftRow?.category).toBe("faq");
    const afterPublish = await anon.get<{ items: unknown[] }>("/api/support/articles");
    expect(afterPublish.body.items).toHaveLength(2);

    const removed = await admin.api.delete(`/api/support/articles/${draft.body.id}`);
    expect(removed.status).toBe(200);
    expect(
      await countRows("SELECT COUNT(*) AS total FROM support_articles WHERE id = ?", [draft.body.id]),
    ).toBe(0);

    // Quem não atende suporte não cria nem edita conteúdo.
    const requester = await createUser(admin, {
      name: "Clara Nunes",
      email: "clara.artigos@exemplo.test",
      roleId: await findRoleId("requester"),
    });
    expectError(
      await requester.api.post("/api/support/articles", { title: "Artigo indevido", body: "Corpo do artigo." }),
      "FORBIDDEN",
    );
    expectError(
      await requester.api.patch(`/api/support/articles/${published.body.id}`, { published: false }),
      "FORBIDDEN",
    );
  });

  /* ------------------------------------------------------------------------ */
  /* Caixa de saída de e-mails                                                */
  /* ------------------------------------------------------------------------ */

  it("registra a caixa de saída e reenvia sem provedor configurado (fica pendente)", async () => {
    const anon = new Api();
    await openRequest({}, anon);

    const outbox = await admin.api.get<{
      items: { id: string; status: string }[];
      mail: { configured: boolean; provider: string };
    }>("/api/support/outbox");
    expect(outbox.status).toBe(200);
    expect(outbox.body.mail.configured).toBe(false);
    expect(outbox.body.items.length).toBeGreaterThanOrEqual(2);

    const target = outbox.body.items[0];
    assert(target, "e-mail na caixa de saída");
    const retry = await admin.api.post<{ status: string; skipped: boolean }>(
      `/api/support/outbox/${target.id}/retry`,
      {},
    );
    expect(retry.status).toBe(200);
    expect(retry.body.skipped).toBe(true);
    expect(retry.body.status).toBe("pending");

    const row = await queryOne<{ status: string }>("SELECT status FROM email_outbox WHERE id = ?", [target.id]);
    expect(row?.status).toBe("pending");

    // Reenvio é ação de quem atende suporte.
    const requester = await createUser(admin, {
      name: "Clara Nunes",
      email: "clara.outbox@exemplo.test",
      roleId: await findRoleId("requester"),
    });
    expectError(await requester.api.get("/api/support/outbox"), "FORBIDDEN");
  });
});
