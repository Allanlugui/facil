import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiErrorMessage, apiGet, apiPost, apiUpload } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";
import {
  Alert,
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Textarea,
  useToast,
  type Tone,
} from "../lib/ui";

/**
 * Canal de suporte pelo lado do solicitante.
 *
 * `/suporte` funciona SEM sessão: é por aqui que quem esqueceu a senha pede a
 * redefinição. O acompanhamento (`/suporte/acompanhar/:token`) usa o link/token
 * como credencial — nada é exposto sem ele. Os mesmos componentes são usados
 * pela página interna de suporte (criação de pedido e grade de artigos).
 */

export interface PublicArticle {
  id: string;
  title: string;
  category: string;
  summary: string | null;
  body: string;
  pinned: boolean;
  /** A resposta da API sempre inclui o estado; a página pública só exibe publicados. */
  published: boolean;
  updatedAt: string;
}

export interface SupportRequestSummary {
  id: string;
  code: string;
  kind: string;
  status: string;
  requesterName: string;
  requesterEmail: string;
  requesterSector: string | null;
  requesterRegistration: string | null;
  reason: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  position: number | null;
}

export interface SupportMessage {
  id: string;
  authorType: "requester" | "staff";
  authorName: string;
  body: string;
  createdAt: string;
  attachments: ChatAttachment[];
}

/** Arquivo preso a uma mensagem da conversa (F-19; binário no R2). */
export interface ChatAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

/** Limites de upload exibidos no composer; o servidor sempre revalida. */
export interface ChatLimits {
  maxFilesPerMessage: number;
  maxBytesPerFile: number;
  maxBytesPerMessage: number;
}

export interface RequestCreated {
  id: string;
  code: string;
  token: string;
  position: number;
}

export const KIND_LABEL: Record<string, string> = {
  password_reset: "Redefinição de senha",
  help: "Ajuda geral",
};

export const ARTICLE_CATEGORY_LABEL: Record<string, string> = {
  general: "Geral",
  security: "Segurança",
  news: "Informativo",
  faq: "Perguntas frequentes",
};

export const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Na fila", tone: "amber" },
  in_progress: { label: "Em atendimento", tone: "blue" },
  resolved: { label: "Resolvido", tone: "green" },
};

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: "slate" as Tone };
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function fileBadgeLabel(filename: string): string {
  const extension = filename.split(".").pop() ?? "";
  return extension.length > 0 && extension.length <= 4 ? extension.toUpperCase() : "ARQ";
}

