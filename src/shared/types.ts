/**
 * Tipos compartilhados entre backend e frontend.
 *
 * Convenção de quantidades: a API trafega quantidades como NÚMERO decimal
 * (ex: 12.5). Internamente o banco armazena inteiros em milli-unidades
 * (1000 = 1 unidade de consumo) para garantir aritmética exata e ausência de
 * deriva de ponto flutuante nos saldos.
 */

export type Id = string;
export type IsoDateTime = string;
export type IsoDate = string;

/* -------------------------------------------------------------------------- */
/* Enumerações de dominio com rótulos em pt-BR                                */
/* -------------------------------------------------------------------------- */

export const MOVEMENT_TYPES = [
  "purchase_receipt",
  "issue",
  "transfer",
  "replenish",
  "consumption",
  "maintenance_use",
  "return",
  "loss",
  "inventory_adjust",
  "correction",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  purchase_receipt: "Entrada por recebimento de compra",
  issue: "Saída definitiva",
  transfer: "Transferência entre locais",
  replenish: "Reposição de ambiente",
  consumption: "Consumo operacional",
  maintenance_use: "Consumo em manutenção",
  return: "Devolução ao estoque",
  loss: "Perda ou descarte",
  inventory_adjust: "Ajuste de inventário",
  correction: "Lançamento corretivo",
};

export const TICKET_STATUS = [
  "open",
  "in_progress",
  "waiting_material",
  "resolved",
  "converted",
  "cancelled",
] as const;
export type TicketStatus = (typeof TICKET_STATUS)[number];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Aberto",
  in_progress: "Em andamento",
  waiting_material: "Aguardando material",
  resolved: "Resolvido",
  converted: "Convertido em OS",
  cancelled: "Cancelado",
};

export const WORK_ORDER_STATUS = [
  "open",
  "planned",
  "in_progress",
  "waiting_material",
  "done",
  "cancelled",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUS)[number];

export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  open: "Aberta",
  planned: "Planejada",
  in_progress: "Em andamento",
  waiting_material: "Aguardando material",
  done: "Concluída",
  cancelled: "Cancelada",
};

/** Transições permitidas de ordem de serviço (validadas no backend). */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  open: ["planned", "in_progress", "waiting_material", "cancelled"],
  planned: ["in_progress", "waiting_material", "cancelled"],
  in_progress: ["waiting_material", "done", "cancelled"],
  waiting_material: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

/** Transições permitidas de ticket (validadas no backend). */
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ["in_progress", "waiting_material", "resolved", "converted", "cancelled"],
  in_progress: ["waiting_material", "resolved", "converted", "cancelled"],
  waiting_material: ["in_progress", "resolved", "converted", "cancelled"],
  resolved: [],
  converted: [],
  cancelled: [],
};

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export const PURCHASE_STATUS = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "quoting",
  "quote_returned",
  "quote_approved",
  "purchasing",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUS)[number];

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  draft: "Rascunho",
  pending_approval: "Pendente de aprovação",
  approved: "Aprovada",
  rejected: "Rejeitada",
  quoting: "Em cotação",
  quote_returned: "Cotação retornada",
  quote_approved: "Cotação aprovada",
  purchasing: "Em compra",
  ordered: "Pedido realizado",
  partially_received: "Parcialmente recebido",
  received: "Recebido integralmente",
  cancelled: "Cancelado",
};

/**
 * Divisão definida pelo gestor na análise (F-01): o item segue como compra
 * direta ou passa pelo ciclo de cotação com propostas de fornecedor (F-02).
 */
export const PURCHASE_ITEM_MODE = ["direct", "quote"] as const;
export type PurchaseItemMode = (typeof PURCHASE_ITEM_MODE)[number];

export const PURCHASE_ITEM_MODE_LABEL: Record<PurchaseItemMode, string> = {
  direct: "Compra direta",
  quote: "Cotação",
};

export const PURCHASE_ITEM_STATUS = [
  "pending",
  "approved",
  "rejected",
  "ordered",
  "partially_received",
  "received",
  "cancelled",
] as const;
export type PurchaseItemStatus = (typeof PURCHASE_ITEM_STATUS)[number];

export const PURCHASE_ITEM_STATUS_LABEL: Record<PurchaseItemStatus, string> = {
  pending: "Pendente",
  approved: "Aprovado",
  rejected: "Rejeitado",
  ordered: "Pedido realizado",
  partially_received: "Parcialmente recebido",
  received: "Recebido",
  cancelled: "Cancelado",
};

