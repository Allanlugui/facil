/**
 * Sala em tempo real do atendimento de suporte.
 *
 * Cada solicitação de suporte tem uma sala isolada (`support:<id>`). O Durable
 * Object NÃO guarda a conversa: as mensagens continuam no D1, gravadas pelo
 * Worker na mesma transação de sempre. A sala apenas transmite eventos
 * efêmeros — mensagem nova, digitando e presença — para quem está com a
 * conversa aberta.
 *
 * O WebSocket é autenticado ANTES de chegar aqui (sessão para o atendimento
 * interno, token para o acompanhamento público). O DO confia no cabeçalho
 * `x-room-role` definido pelo Worker e usa a API de hibernação para não gastar
 * duração enquanto a conversa está parada.
 */
export class SupportRoom {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/broadcast") {
      const payload = await request.json();
      this.broadcast(payload);
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Esperando conexão WebSocket.", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const role = request.headers.get("x-room-role") === "staff" ? "staff" : "requester";
    this.state.acceptWebSocket(server, [role]);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Ping do cliente mantém o socket vivo; o navegador já reconecta sozinho. */
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    try {
      const event = JSON.parse(message) as { type?: string };
      if (event.type === "ping") ws.send(JSON.stringify({ type: "pong" }));
    } catch {
      // Evento inválido é ignorado; a conversa continua pelo polling/fallback.
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Conexão já encerrada.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "Erro na sala de suporte.");
    } catch {
      // Conexão já encerrada.
    }
  }

  private broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const socket of this.state.getWebSockets()) {
      try {
        socket.send(data);
      } catch {
        // Um cliente desconectado não interrompe os demais.
      }
    }
  }
}
