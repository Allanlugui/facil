import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { PERMISSIONS } from "@shared/permissions";
import { themeLabel } from "@shared/themes";
import { apiErrorMessage, apiGet, apiPatch, apiPost, fieldErrors } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/hooks";
import { useSession } from "../lib/session";
import { ThemePicker } from "../lib/theme-picker";
import {
  Alert,
  Badge,
  BoxesIcon,
  BoxIcon,
  Button,
  Card,
  CartIcon,
  ChartIcon,
  Checkbox,
  ClipboardIcon,
  DashboardIcon,
  Dialog,
  EmptyState,
  ErrorBlock,
  Field,
  GearIcon,
  HelpIcon,
  Input,
  LoadingBlock,
  PaletteIcon,
  PageHeader,
  PaperclipIcon,
  Select,
  ShieldIcon,
  Table,
  Textarea,
  TicketIcon,
  UsersIcon,
  useToast,
  type Column,
} from "../lib/ui";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                      */
/* -------------------------------------------------------------------------- */

interface SettingDefinition {
  key: string;
  description: string;
  type: "string" | "boolean" | "enum" | "integer";
  options?: string[];
  min?: number;
  max?: number;
  secret?: boolean;
  section: string;
}

interface SettingItem {
  key: string;
  value: string;
  /** Credencial configurada: o valor em si nunca vem da API. */
  hasValue?: boolean;
  secret?: boolean;
  description: string | null;
  definition: SettingDefinition | null;
  updatedAt: string;
  updatedBy: string | null;
}

