import { useSession } from "./session";
import { resolveTheme } from "./theme";

/**
 * Identidade visual (marca do cliente) aplicada no sistema.
 *
 * Os arquivos processados ficam em `src/client/public/branding/` e entram no
 * build junto com o aplicativo. A marca padrão (círculo preto com "Corp" em
 * branco e o ponto laranja) serve nas superfícies claras; o tema Noturno usa a
 * variante invertida (círculo branco, "Corp" preto), que é o que o manual de
 * marca prevê para fundo escuro. Nada aqui depende de CDN: tudo é servido pelo
 * próprio Worker.
 */
export function Logo({
  dark = false,
  className = "h-9 w-auto",
}: {
  dark?: boolean;
  className?: string;
}) {
  return (
    <img
      src={dark ? "/branding/logo-dark.webp" : "/branding/logo.webp"}
      alt="Logotipo da empresa"
      className={className}
      draggable={false}
    />
  );
}

/**
 * Verdadeiro quando o tema efetivo é o Noturno — aí as superfícies do sistema
 * (menu lateral, cartão do login, tela de carregamento) são escuras e o logo
 * precisa ser o de texto claro.
 */
export function useDarkSurface(): boolean {
  const { user, app } = useSession();
  return resolveTheme(user?.theme, app?.theme) === "escuro";
}
