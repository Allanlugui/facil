import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { apiErrorMessage } from "./api";
import {
  calendarDay,
  formatBytes,
  formatDayHeading,
  formatTime,
  plural,
} from "./format";
import {
  Alert,
  Button,
  ChatIcon,
  CloseIcon,
  PaperclipIcon,
  SendIcon,
  Spinner,
  Textarea,
  useToast,
} from "./ui";

/**
 * Conversa do suporte (acompanhamento público e atendimento interno).
 *
 * Duas regras guiam este módulo:
 *   1. a mensagem enviada aparece na hora, antes da resposta do servidor
 *      (`useOptimisticChat` remove a bolha provisória se o envio falhar);
 *   2. o histórico rola dentro de um painel próprio, com o campo de escrita
 *      sempre visível e o rolamento automático só quando o leitor está no fim.
 */

export interface ChatAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface SupportMessage {
  id: string;
  authorType: "requester" | "staff";
  authorName: string;
  body: string;
  createdAt: string;
  attachments: ChatAttachment[];
}

/** Limites de upload exibidos no composer; o servidor sempre revalida. */
export interface ChatLimits {
  maxFilesPerMessage: number;
  maxBytesPerFile: number;
  maxBytesPerMessage: number;
}

export interface ChatMessageView extends SupportMessage {
  /** Mensagem provisória: já apareceu, mas o POST ainda não confirmou. */
  sending?: boolean;
}

const EMPTY_MESSAGES: SupportMessage[] = [];

/**
 * Mantém as mensagens enviadas nesta sessão visíveis enquanto o servidor
 * confirma. A resposta do POST traz o id definitivo; quando a próxima leitura
 * já contém esse id, a cópia local é descartada (sem duplicar a bolha).
 */
export function useOptimisticChat({
  messages,
  authorType,
  authorName,
  send,
}: {
  messages: SupportMessage[];
  authorType: "requester" | "staff";
  authorName: string;
  send: (text: string, files: File[]) => Promise<{ id: string }>;
}) {
  const [pending, setPending] = useState<ChatMessageView[]>([]);
  const counter = useRef(0);

  useEffect(() => {
    if (pending.length === 0) return;
    const serverIds = new Set(messages.map((message) => message.id));
    if (pending.some((message) => serverIds.has(message.id))) {
      setPending((current) => current.filter((message) => !serverIds.has(message.id)));
    }
  }, [messages, pending]);

  const sendMessage = useCallback(
    async (text: string, files: File[]) => {
      const tempId = `pending-${Date.now()}-${counter.current++}`;
      const optimistic: ChatMessageView = {
        id: tempId,
        authorType,
        authorName,
        body: text,
        createdAt: new Date().toISOString(),
        attachments: files.map((file, index) => ({
          id: `${tempId}-${index}`,
          filename: file.name || "arquivo",
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          url: "",
        })),
        sending: true,
      };
      setPending((current) => [...current, optimistic]);
      try {
        const created = await send(text, files);
        setPending((current) =>
          current.map((message) =>
            message.id === tempId ? { ...message, id: created.id, sending: false } : message,
          ),
        );
      } catch (error) {
        setPending((current) => current.filter((message) => message.id !== tempId));
        throw error;
      }
    },
    [authorName, authorType, send],
  );

  const merged = useMemo(() => {
    if (pending.length === 0) return messages;
    const serverIds = new Set(messages.map((message) => message.id));
    return [...messages, ...pending.filter((message) => !serverIds.has(message.id))];
  }, [messages, pending]);

  return { messages: merged, sendMessage };
}

/* -------------------------------------------------------------------------- */
/* Bolhas e anexos                                                            */
/* -------------------------------------------------------------------------- */

