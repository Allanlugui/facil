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
  /** Setor ao qual o usuário pertence (fluxo de compras v3). */
  departmentId: string | null;
  departmentName: string | null;
  /** true quando o setor do usuário é o setor de Compras. */
  departmentIsPurchasing: boolean;
  /** Setores que este usuário gerencia (pode haver mais de um). */
  managedDepartmentIds: string[];
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
