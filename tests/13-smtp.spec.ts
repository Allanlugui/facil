import { describe, expect, it } from "vitest";
import { smtpDeliver, type SmtpConnect, type SmtpDelivery } from "../src/worker/smtp";
import { assert } from "./helpers";

/**
 * Provedor `gmail` (F-13): o Worker fala SMTP direto com o smtp.gmail.com
 * (porta 465, TLS) autenticando com a senha de app da conta Google.
 *
 * Aqui a conexão é substituída por um socket simulado que executa um roteiro
 * de respostas SMTP; o diálogo inteiro — EHLO, AUTH PLAIN, envelope, DATA e a
 * montagem da mensagem — roda de verdade, sem rede. O envio real é validado na
 * ativação com o Gmail do próprio usuário.
 */

interface ScriptStep {
  /** Linha de comando esperada do cliente. */
  expect: RegExp;
  /** Resposta do servidor (CRLF entre linhas de uma resposta múltipla). */
  reply?: string;
  /** Encerra a conexão sem responder (queda do servidor). */
  close?: boolean;
}

class FakeSmtpServer {
  readonly received: string[] = [];
  readonly dataLines: string[] = [];
  readonly failures: string[] = [];
  closed = false;
  private stepIndex = 0;
  private inData = false;
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private push: ((bytes: Uint8Array) => void) | null = null;
  private finish: (() => void) | null = null;

  constructor(private readonly script: ScriptStep[]) {}

  readonly connect: SmtpConnect = () => {
    const toClient = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.push = (bytes) => controller.enqueue(bytes);
        this.finish = () => controller.close();
      },
    });
    const toServer = new WritableStream<Uint8Array>({
      write: (bytes) => this.handleBytes(bytes),
    });
    // A saudação (220) chega sozinha, como no Smtp real.
    this.reply("220 smtp.gmail.com ESMTP test");
    return {
      readable: toClient,
      writable: toServer,
      close: () => {
        this.closed = true;
      },
    };
  };

  private reply(text: string): void {
    this.push?.(new TextEncoder().encode(`${text}\r\n`));
  }

  private handleBytes(bytes: Uint8Array): void {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    for (;;) {
      const index = this.buffer.indexOf("\r\n");
      if (index < 0) return;
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + 2);
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    if (this.inData) {
      if (line === ".") {
        this.inData = false;
        this.reply("250 2.0.0 Ok: queued");
      } else {
        this.dataLines.push(line);
      }
      return;
    }

    const step = this.script[this.stepIndex];
    if (!step || !step.expect.test(line)) {
      this.failures.push(`linha inesperada (#${this.stepIndex + 1}): ${line}`);
      this.reply("500 5.5.1 Comando inesperado");
      return;
    }

    this.stepIndex += 1;
    this.received.push(line);
    if (step.close) {
      this.finish?.();
      return;
    }
    const reply = step.reply ?? "250 Ok";
    this.reply(reply);
    if (reply.startsWith("354")) this.inData = true;
  }
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

async function failure(promise: Promise<void>): Promise<Error> {
  const caught = await promise.then(
    () => null,
    (cause: unknown) => cause,
  );
  assert(caught instanceof Error, "erro do envio SMTP");
  return caught;
}

const DELIVERY: SmtpDelivery = {
  host: "smtp.gmail.com",
  port: 465,
  user: "lima.atecnica@gmail.com",
  // Senha de app colada em grupos de 4: o cliente precisa remover os espaços.
  password: "abcd efgh ijkl mnop",
  from: "lima.atecnica@gmail.com",
  to: "destino@exemplo.test",
  subject: "Resposta do suporte — atualização",
  text: "Olá!\r\nSeu pedido foi atualizado.\r\n— Equipe Facil",
  senderName: "Empresa Teste",
};

/** Credencial esperada no AUTH PLAIN (formato NUL usuário NUL senha). */
const EXPECTED_CREDENTIALS = "\u0000lima.atecnica@gmail.com\u0000abcdefghijklmnop";

