import { useState } from "react";
import { Navigate } from "react-router-dom";
import { apiErrorMessage, fieldErrors, apiPost } from "../lib/api";
import { useSession } from "../lib/session";
import { Alert, Button, Checkbox, Field, Input, Spinner } from "../lib/ui";
import type { SessionUser } from "@shared/types";

/**
 * Instalação inicial: cria o administrador, o nome da empresa e (opcionalmente)
 * a estrutura mínima com um almoxarifado central.
 */
export function SetupPage() {
  const { status, refresh } = useSession();
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [createStarterStructure, setCreateStarterStructure] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (status === "anonymous") return <Navigate to="/login" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setErrors({});
    try {
      await apiPost<{ user: SessionUser }>("/api/auth/setup", {
        companyName,
        name,
        email,
        password,
        createStarterStructure,
      });
      // `/me` devolve também o nome da empresa e o fuso configurado.
      await refresh();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setErrors(fieldErrors(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-700 text-lg font-bold text-white">
            F
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Instalação do Facil</h1>
            <p className="text-sm text-slate-600">
              Primeiro acesso: crie o administrador do sistema.
            </p>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-slate-200 bg-surface p-5 shadow-sm"
        >
          {error ? <Alert tone="red">{error}</Alert> : null}

          <Field label="Nome da empresa" required error={errors.companyName} htmlFor="companyName">
            <Input
              id="companyName"
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
              placeholder="Ex.: Condomínio Central"
              autoComplete="organization"
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do administrador" required error={errors.name} htmlFor="name">
              <Input
                id="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ex.: Maria Silva"
                autoComplete="name"
                required
              />
            </Field>
            <Field label="E-mail de acesso" required error={errors.email} htmlFor="email">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="voce@empresa.com.br"
                autoComplete="email"
                required
              />
            </Field>
          </div>

          <Field
            label="Senha"
            required
            error={errors.password}
            hint="Mínimo de 10 caracteres; não pode conter o trecho antes do @ do e-mail."
            htmlFor="password"
          >
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <Checkbox
            label="Criar estrutura inicial"
            hint="Cria a unidade matriz e um Almoxarifado Central para começar a operar; pode ser renomeado depois."
            checked={createStarterStructure}
            onChange={setCreateStarterStructure}
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="submit" loading={submitting}>
              Concluir instalação
            </Button>
          </div>

          <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
            Todos os horários são gravados pelo servidor e exibidos no fuso
            America/Sao_Paulo (ajustável em Configurações).
          </p>
        </form>

        <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          {submitting ? <Spinner className="size-3" /> : null}
          Esta tela aparece apenas uma vez: depois que existir um usuário, o acesso passa a ser
          feito pela tela de login.
        </p>
      </div>
    </div>
  );
}
