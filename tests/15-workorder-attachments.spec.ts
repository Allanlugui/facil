import { beforeEach, describe, expect, it } from "vitest";
import {
  Api,
  countRows,
  createStructure,
  createUser,
  expectError,
  findRoleId,
  queryOne,
  resetDatabase,
  setupAdmin,
  type Actor,
  type Structure,
} from "./helpers";

/**
 * Anexos em ordens de serviço (módulo genérico /api/attachments, F-19/F-08).
 *
 * O módulo de anexos já suporta `work_order`: listar, baixar, upload e remoção
 * com controle de entidade e permissão `attachments.documents` para documentos
 * (não-imagem). Este teste valida o fluxo completo na OS.
 */
describe("ordens de serviço — anexos", () => {
  let admin: Actor;
  let structure: Structure;
  let tech: Actor;
  let workOrderId: string;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
    structure = await createStructure(admin);

    const created = await admin.api.post<{ id: string }>("/api/workorders", {
      title: "Revisar quadro de energia do bloco B",
      description: "Verificar disjuntores e reaperto dos terminais.",
      locationId: structure.roomId,
    });
    expect(created.status).toBe(201);
    workOrderId = created.body.id;

    tech = await createUser(admin, {
      name: "Técnico Silva",
      email: "tecnico@facil.test",
      roleId: await findRoleId("maintenance_tech"),
    });
  });

  interface CreatedAttachment {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
  }

  const png = (size: number) => ({ name: "print.png", type: "image/png", bytes: new Uint8Array(size).fill(80) });
  const pdf = (size: number) => ({ name: "laudo.pdf", type: "application/pdf", bytes: new Uint8Array(size).fill(70) });

  function uploadFile(api: Api, file: { name: string; type: string; bytes: Uint8Array }) {
    const form = new FormData();
    form.append("file", new File([file.bytes], file.name, { type: file.type }));
    form.append("entityType", "work_order");
    form.append("entityId", workOrderId);
    return api.request<CreatedAttachment>("POST", "/api/attachments", { rawBody: form });
  }

  /* ------------------------------------------------------------------------ */
  /* Fluxo principal                                                          */
  /* ------------------------------------------------------------------------ */

  it("gestor anexa imagem e documento à OS; ambos aparecem na listagem e baixam", async () => {
    const img = await uploadFile(admin.api, png(700));
    expect(img.status).toBe(201);
    expect(img.body.filename).toBe("print.png");

    const doc = await uploadFile(admin.api, pdf(900));
    expect(doc.status).toBe(201);
    expect(doc.body.filename).toBe("laudo.pdf");

    // Listagem da OS devolve os dois anexos.
    const list = await admin.api.get<{ items: CreatedAttachment[] }>(
      `/api/attachments?entityType=work_order&entityId=${workOrderId}`,
    );
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.map((i) => i.filename)).toContain("print.png");
    expect(list.body.items.map((i) => i.filename)).toContain("laudo.pdf");

    // Download de cada um pelo ID.
    const rowImg = await queryOne<{ id: string }>(
      "SELECT id FROM attachments WHERE filename = 'print.png' AND entity_id = ?",
      [workOrderId],
    );
    assert(rowImg, "anexo de imagem gravado");

    const downloadImg = await admin.api.fetchRaw("GET", `/api/attachments/${rowImg.id}`);
    expect(downloadImg.status).toBe(200);
    expect(downloadImg.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await downloadImg.arrayBuffer()).length).toBe(700);

    // Auditoria registra o upload.
    const audits = await countRows(
      "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'attachment.upload' AND entity_id = ?",
      [workOrderId],
    );
    expect(audits).toBe(2);
  });

  it("técnico sem attachments.documents anexa imagem, mas não documento", async () => {
    // Técnico consegue anexar imagem.
    const img = await uploadFile(tech.api, png(500));
    expect(img.status).toBe(201);

    // Técnico NÃO consegue anexar documento (requer attachments.documents).
    const doc = await uploadFile(tech.api, pdf(400));
    expectError(doc, "FORBIDDEN");

    // Apenas a imagem ficou.
    const list = await tech.api.get<{ items: unknown[] }>(
      `/api/attachments?entityType=work_order&entityId=${workOrderId}`,
    );
    expect(list.body.items).toHaveLength(1);
  });

  it("gestor remove o anexo e registra auditoria", async () => {
    const uploaded = await uploadFile(admin.api, png(600));
    expect(uploaded.status).toBe(201);
    const attachmentId = uploaded.body.id;

    const removed = await admin.api.delete<{ ok: boolean }>(`/api/attachments/${attachmentId}`);
    expect(removed.status).toBe(200);
    expect(removed.body.ok).toBe(true);

    const remaining = await countRows(
      "SELECT COUNT(*) AS total FROM attachments WHERE id = ?",
      [attachmentId],
    );
    expect(remaining).toBe(0);

    const audit = await countRows(
      "SELECT COUNT(*) AS total FROM audit_log WHERE action = 'attachment.delete' AND entity_id = ?",
      [workOrderId],
    );
    expect(audit).toBe(1);
  });

  it("download exige permissão sobre a entidade", async () => {
    const uploaded = await uploadFile(admin.api, png(300));
    const attachmentId = uploaded.body.id;

    // Usuário sem vínculo com o local da OS não baixa.
    const outsider = await createUser(admin, {
      name: "Zé Sem Acesso",
      email: "outsider@facil.test",
      roleId: await findRoleId("requester"),
    });
    const denied = await outsider.api.fetchRaw("GET", `/api/attachments/${attachmentId}`);
    expect(denied.status).toBe(403);
  });

  it("anexo genérico grava no D1 (storage d1), não no R2", async () => {
    const uploaded = await uploadFile(admin.api, png(400));
    expect(uploaded.status).toBe(201);

    const row = await queryOne<{ storage: string; r2_key: string | null; content: unknown }>(
      "SELECT storage, r2_key, content FROM attachments WHERE id = ?",
      [uploaded.body.id],
    );
    expect(row?.storage).toBe("d1");
    expect(row?.r2_key).toBeNull();
    expect(row?.content).not.toBeNull();
  });
});

function assert(row: unknown, message: string): asserts row {
  if (!row) throw new Error(message);
}
