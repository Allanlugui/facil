import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Dialog } from "./ui";

/**
 * Captura de foto pela câmera do aparelho (F-07).
 *
 * Na execução de uma ordem de serviço a evidência precisa ser capturada na
 * hora: este diálogo abre a câmera (`getUserMedia`), mostra a imagem ao vivo e
 * converte o quadro atual em JPEG. Não existe caminho para escolher um arquivo
 * do aparelho — o navegador não consegue provar criptograficamente a origem da
 * imagem, mas a interface bloqueia o fluxo alternativo. O horário da captura
 * vai no nome do arquivo e no registro do anexo (criado em seguida), junto com
 * a etapa de origem (`entityType`/`entityId`).
 */
export function CameraCaptureDialog({
  open,
  busy = false,
  onClose,
  onCapture,
}: {
  open: boolean;
  busy?: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      stopStream();
      return;
    }
    let cancelled = false;
    setError(null);
    setReady(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "Este navegador não oferece câmera para captura no aplicativo. Abra a ordem em um celular ou em um navegador atualizado.",
      );
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        setReady(true);
      })
      .catch((cause: unknown) => {
        const name = cause instanceof Error ? cause.name : "";
        setError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "Permissão de câmera negada. Autorize o acesso à câmera nas configurações do navegador para registrar a foto da execução."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "Nenhuma câmera disponível neste aparelho — registre a foto pelo celular."
              : "Não foi possível abrir a câmera neste aparelho.",
        );
      });

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, stopStream]);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Não foi possível processar a captura neste navegador.");
      return;
    }
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) {
      setError("Não foi possível gerar o arquivo da foto.");
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    onCapture(new File([blob], `foto-${stamp}.jpg`, { type: "image/jpeg" }));
  };

  return (
    <Dialog
      open={open}
      title="Tirar foto da etapa"
      description="A imagem é capturada agora, pela câmera do aparelho, e anexada à etapa da execução."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button loading={busy} disabled={!ready || busy} onClick={() => void capture()}>
            Capturar foto
          </Button>
        </>
      }
    >
      {error ? (
        <Alert tone="amber" title="Câmera indisponível">
          {error}
        </Alert>
      ) : (
        <div className="overflow-hidden rounded-xl bg-slate-900">
          <video ref={videoRef} playsInline muted autoPlay className="aspect-video w-full object-cover" />
        </div>
      )}
      {!error && !ready ? <p className="mt-2 text-xs text-slate-500">Abrindo a câmera…</p> : null}
    </Dialog>
  );
}
