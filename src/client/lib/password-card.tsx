import { useState } from "react";
import { apiErrorMessage, apiPost } from "../lib/api";
import { useSession } from "./session";
import { Alert, Button, Field, Input, useToast } from "./ui";

/**
 * Troca de senha do próprio usuário.
 *
 * O servidor inválida as outras sessões ao trocar; a sessão atual e renovada,
 * por isso o usuário não precisa entrar de novo.
 */
export function PasswordChangeCard({ onChanged }: { onChanged?: () => void }) {
  const { user, markPasswordChanged } = useSession();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirm) {
      setError("A confirmação não corresponde a nova senha.");
      return;
    }
    if (newPassword.length < 10) {
      setError("A nova senha deve ter ao menos 10 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      await apiPost("/api/auth/change-password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      markPasswordChanged();
      toast.success("Senha alterada. As outras sessões foram encerradas.");
      onChanged?.();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {user?.mustChangePassword ? (
        <Alert tone="amber" title="Troca obrigatória">
          Sua senha foi definida por um administrador. Escolha uma senha nova para liberar as
          demais telas.
        </Alert>
      ) : null}
      {error ? <Alert tone="red">{error}</Alert> : null}

      <Field label="Senha atual" required htmlFor="currentPassword">
        <Input
          id="currentPassword"
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nova senha"
          required
          hint="Mínimo de 10 caracteres; não pode repetir o e-mail."
          htmlFor="newPassword"
        >
          <Input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="Confirmar nova senha" required htmlFor="confirmPassword">
          <Input
            id="confirmPassword"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          Alterar senha
        </Button>
      </div>
    </form>
  );
}
