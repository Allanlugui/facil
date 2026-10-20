import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { apiErrorMessage } from "../lib/api";
import { useSession } from "../lib/session";
import { Logo, useDarkSurface } from "../lib/brand";
import { Alert, Button, Field, Input } from "../lib/ui";

interface LocationState {
  from?: string;
}

export function LoginPage() {
  const { login, startupError, app } = useSession();
  const dark = useDarkSurface();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = (location.state as LocationState | null)?.from ?? "/";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(redirectTo, { replace: true });
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden px-4 py-10">
      {/* Papel de parede do login (D-28): foto da operação + véu escuro para o
          cartão branco ler bem em qualquer tela. */}
      <img
        src="/branding/login-bg.webp"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-slate-900/55" aria-hidden />

      <div className="relative w-full max-w-sm">
        <form
          onSubmit={submit}
          className="space-y-4 rounded-xl border border-slate-200 bg-surface p-5 shadow-xl"
        >
          <div className="flex flex-col items-center gap-1 pb-1">
            <Logo dark={dark} className="h-12 w-auto" />
            <p className="text-sm text-slate-600">Facil — Gestão de Facilities</p>
          </div>
          {startupError && !error ? <Alert tone="amber">{startupError}</Alert> : null}
          {error ? <Alert tone="red">{error}</Alert> : null}

          <Field label="E-mail" required htmlFor="email">
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="voce@empresa.com.br"
              autoComplete="username"
              autoFocus
              required
            />
          </Field>

          <Field label="Senha" required htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" className="w-full" loading={submitting}>
            Entrar
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-white/90">
          Esqueceu a senha?{" "}
          <Link to="/suporte?tipo=senha" className="font-medium text-white hover:underline">
            Clique aqui
          </Link>{" "}
          para falar com o suporte.{" "}
          <Link to="/setup" className="font-medium text-white hover:underline">
            Instalação inicial
          </Link>
        </p>
        <p className="mt-6 text-center text-[11px] text-white/80 [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]">
          © 2026 {app.companyName ?? "CorpServices Group"} · desenvolvimento assinado por Allan Luiz Silveira Lima
        </p>
      </div>
    </div>
  );
}