export function MessageBubble({
  mine,
  author,
  body,
  at,
  attachments = [],
  onRemoveAttachment,
}: {
  mine: boolean;
  author: string;
  body: string;
  at: string;
  attachments?: ChatAttachment[];
  onRemoveAttachment?: (attachment: ChatAttachment) => void;
}) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm ${
          mine ? "bg-brand-700 text-white" : "border border-slate-200 bg-surface text-slate-700"
        }`}
      >
        <p className={`text-[11px] font-medium ${mine ? "text-brand-50/90" : "text-slate-400"}`}>
          {mine ? "Você" : author} · {formatDateTime(at)}
        </p>
        {body ? <p className="mt-1 whitespace-pre-line break-words">{body}</p> : null}
        {attachments.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {attachments.map((attachment) => {
              const isImage = attachment.mimeType.startsWith("image/");
              return (
                <li key={attachment.id} className="flex items-center gap-2">
                  {isImage ? (
                    <a href={attachment.url} target="_blank" rel="noreferrer" className="shrink-0">
                      <img
                        src={attachment.url}
                        alt={attachment.filename}
                        className="h-12 w-12 rounded-md border border-black/10 object-cover"
                      />
                    </a>
                  ) : (
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase ${
                        mine ? "bg-white/15 text-white/90" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {fileBadgeLabel(attachment.filename)}
                    </span>
                  )}
                  <span className="min-w-0">
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className={`block max-w-[13rem] truncate text-xs font-medium underline-offset-2 hover:underline ${
                        mine ? "text-white" : "text-brand-700"
                      }`}
                    >
                      {attachment.filename}
                    </a>
                    <span className={`block text-[11px] ${mine ? "text-brand-50/80" : "text-slate-400"}`}>
                      {formatBytes(attachment.sizeBytes)}
                    </span>
                  </span>
                  {onRemoveAttachment ? (
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(attachment)}
                      title="Remover anexo"
                      className={`ml-1 rounded px-1.5 py-0.5 text-xs transition ${
                        mine ? "text-white/70 hover:bg-white/15 hover:text-white" : "text-slate-400 hover:bg-slate-100 hover:text-red-600"
                      }`}
                    >
                      ✕
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

const ATTACHMENT_ACCEPT =
  "image/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx";

/**
 * Composer da conversa (acompanhamento público e atendimento interno): texto +
 * arquivos numa mensagem. A validação fina é do servidor; aqui só evitamos o
 * envio obviamente inválido, usando os limites que a API devolve.
 */
export function MessageComposer({
  placeholder,
  hint,
  limits,
  onSend,
}: {
  placeholder: string;
  hint?: string;
  limits: ChatLimits;
  onSend: (text: string, files: File[]) => Promise<void>;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = (text.trim().length > 0 || files.length > 0) && !sending;

  const pickFiles = (selected: FileList | null) => {
    if (!selected) return;
    setError(null);
    const next = [...files];
    for (const file of Array.from(selected)) {
      const name = file.name || "arquivo";
      if (file.size === 0) {
        setError(`"${name}" está vazio.`);
        continue;
      }
      if (file.size > limits.maxBytesPerFile) {
        setError(`"${name}" excede o limite de ${formatBytes(limits.maxBytesPerFile)} por arquivo.`);
        continue;
      }
      if (next.length >= limits.maxFilesPerMessage) {
        setError(`Cada mensagem aceita no máximo ${limits.maxFilesPerMessage} arquivos.`);
        break;
      }
      const total = next.reduce((sum, item) => sum + item.size, 0) + file.size;
      if (total > limits.maxBytesPerMessage) {
        setError(
          `Os arquivos somam mais que o limite de ${formatBytes(limits.maxBytesPerMessage)} por mensagem.`,
        );
        continue;
      }
      next.push(file);
    }
    setFiles(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(text.trim(), files);
      setText("");
      setFiles([]);
    } catch (cause) {
      const message = apiErrorMessage(cause);
      setError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const totalLabel =
    limits.maxBytesPerMessage === limits.maxBytesPerFile
      ? `${formatBytes(limits.maxBytesPerFile)} por arquivo`
      : `${formatBytes(limits.maxBytesPerFile)} por arquivo (somando ${formatBytes(limits.maxBytesPerMessage)} por mensagem)`;

  return (
    <div className="space-y-2">
      {error ? <Alert tone="red">{error}</Alert> : null}

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-2.5 py-1.5 text-xs text-slate-600 shadow-sm"
            >
              <span className="max-w-[12rem] truncate font-medium text-slate-700">
                {file.name || "arquivo"}
              </span>
              <span className="text-slate-400">{formatBytes(file.size)}</span>
              <button
                type="button"
                title="Remover"
                onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}
                className="text-slate-400 transition hover:text-red-600"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex items-end gap-2">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={(event) => pickFiles(event.target.files)}
        />
        <Button
          variant="secondary"
          type="button"
          onClick={() => inputRef.current?.click()}
          title="Anexar arquivos"
        >
          Anexar
        </Button>
        <Textarea
          rows={2}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder}
          maxLength={2000}
          className="flex-1"
        />
        <Button onClick={send} loading={sending} disabled={!canSend}>
          Enviar
        </Button>
      </div>

      <p className="text-xs text-slate-500">
        {hint ? `${hint} ` : ""}
        {limits.maxFilesPerMessage} arquivo(s) por mensagem · {totalLabel}.
      </p>
    </div>
  );
}

/** Grade de artigos com leitura em diálogo. Compartilhada com a página interna. */
export function ArticleGrid({ articles }: { articles: PublicArticle[] }) {
  const [open, setOpen] = useState<PublicArticle | null>(null);

  if (articles.length === 0) {
    return (
      <EmptyState
        title="Nenhum artigo publicado ainda"
        description="Quando o administrador publicar informativos, dicas ou perguntas frequentes, eles aparecem aqui."
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {articles.map((article) => (
          <button
            key={article.id}
            type="button"
            onClick={() => setOpen(article)}
            className="rounded-xl border border-slate-200 bg-surface p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow"
          >
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={article.pinned ? "brand" : "slate"}>
                {ARTICLE_CATEGORY_LABEL[article.category] ?? article.category}
              </Badge>
              {article.pinned ? <Badge tone="amber">Fixado</Badge> : null}
            </span>
            <span className="mt-2 block text-sm font-semibold text-slate-900">{article.title}</span>
            <span className="mt-1 block text-xs text-slate-500">
              {article.summary ?? `${article.body.slice(0, 140)}${article.body.length > 140 ? "…" : ""}`}
            </span>
          </button>
        ))}
      </div>

      <Dialog
        open={open !== null}
        title={open?.title ?? ""}
        onClose={() => setOpen(null)}
        wide
        footer={
          <Button variant="secondary" onClick={() => setOpen(null)}>
            Fechar
          </Button>
        }
      >
        {open ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="slate">{ARTICLE_CATEGORY_LABEL[open.category] ?? open.category}</Badge>
              <span className="text-xs text-slate-500">Atualizado em {formatDateTime(open.updatedAt)}</span>
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-slate-700">
              {open.body.split(/\n\n+/).map((paragraph, index) => (
                <p key={index} className="whitespace-pre-line">
                  {paragraph}
                </p>
              ))}
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

/**
 * Formulário de abertura de pedido (redefinição de senha ou ajuda geral).
 * O chamador monta o diálogo condicionalmente — o estado nasce limpo a cada
 * abertura. Após o envio, mostra o link de acompanhamento (a credencial de
 * quem não tem sessão).
 */
export function RequestDialog({
  kind,
  onClose,
  defaults,
  onCreated,
}: {
  kind: "password_reset" | "help";
  onClose: () => void;
  defaults?: { name?: string; email?: string };
  onCreated?: (result: RequestCreated) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [name, setName] = useState(defaults?.name ?? "");
  const [email, setEmail] = useState(defaults?.email ?? "");
  const [sector, setSector] = useState("");
  const [registration, setRegistration] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RequestCreated | null>(null);

  const resetPassword = kind === "password_reset";
  const link = created ? `${window.location.origin}/suporte/acompanhar/${created.token}` : "";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await apiPost<RequestCreated>("/api/support/requests", {
        kind,
        name,
        email,
        sector: sector.trim() || null,
        registration: registration.trim() || null,
        reason,
      });
      setCreated(result);
      onCreated?.(result);
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link copiado.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto do campo e copie manualmente.");
    }
  };

  if (created) {
    return (
      <Dialog
        open
        title="Pedido registrado"
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Fechar
            </Button>
            <Button onClick={() => navigate(`/suporte/acompanhar/${created.token}`)}>
              Abrir acompanhamento
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <Alert tone="green">
            Pedido <strong>{created.code}</strong> registrado na fila do suporte. Posição atual:{" "}
            <strong>{created.position}º</strong>.
          </Alert>
          <p>
            Guarde o link de acompanhamento: é por ele que você conversa com o suporte e vê a sua
            posição na fila. O link também é registrado para envio por e-mail ao endereço informado.
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={link} onFocus={(event) => event.currentTarget.select()} />
            <Button variant="secondary" onClick={copyLink}>
              Copiar
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Se o e-mail não chegar, use este link — ele é a sua chave de acesso ao atendimento.
          </p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      title={resetPassword ? "Esqueci minha senha" : "Pedir ajuda ao suporte"}
      description={
        resetPassword
          ? "Informe os seus dados para confirmarmos a identidade antes da redefinição."
          : "Descreva o que você precisa; o suporte responde por aqui e por e-mail."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="support-request-form" loading={submitting}>
            Enviar pedido
          </Button>
        </>
      }
    >
      <form id="support-request-form" onSubmit={submit} className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        <Field label="Nome completo" required htmlFor="support-name">
          <Input
            id="support-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={3}
            maxLength={120}
            required
            autoFocus
          />
        </Field>

        <Field label="E-mail" required htmlFor="support-email" hint="A resposta também é enviada para este endereço.">
          <Input
            id="support-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={160}
            required
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Setor"
            required={resetPassword}
            htmlFor="support-sector"
            hint={resetPassword ? undefined : "Opcional"}
          >
            <Input
              id="support-sector"
              value={sector}
              onChange={(event) => setSector(event.target.value)}
              maxLength={120}
              required={resetPassword}
            />
          </Field>
          <Field
            label="Matrícula"
            required={resetPassword}
            htmlFor="support-registration"
            hint={resetPassword ? undefined : "Opcional"}
          >
            <Input
              id="support-registration"
              value={registration}
              onChange={(event) => setRegistration(event.target.value)}
              maxLength={60}
              required={resetPassword}
            />
          </Field>
        </div>

        <Field
          label={resetPassword ? "Motivo do pedido" : "O que você precisa?"}
          required
          htmlFor="support-reason"
          hint={
            resetPassword
              ? "Ex.: não lembro a senha e preciso de acesso para trabalhar."
              : "Conte o que aconteceu, o que tentou fazer e desde quando."
          }
        >
          <Textarea
            id="support-reason"
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={10}
            maxLength={2000}
            required
          />
        </Field>
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Página pública /suporte                                                    */
/* -------------------------------------------------------------------------- */

export function SupportPublicPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [requestKind, setRequestKind] = useState<"password_reset" | "help" | null>(
    searchParams.get("tipo") === "senha" ? "password_reset" : null,
  );
  const [trackValue, setTrackValue] = useState("");

  const articles = useAsync(() => apiGet<{ items: PublicArticle[] }>("/api/support/articles"), []);

  const closeRequest = () => {
    setRequestKind(null);
    if (searchParams.get("tipo")) setSearchParams({}, { replace: true });
  };

  const goToTracking = () => {
    const value = trackValue.trim();
    if (!value) return;
    // Aceita tanto o link completo quanto apenas o token colado.
    const match = value.match(/acompanhar\/([^/?#\s]+)/);
    const token = match?.[1] ?? value;
    navigate(`/suporte/acompanhar/${encodeURIComponent(token)}`);
  };

  return (
    <div className="min-h-full bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-brand-700 text-lg font-bold text-white">
              F
            </span>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Central de suporte</h1>
              <p className="text-sm text-slate-600">Informativos, dúvidas frequentes e atendimento</p>
            </div>
          </div>
          <Link to="/login" className="text-sm text-brand-700 hover:underline">
            Ir para o login
          </Link>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setRequestKind("password_reset")}
            className="rounded-xl border border-slate-200 bg-surface p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow"
          >
            <span className="block text-sm font-semibold text-slate-900">Esqueci minha senha</span>
            <span className="mt-1 block text-xs text-slate-500">
              Solicite a redefinição ao administrador, com confirmação por setor e matrícula.
            </span>
          </button>
          <button
            type="button"
            onClick={() => setRequestKind("help")}
            className="rounded-xl border border-slate-200 bg-surface p-4 text-left shadow-sm transition hover:border-brand-300 hover:shadow"
          >
            <span className="block text-sm font-semibold text-slate-900">Preciso de ajuda</span>
            <span className="mt-1 block text-xs text-slate-500">
              Abra um pedido de suporte; você acompanha a resposta pelo link de atendimento.
            </span>
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-surface p-4 shadow-sm">
          <Field
            label="Já abriu um pedido?"
            htmlFor="support-track"
            hint="Cole o link de acompanhamento que você recebeu."
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="support-track"
                value={trackValue}
                onChange={(event) => setTrackValue(event.target.value)}
                placeholder="https://…/suporte/acompanhar/…"
                className="sm:flex-1"
              />
              <Button variant="secondary" onClick={goToTracking} disabled={trackValue.trim().length === 0}>
                Acompanhar
              </Button>
            </div>
          </Field>
        </div>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Informativos e perguntas frequentes
          </h2>
          {articles.loading ? (
            <LoadingBlock />
          ) : articles.error ? (
            <ErrorBlock message={articles.error} onRetry={articles.reload} />
          ) : (
            <ArticleGrid articles={articles.data?.items ?? []} />
          )}
        </section>

        {requestKind ? (
          <RequestDialog kind={requestKind} onClose={closeRequest} />
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Acompanhamento público /suporte/acompanhar/:token                          */
/* -------------------------------------------------------------------------- */

export function SupportTrackPage() {
  const { token = "" } = useParams();

  const state = useAsync(
    () =>
      apiGet<{ request: SupportRequestSummary; messages: SupportMessage[]; limits: ChatLimits }>(
        `/api/support/track/${encodeURIComponent(token)}`,
      ),
    [token],
  );

  // Atualiza sozinho para acompanhar as respostas do suporte.
  useEffect(() => {
    const timer = window.setInterval(state.reload, 20000);
    return () => window.clearInterval(timer);
  }, [state.reload]);

  const send = async (text: string, files: File[]) => {
    if (files.length === 0) {
      await apiPost(`/api/support/track/${encodeURIComponent(token)}/messages`, { body: text });
    } else {
      const form = new FormData();
      form.set("body", text);
      for (const file of files) form.append("files", file);
      await apiUpload(`/api/support/track/${encodeURIComponent(token)}/messages`, form);
    }
    state.reload();
  };

  if (state.loading && !state.data) {
    return (
      <div className="min-h-full bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-2xl">
          <LoadingBlock label="Carregando o acompanhamento..." />
        </div>
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="min-h-full bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <ErrorBlock message={state.error ?? "Acompanhamento não encontrado."} onRetry={state.reload} />
          <p className="text-center text-sm text-slate-500">
            Confira o link recebido ou <Link to="/suporte" className="text-brand-700 hover:underline">abra um novo pedido</Link>.
          </p>
        </div>
      </div>
    );
  }

  const { request, messages, limits } = state.data;
  const resolved = request.status === "resolved";

  return (
    <div className="min-h-full bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Acompanhamento de suporte</p>
            <h1 className="text-lg font-semibold text-slate-900">{request.code}</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={request.status} />
            {request.status === "queued" && request.position ? (
              <span className="text-xs text-slate-500">
                Posição na fila: <strong className="tabular-nums">{request.position}º</strong>
              </span>
            ) : null}
          </div>
        </header>

        <div className="rounded-xl border border-slate-200 bg-surface p-4 text-sm text-slate-600 shadow-sm">
          <p>
            <strong className="text-slate-800">{KIND_LABEL[request.kind] ?? request.kind}</strong> ·{" "}
            {request.requesterName} · aberto em {formatDateTime(request.createdAt)}
          </p>
          {request.resolvedAt ? (
            <p className="mt-1 text-xs text-slate-500">Resolvido em {formatDateTime(request.resolvedAt)}.</p>
          ) : null}
        </div>

        <div className="flex min-h-[320px] flex-col gap-3 rounded-xl border border-slate-200 bg-slate-100/70 p-4 shadow-sm">
          <div className="flex-1 space-y-3">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                mine={message.authorType === "requester"}
                author={message.authorName}
                body={message.body}
                at={message.createdAt}
                attachments={message.attachments}
              />
            ))}
          </div>

          {resolved ? (
            <Alert tone="slate">
              Este atendimento foi encerrado. Se precisar de algo mais,{" "}
              <Link to="/suporte" className="font-medium text-brand-700 hover:underline">
                abra um novo pedido
              </Link>
              .
            </Alert>
          ) : (
            <MessageComposer
              placeholder="Escreva uma mensagem para o suporte..."
              hint="Cada mensagem também é enviada por e-mail para o suporte."
              limits={limits}
              onSend={send}
            />
          )}
        </div>

        <p className="text-center text-xs text-slate-400">
          Atualização automática a cada 20 segundos. Guarde este link para voltar depois.
        </p>
      </div>
    </div>
  );
}
