import { apiGet, withParams } from "./api";
import { useAsync, type AsyncState } from "./hooks";

/**
 * Listas de apoio para seletores.
 *
 * Cada função le a rota real do módulo correspondente. Como o backend aplica o
 * escopo de local do usuário, os seletores nunca oferecem opções que a API
 * recusaria depois.
 */

export interface LocationOption {
  id: string;
  name: string;
  path: string;
  typeCode: string | null;
  typeName: string | null;
  unitName: string | null;
  isActive: boolean;
}

export interface ProductOption {
  id: string;
  name: string;
  sku: string | null;
  uomId: string;
  uomCode: string | null;
  categoryName: string | null;
  minQtyMilli: number;
  isActive: boolean;
  tracksStock: boolean;
}

export interface UserOption {
  id: string;
  name: string;
  email: string;
  roleName: string;
  isActive: boolean;
}

export interface NamedOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface UomOption {
  id: string;
  code: string;
  name: string;
  allowsDecimal: boolean;
  isActive: boolean;
}

export function useLocations(): AsyncState<LocationOption[]> {
  return useAsync(async () => {
    const result = await apiGet<{ items: LocationOption[] }>("/api/structure/locations");
    return result.items;
  }, []);
}

export function useActiveUsers(): AsyncState<UserOption[]> {
  return useAsync(async () => {
    const result = await apiGet<{ items: UserOption[] }>("/api/users/users", {
      isActive: "true",
      pageSize: 200,
    });
    return result.items;
  }, []);
}

export function useCategories(): AsyncState<NamedOption[]> {
  return useAsync(async () => {
    const result = await apiGet<{ items: NamedOption[] }>("/api/catalog/categories");
    return result.items;
  }, []);
}

export function useSuppliers(): AsyncState<NamedOption[]> {
  return useAsync(async () => {
    const result = await apiGet<{ items: NamedOption[] }>("/api/catalog/suppliers", { pageSize: 500 });
    return result.items;
  }, []);
}

export function useUoms(): AsyncState<UomOption[]> {
  return useAsync(async () => {
    const result = await apiGet<{ items: UomOption[] }>("/api/catalog/uoms");
    return result.items;
  }, []);
}

export function useUnits(): AsyncState<NamedOption[]> {
  return useAsync(async () => {
    const result = await apiGet<{ items: NamedOption[] }>("/api/structure/units");
    return result.items;
  }, []);
}

export interface TicketCategoryOption extends NamedOption {
  code: string | null;
  defaultKind: string;
}

export function useTicketCategories(): AsyncState<TicketCategoryOption[]> {
  return useAsync(async () => {
    const result = await apiGet<{ items: TicketCategoryOption[] }>("/api/tickets/categories");
    return result.items;
  }, []);
}

export interface TicketOption {
  id: string;
  code: string;
  title: string;
  status: string;
  workOrderId: string | null;
}

/** Chamados abertos para vincular ordens de serviço. */
export function useOpenTickets(): AsyncState<TicketOption[]> {
  return useAsync(async () => {
    const result = await apiGet<{ items: TicketOption[] }>("/api/tickets", {
      open: "true",
      pageSize: 200,
    });
    return result.items;
  }, []);
}

/** Sufixo de consulta para filtros de lista (evita repetir o cast). */
export function listQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  return withParams("", params).replace(/^\?/, "");
}