describe("13: e-mails — provedor gmail (SMTP direto com senha de app)", () => {
  it("conduz o diálogo completo e monta a mensagem em UTF-8/base64", async () => {
    const server = new FakeSmtpServer([
      // A saudação é lida sem comando; a resposta múltipla (`250-...`) é do EHLO.
      { expect: /^EHLO /, reply: "250-smtp.gmail.com at your service\r\n250-SIZE 35882577\r\n250 AUTH PLAIN" },
      { expect: /^AUTH PLAIN /, reply: "235 2.7.0 Accepted" },
      { expect: /^MAIL FROM:<lima\.atecnica@gmail\.com>$/, reply: "250 2.1.0 OK" },
      { expect: /^RCPT TO:<destino@exemplo\.test>$/, reply: "250 2.1.5 OK" },
      { expect: /^DATA$/, reply: "354 Go ahead" },
      { expect: /^QUIT$/, reply: "221 2.0.0 Bye" },
    ]);

    await smtpDeliver(server.connect, DELIVERY);

    expect(server.failures).toEqual([]);
    expect(server.closed).toBe(true);

    // Autenticação: AUTH PLAIN com usuário e senha sem espaços.
    const authLine = server.received[1] ?? "";
    expect(authLine.startsWith("AUTH PLAIN ")).toBe(true);
    expect(decodeBase64(authLine.slice("AUTH PLAIN ".length))).toBe(EXPECTED_CREDENTIALS);

    // Envelope e mensagem.
    expect(server.received[2]).toBe("MAIL FROM:<lima.atecnica@gmail.com>");
    expect(server.received[3]).toBe("RCPT TO:<destino@exemplo.test>");
    expect(server.received[4]).toBe("DATA");

    const joined = server.dataLines.join("\r\n");
    expect(joined).toContain("From: Empresa Teste <lima.atecnica@gmail.com>");
    expect(joined).toContain("To: destino@exemplo.test");
    expect(joined).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(joined).toContain("Content-Transfer-Encoding: base64");

    // Assunto com acento vira palavra codificada e volta ao original.
    const subjectLine = server.dataLines.find((line) => line.startsWith("Subject: "));
    assert(subjectLine, "cabeçalho Subject");
    const wordPrefix = "=?UTF-8?B?";
    const wordStart = subjectLine.indexOf(wordPrefix);
    expect(wordStart).toBeGreaterThan(0);
    expect(decodeBase64(subjectLine.slice(wordStart + wordPrefix.length, -2))).toBe(DELIVERY.subject);

    // Corpo em base64 depois da linha em branco.
    const blankIndex = server.dataLines.indexOf("");
    expect(blankIndex).toBeGreaterThan(0);
    const body = server.dataLines.slice(blankIndex + 1).join("");
    expect(decodeBase64(body)).toBe(DELIVERY.text);
  });

  it("falha com o motivo do servidor quando a senha de app é recusada (535)", async () => {
    const server = new FakeSmtpServer([
      { expect: /^EHLO /, reply: "250 Ok" },
      {
        expect: /^AUTH PLAIN /,
        reply: "535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more at support.google.com",
      },
    ]);

    const error = await failure(smtpDeliver(server.connect, DELIVERY));
    expect(error.message).toContain("recusou AUTH");
    expect(error.message).toContain("535");
    expect(server.closed).toBe(true);
  });

  it("aborta com erro claro quando o servidor encerra a conexão sem responder", async () => {
    const server = new FakeSmtpServer([{ expect: /^EHLO /, close: true }]);
    const error = await failure(smtpDeliver(server.connect, DELIVERY));
    expect(error.message).toContain("encerrada");
    expect(server.closed).toBe(true);
  });

  it("completa o AUTH quando o servidor pede a credencial em um segundo passo (334)", async () => {
    const server = new FakeSmtpServer([
      { expect: /^EHLO /, reply: "250 Ok" },
      { expect: /^AUTH PLAIN /, reply: "334 " },
      { expect: /^[A-Za-z0-9+/=]+$/, reply: "235 2.7.0 Accepted" },
      { expect: /^MAIL FROM:/, reply: "250 OK" },
      { expect: /^RCPT TO:/, reply: "250 OK" },
      { expect: /^DATA$/, reply: "354 Go ahead" },
      { expect: /^QUIT$/, reply: "221 Bye" },
    ]);

    await smtpDeliver(server.connect, DELIVERY);
    expect(server.failures).toEqual([]);
    expect(decodeBase64(server.received[2] ?? "")).toBe(EXPECTED_CREDENTIALS);
  });
});
