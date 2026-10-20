import type { Context } from "hono";

/** Usuário autenticado resolvido a partir da sessão. Nunca vem do cliente. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  unitId: string | null;
  mustChangePassword: boolean;
  /** Códigos de permissão concedidos ao perfil. */
  permissions: Set<string>;
  /** Locais permitidos. Array vazio = sem restrição de local. */
  locationScope: string[];
  /** Tema escolhido pelo usuário; `null` = seguir o tema padrão do sistema. */
  theme: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: AuthUser | null;
    sessionToken: string | null;
    requestId: string;
  };
};

export type AppContext = Context<AppEnv>;
