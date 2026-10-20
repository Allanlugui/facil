import type { Priority, PurchaseStatus } from "@shared/types";
import { fromMilli } from "@shared/types";

/**
 * Formatação para a interface.
 *
 * Regra: o backend sempre grava e devolve ISO-8601 em UTC; a conversão para o
 * fuso configurado (`company.timezone`) acontece aqui, na exibição, e nunca no
 * dado armazenado.
 */

const DEFAULT_TIMEZONE = "America/Sao_Paulo";

let activeTimeZone = DEFAULT_TIMEZONE;

export function setActiveTimeZone(timeZone: string | null | undefined): void {
  activeTimeZone = timeZone && timeZone.trim().length > 0 ? timeZone : DEFAULT_TIMEZONE;
}

export function activeTimeZoneValue(): string {
  return activeTimeZone;
}

const dateTimeFormat = () =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: activeTimeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const dateFormat = () =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: activeTimeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return dateTimeFormat().format(date);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso.includes("T") ? iso : `${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "-";
  return dateFormat().format(date);
}

/** Valor para `<input type="date">` no fuso configurado (YYYY-MM-DD). */
export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso.includes("T") ? iso : `${iso}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: activeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return parts;
}

/** Valor para `<input type="datetime-local">` no fuso configurado. */
export function toDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const formatted = new Intl.DateTimeFormat("sv-SE", {
    timeZone: activeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return formatted.replace(" ", "T");
}

/** Le um `datetime-local`/`date` local e devolve ISO UTC. */
export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/** Deslocamento do fuso configurado (ms) no instante informado. */
function zoneOffsetMillis(timestamp: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: activeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  const wallClockAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour") % 24,
    part("minute"),
    part("second"),
  );
  return wallClockAsUtc - timestamp;
}

/**
 * Data de calendario (YYYY-MM-DD) do fuso configurado no inicio ou no fim do
 * dia, devolvida como instante ISO UTC.
 */
export function toIsoDayBound(date: string, endOfDay: boolean): string {
  const [year, month, day] = date.split("-").map((part) => Number(part));
  const wallClockAsUtc = Date.UTC(
    year || 1970,
    (month || 1) - 1,
    day || 1,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  // Duas passagens resolvem o deslocamento mesmo em virada de horario de verao.
  const firstGuess = wallClockAsUtc - zoneOffsetMillis(wallClockAsUtc);
  return new Date(wallClockAsUtc - zoneOffsetMillis(firstGuess)).toISOString();
}

/**
 * Intervalo ISO completo de um filtro por datas do calendario: "de" comeca a
 * meia-noite e "ate" termina no ultimo milissegundo do dia, no fuso
 * configurado. Sem isso o valor so com a data comparava como texto com os
 * instantes ISO gravados e o filtro padrao "ate hoje" escondia o dia inteiro.
 */
export function dayRangeParams(from: string, to: string): { from?: string; to?: string } {
  return {
    from: from ? toIsoDayBound(from, false) : undefined,
    to: to ? toIsoDayBound(to, true) : undefined,
  };
}

/** Dia do calendário (YYYY-MM-DD) no fuso configurado -- usado em relatórios. */
export function todayIsoDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: activeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDaysIsoDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: activeTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatQuantity(milli: number | null | undefined, maxDecimals = 3): string {
  if (milli === null || milli === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(fromMilli(milli));
}

/** Escolhe a forma singular ou plural conforme a contagem (pt-BR). */
export function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

export function formatCurrencyFromCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPercent(value: number, decimals = 0): string {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)}%`;
}

/** "há 3 dias", "em 2 horas" -- usado em prazos e pendências. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, "minute");
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, "hour");
  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 30) return formatter.format(diffDays, "day");
  return formatDate(iso);
}

/** Normaliza texto para busca local (sem acento, minusculo). */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export const PRIORITY_TONE: Record<Priority, "slate" | "blue" | "amber" | "red"> = {
  low: "slate",
  normal: "blue",
  high: "amber",
  urgent: "red",
};

/** Tons de situação das solicitações de compra (mesma escala usada na lista). */
export const PURCHASE_STATUS_TONE: Record<
  PurchaseStatus,
  "slate" | "amber" | "blue" | "red" | "violet" | "brand" | "green"
> = {
  draft: "slate",
  pending_approval: "amber",
  approved: "blue",
  rejected: "red",
  quoting: "violet",
  quote_returned: "amber",
  quote_approved: "violet",
  purchasing: "violet",
  ordered: "brand",
  partially_received: "amber",
  received: "green",
  cancelled: "red",
};

export function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
