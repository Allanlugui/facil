/**
 * Constantes compartilhadas do módulo de Patrimônio.
 *
 * As mesmas listas são usadas no worker (validação Zod) e no cliente
 * (selects, badges e filtros). Manter em um único lugar evita drift.
 */

export const ASSET_STATUSES = [
  "in_use",
  "in_stock",
  "maintenance",
  "loaned",
  "retired",
  "disposed",
  "lost",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Readonly<Record<AssetStatus, string>> = {
  in_use: "Em uso",
  in_stock: "Em estoque",
  maintenance: "Em manutenção",
  loaned: "Emprestado",
  retired: "Baixado",
  disposed: "Descartado",
  lost: "Extraviado",
};

export const ASSET_STATUS_TONES: Readonly<Record<AssetStatus, "green" | "blue" | "amber" | "violet" | "slate" | "red" | "orange">> = {
  in_use: "green",
  in_stock: "blue",
  maintenance: "amber",
  loaned: "violet",
  retired: "slate",
  disposed: "slate",
  lost: "red",
};

export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "unserviceable"] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const ASSET_CONDITION_LABELS: Readonly<Record<AssetCondition, string>> = {
  new: "Novo",
  good: "Bom",
  fair: "Regular",
  poor: "Ruim",
  unserviceable: "Inservível",
};

export const ASSET_CRITICALITIES = ["low", "normal", "high", "critical"] as const;
export type AssetCriticality = (typeof ASSET_CRITICALITIES)[number];

export const ASSET_CRITICALITY_LABELS: Readonly<Record<AssetCriticality, string>> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  critical: "Crítica",
};

export const ASSET_TERMINAL_STATUSES: ReadonlyArray<AssetStatus> = ["retired", "disposed"];

export const ASSET_MOVEMENT_TYPES = [
  "acquisition",
  "transfer",
  "assignment",
  "status_change",
  "condition_change",
  "maintenance",
  "disposal",
  "inventory",
] as const;
export type AssetMovementType = (typeof ASSET_MOVEMENT_TYPES)[number];

export const ASSET_MOVEMENT_TYPE_LABELS: Readonly<Record<AssetMovementType, string>> = {
  acquisition: "Aquisição",
  transfer: "Transferência",
  assignment: "Atribuição",
  status_change: "Mudança de situação",
  condition_change: "Mudança de condição",
  maintenance: "Manutenção",
  disposal: "Baixa/descarte",
  inventory: "Inventário",
};

/** Statuses que aparecem no painel de resumo (exclui terminal). */
export const ASSET_ACTIVE_STATUSES: ReadonlyArray<AssetStatus> = [
  "in_use",
  "in_stock",
  "maintenance",
  "loaned",
  "lost",
];