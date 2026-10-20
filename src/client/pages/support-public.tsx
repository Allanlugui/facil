import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { apiErrorMessage, apiGet, apiPost, apiUpload } from "../lib/api";
import { formatDateTime, plural } from "../lib/format";
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
import {
  ChatThread,
  EMPTY_MESSAGES,
  MessageComposer,
  useOptimisticChat,
  type ChatLimits,
  type SupportMessage,
} from "../lib/chat";

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

  const { messages: threadMessages, sendMessage } = useOptimisticChat({
    messages: state.data?.messages ?? EMPTY_MESSAGES,
    authorType: "requester",
    authorName: state.data?.request.requesterName ?? "Você",
    send: async (text, files) => {
      const path = `/api/support/track/${encodeURIComponent(token)}/messages`;
      let created: { id: string };
      if (files.length === 0) {
        created = await apiPost<{ id: string }>(path, { body: text });
      } else {
        const form = new FormData();
        form.set("body", text);
        for (const file of files) form.append("files", file);
        created = await apiUpload<{ id: string }>(path, form);
      }
      state.reload();
      return created;
    },
  });

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

  const { request, limits } = state.data;
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

        <ChatThread
          messages={threadMessages}
          isMine={(message) => message.authorType === "requester"}
          title="Conversa com o suporte"
          subtitle={`${threadMessages.length} ${plural(threadMessages.length, "mensagem", "mensagens")} · atualiza a cada 20 s`}
          emptyText="Envie a primeira mensagem para o suporte."
        >
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
              onSend={sendMessage}
            />
          )}
        </ChatThread>

        <p className="text-center text-xs text-slate-400">
          Atualização automática a cada 20 segundos. Guarde este link para voltar depois.
        </p>
      </div>
    </div>
  );
}
