import { PERMISSIONS } from "@shared/permissions";
import type { AuthUser } from "./types";
import { forbidden } from "./errors";

/** Permissões operacionais dão visão da fila inteira, além de `view_all`. */
const FULL_VIEW_PERMISSIONS = [
  PERMISSIONS.PURCHASES_VIEW_ALL,
  PERMISSIONS.PURCHASES_APPROVE,
  PERMISSIONS.PURCHASES_AUTHORIZE,
  PERMISSIONS.PURCHASES_AWARD,
  PERMISSIONS.PURCHASES_DIRECT,
  PERMISSIONS.PURCHASES_ORDER,
  PERMISSIONS.PURCHASES_RECEIVE,
] as const;

export function purchaseSeesAll(user: AuthUser): boolean {
  return FULL_VIEW_PERMISSIONS.some((permission) => user.permissions.has(permission));
}

/**
 * Filtro de visibilidade aplicado na lista, no painel e no detalhe.
 * `locationScope` continua valendo mesmo para quem vê a fila inteira.
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
    clauses.push(`${alias}.requester_id = ?`);
    params.push(user.id);
  }

  return { clause: clauses.length ? `(${clauses.join(" AND ")})` : "", params };
}

export function assertPurchaseVisible(
  user: AuthUser,
  request: { requester_id: string; location_id: string | null },
): void {
  if (user.locationScope.length > 0 && request.location_id && !user.locationScope.includes(request.location_id)) {
    throw forbidden("Você não tem acesso a solicitações deste local.");
  }
  if (!purchaseSeesAll(user) && request.requester_id !== user.id) {
    throw forbidden("Você só pode acessar as suas próprias solicitações de compra.");
  }
}