interface TicketCategoryRow {
  id: string;
  name: string;
  code: string | null;
  defaultKind: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const KIND_LABEL: Record<string, string> = {
  cleaning: "Limpeza",
  maintenance: "Manutenção",
  other: "Outros",
};

const PERIODICITY_LABEL: Record<string, string> = {
  daily: "Diário",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  monthly: "Mensal",
  quarterly: "Trimestral",
  annual: "Anual",
  custom: "Período livre",
};

/* -------------------------------------------------------------------------- */
/* Mapa das seções                                                            */
/*                                                                            */
/* A área de Configurações reúne as regras do sistema e as páginas            */
/* administrativas (F-18). Cada seção tem URL própria: /configuracoes/<id>.   */
/* -------------------------------------------------------------------------- */

const SETTINGS_SECTIONS = [
  {
    id: "aparencia",
    label: "Aparência",
    description: "Tema padrão da interface, com pré-visualização real",
    icon: <PaletteIcon />,
  },
  {
    id: "geral",
    label: "Geral",
    description: "Nome exibido no topo da aplicação e fuso horário",
    icon: <GearIcon />,
  },
  {
    id: "estoque",
    label: "Estoque",
    description: "Estoque negativo permitido e escopo do alerta de mínimo",
    icon: <BoxIcon />,
  },
  {
    id: "consumo",
    label: "Consumo e inventário",
    description: "Periodicidade padrão dos lançamentos e dos inventários",
    icon: <ClipboardIcon />,
  },
  {
    id: "compras",
    label: "Compras",
    description: "Exigência de aprovação antes de comprar",
    icon: <CartIcon />,
  },
  {
    id: "suporte",
    label: "Suporte e e-mail",
    description: "Provedor, remetente e credenciais dos e-mails de suporte",
    icon: <HelpIcon />,
  },
  {
    id: "anexos",
    label: "Anexos",
    description: "Limite de tamanho dos arquivos enviados",
    icon: <PaperclipIcon />,
  },
  {
    id: "categorias",
    label: "Categorias de chamados",
    description: "Taxonomia usada na abertura de chamados e nos relatórios",
    icon: <TicketIcon />,
  },
] as const;

const ADMIN_LINKS = [
  {
    to: "/catalogo",
    label: "Catálogo",
    description: "Produtos, categorias, unidades de medida e fornecedores",
    permission: PERMISSIONS.CATALOG_VIEW,
    icon: <BoxesIcon />,
  },
  {
    to: "/estrutura",
    label: "Estrutura",
    description: "Unidades, tipos e a hierarquia de locais",
    permission: PERMISSIONS.STRUCTURE_VIEW,
    icon: <DashboardIcon />,
  },
  {
    to: "/usuarios",
    label: "Usuários",
    description: "Contas, perfis, permissões e escopos por local",
    permission: PERMISSIONS.USERS_VIEW,
    icon: <UsersIcon />,
  },
  {
    to: "/controle",
    label: "Controle do sistema",
    description: "Exclusão de cadastros com prévia de impacto e histórico preservado",
    anyOf: [
      PERMISSIONS.STRUCTURE_MANAGE,
      PERMISSIONS.CATALOG_MANAGE,
      PERMISSIONS.USERS_MANAGE,
      PERMISSIONS.SETTINGS_MANAGE,
    ],
    icon: <ShieldIcon />,
  },
  {
    to: "/relatorios",
    label: "Relatórios",
    description: "Visões consolidadas com exportação em CSV",
    permission: PERMISSIONS.REPORTS_VIEW,
    icon: <ChartIcon />,
  },
  {
    to: "/auditoria",
    label: "Auditoria",
    description: "Trilha completa de ações do sistema",
    permission: PERMISSIONS.AUDIT_VIEW,
    icon: <ShieldIcon />,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Página                                                                     */
/* -------------------------------------------------------------------------- */

export function SettingsPage() {
  const { section } = useParams();
  const { can, canAny } = useSession();

  const canViewSettings = can(PERMISSIONS.SETTINGS_VIEW);
  const settingsSection = SETTINGS_SECTIONS.find((entry) => entry.id === section);
  const canSeeAdministration = ADMIN_LINKS.some((entry) =>
    "anyOf" in entry ? canAny(entry.anyOf) : can(entry.permission),
  );

  const navItems = [
    { id: "inicio", label: "Visão geral", href: "/configuracoes" },
    ...SETTINGS_SECTIONS.filter(() => canViewSettings).map((entry) => ({
      id: entry.id as string,
      label: entry.label,
      href: `/configuracoes/${entry.id}`,
    })),
    ...(canSeeAdministration || canViewSettings
      ? [{ id: "administracao", label: "Administração", href: "/configuracoes/administracao" }]
      : []),
  ];

  let body: ReactNode;
  if (!section) {
    body = <OverviewSection />;
  } else if (section === "administracao") {
    body = (
      <div>
        <PageHeader
          title="Administração"
          description="Acesso às áreas administrativas do sistema."
          backTo="/configuracoes"
          backLabel="Voltar às configurações"
        />
        <AdministrationSection />
      </div>
    );
  } else if (!settingsSection) {
    body = (
      <Card>
        <EmptyState
          title="Seção não encontrada"
          description="O endereço não corresponde a nenhuma seção de configurações."
          action={
            <Link to="/configuracoes" className="text-sm font-medium text-brand-700 hover:underline">
              Voltar para a visão geral
            </Link>
          }
        />
      </Card>
    );
  } else if (!canViewSettings) {
    body = <RestrictedCard />;
  } else if (settingsSection.id === "aparencia") {
    body = (
      <div>
        <PageHeader
          title={settingsSection.label}
          description={settingsSection.description}
          backTo="/configuracoes"
          backLabel="Voltar às configurações"
        />
        <AppearanceSection />
      </div>
    );
  } else if (settingsSection.id === "categorias") {
    body = (
      <div>
        <PageHeader
          title={settingsSection.label}
          description={settingsSection.description}
          backTo="/configuracoes"
          backLabel="Voltar às configurações"
        />
        <TicketCategoriesTab />
      </div>
    );
  } else {
    body = (
      <div>
        <PageHeader
          title={settingsSection.label}
          description={settingsSection.description}
          backTo="/configuracoes"
          backLabel="Voltar às configurações"
        />
        <SettingsSectionEditor section={settingsSection.id} />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Configurações"
        description="Regras do sistema, aparência e áreas administrativas em um só lugar."
        backTo="/"
        backLabel="Voltar ao painel"
      />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 pb-px" role="tablist">
        {navItems.map((item) => {
          const active = (item.id === "inicio" && !section) || item.id === section;
          return (
            <Link
              key={item.id}
              to={item.href}
              role="tab"
              aria-selected={active}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                active
                  ? "border-brand-700 text-brand-800"
                  : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {body}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Visão geral                                                                */
/* -------------------------------------------------------------------------- */

function OverviewSection() {
  const { can, canAny } = useSession();
  const canViewSettings = can(PERMISSIONS.SETTINGS_VIEW);
  const canAnyAdmin = ADMIN_LINKS.some((entry) =>
    "anyOf" in entry ? canAny(entry.anyOf) : can(entry.permission),
  );

  return (
    <div className="space-y-6">
      {canViewSettings ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Regras e preferências
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {SETTINGS_SECTIONS.map((entry) => (
              <SectionCard
                key={entry.id}
                to={`/configuracoes/${entry.id}`}
                icon={entry.icon}
                label={entry.label}
                description={entry.description}
              />
            ))}
          </div>
        </section>
      ) : null}

      {canAnyAdmin ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Administração do sistema
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Estas áreas continuam com permissões próprias: cada pessoa vê apenas o que a função dela permite.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ADMIN_LINKS.filter((entry) =>
              "anyOf" in entry ? canAny(entry.anyOf) : can(entry.permission),
            ).map((entry) => (
              <SectionCard
                key={entry.to}
                to={entry.to}
                icon={entry.icon}
                label={entry.label}
                description={entry.description}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!canViewSettings && !canAnyAdmin ? <RestrictedCard /> : null}
    </div>
  );
}

function AdministrationSection() {
  return (
    <div className="space-y-6">
      <OverviewSection />
    </div>
  );
}

function SectionCard({
  to,
  icon,
  label,
  description,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-surface p-4 transition hover:border-brand-300 hover:shadow-sm"
    >
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-800">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{description}</span>
      </span>
    </Link>
  );
}

function RestrictedCard() {
  return (
    <Card>
      <EmptyState
        title="Acesso restrito"
        description="Sua função não inclui configurações do sistema. Se precisar de acesso, solicite ao administrador uma alteração de perfil."
      />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Seções de regras (editor genérico por seção)                               */
/* -------------------------------------------------------------------------- */

function SettingsSectionEditor({ section }: { section: string }) {
  const { can, refresh } = useSession();
  const toast = useToast();
  const state = useAsync(async () => {
    const result = await apiGet<{ items: SettingItem[] }>("/api/settings");
    return result.items;
  }, []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [clearedSecrets, setClearedSecrets] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const manage = can(PERMISSIONS.SETTINGS_MANAGE);

  const items = useMemo(
    () => (state.data ?? []).filter((item) => item.definition?.section === section),
    [state.data, section],
  );

  const dirtyKeys = useMemo(
    () =>
      Object.keys(drafts).filter((key) => {
        const original = state.data?.find((item) => item.key === key);
        return original ? original.value !== drafts[key] : true;
      }),
    [drafts, state.data],
  );

  const pendingKeys = useMemo(
    () => new Set([...dirtyKeys, ...clearedSecrets]),
    [dirtyKeys, clearedSecrets],
  );

  const setValue = (key: string, value: string) => {
    // Digitar de novo cancela um "limpar credencial" pendente.
    setClearedSecrets((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setDrafts((current) => ({ ...current, [key]: value }));
  };

  const clearSecret = (key: string) => {
    setDrafts((current) => ({ ...current, [key]: "" }));
    setClearedSecrets((current) => new Set(current).add(key));
  };

  const cancelClear = (key: string) => {
    setClearedSecrets((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const save = async () => {
    if (pendingKeys.size === 0) return;
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const values: Record<string, string> = {};
      for (const key of pendingKeys) {
        const value = clearedSecrets.has(key) ? "" : drafts[key];
        if (value !== undefined) values[key] = value;
      }
      await apiPatch("/api/settings", { values });
      const touchedSession = dirtyKeys.some((key) => key === "company.timezone" || key === "company.name");
      toast.success(
        touchedSession
          ? "Configurações salvas. Nome e fuso da empresa atualizados na sessão."
          : "Configurações salvas e valendo imediatamente.",
      );
      setDrafts({});
      setClearedSecrets(new Set());
      state.reload();
      if (touchedSession) {
        await refresh();
      }
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setErrors(fieldErrors(cause));
    } finally {
      setSaving(false);
    }
  };

  if (state.loading && !state.data) return <LoadingBlock />;
  if (state.error) return <ErrorBlock message={state.error} onRetry={state.reload} />;

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <p className="text-sm text-slate-600">
          Alterações entram em vigor na hora para todos os usuários e ficam registradas na auditoria.
        </p>
        {manage ? (
          <Button onClick={() => void save()} loading={saving} disabled={pendingKeys.size === 0}>
            Salvar alterações{pendingKeys.size > 0 ? ` (${pendingKeys.size})` : ""}
          </Button>
        ) : null}
      </div>

      <div className="space-y-4 p-4">
        {error ? <Alert tone="red">{error}</Alert> : null}

        {items.length === 0 ? (
          <EmptyState title="Nada por aqui" description="Esta seção não tem configurações publicadas." />
        ) : (
          items.map((item) => {
            const value = drafts[item.key] ?? item.value;
            const definition = item.definition;
            return (
              <div
                key={item.key}
                className="grid gap-2 rounded-lg border border-slate-200 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] sm:items-start"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs text-slate-500">{item.key}</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">
                    {definition?.description ?? item.description ?? "Sem descrição"}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Atualizada em {formatDateTime(item.updatedAt)}
                    {definition ? ` · tipo: ${typeLabel(definition)}` : " · fora do catálogo (somente leitura)"}
                  </p>
                </div>
                <div>
                  {definition ? (
                    <>
                      {definition.type === "boolean" ? (
                        <Checkbox
                          label={value === "true" ? "Ativado" : "Desativado"}
                          checked={value === "true"}
                          disabled={!manage}
                          onChange={(checked) => setValue(item.key, checked ? "true" : "false")}
                        />
                      ) : definition.type === "enum" ? (
                        <Select
                          value={value}
                          disabled={!manage}
                          onChange={(event) => setValue(item.key, event.target.value)}
                          aria-label={definition.description}
                        >
                          {(definition.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {enumLabel(item.key, option)}
                            </option>
                          ))}
                        </Select>
                      ) : definition.type === "integer" ? (
                        <Input
                          type="number"
                          value={value}
                          disabled={!manage}
                          min={definition.min}
                          max={definition.max}
                          invalid={Boolean(errors[item.key])}
                          onChange={(event) => setValue(item.key, event.target.value)}
                          aria-label={definition.description}
                        />
                      ) : definition.secret ? (
                        manage ? (
                          <div className="space-y-1">
                            <Input
                              type="password"
                              autoComplete="new-password"
                              value={value}
                              placeholder={
                                item.hasValue
                                  ? "•••••••• (configurado — digite para substituir)"
                                  : "Não configurado"
                              }
                              invalid={Boolean(errors[item.key])}
                              onChange={(event) => setValue(item.key, event.target.value)}
                              aria-label={definition.description}
                            />
                            {item.hasValue && value === "" ? (
                              <button
                                type="button"
                                className="text-xs font-medium text-red-700 underline-offset-2 hover:underline"
                                onClick={() =>
                                  clearedSecrets.has(item.key)
                                    ? cancelClear(item.key)
                                    : clearSecret(item.key)
                                }
                              >
                                {clearedSecrets.has(item.key)
                                  ? "Cancelar remoção"
                                  : "Limpar credencial"}
                              </button>
                            ) : null}
                            {clearedSecrets.has(item.key) ? (
                              <p className="text-xs text-amber-700">
                                A credencial será removida ao salvar.
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="rounded bg-slate-50 px-3 py-2 text-sm text-slate-600">
                            {item.hasValue ? "Configurado (valor oculto)" : "Não configurado"}
                          </p>
                        )
                      ) : (
                        <Input
                          value={value}
                          disabled={!manage}
                          invalid={Boolean(errors[item.key])}
                          onChange={(event) => setValue(item.key, event.target.value)}
                          aria-label={definition.description}
                        />
                      )}
                      {errors[item.key] ? (
                        <p className="mt-1 text-xs text-red-600">{errors[item.key]}</p>
                      ) : null}
                      {item.key === "company.timezone" ? (
                        <p className="mt-1 text-xs text-slate-500">
                          Fuso IANA, ex.: America/Sao_Paulo. Todo horário exibido usa este fuso.
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="break-words rounded bg-slate-50 px-3 py-2 font-mono text-sm text-slate-700">
                      {item.value}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

function typeLabel(definition: SettingDefinition): string {
  const labels: Record<SettingDefinition["type"], string> = {
    string: "texto",
    boolean: "ligado/desligado",
    enum: "lista de opções",
    integer: "número inteiro",
  };
  return labels[definition.type];
}

function enumLabel(key: string, option: string): string {
  if (key === "stock.low_stock_scope") {
    return option === "global" ? "Global (soma dos locais)" : "Por local";
  }
  if (key === "mail.provider") {
    return (
      {
        none: "Desativado (fila interna)",
        resend: "Resend",
        brevo: "Brevo",
        relay: "Relay (Google Apps Script / webhook)",
        gmail: "Gmail (senha de app)",
      }[option] ?? option
    );
  }
  if (key === "ui.theme") return themeLabel(option);
  return PERIODICITY_LABEL[option] ?? option;
}

/* -------------------------------------------------------------------------- */
/* Aparência                                                                  */
/* -------------------------------------------------------------------------- */

function AppearanceSection() {
  const { can, reloadAppInfo } = useSession();
  const toast = useToast();
  const manage = can(PERMISSIONS.SETTINGS_MANAGE);

  const state = useAsync(async () => {
    const result = await apiGet<{ items: SettingItem[] }>("/api/settings");
    return result.items.find((item) => item.key === "ui.theme")?.value ?? "classico";
  }, []);
  const [saving, setSaving] = useState<string | null>(null);

  const change = async (theme: string | null) => {
    if (!theme) return;
    setSaving(theme);
    try {
      await apiPatch("/api/settings", { values: { "ui.theme": theme } });
      toast.success(`Tema padrão definido como ${themeLabel(theme)}.`);
      state.reload();
      await reloadAppInfo();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setSaving(null);
    }
  };

  if (state.loading && !state.data) return <LoadingBlock />;
  if (state.error) return <ErrorBlock message={state.error} onRetry={state.reload} />;

  return (
    <Card
      title="Tema padrão do sistema"
      description="Vale para quem não escolheu um tema pessoal em Meu perfil. A prévia de cada cartão usa as cores, a fonte, os cantos e os ícones do tema de verdade."
    >
      <ThemePicker
        value={state.data ?? "classico"}
        systemTheme={state.data ?? "classico"}
        disabled={!manage || saving !== null}
        onChange={(theme) => void change(theme)}
      />
      {!manage ? (
        <p className="mt-3 text-xs text-slate-500">Somente quem pode alterar configurações troca o tema padrão.</p>
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Categorias de chamados                                                     */
/* -------------------------------------------------------------------------- */

function TicketCategoriesTab() {
  const { can } = useSession();
  const toast = useToast();
  const [editing, setEditing] = useState<TicketCategoryRow | "new" | null>(null);

  const state = useAsync(async () => {
    const result = await apiGet<{ items: TicketCategoryRow[] }>("/api/settings/ticket-categories");
    return result.items;
  }, []);

  const manage = can(PERMISSIONS.SETTINGS_MANAGE);

  const toggle = async (row: TicketCategoryRow) => {
    try {
      await apiPatch(`/api/settings/ticket-categories/${row.id}`, { isActive: !row.isActive });
      toast.success(row.isActive ? "Categoria desativada." : "Categoria reativada.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    }
  };

  const columns: Column<TicketCategoryRow>[] = [
    {
      key: "name",
      header: "Categoria",
      cell: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="truncate text-xs text-slate-500">
            {row.code ?? "sem código"} · ordem {row.sortOrder}
            {row.description ? ` · ${row.description}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Tipo padrão",
      cell: (row) => <Badge tone="blue">{KIND_LABEL[row.defaultKind] ?? row.defaultKind}</Badge>,
    },
    {
      key: "status",
      header: "Situação",
      cell: (row) => (row.isActive ? <Badge tone="green">Ativa</Badge> : <Badge tone="slate">Inativa</Badge>),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (row) =>
        manage ? (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(row)}>
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void toggle(row)}>
              {row.isActive ? "Desativar" : "Reativar"}
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
        <p className="text-sm text-slate-600">
          Usadas na abertura de chamados e nos relatórios por categoria. Categorias inativas deixam de
          aparecer em novos chamados.
        </p>
        {manage ? <Button onClick={() => setEditing("new")}>Nova categoria</Button> : null}
      </div>
      <div className="p-4">
        {state.loading && !state.data ? (
          <LoadingBlock />
        ) : state.error ? (
          <ErrorBlock message={state.error} onRetry={state.reload} />
        ) : (
          <Table
            columns={columns}
            rows={state.data ?? []}
            keyOf={(row) => row.id}
            empty={<EmptyState title="Nenhuma categoria" description="Cadastre categorias para classificar chamados." />}
          />
        )}
      </div>

      {editing ? (
        <TicketCategoryDialog
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function TicketCategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: TicketCategoryRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(category?.name ?? "");
  const [code, setCode] = useState(category?.code ?? "");
  const [defaultKind, setDefaultKind] = useState(category?.defaultKind ?? "maintenance");
  const [description, setDescription] = useState(category?.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category?.sortOrder ?? 100));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const payload = {
      name,
      code: code || null,
      defaultKind,
      description: description || null,
      sortOrder: Number(sortOrder) || 0,
    };
    try {
      if (category) {
        await apiPatch(`/api/settings/ticket-categories/${category.id}`, payload);
        toast.success("Categoria atualizada.");
      } else {
        await apiPost("/api/settings/ticket-categories", payload);
        toast.success("Categoria criada.");
      }
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
      title={category ? `Editar ${category.name}` : "Nova categoria de chamado"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="red">{error}</Alert> : null}
        <Field label="Nome" required htmlFor="tcName">
          <Input id="tcName" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Código" hint="Opcional, para integrações." htmlFor="tcCode">
            <Input id="tcCode" value={code} onChange={(event) => setCode(event.target.value)} />
          </Field>
          <Field label="Ordem de exibição" htmlFor="tcOrder">
            <Input
              id="tcOrder"
              type="number"
              min={0}
              max={9999}
              value={sortOrder}
              onChange={(event) => setSortOrder(event.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Tipo padrão do atendimento"
          hint="Define se o chamado tende a virar limpeza ou manutenção nos relatórios."
          htmlFor="tcKind"
        >
          <Select id="tcKind" value={defaultKind} onChange={(event) => setDefaultKind(event.target.value)}>
            <option value="cleaning">Limpeza</option>
            <option value="maintenance">Manutenção</option>
            <option value="other">Outros</option>
          </Select>
        </Field>
        <Field label="Descrição" htmlFor="tcDescription">
          <Textarea
            id="tcDescription"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
