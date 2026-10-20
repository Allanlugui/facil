import { connect } from "cloudflare:sockets";

/**
 * Cliente SMTP mínimo (F-13, provedor `gmail`).
 *
 * O runtime dos Workers não traz biblioteca de e-mail: o envio é um diálogo
 * SMTP cru sobre TCP+TLS (`cloudflare:sockets`, porta 465 com TLS implícito),
 * autenticado com uma senha de app da conta Google. Efeito equivalente ao do
 * relay por Apps Script: o e-mail sai da conta do próprio usuário, para
 * qualquer destinatário, assinado pelo Google.
 *
 * Só a conexão fica atrás de `SmtpConnect`; o diálogo e a montagem da mensagem
 * são determinísticos e testáveis com um socket simulado, sem rede.
 */

export interface SmtpStreams {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
}

export type SmtpConnect = (address: { hostname: string; port: number }) => SmtpStreams;

export interface SmtpDelivery {
  host: string;
  port: number;
  /** Usuário do SMTP (no Gmail, o próprio endereço). */
  user: string;
  /** Senha; espaços são removidos (senha de app colada em grupos de 4). */
  password: string;
  from: string;
  to: string;
  subject: string;
  text: string;
  senderName?: string;
  /** Limite do diálogo inteiro; evita requisição pendurada. */
  timeoutMs?: number;
}

/** Conexão real: TLS desde o primeiro byte (porta 465 do Gmail). */
export function socketConnect(address: { hostname: string; port: number }): SmtpStreams {
  const socket = connect(address, { secureTransport: "on", allowHalfOpen: false });
  return {
    readable: socket.readable,
    writable: socket.writable,
    close: () => {
      void socket.close();
    },
  };
}

interface SmtpResponse {
  code: number;
  text: string;
}

class LineReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = "";

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async readLine(): Promise<string> {
    for (;;) {
      const index = this.buffer.indexOf("\r\n");
      if (index >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        return line;
      }
      const { done, value } = await this.reader.read();
      if (done) throw new Error("Conexão SMTP encerrada antes da resposta.");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  /** Resposta SMTP pode ter várias linhas: `250-...` continua, `250 ...` fecha. */
  async readResponse(): Promise<SmtpResponse> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      if (line.length < 4 || line[3] !== "-") {
        return { code: Number(line.slice(0, 3)), text: lines.join(" | ").slice(0, 300) };
      }
    }
  }
}

/**
 * Executa um envio completo: saudação, EHLO, AUTH PLAIN, envelope, mensagem e
 * QUIT. Qualquer código fora do esperado vira erro com o motivo do servidor
 * (ex.: senha de app inválida = `535 Username and Password not accepted`).
 */
export async function smtpDeliver(connectFn: SmtpConnect, delivery: SmtpDelivery): Promise<void> {
  const timeoutMs = delivery.timeoutMs ?? 20000;
  const user = delivery.user.trim();
  const password = delivery.password.replace(/\s+/g, "");
  const from = cleanAddress(delivery.from);
  const to = cleanAddress(delivery.to);
  const message: SmtpDelivery = { ...delivery, user, password, from, to };

  const streams = connectFn({ hostname: delivery.host, port: delivery.port });
  const writer = streams.writable.getWriter();
  const reader = new LineReader(streams.readable);
  const encoder = new TextEncoder();

  const sendLine = async (line: string): Promise<SmtpResponse> => {
    await writer.write(encoder.encode(`${line}\r\n`));
    return reader.readResponse();
  };
  const expect = (response: SmtpResponse, code: number, step: string): void => {
    if (response.code !== code) {
      throw new Error(`SMTP ${delivery.host} recusou ${step}: ${response.code} ${response.text}`);
    }
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Tempo esgotado ao falar com ${delivery.host}:${delivery.port}.`)),
      timeoutMs,
    );
  });

  try {
    await Promise.race([dialogue(), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    try {
      writer.releaseLock();
    } catch {
      // o socket pode já ter sido fechado pelo servidor
    }
    streams.close();
  }

  async function dialogue(): Promise<void> {
    expect(await reader.readResponse(), 220, "a saudação");
    expect(await sendLine("EHLO facil.local"), 250, "EHLO");

    const credentials = base64Utf8(`\u0000${message.user}\u0000${message.password}`);
    const auth = await sendLine(`AUTH PLAIN ${credentials}`);
    if (auth.code === 334) {
      // Alguns servidores pedem a credencial em um segundo passo.
      expect(await sendLine(credentials), 235, "AUTH (confira a senha de app)");
    } else {
      expect(auth, 235, "AUTH (confira a senha de app)");
    }

    expect(await sendLine(`MAIL FROM:<${message.from}>`), 250, "MAIL FROM");
    expect(await sendLine(`RCPT TO:<${message.to}>`), 250, "RCPT TO");
    expect(await sendLine("DATA"), 354, "DATA");

    await writer.write(encoder.encode(`${buildMessage(message)}\r\n.\r\n`));
    expect(await reader.readResponse(), 250, "aceite da mensagem");

    // Encerramento cortês; se o servidor já fechou, a mensagem já foi aceita.
    try {
      await sendLine("QUIT");
    } catch {
      // ignorado de propósito
    }
  }
}

/** Monta a mensagem RFC 5322 com corpo em base64 UTF-8 (seguro para acentos). */
export function buildMessage(delivery: SmtpDelivery): string {
  const subject = headerWord(sanitize(delivery.subject)) || "(sem assunto)";
  const senderName = sanitize(delivery.senderName ?? "");
  const fromHeader = senderName === "" ? delivery.from : `${headerWord(senderName)} <${delivery.from}>`;
  const domain = delivery.from.split("@")[1] ?? "facil.local";

  const headers = [
    `From: ${fromHeader}`,
    `To: ${delivery.to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  return dotStuff([...headers, "", base64Lines(delivery.text)].join("\r\n"));
}

function cleanAddress(value: string): string {
  return value.replace(/[\r\n<>]/g, "").trim();
}

function sanitize(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Cabeçalho com acento vira palavra codificada (`=?UTF-8?B?...?=`). */
function headerWord(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${base64Utf8(value)}?=`;
}

function base64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Lines(text: string): string {
  const base64 = base64Utf8(text);
  const lines: string[] = [];
  for (let index = 0; index < base64.length; index += 76) lines.push(base64.slice(index, index + 76));
  return lines.join("\r\n");
}

function dotStuff(data: string): string {
  return data
    .split("\r\n")
    .map((line) => (line.startsWith(".") ? `.${line}` : line))
    .join("\r\n");
}
