import { PERMISSIONS } from "@shared/permissions";
import type { AuthUser } from "./types";
import { forbidden } from "./errors";

/** Permissões operacionais dão visão da fila inteira, além de `view_all`. */
const FULL_VIEW_PERMISSIONS = [
  PERMISSIONS.PURCHASES_VIEW_ALL,
  PERMISSIONS.PURCHASES_APPROVE,
  PERMISSIONS.PURCHASES_APPROVE_DEPARTMENT,
  PERMISSIONS.PURCHASES_AUTHORIZE,
  PERMISSIONS.PURCHASES_AWARD,
  PERMISSIONS.PURCHASES_DIRECT,
  PERMISSIONS.PURCHASES_ORDER,
  PERMISSIONS.PURCHASES_RECEIVE,
] as const;

export function purchaseSeesAll(user: AuthUser): boolean {
  // Todo membro do setor de Compras enxerga a fila completa, mesmo sem uma
  // permissão operacional específica.
  if (user.departmentIsPurchasing) return true;
  return FULL_VIEW_PERMISSIONS.some((permission) => user.permissions.has(permission));
}

/**
 * Filtro de visibilidade aplicado na lista, no painel e no detalhe.
 * `locationScope` continua valendo mesmo para quem vê a fila inteira.
 *
 * No fluxo v3, o gestor vê as solicitações dos setores que gerencia (um gestor
 * pode responder por vários setores) e o solicitante vê as suas.
 */
export function purchaseVisibility(
  user: AuthUser,
  alias = "r",
): { clause: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];

  if (user.locationScope.length > 0) {
    clauses.push(
      `(${alias}.location_id IS NULL OR ${alias}.location_id IN (${user.locationScope
        .map(() => "?")
        .join(",")}))`,
    );
    params.push(...user.locationScope);
  }
  if (!purchaseSeesAll(user)) {
    const own = [`${alias}.requester_id = ?`];
    params.push(user.id);
    if (user.managedDepartmentIds.length > 0) {
      own.push(`${alias}.department_id IN (${user.managedDepartmentIds.map(() => "?").join(",")})`);
      params.push(...user.managedDepartmentIds);
    }
    clauses.push(`(${own.join(" OR ")})`);
  }

  return { clause: clauses.length ? `(${clauses.join(" AND ")})` : "", params };
}

export function assertPurchaseVisible(
  user: AuthUser,
  request: { requester_id: string; location_id: string | null; department_id?: string | null },
): void {
  if (user.locationScope.length > 0 && request.location_id && !user.locationScope.includes(request.location_id)) {
    throw forbidden("Você não tem acesso a solicitações deste local.");
  }
  if (purchaseSeesAll(user)) return;
  if (request.requester_id === user.id) return;
  if (request.department_id && user.managedDepartmentIds.includes(request.department_id)) return;
  throw forbidden(
    "Você só pode acessar as suas solicitações ou as solicitações dos setores que gerencia. Peça acesso ao gestor do seu setor.",
  );
}

/** true quando o usuário gerencia o setor informado (ou é administrador). */
export function managesDepartment(user: AuthUser, departmentId: string | null): boolean {
  if (!departmentId) return false;
  if (user.permissions.has(PERMISSIONS.SETTINGS_MANAGE)) return true;
  return user.managedDepartmentIds.includes(departmentId);
}
