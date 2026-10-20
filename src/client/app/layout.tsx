import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { PERMISSIONS } from "@shared/permissions";
import type { Paginated } from "@shared/types";
import { apiGet, apiPost, apiDelete, apiErrorMessage } from "../lib/api";
import { formatRelative } from "../lib/format";
import { useSession } from "../lib/session";
import { Logo, useDarkSurface } from "../lib/brand";
import {
  BellIcon,
  BoxesIcon,
  BoxIcon,
  Button,
  CartIcon,
  ClipboardIcon,
  CloseIcon,
  DashboardIcon,
  GearIcon,
  HelpIcon,
  LogoutIcon,
  MenuIcon,
  Spinner,
  TicketIcon,
  WrenchIcon,
} from "../lib/ui";
import { useToast } from "../lib/ui";

interface NavItem {
  to: string;
  label: string;
  /** Sem permissão definida, o item aparece para qualquer usuário logado. */
  permission?: string;
  icon: ReactNode;
  end?: boolean;
}

const OPERATION_NAV: NavItem[] = [
  { to: "/", label: "Painel", permission: PERMISSIONS.DASHBOARD_VIEW, icon: <DashboardIcon />, end: true },
  { to: "/estoque", label: "Estoque", permission: PERMISSIONS.STOCK_VIEW, icon: <BoxIcon /> },
  { to: "/consumo", label: "Consumo", permission: PERMISSIONS.CONSUMPTION_VIEW, icon: <ClipboardIcon /> },
  { to: "/inventario", label: "Inventário", permission: PERMISSIONS.INVENTORY_VIEW, icon: <BoxesIcon /> },
  { to: "/chamados", label: "Chamados", permission: PERMISSIONS.TICKETS_VIEW, icon: <TicketIcon /> },
  { to: "/ordens", label: "Ordens de serviço", permission: PERMISSIONS.WORKORDERS_VIEW, icon: <WrenchIcon /> },
  { to: "/compras", label: "Compras", permission: PERMISSIONS.PURCHASES_VIEW, icon: <CartIcon /> },
  { to: "/ajuda", label: "Suporte", icon: <HelpIcon /> },
];

/**
 * Menu do técnico (F-20): a rotina de execução vem primeiro — suas ordens,
 * chamados, material —, sem inventário nem compras na frente.
 */
const TECH_NAV: NavItem[] = [
  { to: "/", label: "Meu painel", permission: PERMISSIONS.DASHBOARD_VIEW, icon: <DashboardIcon />, end: true },
  { to: "/chamados", label: "Chamados", permission: PERMISSIONS.TICKETS_VIEW, icon: <TicketIcon /> },
  { to: "/ordens", label: "Ordens de serviço", permission: PERMISSIONS.WORKORDERS_VIEW, icon: <WrenchIcon /> },
  { to: "/estoque", label: "Estoque", permission: PERMISSIONS.STOCK_VIEW, icon: <BoxIcon /> },
  { to: "/consumo", label: "Consumo", permission: PERMISSIONS.CONSUMPTION_VIEW, icon: <ClipboardIcon /> },
  { to: "/ajuda", label: "Suporte", icon: <HelpIcon /> },
];

/** Menu do solicitante (F-20): só o que ele faz — abrir e acompanhar chamados. */
const REQUESTER_NAV: NavItem[] = [
  { to: "/", label: "Início", permission: PERMISSIONS.DASHBOARD_VIEW, icon: <DashboardIcon />, end: true },
  { to: "/chamados", label: "Meus chamados", permission: PERMISSIONS.TICKETS_VIEW, icon: <TicketIcon /> },
  { to: "/ajuda", label: "Suporte", icon: <HelpIcon /> },
];

/** Menu do comprador (F-20 fase 2): compras e recebimentos na frente. */
const BUYER_NAV: NavItem[] = [
  { to: "/", label: "Início", permission: PERMISSIONS.DASHBOARD_VIEW, icon: <DashboardIcon />, end: true },
  { to: "/compras", label: "Compras", permission: PERMISSIONS.PURCHASES_VIEW, icon: <CartIcon /> },
  { to: "/ajuda", label: "Suporte", icon: <HelpIcon /> },
];

/** Menu do estoque (F-20 fase 2): saldos, consumo e inventário na frente. */
const STOCK_NAV: NavItem[] = [
  { to: "/", label: "Meu painel", permission: PERMISSIONS.DASHBOARD_VIEW, icon: <DashboardIcon />, end: true },
  { to: "/estoque", label: "Estoque", permission: PERMISSIONS.STOCK_VIEW, icon: <BoxIcon /> },
  { to: "/consumo", label: "Consumo", permission: PERMISSIONS.CONSUMPTION_VIEW, icon: <ClipboardIcon /> },
  { to: "/inventario", label: "Inventário", permission: PERMISSIONS.INVENTORY_VIEW, icon: <BoxesIcon /> },
  { to: "/chamados", label: "Chamados", permission: PERMISSIONS.TICKETS_VIEW, icon: <TicketIcon /> },
  { to: "/compras", label: "Compras", permission: PERMISSIONS.PURCHASES_VIEW, icon: <CartIcon /> },
  { to: "/ajuda", label: "Suporte", icon: <HelpIcon /> },
];

