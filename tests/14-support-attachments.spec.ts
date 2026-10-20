import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  Api,
  assert,
  countRows,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  queryOne,
  resetDatabase,
  setupAdmin,
  type Actor,
} from "./helpers";

/**
 * F-19: anexos da conversa de suporte.
 *
 * O binário vai para o R2 (binding `ATTACHMENTS`, simulado pelo Miniflare) e os
 * metadados para `attachments` (F-19/D-18). Regras centrais verificadas aqui:
 *   - solicitante anexa pelo link/token (sem sessão) e o staff anexa pelo
 *     atendimento (com sessão);
 *   - uploads por token têm teto menor (5 MB por arquivo, 3 por mensagem) e
 *     tipos reduzidos (imagem/PDF/texto);
 *   - download exige o token certo ou permissão sobre o pedido;
 *   - rotas genéricas de anexo não servem nem removem anexo do suporte;
 *   - o caminho legado do D1 (tickets etc.) continua intacto.
 */
describe("14: suporte — anexos em R2 (F-19)", () => {
  let admin: Actor;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
  });

  interface CreatedRequest {
    id: string;
    code: string;
    token: string;
    position: number;
  }

  interface ChatAttachment {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
  }

  interface TrackResponse {
    request: { id: string; code: string };
    messages: { id: string; body: string; attachments: ChatAttachment[] }[];
    limits: { maxFilesPerMessage: number; maxBytesPerFile: number; maxBytesPerMessage: number };
  }

  interface ThreadResponse {
    messages: { id: string; body: string; attachments: ChatAttachment[] }[];
    limits: { maxFilesPerMessage: number; maxBytesPerFile: number; maxBytesPerMessage: number };
  }

  async function openRequest(api: Api = new Api()): Promise<CreatedRequest> {
    const created = await api.post<CreatedRequest>("/api/support/requests", {
      kind: "help",
      name: "Maria Souza",
      email: "maria@exemplo.test",
      sector: "Recepção",
      registration: "MAT-1234",
      reason: "Preciso de ajuda com a impressora do setor.",
    });
    expect(created.status).toBe(201);
    return created.body;
  }

  function messageForm(
    text: string | null,
    files: { name: string; type: string; bytes: Uint8Array }[],
  ): FormData {
    const form = new FormData();
    if (text !== null) form.set("body", text);
    for (const file of files) {
      form.append("files", new File([file.bytes], file.name, { type: file.type }));
    }
    return form;
  }

  const png = (size: number) => ({ name: "print.png", type: "image/png", bytes: new Uint8Array(size).fill(80) });
  const pdf = (size: number) => ({ name: "laudo.pdf", type: "application/pdf", bytes: new Uint8Array(size).fill(70) });
  const docx = (size: number) => ({
    name: "relatorio.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: new Uint8Array(size).fill(60),
  });

  /* ------------------------------------------------------------------------ */
  /* Fluxo principal                                                          */
  /* ------------------------------------------------------------------------ */

  it("solicitante anexa pelo link; staff vê no atendimento; os dois baixam", async () => {
    const anon = new Api();
    const created = await openRequest(anon);

    const sent = await anon.postRaw<{ id: string }>(
      `/api/support/track/${created.token}/messages`,
      messageForm("Segue o print do erro.", [png(700)]),
    );
    expect(sent.status).toBe(201);

    // Metadados no D1: sem blob, apontando para o R2, autor anônimo identificado.
    const attachment = await queryOne<{
      id: string;
      entity_type: string;
      entity_id: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
      content: unknown;
      storage: string;
      r2_key: string;
      uploaded_by: string | null;
      author_name: string;
    }>("SELECT id, entity_type, entity_id, filename, mime_type, size_bytes, content, storage, r2_key, uploaded_by, author_name FROM attachments WHERE entity_id = ?", [
      sent.body.id,
    ]);
    assert(attachment, "linha de anexo gravada");
    expect(attachment.entity_type).toBe("support_message");
    expect(attachment.filename).toBe("print.png");
    expect(attachment.mime_type).toBe("image/png");
    expect(attachment.size_bytes).toBe(700);
    expect(attachment.content).toBeNull();
    expect(attachment.storage).toBe("r2");
    expect(attachment.r2_key).toBe(`anexos/${attachment.id}`);
    expect(attachment.uploaded_by).toBeNull();
    expect(attachment.author_name).toBe("Maria Souza");

    // O binário está de verdade no bucket.
    const stored = await env.ATTACHMENTS.get(attachment.r2_key);
    assert(stored, "objeto no R2");
    expect(stored.size).toBe(700);
    expect(new Uint8Array(await stored.arrayBuffer())[0]).toBe(80);

    // A conversa devolve o anexo com URL do acompanhamento e os limites do anônimo.
    const tracked = await anon.get<TrackResponse>(`/api/support/track/${created.token}`);
    expect(tracked.status).toBe(200);
    const trackMessage = tracked.body.messages.at(-1);
    assert(trackMessage, "mensagem de acompanhamento");
    expect(trackMessage.body).toBe("Segue o print do erro.");
    expect(trackMessage.attachments).toHaveLength(1);
    expect(trackMessage.attachments[0]?.url).toBe(
      `/api/support/track/${created.token}/attachments/${attachment.id}`,
    );
    expect(tracked.body.limits.maxFilesPerMessage).toBe(3);
    expect(tracked.body.limits.maxBytesPerFile).toBe(5 * 1024 * 1024);
    expect(tracked.body.limits.maxBytesPerMessage).toBe(5 * 1024 * 1024);

    // Download sem sessão, pelo token.
    const download = await anon.fetchRaw(
      "GET",
      `/api/support/track/${created.token}/attachments/${attachment.id}`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(download.headers.get("content-disposition")).toContain("inline");
    expect(new Uint8Array(await download.arrayBuffer()).length).toBe(700);

    // Staff vê a mensagem e baixa pela rota com sessão.
    const thread = await admin.api.get<ThreadResponse>(`/api/support/requests/${created.id}`);
    expect(thread.status).toBe(200);
    const staffView = thread.body.messages.at(-1);
    assert(staffView, "mensagem vista pelo staff");
    expect(staffView.attachments[0]?.url).toBe(`/api/support/attachments/${attachment.id}`);
    expect(thread.body.limits.maxFilesPerMessage).toBe(10);
    expect(thread.body.limits.maxBytesPerFile).toBe(20971520);

    const staffDownload = await admin.api.fetchRaw("GET", `/api/support/attachments/${attachment.id}`);
    expect(staffDownload.status).toBe(200);
    expect(new Uint8Array(await staffDownload.arrayBuffer()).length).toBe(700);

    // O e-mail do suporte lista os anexos e a auditoria registra a quantidade.
    const mail = await queryOne<{ body: string }>(
      "SELECT body FROM email_outbox WHERE kind = 'support_message' AND related_id = ? ORDER BY created_at DESC LIMIT 1",
      [created.id],
    );
    expect(mail?.body).toContain("Anexos (1):");
    expect(mail?.body).toContain("print.png");
    const audit = await queryOne<{ after_json: string }>(
      "SELECT after_json FROM audit_log WHERE action = 'support.message' AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
      [created.id],
    );
    expect(audit?.after_json).toContain('"attachments":1');
  });

  it("staff anexa pelo atendimento (documento de escritório) e o solicitante baixa pelo link", async () => {
    const anon = new Api();
    const created = await openRequest(anon);

    const sent = await admin.api.postRaw<{ id: string }>(
      `/api/support/requests/${created.id}/messages`,
      messageForm("Envio o relatório completo do equipamento.", [docx(900)]),
    );
    expect(sent.status).toBe(201);

    // Documento de escritório passa no fluxo autenticado (o anônimo não aceita).
    const attachment = await queryOne<{ id: string; storage: string; author_name: string }>(
      "SELECT id, storage, author_name FROM attachments WHERE entity_id = ?",
      [sent.body.id],
    );
    assert(attachment, "anexo do staff gravado");
    expect(attachment.storage).toBe("r2");
    expect(attachment.author_name).toBe("Administrador Teste");

    const tracked = await anon.get<TrackResponse>(`/api/support/track/${created.token}`);
    const message = tracked.body.messages.at(-1);
    assert(message, "mensagem com anexo");
    expect(message.attachments[0]?.filename).toBe("relatorio.docx");

    const download = await anon.fetchRaw(
      "GET",
      `/api/support/track/${created.token}/attachments/${attachment.id}`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain(
      "application/vnd.openxmlformats-officedocument",
    );
    // Documento de escritório não abre inline no origin do sistema.
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(new Uint8Array(await download.arrayBuffer()).length).toBe(900);

    // E-mail do solicitante também lista o anexo.
    const mail = await queryOne<{ body: string }>(
      "SELECT body FROM email_outbox WHERE kind = 'support_message' AND related_id = ?ORDER BY created_at DESC LIMIT 1",
      [created.id],
    );
    expect(mail?.body).toContain("relatorio.docx");
  });

  /* ------------------------------------------------------------------------ */
  /* Regras do anônimo                                                        */
  /* ------------------------------------------------------------------------ */

  it("upload por token: teto de 5 MB, tipos reduzidos e no máximo 3 arquivos", async () => {
    const anon = new Api();
    const created = await openRequest(anon);
    const url = `/api/support/track/${created.token}/messages`;

    // Acima de 5 MB por arquivo (mesmo com o padrão configurado em 20 MB).
    const big = await anon.postRaw(url, messageForm(null, [pdf(6 * 1024 * 1024)]));
    expect([400, 413]).toContain(big.status);
    expectError(big);

    // Documento de escritório não é aceito sem sessão.
    const office = await anon.postRaw(url, messageForm(null, [docx(100)]));
    expectError(office, "BAD_REQUEST");

    // SVG executa script no mesmo origin: bloqueado em qualquer fluxo.
    const svg = await anon.postRaw(
      url,
      messageForm(null, [
        { name: "logo.svg", type: "image/svg+xml", bytes: new Uint8Array(120).fill(60) },
      ]),
    );
    expectError(svg, "BAD_REQUEST");

    // A soma da mensagem também respeita o teto.
    const sum = await anon.postRaw(
      url,
      messageForm(null, [png(2 * 1024 * 1024), pdf(2 * 1024 * 1024), png(2 * 1024 * 1024)]),
    );
    // Pode ser recusado pelo teto da mensagem (413) ou pela validação (400).
    expect([400, 413]).toContain(sum.status);
    expectError(sum);

    // Mais de 3 arquivos.
    const tooMany = await anon.postRaw(
      url,
      messageForm(null, [png(10), png(11), png(12), png(13)]),
    );
    expectError(tooMany, "BAD_REQUEST");

    // Arquivo vazio.
    const empty = await anon.postRaw(url, messageForm(null, [png(0)]));
    expectError(empty, "BAD_REQUEST");

    // Nem mensagem nem arquivos.
    const blank = await anon.postRaw(url, messageForm("", []));
    expectError(blank, "BAD_REQUEST");

    // Nada disso deixou resíduo no banco nem no bucket.
    expect(await countRows("SELECT COUNT(*) AS total FROM attachments")).toBe(0);
    const messages = await countRows("SELECT COUNT(*) AS total FROM support_messages WHERE request_id = ?", [
      created.id,
    ]);
    expect(messages).toBe(1);
  });

  /* ------------------------------------------------------------------------ */
  /* Acesso e remoção                                                         */
  /* ------------------------------------------------------------------------ */

  it("anexo exige acesso ao pedido; rotas genéricas recusam anexo do suporte; staff remove", async () => {
    const requester = await createUser(admin, {
      name: "Requisitante A",
      email: "requisitante.a@demo.test",
      roleId: await findRoleId("requester"),
    });
    const other = await createUser(admin, {
      name: "Outro Usuário",
      email: "outro@demo.test",
      roleId: await findRoleId("requester"),
    });

    const created = await openRequest(requester.api);
    const sent = await requester.api.postRaw<{ id: string }>(
      `/api/support/requests/${created.id}/messages`,
      messageForm("Print da tela com erro.", [png(120)]),
    );
    expect(sent.status).toBe(201);
    const attachment = await queryOne<{ id: string; r2_key: string }>(
      "SELECT id, r2_key FROM attachments WHERE entity_id = ?",
      [sent.body.id],
    );
    assert(attachment, "anexo criado");

    // Outro usuário (sem staff, sem ser o dono) não baixa.
    const denied = await other.api.fetchRaw("GET", `/api/support/attachments/${attachment.id}`);
    expect(denied.status).toBe(403);

    // Token errado não baixa.
    const wrongToken = await new Api().fetchRaw(
      "GET",
      `/api/support/track/token-de-outro-pedido/attachments/${attachment.id}`,
    );
    expect(wrongToken.status).toBe(404);

    // Rotas genéricas não servem nem removem o anexo do suporte.
    const genericGet = await admin.api.fetchRaw("GET", `/api/attachments/${attachment.id}`);
    expect(genericGet.status).toBe(403);
    const genericDelete = await admin.api.delete(`/api/attachments/${attachment.id}`);
    expectError(genericDelete, "FORBIDDEN");

    // Staff remove: linha, objeto no R2 e registro de auditoria.
    expect(await env.ATTACHMENTS.get(attachment.r2_key)).not.toBeNull();
    const removed = await admin.api.delete<{ ok: boolean }>(`/api/support/attachments/${attachment.id}`);
    expect(removed.status).toBe(200);
    expect(await env.ATTACHMENTS.get(attachment.r2_key)).toBeNull();
    expect(
      await countRows("SELECT COUNT(*) AS total FROM attachments WHERE id = ?", [attachment.id]),
    ).toBe(0);
    expect(
      await countRows(
        "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'support.attachment.delete' AND entity_id = ?",
        [sent.body.id],
      ),
    ).toBe(1);

    // O pedido continua acessível e a mensagem permanece na conversa.
    const thread = await requester.api.get<ThreadResponse>(`/api/support/requests/${created.id}`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages.at(-1)?.attachments).toEqual([]);
  });

  it("respeita o teto configurado em attachments.max_bytes", async () => {
    const anon = new Api();
    const created = await openRequest(anon);

    const configured = await admin.api.patch("/api/settings", {
      values: { "attachments.max_bytes": "10240" },
    });
    expect(configured.status).toBe(200);

    // Numa sessão, o teto configurado manda (10 KB).
    const staffBig = await admin.api.postRaw(
      `/api/support/requests/${created.id}/messages`,
      messageForm(null, [png(20480)]),
    );
    expectError(staffBig, "BAD_REQUEST");

    // No token, vale o menor entre o configurado e o teto público.
    const anonBig = await anon.postRaw(
      `/api/support/track/${created.token}/messages`,
      messageForm(null, [png(20480)]),
    );
    expectError(anonBig, "BAD_REQUEST");

    const anonOk = await anon.postRaw(
      `/api/support/track/${created.token}/messages`,
      messageForm(null, [png(8000)]),
    );
    expect(anonOk.status).toBe(201);

    // O limite exibido ao solicitante acompanha a configuração.
    const tracked = await anon.get<TrackResponse>(`/api/support/track/${created.token}`);
    expect(tracked.body.limits.maxBytesPerFile).toBe(10240);

    await admin.api.patch("/api/settings", { values: { "attachments.max_bytes": "20971520" } });
  });

  /* ------------------------------------------------------------------------ */
  /* Legado                                                                   */
  /* ------------------------------------------------------------------------ */

  it("anexo genérico (ticket) continua no D1 e baixa como antes", async () => {
    const structure = await createStructure(admin);
    const ticket = await admin.api.post<{ id: string }>("/api/tickets", {
      title: "Chamado com anexo legado",
      locationId: structure.roomId,
    });
    expect(ticket.status).toBe(201);

    const form = new FormData();
    form.set("file", new File([new Uint8Array(500).fill(1)], "croqui.txt", { type: "text/plain" }));
    form.set("entityType", "ticket");
    form.set("entityId", ticket.body.id);
    const uploaded = await admin.api.postRaw<{ id: string }>("/api/attachments", form);
    expect(uploaded.status).toBe(201);

    const row = await queryOne<{ storage: string; r2_key: string | null; content: unknown }>(
      "SELECT storage, r2_key, content FROM attachments WHERE id = ?",
      [uploaded.body.id],
    );
    expect(row?.storage).toBe("d1");
    expect(row?.r2_key).toBeNull();
    expect(row?.content).not.toBeNull();

    const download = await admin.api.fetchRaw("GET", `/api/attachments/${uploaded.body.id}`);
    expect(download.status).toBe(200);
    expect(new Uint8Array(await download.arrayBuffer()).length).toBe(500);

    // E o módulo genérico segue listando normalmente.
    const list = await admin.api.get<{ items: unknown[] }>(
      `/api/attachments?entityType=ticket&entityId=${ticket.body.id}`,
    );
    expect(list.body.items).toHaveLength(1);
  });
});
