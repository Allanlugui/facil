import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "../lib/session";
import { Logo, useDarkSurface } from "../lib/brand";
import { LoadingBlock, EmptyState, Button } from "../lib/ui";

/**
 * Guardas de navegação.
 *
 * Não são controle de acesso: o servidor continua autorizando tudo. Aqui só
 * evitamos abrir telas que o usuário não pode usar e mostramos o motivo.
 */

export function FullPageLoading() {
  const dark = useDarkSurface();
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6">
      <Logo dark={dark} className="h-11 w-auto" />
      <div className="w-full max-w-sm">
        <LoadingBlock label="Carregando o Facil..." />
      </div>
    </div>
  );
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === "loading") return <FullPageLoading />;
  if (status === "setup") return <Navigate to="/setup" replace />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

export function RequireAnonymous({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "loading") return <FullPageLoading />;
  if (status === "authenticated") return <Navigate to="/" replace />;
  if (status === "setup") return <Navigate to="/setup" replace />;
  return <>{children}</>;
}

export function PermissionGate({
  code,
  anyOf,
  children,
}: {
  code?: string;
  /** Basta possuir uma das permissões listadas (usado em páginas guarda-chuva). */
  anyOf?: readonly string[];
  children: ReactNode;
}) {
  const { can, canAny } = useSession();
  const allowed = code ? can(code) : anyOf ? canAny(anyOf) : true;
  if (allowed) return <>{children}</>;

  return (
    <div className="mx-auto max-w-lg py-10">
      <EmptyState
        title="Acesso restrito"
        description={
          <>
            Sua função não inclui esta área. Se precisar de acesso, solicite ao administrador uma
            alteração de perfil.
          </>
        }
        action={<Button variant="secondary" onClick={() => window.history.back()}>Voltar</Button>}
      />
    </div>
  );
}
