import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useEscape } from "./hooks";

/**
 * Componentes de interface compartilhados.
 *
 * Todos os módulos usam estes blocos para manter a mesma linguagem visual:
 * mesma altura de campo, mesmo anel de foco, mesmos estados de carregamento e
 * erro. Nenhum componente aqui decide autorização.
 */

/* -------------------------------------------------------------------------- */
/* Tons                                                                       */
/* -------------------------------------------------------------------------- */

export type Tone = "slate" | "brand" | "blue" | "amber" | "red" | "violet" | "green";

const TONE_BADGE: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

const TONE_ALERT: Record<Tone, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  brand: "border-brand-200 bg-brand-50 text-brand-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  red: "border-red-200 bg-red-50 text-red-800",
  violet: "border-violet-200 bg-violet-50 text-violet-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
};

const TONE_DOT: Record<Tone, string> = {
  slate: "bg-slate-400",
  brand: "bg-brand-500",
  blue: "bg-blue-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  violet: "bg-violet-500",
  green: "bg-emerald-500",
};

export function Badge({
  tone = "slate",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex w-fit shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium leading-4 ring-1 ring-inset ${TONE_BADGE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "slate" }: { tone?: Tone }) {
  return <span className={`inline-block size-1.5 rounded-full ${TONE_DOT[tone]}`} aria-hidden />;
}

export function Alert({
  tone = "red",
  title,
  children,
  onDismiss,
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div role={tone === "red" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${TONE_ALERT[tone]}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {title ? <p className="font-semibold">{title}</p> : null}
          <div className={title ? "mt-0.5" : ""}>{children}</div>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded p-0.5 text-current opacity-60 hover:opacity-100"
            aria-label="Fechar aviso"
          >
            <CloseIcon className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Botões                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-700 text-white hover:bg-brand-800 focus-visible:outline-brand-700 disabled:bg-brand-700/60",
  secondary:
    "bg-surface text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50 focus-visible:outline-slate-400",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-400",
  subtle: "bg-slate-100 text-slate-800 hover:bg-slate-200 focus-visible:outline-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600 disabled:bg-red-600/60",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  const sizing = size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm";
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${sizing} ${BUTTON_VARIANT[variant]} ${className}`}
      {...rest}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Campos de formulário                                                       */
/* -------------------------------------------------------------------------- */

const FIELD_BASE =
  "block w-full rounded-lg border-0 bg-surface px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-600 disabled:bg-slate-50 disabled:text-slate-500";

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className = "", invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={`${FIELD_BASE} ${invalid ? "ring-red-400 focus:ring-red-600" : ""} ${className}`}
      {...rest}
    />
  );
}

export function Select({
  className = "",
  invalid,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select className={`${FIELD_BASE} ${invalid ? "ring-red-400" : ""} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({
  className = "",
  invalid,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={`${FIELD_BASE} ${invalid ? "ring-red-400 focus:ring-red-600" : ""} ${className}`}
      {...rest}
    />
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 rounded border-slate-300 text-brand-700 focus:ring-brand-600"
      />
      <span>
        <span className="font-medium text-slate-800">{label}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${FIELD_BASE} pl-8`}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Estrutura de página                                                        */
/* -------------------------------------------------------------------------- */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  padded = true,
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-surface shadow-sm ${className}`}>
      {title || actions ? (
        <header className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold text-slate-900">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "slate",
  alert = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        alert ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-surface"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint ? (
        <p className={`mt-1 flex items-center gap-1.5 text-xs ${alert ? "text-amber-900" : "text-slate-500"}`}>
          <Dot tone={tone} />
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description ? <p className="max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-4 py-6 text-sm text-slate-500">
      <Spinner />
      {label}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert tone="red" title="Não foi possível carregar">
      <div className="flex flex-col gap-2">
        <span>{message}</span>
        {onRetry ? (
          <div>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Tentar de novo
            </Button>
          </div>
        ) : null}
      </div>
    </Alert>
  );
}

/* -------------------------------------------------------------------------- */
/* Tabela                                                                     */
/* -------------------------------------------------------------------------- */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  /** Colunas secundarias somem no celular para não espremer a tabela. */
  hideOnMobile?: boolean;
}

export function Table<T>({
  columns,
  rows,
  keyOf,
  empty,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  keyOf: (row: T) => string;
  empty: ReactNode;
  onRowClick?: (row: T) => void;
}) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="table-scroll">
      <table className="w-full min-w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                  column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : ""
                } ${column.hideOnMobile ? "hidden md:table-cell" : ""} ${column.className ?? ""}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={keyOf(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "cursor-pointer transition-colors duration-150 hover:bg-slate-50" : "transition-colors duration-150 hover:bg-slate-50/60"}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-3 py-2.5 align-middle text-slate-700 ${
                    column.align === "right" ? "text-right tabular-nums" : column.align === "center" ? "text-center" : ""
                  } ${column.hideOnMobile ? "hidden md:table-cell" : ""} ${column.className ?? ""}`}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-slate-100 px-1 pt-3 text-sm text-slate-600">
      <span className="tabular-nums">
        {from}-{to} de {total}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Anterior
        </Button>
        <span className="px-1 text-xs text-slate-500">
          {page}/{pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima
        </Button>
      </div>
    </nav>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  // O contêiner rola na horizontal quando há muitas abas; o pb-px absorve o
  // deslocamento de -1px dos botões e evita a barra de rolagem vertical fantasma.
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 pb-px" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 ${
            value === tab.value
              ? "border-brand-700 text-brand-800"
              : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
          }`}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-xs tabular-nums text-slate-600">
              {tab.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Dialogo                                                                    */
/* -------------------------------------------------------------------------- */

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="facil-fade-in absolute inset-0 bg-overlay backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`facil-dialog-in relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl ${
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar"
          >
            <CloseIcon className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Avisos (toasts)                                                            */
/* -------------------------------------------------------------------------- */

interface Toast {
  id: number;
  tone: Tone;
  message: string;
  closing: boolean;
}

interface ToastValue {
  push: (message: string, tone?: Tone) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: Tone = "slate") => {
    const id = (counter.current += 1);
    setToasts((current) => [...current, { id, tone, message, closing: false }]);
    window.setTimeout(() => {
      // Marca a saída (120 ms) antes de remover: o aviso não "pisca" para fora.
      setToasts((current) =>
        current.map((toast) => (toast.id === id ? { ...toast, closing: true } : toast)),
      );
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 140);
    }, 4500);
  }, []);

  const value = useMemo<ToastValue>(
    () => ({
      push,
      success: (message: string) => push(message, "green"),
      error: (message: string) => push(message, "red"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`${toast.closing ? "facil-toast-out" : "facil-toast-in"} pointer-events-auto w-full max-w-sm rounded-lg border px-3 py-2 text-sm shadow-lg ${TONE_ALERT[toast.tone]}`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast precisa estar dentro de <ToastProvider>.");
  return context;
}

/* -------------------------------------------------------------------------- */
/* Ícones (traco 1.6, 20px)                                                   */
/* -------------------------------------------------------------------------- */

function icon(path: ReactNode, className = "size-5") {
  return (
    <svg
      className={`theme-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {path}
    </svg>
  );
}

export const CloseIcon = ({ className }: { className?: string }) =>
  icon(
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>,
    className,
  );

export const SearchIcon = ({ className }: { className?: string }) =>
  icon(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>,
    className,
  );

export const HelpIcon = () =>
  icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.2c-.7.3-1 .8-1 1.5v.4" />
      <path d="M12 16.8h.01" />
    </>,
  );

export const DashboardIcon = () =>
  icon(
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>,
  );

export const BoxIcon = () =>
  icon(
    <>
      <path d="m21 8-9-5-9 5v8l9 5 9-5Z" />
      <path d="m3 8 9 5 9-5" />
      <path d="M12 13v8" />
    </>,
  );

export const ArrowIcon = () =>
  icon(
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>,
  );

export const ArrowLeftIcon = ({ className = "size-4" }: { className?: string }) =>
  icon(
    <>
      <path d="M19 12H5" />
      <path d="m11 18-6-6 6-6" />
    </>,
    className,
  );

export const ChevronIcon = ({ className = "size-4" }: { className?: string }) =>
  icon(<path d="m9 6 6 6-6 6" />, className);

export const ClipboardIcon = () =>
  icon(
    <>
      <path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Z" />
      <path d="M8 6H6.5A1.5 1.5 0 0 0 5 7.5v12A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 17.5 6H16" />
      <path d="M9 13h6M9 17h4" />
    </>,
  );

export const TicketIcon = () =>
  icon(
    <>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4Z" />
      <path d="M10 6v12" strokeDasharray="2 3" />
    </>,
  );

export const WrenchIcon = () =>
  icon(
    <>
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.1 2.1-2.5-.6-.6-2.5Z" />
    </>,
  );

export const CartIcon = () =>
  icon(
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M3 3h2l2.4 12.2a1.5 1.5 0 0 0 1.5 1.3h7.9a1.5 1.5 0 0 0 1.5-1.2L21 7H6" />
    </>,
  );

export const ChartIcon = () =>
  icon(
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-5M12 16V8M16 16v-8" />
    </>,
  );

export const UsersIcon = () =>
  icon(
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.6A5.5 5.5 0 0 1 20.5 20" />
    </>,
  );

export const ShieldIcon = () =>
  icon(
    <>
      <path d="M12 3 5 6v6c0 4 3 6.8 7 9 4-2.2 7-5 7-9V6Z" />
      <path d="m9.5 12 1.8 1.8 3.4-3.6" />
    </>,
  );

export const GearIcon = () =>
  icon(
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>,
  );

export const BellIcon = ({ className }: { className?: string }) =>
  icon(
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 13 6 9Z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </>,
    className,
  );

export const BoxesIcon = () =>
  icon(
    <>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </>,
  );

export const RefreshIcon = ({ className }: { className?: string }) =>
  icon(
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4h-4" />
    </>,
    className,
  );

export const MenuIcon = ({ className = "size-5" }: { className?: string }) =>
  icon(
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>,
    className,
  );

export const LogoutIcon = ({ className = "size-5" }: { className?: string }) =>
  icon(
    <>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <path d="M15 8l4 4-4 4" />
      <path d="M19 12H9" />
    </>,
    className,
  );

export const PlusIcon = ({ className = "size-4" }: { className?: string }) =>
  icon(
    <>
      <path d="M12 5v14M5 12h14" />
    </>,
    className,
  );

export const DownloadIcon = ({ className = "size-4" }: { className?: string }) =>
  icon(
    <>
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </>,
    className,
  );

export const CheckIcon = ({ className = "size-4" }: { className?: string }) =>
  icon(<path d="m5 12 4.5 4.5L19 7" />, className);

export const PaletteIcon = () =>
  icon(
    <>
      <path d="M12 3a9 9 0 0 0 0 18c1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6h2.1A4.4 4.4 0 0 0 21 10.9C21 6.5 16.9 3 12 3Z" />
      <circle cx="7.6" cy="11.2" r="1" />
      <circle cx="10.3" cy="7.4" r="1" />
      <circle cx="15" cy="7.6" r="1" />
    </>,
  );

export const PaperclipIcon = ({ className = "size-5" }: { className?: string }) =>
  icon(
    <path d="M21 11.5 12.6 19.9a5.5 5.5 0 0 1-7.8-7.8l8.4-8.4a3.7 3.7 0 0 1 5.2 5.2l-8.4 8.4a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8" />,
    className,
  );

export const ChatIcon = ({ className = "size-5" }: { className?: string }) =>
  icon(<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />, className);

export const SendIcon = ({ className = "size-4" }: { className?: string }) =>
  icon(
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </>,
    className,
  );