/**
 * Linha do tempo da solicitação de compra (F-05): rotulos pt-BR para as acoes
 * registradas na auditoria (`audit_log.action`). Acoes desconhecidas aparecem
 * como estao -- a linha do tempo nunca esconde um evento.
 */
export const PURCHASE_EVENT_LABEL: Record<string, string> = {
  "purchase_request.create": "Solicitação criada",
  "purchase_request.auto_approved": "Solicitação criada e aprovada automaticamente",
  "purchase_request.update": "Solicitação editada",
  "purchase_request.submit": "Enviada para aprovação",
  "purchase_request.approved": "Aprovada",
  "purchase_request.rejected": "Recusada",
  "purchase_request.quoting": "Encaminhada para cotação",
  "purchase_request.purchasing": "Marcada em compra",
  "purchase_request.order": "Pedido registrado",
  "purchase_request.cancel": "Solicitação cancelada",
  "purchase_quote.create": "Proposta registrada",
  "purchase_quote.update": "Proposta atualizada",
  "purchase_quote.return": "Cotação devolvida para aprovação",
  "purchase_quote.approve": "Proposta aprovada",
  "purchase_quote.reject": "Proposta recusada",
  "purchase_receipt.confirm": "Recebimento confirmado",
};

export const INVENTORY_STATUS = ["open", "closed", "cancelled"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUS)[number];

export const INVENTORY_STATUS_LABEL: Record<InventoryStatus, string> = {
  open: "Aberto",
  closed: "Encerrado",
  cancelled: "Cancelado",
};

export const INVENTORY_ITEM_STATUS = ["pending", "counted", "divergent", "adjusted", "skipped"] as const;
export type InventoryItemStatus = (typeof INVENTORY_ITEM_STATUS)[number];

export const INVENTORY_ITEM_STATUS_LABEL: Record<InventoryItemStatus, string> = {
  pending: "Pendente de contagem",
  counted: "Inventariado",
  divergent: "Com divergência",
  adjusted: "Ajustado",
  skipped: "Dispensado",
};

export const CONSUMPTION_STATUS = ["draft", "registered", "cancelled"] as const;
export type ConsumptionStatus = (typeof CONSUMPTION_STATUS)[number];

export const CONSUMPTION_STATUS_LABEL: Record<ConsumptionStatus, string> = {
  draft: "Rascunho",
  registered: "Registrado",
  cancelled: "Cancelado",
};

/* -------------------------------------------------------------------------- */
/* DTOs                                                                       */
/* -------------------------------------------------------------------------- */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface SessionUser {
  id: Id;
  name: string;
  email: string;
  roleId: Id;
  roleCode: string;
  roleName: string;
  unitId: Id | null;
  mustChangePassword: boolean;
  permissions: string[];
  locationScope: Id[];
  /** Tema escolhido pelo usuário; `null` = seguir o tema padrão do sistema. */
  theme: string | null;
}

/**
 * Dados de apresentação da instalação: usados pela interface para exibir o nome
 * da empresa e formatar datas no fuso configurado (`settings.company.timezone`),
 * além do tema padrão do sistema (`settings['ui.theme']`).
 */
export interface AppInfo {
  companyName: string | null;
  timezone: string;
  theme: string;
}

export interface LoginResponse {
  user: SessionUser;
  app: AppInfo;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* -------------------------------------------------------------------------- */
/* Utilitarios de conversão milli-unidade <-> decimal                         */
/* -------------------------------------------------------------------------- */

export const MILLI = 1000;

/** Converte um decimal (ex: 12.5) em milli-unidades (12500). */
export function toMilli(value: number): number {
  return Math.round(value * MILLI);
}

/** Converte milli-unidades em decimal. */
export function fromMilli(value: number): number {
  return value / MILLI;
}

/**
 * Formata milli-unidades para exibição usando virgula decimal,
 * sem zeros a direita desnecessarios.
 */
export function formatQty(milli: number, options?: { maxDecimals?: number }): string {
  const maxDecimals = options?.maxDecimals ?? 3;
  const value = fromMilli(milli);
  const fixed = value.toFixed(maxDecimals);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return (trimmed === "" ? "0" : trimmed).replace(".", ",");
}

/** Le uma quantidade em formato brasileiro/americano e devolve milli-unidades. */
export function parseQtyToMilli(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) return null;
    return toMilli(input);
  }
  const raw = String(input).trim().replace(/\s/g, "");
  if (raw === "") return null;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return toMilli(value);
}