/** Menu da limpeza (F-20 fase 2): consumo, inventário (líder) e chamados. */
const CLEANING_NAV: NavItem[] = [
  { to: "/", label: "Meu painel", permission: PERMISSIONS.DASHBOARD_VIEW, icon: <DashboardIcon />, end: true },
  { to: "/consumo", label: "Consumo", permission: PERMISSIONS.CONSUMPTION_VIEW, icon: <ClipboardIcon /> },
  { to: "/inventario", label: "Inventário", permission: PERMISSIONS.INVENTORY_VIEW, icon: <BoxesIcon /> },
  { to: "/chamados", label: "Chamados", permission: PERMISSIONS.TICKETS_VIEW, icon: <TicketIcon /> },
  { to: "/ajuda", label: "Suporte", icon: <HelpIcon /> },
];

/** Menu da recepção (F-20 fase 2 + D-30): chamados do posto e consumo dos itens usados. */
const RECEPTION_NAV: NavItem[] = [
  { to: "/", label: "Início", permission: PERMISSIONS.DASHBOARD_VIEW, icon: <DashboardIcon />, end: true },
  { to: "/consumo", label: "Consumo", permission: PERMISSIONS.CONSUMPTION_VIEW, icon: <ClipboardIcon /> },
  { to: "/chamados", label: "Chamados", permission: PERMISSIONS.TICKETS_VIEW, icon: <TicketIcon /> },
  { to: "/ajuda", label: "Suporte", icon: <HelpIcon /> },
];

/** Menu e título da seção conforme o perfil; sem perfil especial, visão geral. */
function navForRole(roleCode: string | undefined): { title: string; items: NavItem[] } {
  switch (roleCode) {
    case "maintenance_tech":
      return { title: "Meu dia", items: TECH_NAV };
    case "requester":
      return { title: "Meus serviços", items: REQUESTER_NAV };
    case "buyer":
      return { title: "Compras", items: BUYER_NAV };
    case "stock_keeper":
      return { title: "Estoque e suprimentos", items: STOCK_NAV };
    case "cleaning_lead":
    case "cleaning_staff":
      return { title: "Limpeza", items: CLEANING_NAV };
    case "receptionist":
      return { title: "Recepção", items: RECEPTION_NAV };
    default:
      return { title: "Operação", items: OPERATION_NAV };
  }
}

/**
 * Áreas administrativas vivem dentro de Configurações (F-18): uma única porta
 * no menu lateral; as páginas continuam com suas próprias permissões e URLs.
 */
const SETTINGS_NAV: NavItem[] = [
  { to: "/configuracoes", label: "Configurações", icon: <GearIcon /> },
];

/** Quem enxerga a porta de Configurações: configurações ou qualquer área administrativa. */
const SETTINGS_ACCESS = [
  PERMISSIONS.SETTINGS_VIEW,
  PERMISSIONS.CATALOG_VIEW,
  PERMISSIONS.STRUCTURE_VIEW,
  PERMISSIONS.REPORTS_VIEW,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.USERS_VIEW,
] as const;

/** Fecha ao clicar fora (menus do topo). */
function useClickOutside(onOutside: () => void, active: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const listener = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", listener);
    return () => document.removeEventListener("mousedown", listener);
  }, [active, onOutside]);
  return ref;
}