function fileBadgeLabel(filename: string): string {
  const extension = filename.split(".").pop() ?? "";
  return extension.length > 0 && extension.length <= 4 ? extension.toUpperCase() : "ARQ";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

function ChatAttachments({
  attachments,
  mine,
  onRemove,
}: {
  attachments: ChatAttachment[];
  mine: boolean;
  onRemove?: (attachment: ChatAttachment) => void;
}) {
  const images = attachments.filter(
    (attachment) => attachment.mimeType.startsWith("image/") && attachment.url.length > 0,
  );
  const files = attachments.filter((attachment) => !images.includes(attachment));

  return (
    <div className="mt-2 space-y-1.5">
      {images.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {images.map((attachment) => (
            <a
              key={attachment.id}
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              title={attachment.filename}
              className="block overflow-hidden rounded-lg ring-1 ring-black/10 transition hover:opacity-90"
            >
              <img
                src={attachment.url}
                alt={attachment.filename}
                loading="lazy"
                className="size-24 object-cover"
              />
            </a>
          ))}
        </div>
      ) : null}

      {files.map((attachment) => {
        const uploading = attachment.url.length === 0;
        const nameClass = "block max-w-[12rem] truncate text-xs font-medium underline-offset-2";
        return (
          <div
            key={attachment.id}
            className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
              mine ? "bg-white/10" : "bg-slate-50"
            }`}
          >
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-md text-[9px] font-bold uppercase ${
                mine ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
              }`}
            >
              {fileBadgeLabel(attachment.filename)}
            </span>
            <span className="min-w-0">
              {uploading ? (
                <span className={`${nameClass} ${mine ? "text-white" : "text-slate-700"}`}>
                  {attachment.filename}
                </span>
              ) : (
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`${nameClass} hover:underline ${mine ? "text-white" : "text-brand-700"}`}
                >
                  {attachment.filename}
                </a>
              )}
              <span className={`block text-[11px] ${mine ? "text-brand-50/80" : "text-slate-400"}`}>
                {formatBytes(attachment.sizeBytes)}
                {uploading ? " · anexando" : ""}
              </span>
            </span>
            {onRemove && !uploading ? (
              <button
                type="button"
                onClick={() => onRemove(attachment)}
                title="Remover anexo"
                className={`ml-auto inline-flex items-center rounded p-1 transition ${
                  mine
                    ? "text-white/70 hover:bg-white/15 hover:text-white"
                    : "text-slate-400 hover:bg-slate-100 hover:text-red-600"
                }`}
              >
                <CloseIcon className="size-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function MessageBubble({
  message,
  mine,
  compact = false,
  onRemoveAttachment,
}: {
  message: ChatMessageView;
  mine: boolean;
  compact?: boolean;
  onRemoveAttachment?: (attachment: ChatAttachment) => void;
}) {
  const { authorName, body, createdAt, attachments, sending } = message;

  return (
    <div
      className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"} ${
        compact ? "mt-1" : "mt-4"
      }`}
    >
      {!mine ? (
        compact ? (
          <span className="w-7 shrink-0" aria-hidden />
        ) : (
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-800"
            aria-hidden
          >
            {initials(authorName)}
          </span>
        )
      ) : null}

      <div className={`flex min-w-0 max-w-[82%] flex-col ${mine ? "items-end" : "items-start"}`}>
        {!compact ? (
          <p className="mb-1 flex items-center gap-1 px-1 text-[11px] text-slate-500">
            <span className="font-medium text-slate-600">{mine ? "Você" : authorName}</span>
            <span aria-hidden>·</span>
            {sending ? (
              <span className="inline-flex items-center gap-1">
                <Spinner className="size-2.5" /> enviando
              </span>
            ) : (
              <time dateTime={createdAt} className="tabular-nums">
                {formatTime(createdAt)}
              </time>
            )}
          </p>
        ) : null}

        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed shadow-sm ${
            mine
              ? "rounded-br-md bg-brand-700 text-white"
              : "rounded-bl-md border border-slate-200 bg-surface text-slate-700"
          }`}
        >
          {body ? <p className="whitespace-pre-line break-words">{body}</p> : null}
          {attachments.length > 0 ? (
            <ChatAttachments attachments={attachments} mine={mine} onRemove={onRemoveAttachment} />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Painel da conversa                                                         */
/* -------------------------------------------------------------------------- */

function DaySeparator({ at }: { at: string }) {
  return (
    <div className="my-3 flex items-center gap-2" role="separator">
      <span className="h-px flex-1 bg-slate-200" />
      <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 ring-1 ring-slate-200">
        {formatDayHeading(at)}
      </span>
      <span className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

export function ChatThread({
  messages,
  isMine,
  onRemoveAttachment,
  title = "Conversa",
  subtitle,
  emptyText = "Nenhuma mensagem ainda.",
  children,
}: {
  messages: ChatMessageView[];
  isMine: (message: ChatMessageView) => boolean;
  onRemoveAttachment?: (attachment: ChatAttachment) => void;
  title?: string;
  subtitle?: string;
  emptyText?: string;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const previousCount = useRef(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const first = previousCount.current === 0;
    const last = messages[messages.length - 1];
    if (first || atBottom.current || (last && isMine(last))) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      element.scrollTo({
        top: element.scrollHeight,
        behavior: first || reduce ? "auto" : "smooth",
      });
      atBottom.current = true;
    }
    previousCount.current = messages.length;
  }, [messages, isMine]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    atBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  };

  const countLabel = `${messages.length} ${plural(messages.length, "mensagem", "mensagens")}`;
  let lastDay = "";

  return (
    <section className="self-start overflow-hidden rounded-2xl border border-slate-200 bg-surface shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
            <ChatIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
            <p className="truncate text-xs text-slate-500">{subtitle ?? countLabel}</p>
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label={title}
        className="h-[clamp(320px,52vh,480px)] overflow-y-auto overscroll-contain bg-slate-50 px-3 sm:px-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <span className="grid size-10 place-items-center rounded-full bg-surface text-slate-400 ring-1 ring-slate-200">
              <ChatIcon />
            </span>
            <p className="text-sm text-slate-500">{emptyText}</p>
          </div>
        ) : (
          <div className="flex min-h-full flex-col justify-end py-4">
            {messages.map((message, index) => {
              const day = calendarDay(message.createdAt);
              const showDay = day !== lastDay;
              lastDay = day;
              const previous = index > 0 ? messages[index - 1] : null;
              const compact =
                previous !== null &&
                previous !== undefined &&
                !message.sending &&
                previous.authorType === message.authorType &&
                previous.authorName === message.authorName &&
                calendarDay(previous.createdAt) === day &&
                new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() <
                  5 * 60_000;
              return (
                <Fragment key={message.id}>
                  {showDay ? <DaySeparator at={message.createdAt} /> : null}
                  <MessageBubble
                    message={message}
                    mine={isMine(message)}
                    compact={compact}
                    onRemoveAttachment={onRemoveAttachment}
                  />
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 bg-surface p-3 sm:p-4">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Composer                                                                   */
/* -------------------------------------------------------------------------- */

const ATTACHMENT_ACCEPT =
  "image/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx";

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

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    // No celular o Enter quebra linha; no desktop, envia (como em um chat).
    if (window.matchMedia("(pointer: coarse)").matches) return;
    event.preventDefault();
    void send();
  };

  const totalLabel =
    limits.maxBytesPerMessage === limits.maxBytesPerFile
      ? `${formatBytes(limits.maxBytesPerFile)} por arquivo`
      : `${formatBytes(limits.maxBytesPerFile)} por arquivo (somando ${formatBytes(limits.maxBytesPerMessage)} por mensagem)`;

  return (
    <div className="space-y-2">
      {error ? <Alert tone="red">{error}</Alert> : null}

      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-2 py-1.5 text-xs text-slate-600 shadow-sm"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded bg-slate-100 text-[9px] font-bold uppercase text-slate-500">
                {fileBadgeLabel(file.name || "arquivo")}
              </span>
              <span className="max-w-[11rem] truncate font-medium text-slate-700">
                {file.name || "arquivo"}
              </span>
              <span className="text-slate-400">{formatBytes(file.size)}</span>
              <button
                type="button"
                title="Remover"
                onClick={() => setFiles((current) => current.filter((_, position) => position !== index))}
                className="inline-flex items-center text-slate-400 transition hover:text-red-600"
              >
                <CloseIcon className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(event) => pickFiles(event.target.files)}
      />

      <Textarea
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={2000}
        className="resize-none"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<PaperclipIcon className="size-3.5" />}
            onClick={() => inputRef.current?.click()}
            title="Anexar arquivos"
          >
            Anexar
          </Button>
          <span className="hidden text-[11px] text-slate-400 sm:inline">
            Enter envia · Shift+Enter quebra linha
          </span>
          {text.length > 1800 ? (
            <span className="text-[11px] tabular-nums text-amber-700">{text.length}/2000</span>
          ) : null}
        </div>
        <Button
          size="sm"
          onClick={send}
          loading={sending}
          disabled={!canSend}
          icon={<SendIcon className="size-3.5" />}
        >
          Enviar
        </Button>
      </div>

      <p className="text-[11px] text-slate-500">
        {hint ? `${hint} ` : ""}
        {limits.maxFilesPerMessage} arquivo(s) por mensagem · {totalLabel}.
      </p>
    </div>
  );
}

export { EMPTY_MESSAGES };
