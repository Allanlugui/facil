import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PERMISSIONS } from "@shared/permissions";
import { apiDelete, apiErrorMessage, apiGet, apiPatch, apiPost, apiUpload } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSession } from "../lib/session";
import {
  Alert,
  ArrowLeftIcon,
  Badge,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  Tabs,
  Textarea,
  useToast,
} from "../lib/ui";
import {
  ARTICLE_CATEGORY_LABEL,
  ArticleGrid,
  KIND_LABEL,
  RequestDialog,
  StatusBadge,
  type PublicArticle,
  type SupportRequestSummary,
} from "./support-public";
import {
  ChatThread,
  EMPTY_MESSAGES,
  MessageComposer,
  useOptimisticChat,
  type ChatAttachment,
  type ChatLimits,
  type SupportMessage,
} from "../lib/chat";

/**
 * Suporte dentro do sistema (`/ajuda`).
 *
 * Todos os usuários logados veem a central de ajuda, abrem pedidos e acompanham
 * os seus atendimentos. Quem tem `support.manage` (administrador) ganha as abas
 * de fila de atendimento, conteúdo e e-mails. A autorização real é sempre do
 * servidor — as abas só escondem o que já seria recusado na API.
 */

interface QueueItem extends SupportRequestSummary {
  messageCount: number;
  lastMessageAt: string | null;
}

interface QueueResponse {
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<string, number>;
}

