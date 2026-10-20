import { Link } from "react-router-dom";
import { EmptyState } from "../lib/ui";

/** Tela 404 exibida dentro do layout autenticado. */
export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg py-12">
      <EmptyState
        title="Página não encontrada"
        description={
          <>
            O endereço acessado não existe ou foi movido. Confira o link ou volte ao painel para
            continuar de onde parou.
          </>
        }
        action={
          <Link
            to="/"
            className="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800"
          >
            Ir para o painel
          </Link>
        }
      />
    </div>
  );
}
