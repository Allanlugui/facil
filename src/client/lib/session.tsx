import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AppInfo, LoginResponse, SessionUser } from "@shared/types";
import { apiErrorMessage, apiGet, apiPatch, apiPost } from "./api";
import { setActiveTimeZone } from "./format";
import { applyTheme, resolveTheme } from "./theme";

/**
 * Sessão da aplicação.
 *
 * A interface NUNCA decide autorização: ela apenas esconde o que o usuário não
 * pode fazer. Toda ação continua validada no servidor. Quando o backend devolve
 * 403 mesmo com a tela aberta (permissão trocada em outra aba, por exemplo), a
 * mensagem de erro aparece no lugar da ação.
 */

export type SessionStatus = "loading" | "setup" | "anonymous" | "authenticated";

interface SessionValue {
  status: SessionStatus;
  user: SessionUser | null;
  app: AppInfo;
  permissions: ReadonlySet<string>;
  mustChangePassword: boolean;
  can: (permission: string) => boolean;
  canAny: (permissions: readonly string[]) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  markPasswordChanged: () => void;
  reloadAppInfo: () => Promise<void>;
  /** Define o tema pessoal; `null` volta a seguir o tema padrão do sistema. */
  setThemePreference: (theme: string | null) => Promise<void>;
  startupError: string | null;
}

const DEFAULT_APP: AppInfo = { companyName: null, timezone: "America/Sao_Paulo", theme: "classico" };

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [app, setApp] = useState<AppInfo>(DEFAULT_APP);
  const [startupError, setStartupError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applySession = useCallback((session: { user: SessionUser; app: AppInfo }) => {
    setUser(session.user);
    setApp(session.app);
    setActiveTimeZone(session.app.timezone);
    setStatus("authenticated");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const setup = await apiGet<{ needsSetup: boolean; companyName: string | null; theme: string | null }>(
        "/api/auth/setup-status",
      );
      if (setup.needsSetup) {
        if (mounted.current) {
          setUser(null);
          setStatus("setup");
        }
        return;
      }
      if (mounted.current) {
        // Páginas públicas (login, suporte) usam o tema padrão do sistema
        // mesmo sem sessão; `/me` substitui logo abaixo quando houver login.
        setApp((current) => ({
          ...current,
          companyName: setup.companyName ?? current.companyName,
          theme: setup.theme ?? current.theme,
        }));
      }
      const session = await apiGet<LoginResponse>("/api/auth/me");
      if (mounted.current) applySession(session);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof Error && "status" in error && (error as { status: number }).status === 401) {
        setUser(null);
        setStatus("anonymous");
      } else if (error instanceof Error && "status" in error && (error as { status: number }).status === 403) {
        // Sessão válida, mas a senha precisa ser trocada: mantem o usuário logado.
        try {
          const session = await apiGet<LoginResponse>("/api/auth/me");
          if (mounted.current) applySession(session);
        } catch {
          if (mounted.current) {
            setUser(null);
            setStatus("anonymous");
          }
        }
      } else {
        setStartupError(apiErrorMessage(error));
        setStatus("anonymous");
      }
    }
  }, [applySession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Tema efetivo: preferência do usuário → padrão do sistema → Clássico.
  // O efeito cobre login, logout, troca de preferência e mudança do padrão.
  useEffect(() => {
    applyTheme(resolveTheme(user?.theme, app.theme));
  }, [user?.theme, app.theme]);

  const setThemePreference = useCallback(async (theme: string | null) => {
    await apiPatch("/api/auth/preferences", { theme });
    setUser((current) => (current ? { ...current, theme } : current));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await apiPost<LoginResponse>("/api/auth/login", { email, password });
      applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await apiPost("/api/auth/logout");
    } finally {
      setUser(null);
      setActiveTimeZone(DEFAULT_APP.timezone);
      setStatus("anonymous");
      // Recarrega os dados públicos (nome da empresa, tema do sistema) para a
      // tela de login seguir a configuração da instalação.
      void refresh();
    }
  }, [refresh]);

  const value = useMemo<SessionValue>(() => {
    const permissions = new Set(user?.permissions ?? []);
    return {
      status,
      user,
      app,
      permissions,
      mustChangePassword: user?.mustChangePassword ?? false,
      can: (permission: string) => permissions.has(permission),
      canAny: (codes: readonly string[]) => codes.some((code) => permissions.has(code)),
      login,
      logout,
      refresh,
      markPasswordChanged: () => {
        setUser((current) => (current ? { ...current, mustChangePassword: false } : current));
      },
      reloadAppInfo: async () => {
        const session = await apiGet<LoginResponse>("/api/auth/me");
        setApp(session.app);
        setActiveTimeZone(session.app.timezone);
      },
      setThemePreference,
      startupError,
    };
  }, [status, user, app, login, logout, refresh, setThemePreference, startupError]);

  return createElement(SessionContext.Provider, { value }, children);
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession precisa estar dentro de <SessionProvider>.");
  return context;
}

/** `true` somente se o usuário possui a permissão informada. */
export function useCan(permission: string): boolean {
  return useSession().can(permission);
}