interface OutboxEmail {
  id: string;
  toEmail: string;
  subject: string;
  kind: string;
  relatedId: string | null;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface MailInfo {
  configured: boolean;
  enabled: boolean;
  provider: string;
  from: string;
}

const OUTBOX_KIND_LABEL: Record<string, string> = {
  support_request: "Pedido",
  support_message: "Mensagem",
  support_status: "Atualização",
};

const OUTBOX_STATUS: Record<string, { label: string; tone: "amber" | "green" | "red" }> = {
  pending: { label: "Pendente", tone: "amber" },
  sent: { label: "Enviado", tone: "green" },
  failed: { label: "Falhou", tone: "red" },
};

type HelpTab = "ajuda" | "pedidos" | "fila" | "conteudo" | "emails";

export function HelpPage() {
  const { can, user } = useSession();
  const staff = can(PERMISSIONS.SUPPORT_MANAGE);
  const [tab, setTab] = useState<HelpTab>("ajuda");
  const [asking, setAsking] = useState(false);
  const [myRefresh, setMyRefresh] = useState(0);

  const tabs: { value: HelpTab; label: string }[] = [
    { value: "ajuda", label: "Central de ajuda" },
    { value: "pedidos", label: "Meus pedidos" },
  ];
  if (staff) {
    tabs.push(
      { value: "fila", label: "Fila de atendimento" },
      { value: "conteudo", label: "Conteúdo" },
      { value: "emails", label: "E-mails" },
    );
  }

  return (
    <div>
      <PageHeader
        title="Suporte"
        description="Informativos, perguntas frequentes e canal direto com o administrador."
        actions={
          <Button onClick={() => setAsking(true)}>Abrir pedido de suporte</Button>
        }
      />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "ajuda" ? <ArticlesSection /> : null}
      {tab === "pedidos" ? <MyRequestsSection refreshKey={myRefresh} onCreate={() => setAsking(true)} /> : null}
      {tab === "fila" && staff ? <QueueSection /> : null}
      {tab === "conteudo" && staff ? <ArticlesAdminSection /> : null}
      {tab === "emails" && staff ? <OutboxSection /> : null}

      {asking ? (
        <RequestDialog
          kind="help"
          defaults={{ name: user?.name, email: user?.email }}
          onClose={() => setAsking(false)}
          onCreated={() => setMyRefresh((key) => key + 1)}
        />
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Central de ajuda (artigos)                                                 */
/* -------------------------------------------------------------------------- */

function ArticlesSection() {
  const articles = useAsync(() => apiGet<{ items: PublicArticle[] }>("/api/support/articles"), []);

  if (articles.loading) return <LoadingBlock />;
  if (articles.error) {
    return (
      <Alert tone="red" title="Não foi possível carregar os artigos">
        <div className="flex flex-col gap-2">
          <span>{articles.error}</span>
          <div>
            <Button variant="secondary" size="sm" onClick={articles.reload}>
              Tentar de novo
            </Button>
          </div>
        </div>
      </Alert>
    );
  }
  return <ArticleGrid articles={articles.data?.items ?? []} />;
}

/* -------------------------------------------------------------------------- */
/* Meus pedidos                                                               */
/* -------------------------------------------------------------------------- */

function MyRequestsSection({ refreshKey, onCreate }: { refreshKey: number; onCreate: () => void }) {
  const navigate = useNavigate();
  const state = useAsync(() => apiGet<{ items: QueueItem[] }>("/api/support/my"), [refreshKey]);

  if (state.loading) return <LoadingBlock />;
  if (state.error) {
    return (
      <Alert tone="red" title="Não foi possível carregar os seus pedidos">
        <div className="flex flex-col gap-2">
          <span>{state.error}</span>
          <div>
            <Button variant="secondary" size="sm" onClick={state.reload}>
              Tentar de novo
            </Button>
          </div>
        </div>
      </Alert>
    );
  }

  return (
    <Table
      columns={[
        {
          key: "code",
          header: "Código",
          cell: (row) => <span className="font-medium tabular-nums text-slate-700">{row.code}</span>,
        },
        { key: "kind", header: "Tipo", cell: (row) => KIND_LABEL[row.kind] ?? row.kind, hideOnMobile: true },
        { key: "created", header: "Entrada", cell: (row) => formatDateTime(row.createdAt), hideOnMobile: true },
        { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
        {
          key: "queue",
          header: "Fila",
          align: "center",
          cell: (row) =>
            row.status === "queued" && row.position ? (
              <span className="tabular-nums text-slate-600">{row.position}º</span>
            ) : (
              <span className="text-slate-400">—</span>
            ),
        },
        {
          key: "last",
          header: "Última mensagem",
          cell: (row) => (row.lastMessageAt ? formatDateTime(row.lastMessageAt) : "—"),
          hideOnMobile: true,
        },
        {
          key: "open",
          header: "",
          align: "right",
          cell: (row) => (
            <Link to={`/ajuda/${row.id}`} className="font-medium text-brand-700 hover:underline">
              Abrir
            </Link>
          ),
        },
      ]}
      rows={state.data?.items ?? []}
      keyOf={(row) => row.id}
      onRowClick={(row) => navigate(`/ajuda/${row.id}`)}
      empty={
        <EmptyState
          title="Nenhum pedido de suporte"
          description="Precisa de ajuda? Abra um pedido e acompanhe a resposta por aqui."
          action={<Button onClick={onCreate}>Abrir pedido de suporte</Button>}
        />
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Fila de atendimento (administrador)                                        */
/* -------------------------------------------------------------------------- */

function QueueSection() {
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const state = useAsync(
    () =>
      apiGet<QueueResponse>("/api/support/queue", {
        status: status || undefined,
        search: search.trim() || undefined,
        page,
        pageSize: 25,
      }),
    [status, search, page],
  );

  const counts = state.data?.counts ?? {};

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Status" htmlFor="queue-status" className="sm:w-56">
          <Select
            id="queue-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="queued">Na fila</option>
            <option value="in_progress">Em atendimento</option>
            <option value="resolved">Resolvidos</option>
          </Select>
        </Field>
        <div className="sm:w-72">
          <span className="mb-1 block text-xs font-medium text-slate-600">Buscar</span>
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Nome, e-mail, código ou motivo"
          />
        </div>
        <p className="pb-2 text-xs text-slate-500 sm:ml-auto">
          Na fila: <strong className="tabular-nums">{counts.queued ?? 0}</strong> · Em atendimento:{" "}
          <strong className="tabular-nums">{counts.in_progress ?? 0}</strong> · Resolvidos:{" "}
          <strong className="tabular-nums">{counts.resolved ?? 0}</strong>
        </p>
      </div>

      {state.loading && !state.data ? <LoadingBlock /> : null}
      {state.error ? (
        <Alert tone="red" title="Não foi possível carregar a fila">
          <div className="flex flex-col gap-2">
            <span>{state.error}</span>
            <div>
              <Button variant="secondary" size="sm" onClick={state.reload}>
                Tentar de novo
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}

      {state.data ? (
        <>
          <Table
            columns={[
              {
                key: "code",
                header: "Código",
                cell: (row) => <span className="font-medium tabular-nums text-slate-700">{row.code}</span>,
              },
              { key: "kind", header: "Tipo", cell: (row) => KIND_LABEL[row.kind] ?? row.kind, hideOnMobile: true },
              {
                key: "requester",
                header: "Solicitante",
                cell: (row) => (
                  <span>
                    <span className="block font-medium text-slate-800">{row.requesterName}</span>
                    <span className="block text-xs text-slate-500">{row.requesterEmail}</span>
                  </span>
                ),
              },
              { key: "created", header: "Entrada", cell: (row) => formatDateTime(row.createdAt), hideOnMobile: true },
              { key: "status", header: "Status", cell: (row) => <StatusBadge status={row.status} /> },
              {
                key: "queue",
                header: "Fila",
                align: "center",
                cell: (row) =>
                  row.status === "queued" && row.position ? (
                    <span className="tabular-nums text-slate-600">{row.position}º</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  ),
              },
              {
                key: "messages",
                header: "Msgs",
                align: "center",
                cell: (row) => <span className="tabular-nums text-slate-600">{row.messageCount}</span>,
                hideOnMobile: true,
              },
              {
                key: "last",
                header: "Última atividade",
                cell: (row) => formatDateTime(row.lastMessageAt ?? row.createdAt),
                hideOnMobile: true,
              },
              {
                key: "open",
                header: "",
                align: "right",
                cell: (row) => (
                  <Link to={`/ajuda/${row.id}`} className="font-medium text-brand-700 hover:underline">
                    Atender
                  </Link>
                ),
              },
            ]}
            rows={state.data.items}
            keyOf={(row) => row.id}
            onRowClick={(row) => navigate(`/ajuda/${row.id}`)}
            empty={
              <EmptyState
                title="Nenhum pedido neste filtro"
                description="Ajuste o status ou a busca para ver outros atendimentos."
              />
            }
          />
          <Pagination
            page={state.data.page}
            pageSize={state.data.pageSize}
            total={state.data.total}
            onPage={setPage}
          />
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Conteúdo (administrador)                                                   */
/* -------------------------------------------------------------------------- */

function ArticlesAdminSection() {
  const toast = useToast();
  const [editing, setEditing] = useState<PublicArticle | "new" | null>(null);
  const [removing, setRemoving] = useState<PublicArticle | null>(null);
  const [busy, setBusy] = useState(false);

  const state = useAsync(() => apiGet<{ items: PublicArticle[] }>("/api/support/articles"), []);

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await apiDelete(`/api/support/articles/${removing.id}`);
      toast.success("Artigo removido.");
      setRemoving(null);
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Artigos publicados aqui aparecem na central de ajuda (dentro do sistema e na página pública).
        </p>
        <Button onClick={() => setEditing("new")}>Novo artigo</Button>
      </div>

      {state.loading ? <LoadingBlock /> : null}
      {state.error ? (
        <Alert tone="red" title="Não foi possível carregar os artigos">
          <div className="flex flex-col gap-2">
            <span>{state.error}</span>
            <div>
              <Button variant="secondary" size="sm" onClick={state.reload}>
                Tentar de novo
              </Button>
            </div>
          </div>
        </Alert>
      ) : null}

      {state.data ? (
        <Table
          columns={[
            {
              key: "title",
              header: "Título",
              cell: (row) => <span className="font-medium text-slate-800">{row.title}</span>,
            },
            {
              key: "category",
              header: "Categoria",
              cell: (row) => (
                <Badge tone="slate">{ARTICLE_CATEGORY_LABEL[row.category] ?? row.category}</Badge>
              ),
              hideOnMobile: true,
            },
            {
              key: "status",
              header: "Situação",
              cell: (row) => (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={row.published ? "green" : "slate"}>{row.published ? "Publicado" : "Rascunho"}</Badge>
                  {row.pinned ? <Badge tone="amber">Fixado</Badge> : null}
                </span>
              ),
            },
            { key: "updated", header: "Atualizado", cell: (row) => formatDateTime(row.updatedAt), hideOnMobile: true },
            {
              key: "actions",
              header: "",
              align: "right",
              cell: (row) => (
                <span className="flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(row)}>
                    Editar
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setRemoving(row)}>
                    Remover
                  </Button>
                </span>
              ),
            },
          ]}
          rows={state.data.items}
          keyOf={(row) => row.id}
          empty={
            <EmptyState
              title="Nenhum artigo"
              description="Publique informativos, dicas de segurança e perguntas frequentes para os usuários."
              action={<Button onClick={() => setEditing("new")}>Criar o primeiro artigo</Button>}
            />
          }
        />
      ) : null}

      {editing ? (
        <ArticleDialog
          article={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}

      <Dialog
        open={removing !== null}
        title="Remover artigo"
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button loading={busy} onClick={confirmRemove}>
              Remover
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Remover <strong>{removing?.title}</strong>? A ação não pode ser desfeita.
        </p>
      </Dialog>
    </div>
  );
}

function ArticleDialog({
  article,
  onClose,
  onSaved,
}: {
  article: PublicArticle | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(article?.title ?? "");
  const [category, setCategory] = useState(article?.category ?? "general");
  const [summary, setSummary] = useState(article?.summary ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [pinned, setPinned] = useState(article?.pinned ?? false);
  const [published, setPublished] = useState(article?.published ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title,
        category,
        summary: summary.trim() || null,
        body,
        pinned,
        published,
      };
      if (article) await apiPatch(`/api/support/articles/${article.id}`, payload);
      else await apiPost("/api/support/articles", payload);
      toast.success(article ? "Artigo atualizado." : "Artigo criado.");
      onSaved();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      wide
      title={article ? "Editar artigo" : "Novo artigo"}
      description="O texto aceita parágrafos separados por linha em branco."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="article-form" loading={saving}>
            Salvar artigo
          </Button>
        </>
      }
    >
      <form id="article-form" onSubmit={save} className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        <Field label="Título" required htmlFor="article-title">
          <Input
            id="article-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            minLength={3}
            maxLength={160}
            required
            autoFocus
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoria" required htmlFor="article-category">
            <Select
              id="article-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="general">Geral</option>
              <option value="security">Segurança</option>
              <option value="news">Informativo</option>
              <option value="faq">Perguntas frequentes</option>
            </Select>
          </Field>
          <Field label="Resumo" htmlFor="article-summary" hint="Opcional — aparece no cartão da lista.">
            <Input
              id="article-summary"
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              maxLength={300}
            />
          </Field>
        </div>

        <Field label="Conteúdo" required htmlFor="article-body">
          <Textarea
            id="article-body"
            rows={10}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            minLength={10}
            maxLength={20000}
            required
          />
        </Field>

        <div className="flex flex-col gap-2">
          <Checkbox
            label="Fixar no topo da central de ajuda"
            checked={pinned}
            onChange={setPinned}
            hint="Artigos fixados aparecem antes dos demais."
          />
          <Checkbox
            label="Publicado"
            checked={published}
            onChange={setPublished}
            hint="Desmarque para manter como rascunho (visível só para quem atende suporte)."
          />
        </div>
      </form>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* E-mails (administrador)                                                    */
/* -------------------------------------------------------------------------- */

function OutboxSection() {
  const toast = useToast();
  const [retrying, setRetrying] = useState<string | null>(null);
  const state = useAsync(
    () => apiGet<{ items: OutboxEmail[]; mail: MailInfo }>("/api/support/outbox"),
    [],
  );

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const result = await apiPost<{ status: string; skipped: boolean }>(
        `/api/support/outbox/${id}/retry`,
        {},
      );
      if (result.skipped) {
        toast.push("Provedor de e-mail não configurado: o e-mail continua na fila.", "amber");
      } else if (result.status === "sent") {
        toast.success("E-mail enviado.");
      } else {
        toast.error("O envio falhou. Veja o motivo na coluna Erro.");
      }
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setRetrying(null);
    }
  };

  if (state.loading) return <LoadingBlock />;
  if (state.error) {
    return (
      <Alert tone="red" title="Não foi possível carregar os e-mails">
        <div className="flex flex-col gap-2">
          <span>{state.error}</span>
          <div>
            <Button variant="secondary" size="sm" onClick={state.reload}>
              Tentar de novo
            </Button>
          </div>
        </div>
      </Alert>
    );
  }

  const mail = state.data?.mail;
  const items = state.data?.items ?? [];

  return (
    <div className="space-y-4">
      {mail && !mail.configured ? (
        <Alert tone="amber" title="Provedor de e-mail não configurado">
          Os e-mails do suporte ficam registrados aqui e podem ser reenviados quando o envio estiver
          ativo. Em{" "}
          <Link to="/configuracoes" className="font-medium text-brand-700 hover:underline">
            Configurações
          </Link>
          , ative <code className="font-mono text-xs">mail.enabled</code> e escolha{" "}
          <code className="font-mono text-xs">mail.provider</code>: com Resend/Brevo valem{" "}
          <code className="font-mono text-xs">mail.api_key</code> e{" "}
          <code className="font-mono text-xs">mail.from</code>; com o relay valem{" "}
          <code className="font-mono text-xs">mail.relay_url</code> e{" "}
          <code className="font-mono text-xs">mail.relay_secret</code>; com o Gmail valem{" "}
          <code className="font-mono text-xs">mail.from</code> e{" "}
          <code className="font-mono text-xs">mail.gmail_app_password</code>.
        </Alert>
      ) : null}
      {mail && mail.configured ? (
        <Alert tone="slate">
          {mail.provider === "relay" ? (
            <>
              Enviando via <strong>relay</strong> · o remetente é a conta configurada no relay.
            </>
          ) : mail.provider === "gmail" ? (
            <>
              Enviando via <strong>Gmail</strong> · remetente <strong>{mail.from}</strong>.
            </>
          ) : (
            <>
              Enviando via <strong>{mail.provider}</strong> · remetente <strong>{mail.from}</strong>.
            </>
          )}
        </Alert>
      ) : null}

      <Table
        columns={[
          { key: "to", header: "Para", cell: (row) => <span className="text-slate-700">{row.toEmail}</span> },
          {
            key: "subject",
            header: "Assunto",
            cell: (row) => <span className="text-slate-700">{row.subject}</span>,
          },
          {
            key: "kind",
            header: "Tipo",
            cell: (row) => <Badge tone="slate">{OUTBOX_KIND_LABEL[row.kind] ?? row.kind}</Badge>,
            hideOnMobile: true,
          },
          {
            key: "status",
            header: "Situação",
            cell: (row) => {
              const meta = OUTBOX_STATUS[row.status] ?? { label: row.status, tone: "amber" as const };
              return <Badge tone={meta.tone}>{meta.label}</Badge>;
            },
          },
          { key: "created", header: "Criado", cell: (row) => formatDateTime(row.createdAt), hideOnMobile: true },
          {
            key: "error",
            header: "Erro",
            cell: (row) =>
              row.error ? (
                <span className="block max-w-[16rem] truncate text-xs text-red-600" title={row.error}>
                  {row.error}
                </span>
              ) : (
                <span className="text-slate-400">—</span>
              ),
            hideOnMobile: true,
          },
          {
            key: "retry",
            header: "",
            align: "right",
            cell: (row) =>
              row.status === "sent" ? (
                <span className="text-xs text-slate-400">{row.sentAt ? formatDateTime(row.sentAt) : "Enviado"}</span>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={retrying === row.id}
                  onClick={() => retry(row.id)}
                >
                  Reenviar
                </Button>
              ),
          },
        ]}
        rows={items}
        keyOf={(row) => row.id}
        empty={
          <EmptyState
            title="Nenhum e-mail registrado"
            description="Cada pedido e cada mensagem do suporte registram os e-mails aqui."
          />
        }
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Atendimento (/ajuda/:id)                                                   */
/* -------------------------------------------------------------------------- */

interface ThreadResponse {
  request: SupportRequestSummary;
  messages: SupportMessage[];
  limits: ChatLimits;
  emails: OutboxEmail[];
}

export function SupportThreadPage() {
  const { id = "" } = useParams();
  const { can, user } = useSession();
  const staff = can(PERMISSIONS.SUPPORT_MANAGE);
  const toast = useToast();
  const [changingStatus, setChangingStatus] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState(false);

  const state = useAsync(() => apiGet<ThreadResponse>(`/api/support/requests/${id}`), [id]);

  // Mantém a conversa atualizada enquanto o atendimento está aberto.
  useEffect(() => {
    const timer = window.setInterval(state.reload, 20000);
    return () => window.clearInterval(timer);
  }, [state.reload]);

  const changeStatus = async (status: "queued" | "in_progress" | "resolved") => {
    setChangingStatus(true);
    try {
      await apiPatch(`/api/support/requests/${id}`, { status });
      toast.success(status === "resolved" ? "Atendimento marcado como resolvido." : "Atendimento atualizado.");
      setConfirmResolve(false);
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setChangingStatus(false);
    }
  };

  const { messages: threadMessages, sendMessage } = useOptimisticChat({
    messages: state.data?.messages ?? EMPTY_MESSAGES,
    authorType: staff ? "staff" : "requester",
    authorName: user?.name ?? (staff ? "Suporte" : "Você"),
    send: async (text, files) => {
      const path = `/api/support/requests/${id}/messages`;
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

  const removeAttachment = async (attachment: ChatAttachment) => {
    try {
      await apiDelete(`/api/support/attachments/${attachment.id}`);
      toast.success("Anexo removido.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    }
  };

  if (state.loading && !state.data) return <LoadingBlock label="Carregando o atendimento..." />;
  if (!state.data) {
    return (
      <div className="space-y-4">
        <Alert tone="red" title="Não foi possível carregar o atendimento">
          <div className="flex flex-col gap-2">
            <span>{state.error ?? "Pedido não encontrado."}</span>
            <div>
              <Button variant="secondary" size="sm" onClick={state.reload}>
                Tentar de novo
              </Button>
            </div>
          </div>
        </Alert>
        <Link to="/ajuda" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
          <ArrowLeftIcon className="size-3.5" /> Voltar ao suporte
        </Link>
      </div>
    );
  }

  const { request, limits, emails } = state.data;
  const resolved = request.status === "resolved";

  return (
    <div className="space-y-4">
      <Link to="/ajuda" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">
        <ArrowLeftIcon className="size-3.5" /> Voltar ao suporte
      </Link>

      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Atendimento {request.code}</h1>
          <StatusBadge status={request.status} />
          <Badge tone="slate">{KIND_LABEL[request.kind] ?? request.kind}</Badge>
        </div>
        {staff ? (
          <div className="flex flex-wrap items-center gap-2">
            {request.status === "queued" ? (
              <Button variant="secondary" loading={changingStatus} onClick={() => changeStatus("in_progress")}>
                Marcar em atendimento
              </Button>
            ) : null}
            {!resolved ? (
              <Button loading={changingStatus} onClick={() => setConfirmResolve(true)}>
                Marcar como resolvido
              </Button>
            ) : (
              <Button variant="secondary" loading={changingStatus} onClick={() => changeStatus("queued")}>
                Reabrir na fila
              </Button>
            )}
          </div>
        ) : null}
      </header>

      <section className="grid gap-3 rounded-xl border border-slate-200 bg-surface p-4 text-sm shadow-sm sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Solicitante</p>
          <p className="mt-0.5 font-medium text-slate-800">{request.requesterName}</p>
          <p className="text-xs text-slate-500">{request.requesterEmail}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Setor / Matrícula</p>
          <p className="mt-0.5 text-slate-700">
            {request.requesterSector ?? "—"} · {request.requesterRegistration ?? "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Aberto em</p>
          <p className="mt-0.5 text-slate-700">{formatDateTime(request.createdAt)}</p>
          {request.status === "queued" && request.position ? (
            <p className="text-xs text-slate-500">
              Posição na fila: <strong className="tabular-nums">{request.position}º</strong>
            </p>
          ) : null}
          {request.resolvedAt ? (
            <p className="text-xs text-slate-500">Resolvido em {formatDateTime(request.resolvedAt)}</p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ChatThread
          messages={threadMessages}
          isMine={(message) =>
            staff ? message.authorType === "staff" : message.authorType === "requester"
          }
          onRemoveAttachment={staff ? removeAttachment : undefined}
          title={staff ? "Conversa com o solicitante" : "Conversa com o suporte"}
          emptyText={
            staff
              ? "Nenhuma mensagem ainda. Escreva a primeira resposta."
              : "Envie a primeira mensagem para o suporte."
          }
        >
          {resolved ? (
            <Alert tone="slate">
              Atendimento encerrado. {staff ? "Reabra na fila para continuar a conversa." : "Se precisar de algo mais, abra um novo pedido."}
            </Alert>
          ) : (
            <MessageComposer
              placeholder={staff ? "Responda ao solicitante..." : "Escreva uma mensagem para o suporte..."}
              hint={
                staff
                  ? "Cada mensagem enviada também gera um e-mail para o solicitante."
                  : "Cada mensagem também é enviada por e-mail ao suporte."
              }
              limits={limits}
              onSend={sendMessage}
            />
          )}
        </ChatThread>

        {staff ? (
          <aside className="space-y-3">
            <section className="rounded-xl border border-slate-200 bg-surface p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Motivo do pedido</h2>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{request.reason}</p>
            </section>
            <section className="rounded-xl border border-slate-200 bg-surface p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">E-mails do pedido</h2>
                {emails.length > 0 ? <Badge tone="slate">{emails.length}</Badge> : null}
              </div>
              {emails.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">Nenhum e-mail registrado.</p>
              ) : (
                <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-1">
                  {[...emails].reverse().map((email) => {
                    const meta = OUTBOX_STATUS[email.status] ?? { label: email.status, tone: "amber" as const };
                    return (
                      <li key={email.id} className="text-xs text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                          <span className="truncate">{email.toEmail}</span>
                        </span>
                        <span className="mt-0.5 block truncate" title={email.subject}>
                          {email.subject}
                        </span>
                        <span className="block text-slate-400">{formatDateTime(email.createdAt)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </aside>
        ) : null}
      </div>

      <Dialog
        open={confirmResolve}
        title="Marcar como resolvido"
        onClose={() => setConfirmResolve(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmResolve(false)}>
              Cancelar
            </Button>
            <Button loading={changingStatus} onClick={() => changeStatus("resolved")}>
              Confirmar
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Encerrar o atendimento <strong>{request.code}</strong>? O solicitante é avisado por e-mail e não
          poderá enviar novas mensagens até o pedido ser reaberto.
        </p>
      </Dialog>
    </div>
  );
}