export function AppShell() {
  const { user, app, can, canAny, logout, mustChangePassword } = useSession();
  const nav = navForRole(user?.roleCode);
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeBell = useCallback(() => setBellOpen(false), []);
  const menuRef = useClickOutside(closeMenu, menuOpen);
  const bellRef = useClickOutside(closeBell, bellOpen);

  // Os menus fecham e a rolagem do conteúdo volta ao topo ao trocar de rota.
  useEffect(() => {
    setSidebarOpen(false);
    setMenuOpen(false);
    setBellOpen(false);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (mustChangePassword) {
    // O servidor bloqueia as ações de negócio até a troca; a interface acompanha.
    return <Navigate to="/trocar-senha" replace />;
  }

  const renderNav = (items: NavItem[]) => (
    <ul className="space-y-0.5">
      {items
        .filter((item) => !item.permission || can(item.permission))
        .map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive
                    ? "bg-brand-50 text-brand-800"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              <span className="text-slate-400">{item.icon}</span>
              {item.label}
            </NavLink>
          </li>
        ))}
    </ul>
  );

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-full overflow-hidden bg-slate-50">
      {/* Menu lateral fixo a partir de lg */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-surface lg:flex">
        <Brand />
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          <div>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {nav.title}
            </p>
            {renderNav(nav.items)}
          </div>
          {canAny(SETTINGS_ACCESS) ? (
            <div className="border-t border-slate-100 pt-3">
              {renderNav(SETTINGS_NAV)}
            </div>
          ) : null}
        </nav>
        <footer className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          {app.companyName ?? "Facil"} · {app.timezone}
        </footer>
      </aside>

      {/* Gaveta no celular */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Fechar menu"
            className="absolute inset-0 bg-overlay"
            onClick={closeSidebar}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <Brand />
              <button
                type="button"
                onClick={closeSidebar}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100"
                aria-label="Fechar menu"
              >
                <CloseIcon className="size-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
              <div>
                <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {nav.title}
                </p>
                {renderNav(nav.items)}
              </div>
              {canAny(SETTINGS_ACCESS) ? (
                <div className="border-t border-slate-100 pt-3">{renderNav(SETTINGS_NAV)}</div>
              ) : null}
            </nav>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-surface px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Abrir menu"
          >
            <MenuIcon />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">
              {app.companyName ?? "Facil"}
            </p>
          </div>

          <div className="relative" ref={bellRef}>
            <NotificationsBell open={bellOpen} onToggle={() => setBellOpen((value) => !value)} />
          </div>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white">
                {initials(user?.name ?? "")}
              </span>
              <span className="hidden text-left sm:block">
                <span className="block max-w-40 truncate text-sm font-medium text-slate-800">
                  {user?.name}
                </span>
                <span className="block max-w-40 truncate text-xs text-slate-500">{user?.roleName}</span>
              </span>
            </button>
            {menuOpen ? (
              <div
                role="menu"
                className="absolute right-0 mt-1 w-56 overflow-hidden rounded-xl border border-slate-200 bg-surface py-1 shadow-lg"
              >
                <div className="border-b border-slate-100 px-3 py-2">
                  <p className="truncate text-sm font-medium text-slate-800">{user?.name}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                </div>
                <Link
                  to="/perfil"
                  onClick={closeMenu}
                  className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  role="menuitem"
                >
                  Meu perfil e senha
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                >
                  <LogoutIcon className="size-4" />
                  Sair
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <main className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-5">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  const dark = useDarkSurface();
  return (
    <Link to="/" className="flex items-center gap-2 px-4 py-4">
      <Logo dark={dark} className="h-9 w-auto" />
      <span>
        <span className="block text-sm font-semibold text-slate-900">Facil</span>
        <span className="block text-[11px] text-slate-500">Gestão de Facilities</span>
      </span>
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function NotificationsBell({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadCount = useCallback(async () => {
    try {
      const result = await apiGet<{ count: number }>("/api/notifications/unread-count");
      setCount(result.count);
    } catch {
      // Sem sessão válida o contador apenas fica zerado.
    }
  }, []);

  useEffect(() => {
    void loadCount();
    const timer = window.setInterval(() => void loadCount(), 60_000);
    return () => window.clearInterval(timer);
  }, [loadCount]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiGet<Paginated<NotificationItem>>("/api/notifications", { pageSize: 12 });
      setItems(result.items);
      await loadCount();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadCount, toast]);

  useEffect(() => {
    if (open) void loadItems();
  }, [open, loadItems]);

  const openNotification = async (item: NotificationItem) => {
    if (!item.readAt) {
      try {
        await apiPost(`/api/notifications/${item.id}/read`, {});
        setItems((current) =>
          current.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)),
        );
        setCount((value) => Math.max(0, value - 1));
      } catch (error) {
        toast.error(apiErrorMessage(error));
      }
    }
    if (item.link) navigate(item.link);
  };

  const markAll = async () => {
    try {
      await apiPost("/api/notifications/read-all", {});
      setItems((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt ?? new Date().toISOString() })));
      setCount(0);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  const remove = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await apiDelete(`/api/notifications/${id}`);
      setItems((current) => current.filter((entry) => entry.id !== id));
      await loadCount();
    } catch (error) {
      toast.error(apiErrorMessage(error));
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        aria-label={count > 0 ? `Notificações (${count} não lidas)` : "Notificações"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <BellIcon />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-slate-200 bg-surface shadow-lg"
        >
          <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-semibold text-slate-800">Notificações</p>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={markAll} disabled={count === 0}>
                Marcar todas
              </Button>
            </div>
          </header>
          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500">
                <Spinner /> Carregando...
              </div>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Nada por aqui.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openNotification(item)}
                      className={`flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-slate-50 ${
                        item.readAt ? "" : "bg-brand-50/50"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800">{item.title}</span>
                        {item.body ? (
                          <span className="mt-0.5 block truncate text-xs text-slate-500">{item.body}</span>
                        ) : null}
                        <span className="mt-1 block text-[11px] text-slate-400">
                          {formatRelative(item.createdAt)}
                        </span>
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(event) => void remove(item.id, event)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void remove(item.id, event as unknown as React.MouseEvent);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Remover notificação"
                      >
                        <CloseIcon className="size-3.5" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
