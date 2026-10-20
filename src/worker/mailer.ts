import { allRows, insertStatement, oneRow } from "./db";
import { smtpDeliver, socketConnect } from "./smtp";
import { nowIso, uuid } from "./util";

/**
 * Caixa de saida de e-mails do suporte.
 *
 * Toda mensagem de suporte gera linhas em `email_outbox` DENTRO do mesmo lote
 * atomico da conversa: ou a mensagem e os e-mails existem juntos, ou nada
 * existe. O envio real acontece logo depois (`deliverOutbox`), e depende das
 * configuracoes `mail.*`:
 *
 *   - sem provedor configurado, os e-mails permanecem `pending` e visiveis na
 *     interface (aba E-mails), podendo ser reenviados quando o provedor existir;
 *   - com provedor (Resend, Brevo, relay ou Gmail) e credenciais configuradas, o
 *     envio e imediato.
 *
 * O provedor `relay` entrega cada e-mail a uma URL HTTPS (`mail.relay_url`)
 * autenticada por segredo (`mail.relay_secret`). O contrato e simples: POST JSON
 * `{ secret, to, subject, text, name }` respondido com HTTP 2xx e corpo
 * `{"ok": true}`; qualquer outra resposta marca o e-mail como `failed`, para
 * nunca registrar como enviado algo que o relay nao confirmou.
 *
 * O provedor `gmail` fala SMTP direto com `smtp.gmail.com` (porta 465, TLS) usando
 * o endereco de `mail.from` e a senha de app em `mail.gmail_app_password`
 * (detalhes em `./smtp.ts`).
 *
 * Nenhuma falha de envio derruba a operacao de suporte: o e-mail fica `failed`
 * com o motivo registrado.
 */

export interface QueuedEmail {
  to: string;
  subject: string;
  body: string;
  kind: string;
  relatedId?: string | null;
}

export interface QueuedEmailStatement {
  id: string;
  statement: D1PreparedStatement;
}

export function queueEmail(db: D1Database, email: QueuedEmail): QueuedEmailStatement {
  const id = uuid();
  return {
    id,
    statement: insertStatement(db, "email_outbox", {
      id,
      to_email: email.to,
      subject: email.subject,
      body: email.body,
      kind: email.kind,
      related_id: email.relatedId ?? null,
      status: "pending",
      error: null,
      created_at: nowIso(),
      sent_at: null,
    }),
  };
}

export interface MailConfig {
  enabled: boolean;
  provider: string;
  apiKey: string;
  from: string;
  /** URL do Web App do relay (provedor `relay`). */
  relayUrl: string;
  /** Segredo compartilhado com o relay. */
  relaySecret: string;
  /** Senha de app do Gmail (provedor `gmail`). */
  gmailAppPassword: string;
  /** Nome de exibição do remetente no relay (nome da empresa). */
  senderName: string;
}

/** `true` quando ha provedor pronto para enviar (nunca expoe a chave). */
export function mailConfigured(config: MailConfig): boolean {
  if (!config.enabled || config.provider === "none") return false;
  if (config.provider === "relay") return config.relayUrl !== "" && config.relaySecret !== "";
  if (config.provider === "gmail") return config.from !== "" && config.gmailAppPassword !== "";
  return config.apiKey !== "" && config.from !== "";
}

export async function readMailConfig(db: D1Database): Promise<MailConfig> {
  const rows = await allRows<{ key: string; value: string }>(
    db,
    `SELECT key, value FROM settings
      WHERE key IN ('mail.enabled','mail.provider','mail.api_key','mail.from',
                    'mail.relay_url','mail.relay_secret','mail.gmail_app_password','company.name')`,
  );
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    enabled: map.get("mail.enabled") === "true",
    provider: (map.get("mail.provider") ?? "none").trim(),
    apiKey: (map.get("mail.api_key") ?? "").trim(),
    from: (map.get("mail.from") ?? "").trim(),
    relayUrl: (map.get("mail.relay_url") ?? "").trim(),
    relaySecret: (map.get("mail.relay_secret") ?? "").trim(),
    gmailAppPassword: (map.get("mail.gmail_app_password") ?? "").trim(),
    senderName: (map.get("company.name") ?? "").trim(),
  };
}

export interface DeliveryResult {
  attempted: number;
  sent: number;
  failed: number;
  /** Nenhum envio foi tentado por falta de provedor configurado. */
  skipped: boolean;
  error: string | null;
}

/**
 * Tenta entregar os e-mails informados. Idempotente: linhas ja `sent` sao
 * ignoradas. Sem provedor configurado, retorna `skipped` e nao altera nada.
 */
export async function deliverOutbox(db: D1Database, ids: string[]): Promise<DeliveryResult> {
  if (ids.length === 0) return { attempted: 0, sent: 0, failed: 0, skipped: false, error: null };

  const config = await readMailConfig(db);
  if (!mailConfigured(config)) {
    return { attempted: 0, sent: 0, failed: 0, skipped: true, error: null };
  }

  let attempted = 0;
  let sent = 0;
  let failed = 0;
  let lastError: string | null = null;

  for (const id of ids) {
    const row = await oneRow<{ id: string; to_email: string; subject: string; body: string; status: string }>(
      db,
      `SELECT id, to_email, subject, body, status FROM email_outbox WHERE id = ?`,
      [id],
    );
    if (!row || row.status === "sent") continue;
    attempted += 1;
    try {
      await sendWithProvider(config, { to: row.to_email, subject: row.subject, body: row.body });
      await db
        .prepare(`UPDATE email_outbox SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?`)
        .bind(nowIso(), id)
        .run();
      sent += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : "Falha desconhecida no envio.";
      lastError = message;
      await db.prepare(`UPDATE email_outbox SET status = 'failed', error = ? WHERE id = ?`).bind(message, id).run();
      failed += 1;
    }
  }

  return { attempted, sent, failed, skipped: false, error: lastError };
}

async function sendWithProvider(config: MailConfig, email: { to: string; subject: string; body: string }): Promise<void> {
  if (config.provider === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.from, to: [email.to], subject: email.subject, text: email.body }),
    });
    if (!response.ok) {
      throw new Error(`Resend respondeu ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return;
  }

  if (config.provider === "brevo") {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": config.apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        sender: { email: config.from },
        to: [{ email: email.to }],
        subject: email.subject,
        textContent: email.body,
      }),
    });
    if (!response.ok) {
      throw new Error(`Brevo respondeu ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return;
  }

  if (config.provider === "gmail") {
    await smtpDeliver(socketConnect, {
      host: "smtp.gmail.com",
      port: 465,
      user: config.from,
      password: config.gmailAppPassword,
      from: config.from,
      to: email.to,
      subject: email.subject,
      text: email.body,
      senderName: config.senderName,
    });
    return;
  }

  if (config.provider === "relay") {
    const response = await fetch(config.relayUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: config.relaySecret,
        to: email.to,
        subject: email.subject,
        text: email.body,
        name: config.senderName === "" ? "Facil" : config.senderName,
      }),
    });
    if (!response.ok) {
      throw new Error(`Relay respondeu ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    const text = await response.text();
    let parsed: { ok?: boolean; error?: string } | null = null;
    try {
      parsed = JSON.parse(text) as { ok?: boolean; error?: string };
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.ok !== true) {
      const detail = parsed?.error ? String(parsed.error) : text.slice(0, 200);
      throw new Error(`Relay não confirmou o envio: ${detail || "resposta sem conteúdo"}`);
    }
    return;
  }

  throw new Error(`Provedor de e-mail desconhecido: ${config.provider}`);
}
