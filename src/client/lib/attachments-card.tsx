/**
 * Card de anexos genérico: lista, upload e remoção de arquivos de qualquer
 * entidade cadastrada no módulo de anexos (`/api/attachments`).
 *
 * Reaproveita o módulo de anexos existente (F-19/F-08): imagem é livre;
 * documento (PDF/planilha/texto) exige `attachments.documents` (gestão).
 * O servidor valida a entidade, a permissão e o tamanho novamente.
 */
"use client";

import { useRef, useState } from "react";
import { PERMISSIONS } from "@shared/permissions";
import { apiDelete, apiErrorMessage, apiGet, apiUpload } from "../lib/api";
import { useAsync } from "../lib/hooks";
import { formatBytes, formatDateTime } from "../lib/format";
import { useSession } from "../lib/session";
import {
  Button,
  Card,
  Dialog,
  ErrorBlock,
  LoadingBlock,
  useToast,
} from "../lib/ui";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/avif";
const ATTACHMENT_ACCEPT = `${IMAGE_ACCEPT},application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx`;

interface AttachmentItem {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedByName: string;
  createdAt: string;
  url: string;
}

export function AttachmentsCard({
  entityType,
  entityId,
  title = "Anexos",
  description,
}: {
  entityType: string;
  entityId: string;
  title?: string;
  description?: string;
}) {
  const { user, can } = useSession();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<AttachmentItem | null>(null);
  const [removeLoading, setRemoveLoading] = useState(false);

  const canAttachDocuments = can(PERMISSIONS.ATTACHMENTS_DOCUMENTS);

  const state = useAsync(
    () =>
      apiGet<{ items: AttachmentItem[] }>("/api/attachments", {
        entityType,
        entityId,
      }),
    [entityType, entityId],
  );

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", entityType);
      form.append("entityId", entityId);
      await apiUpload("/api/attachments", form);
      toast.success("Anexo enviado.");
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveLoading(true);
    try {
      await apiDelete(`/api/attachments/${removing.id}`);
      toast.success("Anexo removido.");
      setRemoving(null);
      state.reload();
    } catch (cause) {
      toast.error(apiErrorMessage(cause));
    } finally {
      setRemoveLoading(false);
    }
  };

  const items = state.data?.items ?? [];

  return (
    <Card
      title={title}
      description={
        description ??
        (canAttachDocuments
          ? "Fotos, PDFs e planilhas vinculados a esta ordem; tamanho e tipo são validados pelo servidor."
          : "Fotos vinculadas a esta ordem; documentos (PDF/planilha) são anexados pela gestão.")
      }
      actions={
        <>
          <input
            ref={inputRef}
            type="file"
            accept={canAttachDocuments ? ATTACHMENT_ACCEPT : IMAGE_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            loading={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {canAttachDocuments ? "Anexar arquivo" : "Anexar foto"}
          </Button>
        </>
      }
    >
      {state.loading && !state.data ? <LoadingBlock label="Carregando anexos..." /> : null}
      {state.error ? <ErrorBlock message={state.error} onRetry={state.reload} /> : null}
      {state.data && items.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum anexo neste registro.</p>
      ) : null}
      {items.length > 0 ? (
        <ul className="divide-y divide-slate-100">
          {items.map((item: AttachmentItem) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium text-brand-700 hover:underline"
                >
                  {item.filename}
                </a>
                <p className="text-xs text-slate-500">
                  {formatBytes(item.sizeBytes)} · {item.uploadedByName} · {formatDateTime(item.createdAt)}
                </p>
              </div>
              {user?.id === item.uploadedBy || can(PERMISSIONS.SETTINGS_MANAGE) ? (
                <Button variant="ghost" size="sm" onClick={() => setRemoving(item)}>
                  Remover
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {removing ? (
        <Dialog
          open
          title="Remover anexo"
          description={`O arquivo "${removing.filename}" será removido permanentemente.`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                Cancelar
              </Button>
              <Button variant="danger" loading={removeLoading} onClick={confirmRemove}>
                Remover
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">A remoção fica registrada na auditoria da ordem.</p>
        </Dialog>
      ) : null}
    </Card>
  );
}
