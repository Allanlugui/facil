/**
 * Catálogo de permissões do sistema.
 *
 * Esta lista espelha exatamente os registros inseridos em
 * `migrations/0002_reference_data.sql` (tabela `permissions`).
 * O backend autoriza por estes códigos; o frontend apenas os usa para
 * ocultar/desabilitar ações. Ocultar um botão NÃO e controle de acesso.
 */

export const PERMISSIONS = {
  DASHBOARD_VIEW: "dashboard.view",

  STRUCTURE_VIEW: "structure.view",
  STRUCTURE_MANAGE: "structure.manage",

  USERS_VIEW: "users.view",
  USERS_MANAGE: "users.manage",
  USERS_PERMISSIONS: "users.permissions",

  CATALOG_VIEW: "catalog.view",
  CATALOG_MANAGE: "catalog.manage",

  STOCK_VIEW: "stock.view",
  STOCK_ISSUE: "stock.issue",
  STOCK_TRANSFER: "stock.transfer",
  STOCK_REPLENISH: "stock.replenish",
  STOCK_ADJUST: "stock.adjust",
  STOCK_LOSS: "stock.loss",

  CONSUMPTION_VIEW: "consumption.view",
  CONSUMPTION_CREATE: "consumption.create",
  CONSUMPTION_CANCEL: "consumption.cancel",

  INVENTORY_VIEW: "inventory.view",
  INVENTORY_CREATE: "inventory.create",
  INVENTORY_COUNT: "inventory.count",
  INVENTORY_ADJUST: "inventory.adjust",
  INVENTORY_CLOSE: "inventory.close",
  INVENTORY_REOPEN: "inventory.reopen",

  TICKETS_VIEW: "tickets.view",
  TICKETS_VIEW_ALL: "tickets.view_all",
  TICKETS_CREATE: "tickets.create",
  TICKETS_ASSIGN: "tickets.assign",
  TICKETS_RESOLVE: "tickets.resolve",
  TICKETS_CANCEL: "tickets.cancel",

  WORKORDERS_VIEW: "workorders.view",
  WORKORDERS_CREATE: "workorders.create",
  WORKORDERS_EXECUTE: "workorders.execute",
  WORKORDERS_MATERIAL: "workorders.material",
  WORKORDERS_CLOSE: "workorders.close",
  WORKORDERS_CANCEL: "workorders.cancel",

  PURCHASES_VIEW: "purchases.view",
  PURCHASES_VIEW_ALL: "purchases.view_all",
  PURCHASES_CREATE: "purchases.create",
  PURCHASES_APPROVE: "purchases.approve",
  PURCHASES_AUTHORIZE: "purchases.authorize",
  PURCHASES_AWARD: "purchases.award",
  PURCHASES_DIRECT: "purchases.direct",
  PURCHASES_ORDER: "purchases.order",
  PURCHASES_RECEIVE: "purchases.receive",
  PURCHASES_CANCEL: "purchases.cancel",

  ATTACHMENTS_DOCUMENTS: "attachments.documents",

  REPORTS_VIEW: "reports.view",
  REPORTS_EXPORT: "reports.export",

  AUDIT_VIEW: "audit.view",

  SUPPORT_MANAGE: "support.manage",

  SETTINGS_VIEW: "settings.view",
  SETTINGS_MANAGE: "settings.manage",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionGroup {
  module: string;
  label: string;
  codes: readonly { code: PermissionCode; label: string }[];
}

/** Agrupamento usado na tela de perfis e permissões. */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    module: "dashboard",
    label: "Painel",
    codes: [{ code: "dashboard.view", label: "Visualizar painel principal" }],
  },
  {
    module: "structure",
    label: "Estrutura e locais",
    codes: [
      { code: "structure.view", label: "Visualizar unidades e locais" },
      { code: "structure.manage", label: "Gerenciar unidades, tipos e locais" },
    ],
  },
  {
    module: "users",
    label: "Usuários e permissões",
    codes: [
      { code: "users.view", label: "Visualizar usuários" },
      { code: "users.manage", label: "Criar, editar e desativar usuários" },
      { code: "users.permissions", label: "Alterar perfis e permissões" },
    ],
  },
  {
    module: "catalog",
    label: "Catálogo de materiais",
    codes: [
      { code: "catalog.view", label: "Visualizar produtos e fornecedores" },
      { code: "catalog.manage", label: "Gerenciar produtos, categorias e fornecedores" },
    ],
  },
  {
    module: "stock",
    label: "Estoque",
    codes: [
      { code: "stock.view", label: "Visualizar saldos e movimentações" },
      { code: "stock.issue", label: "Registrar saída definitiva" },
      { code: "stock.transfer", label: "Transferir entre locais" },
      { code: "stock.replenish", label: "Repor material em ambientes" },
      { code: "stock.adjust", label: "Ajustar saldo com justificativa" },
      { code: "stock.loss", label: "Registrar perda ou descarte" },
    ],
  },
  {
    module: "consumption",
    label: "Consumo",
    codes: [
      { code: "consumption.view", label: "Visualizar lançamentos de consumo" },
      { code: "consumption.create", label: "Registrar consumo operacional" },
      { code: "consumption.cancel", label: "Cancelar lançamento de consumo" },
    ],
  },
  {
    module: "inventory",
    label: "Inventário",
    codes: [
      { code: "inventory.view", label: "Visualizar inventários" },
      { code: "inventory.create", label: "Abrir ciclo de inventário" },
      { code: "inventory.count", label: "Contar e conferir itens" },
      { code: "inventory.adjust", label: "Aplicar ajuste de inventário" },
      { code: "inventory.close", label: "Fechar ciclo de inventário" },
      { code: "inventory.reopen", label: "Reabrir inventário encerrado" },
    ],
  },
  {
    module: "tickets",
    label: "Tickets e chamados",
    codes: [
      { code: "tickets.view", label: "Visualizar tickets próprios" },
      { code: "tickets.view_all", label: "Visualizar todos os tickets" },
      { code: "tickets.create", label: "Abrir ticket" },
      { code: "tickets.assign", label: "Atribuir responsável" },
      { code: "tickets.resolve", label: "Resolver ticket diretamente" },
      { code: "tickets.cancel", label: "Cancelar ticket" },
    ],
  },
  {
    module: "workorders",
    label: "Ordens de serviço",
    codes: [
      { code: "workorders.view", label: "Visualizar ordens de serviço" },
      { code: "workorders.create", label: "Criar ordem de serviço" },
      { code: "workorders.execute", label: "Executar e movimentar status" },
      { code: "workorders.material", label: "Registrar material utilizado" },
      { code: "workorders.close", label: "Concluir ordem de serviço" },
      { code: "workorders.cancel", label: "Cancelar ordem de serviço" },
    ],
  },
  {
    module: "purchases",
    label: "Compras e recebimentos",
    codes: [
      { code: "purchases.view", label: "Visualizar compras" },
      { code: "purchases.view_all", label: "Visualizar todas as solicitações de compra" },
      { code: "purchases.create", label: "Criar solicitação de compra" },
      { code: "purchases.approve", label: "Aprovar a necessidade como gestor do setor" },
      { code: "purchases.authorize", label: "Autorizar compra após análise de orçamento" },
      { code: "purchases.award", label: "Adjudicar cotação por item e escolher fornecedores" },
      { code: "purchases.direct", label: "Autorizar compra direta sem cotação" },
      { code: "purchases.order", label: "Registrar pedido e fornecedor" },
      { code: "purchases.receive", label: "Registrar recebimento" },
      { code: "purchases.cancel", label: "Cancelar solicitação ou recebimento" },
    ],
  },
  {
    module: "attachments",
    label: "Anexos",
    codes: [
      {
        code: "attachments.documents",
        label: "Anexar documentos (PDF, planilha ou texto) a chamados e ordens de serviço",
      },
    ],
  },
  {
    module: "reports",
    label: "Relatórios",
    codes: [
      { code: "reports.view", label: "Acessar relatórios" },
      { code: "reports.export", label: "Exportar relatórios em CSV" },
    ],
  },
  {
    module: "audit",
    label: "Auditoria",
    codes: [{ code: "audit.view", label: "Consultar trilha de auditoria" }],
  },
  {
    module: "support",
    label: "Suporte",
    codes: [{ code: "support.manage", label: "Atender pedidos de suporte e publicar conteúdo de ajuda" }],
  },
  {
    module: "settings",
    label: "Configurações",
    codes: [
      { code: "settings.view", label: "Visualizar configurações" },
      { code: "settings.manage", label: "Alterar configurações do sistema" },
    ],
  },
];

export const ALL_PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_GROUPS.flatMap((g) =>
  g.codes.map((c) => c.code),
);

export function hasPermission(granted: readonly string[], code: PermissionCode): boolean {
  return granted.includes(code);
}

export function hasAnyPermission(granted: readonly string[], codes: readonly PermissionCode[]): boolean {
  return codes.some((c) => granted.includes(c));
}
