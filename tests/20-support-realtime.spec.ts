import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { Api, resetDatabase, setupAdmin, type Actor } from "./helpers";

/**
 * Tempo real do suporte: o WebSocket autenticado abre a sala da solicitação e
 * recebe os eventos gravados pelo Worker. A conversa em si continua no D1; o
 * teste prova que o evento chega sem polling.
 */
describe("20: suporte em tempo real", () => {
  let admin: Actor;

  beforeEach(async () => {
    await resetDatabase();
    admin = await setupAdmin();
  });

  async function openRequest(): Promise<{ id: string; token: string }> {
    const created = await new Api().post<{ id: string; token: string }>("/api/support/requests", {
      kind: "help",
      name: "Maria Souza",
      email: "maria.tempo-real@exemplo.test",
      sector: "Recepção",
      registration: "MAT-9001",
      reason: "Preciso de ajuda com o acesso ao sistema.",
    });
    expect(created.status).toBe(201);
    return created.body;
  }

  function waitForEvent(
    socket: WebSocket,
    predicate: (event: Record<string, unknown>) => boolean,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener("message", handler);
        reject(new Error("Evento de tempo real não chegou."));
      }, 4_000);
      const handler = (event: MessageEvent) => {
        const data = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (!predicate(data)) return;
        clearTimeout(timer);
        socket.removeEventListener("message", handler);
        resolve(data);
      };
      socket.addEventListener("message", handler);
    });
  }

  it("entrega mensagem e digitando para quem acompanha pelo token", async () => {
    const request = await openRequest();

    const response = await SELF.fetch(
      `https://facil.test/api/support/track/${request.token}/socket`,
      { headers: { Upgrade: "websocket" } },
    );
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).toBeTruthy();
    socket!.accept();

    // A digitação do solicitante também passa pela sala (o cliente ignora a
    // própria pelo clientId; aqui o teste confirma o broadcast).
    const typingPromise = waitForEvent(socket!, (event) => event.type === "typing");
    await new Api().post(`/api/support/track/${request.token}/typing`, {
      clientId: "test-client",
      typing: true,
    });
    const typing = await typingPromise;
    expect(typing).toMatchObject({
      type: "typing",
      authorType: "requester",
      clientId: "test-client",
    });

    // Resposta do atendente: grava no D1 e transmite para a sala.
    const messagePromise = waitForEvent(socket!, (event) => event.type === "message");
    const reply = await admin.api.post(`/api/support/requests/${request.id}/messages`, {
      body: "Estou verificando o seu acesso agora.",
    });
    expect(reply.status).toBe(201);
    const message = await messagePromise;
    expect(message).toMatchObject({
      type: "message",
      authorType: "staff",
      authorName: admin.name,
    });

    socket!.close();
  });

  it("recusa WebSocket sem token válido", async () => {
    const response = await SELF.fetch("https://facil.test/api/support/track/token-invalido/socket", {
      headers: { Upgrade: "websocket" },
    });
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
  });
});
