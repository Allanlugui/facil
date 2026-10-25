import { Suspense, lazy, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { PERMISSIONS } from "@shared/permissions";
import { useSession } from "../lib/session";
import { FullPageLoading, PermissionGate, RequireAnonymous, RequireSession } from "./guards";
import { AppShell } from "./layout";

/**
 * Rotas do Facil.
 *
 * Cada página é carregada sob demanda: o login e a instalação abrem sem baixar
 * o sistema inteiro, e cada módulo vira um chunk próprio.
 *
 * As guardas escondem telas sem sentido para o estado atual (sessão ausente,
 * instalação pendente), mas quem autoriza continua sendo o servidor: cada rota
 * de API valida a permissão de novo.
 */

const LoginPage = lazy(() => import("../pages/login").then((m) => ({ default: m.LoginPage })));
const SetupPage = lazy(() => import("../pages/setup").then((m) => ({ default: m.SetupPage })));
const ChangePasswordPage = lazy(() =>
  import("../pages/change-password").then((m) => ({ default: m.ChangePasswordPage })),
);
const DashboardPage = lazy(() => import("../pages/dashboard").then((m) => ({ default: m.DashboardPage })));
const StockPage = lazy(() => import("../pages/stock").then((m) => ({ default: m.StockPage })));
const ConsumptionPage = lazy(() =>
  import("../pages/consumption").then((m) => ({ default: m.ConsumptionPage })),
);
const InventoryPage = lazy(() => import("../pages/inventory").then((m) => ({ default: m.InventoryPage })));
const InventoryDetailPage = lazy(() =>
  import("../pages/inventory").then((m) => ({ default: m.InventoryDetailPage })),
);
const TicketsPage = lazy(() => import("../pages/tickets").then((m) => ({ default: m.TicketsPage })));
const TicketDetailPage = lazy(() => import("../pages/tickets").then((m) => ({ default: m.TicketDetailPage })));
const WorkOrdersPage = lazy(() => import("../pages/workorders").then((m) => ({ default: m.WorkOrdersPage })));
const WorkOrderDetailPage = lazy(() =>
  import("../pages/workorders").then((m) => ({ default: m.WorkOrderDetailPage })),
);
const PurchasesPage = lazy(() => import("../pages/purchases").then((m) => ({ default: m.PurchasesPage })));
const PurchaseDetailPage = lazy(() =>
  import("../pages/purchases").then((m) => ({ default: m.PurchaseDetailPage })),
);
const CatalogPage = lazy(() => import("../pages/catalog").then((m) => ({ default: m.CatalogPage })));
const AssetsPage = lazy(() => import("../pages/assets").then((m) => ({ default: m.AssetsPage })));
const AssetDetailPage = lazy(() => import("../pages/assets").then((m) => ({ default: m.AssetDetailPage })));
const LegalPage = lazy(() => import("../pages/legal"));
const ConsentsPage = lazy(() => import("../pages/consents"));
const DpoPage = lazy(() => import("../pages/dpo"));
const DataSubjectRequestsPage = lazy(() => import("../pages/data-subject-requests"));
const SecurityMeasuresPage = lazy(() => import("../pages/security-measures"));
const SecurityIncidentsPage = lazy(() => import("../pages/security-incidents"));
const ReportsPage = lazy(() => import("../pages/reports").then((m) => ({ default: m.ReportsPage })));
const AuditPage = lazy(() => import("../pages/audit").then((m) => ({ default: m.AuditPage })));
const UsersPage = lazy(() => import("../pages/users").then((m) => ({ default: m.UsersPage })));
const SettingsPage = lazy(() => import("../pages/settings").then((m) => ({ default: m.SettingsPage })));
const ControlPage = lazy(() => import("../pages/control").then((m) => ({ default: m.ControlPage })));
const StructurePage = lazy(() => import("../pages/structure"));
const ProfilePage = lazy(() => import("../pages/profile").then((m) => ({ default: m.ProfilePage })));
const SupportPublicPage = lazy(() =>
  import("../pages/support-public").then((m) => ({ default: m.SupportPublicPage })),
);
const SupportTrackPage = lazy(() =>
  import("../pages/support-public").then((m) => ({ default: m.SupportTrackPage })),
);
const HelpPage = lazy(() => import("../pages/support").then((m) => ({ default: m.HelpPage })));
const SupportThreadPage = lazy(() =>
  import("../pages/support").then((m) => ({ default: m.SupportThreadPage })),
);
const NotFoundPage = lazy(() => import("../pages/not-found").then((m) => ({ default: m.NotFoundPage })));

/** Mantem a tela de carregamento enquanto o chunk da pagina chega. */
function page(node: ReactNode) {
  return <Suspense fallback={<FullPageLoading />}>{node}</Suspense>;
}

function SetupRoute() {
  // `/setup` se resolve sozinha quando a instalação já existe; aqui só esperamos
  // o estado da sessão para não piscar o formulário de instalação.
  const { status } = useSession();
  if (status === "loading") return <FullPageLoading />;
  return page(<SetupPage />);
}

export const router = createBrowserRouter([
  { path: "/setup", element: <SetupRoute /> },
  {
    path: "/login",
    element: (
      <RequireAnonymous>
        <Suspense fallback={<FullPageLoading />}>
          <LoginPage />
        </Suspense>
      </RequireAnonymous>
    ),
  },
  {
    path: "/trocar-senha",
    element: (
      <RequireSession>
        <Suspense fallback={<FullPageLoading />}>
          <ChangePasswordPage />
        </Suspense>
      </RequireSession>
    ),
  },
  {
    // Canal público de suporte: funciona sem sessão (quem perdeu a senha chega
    // por aqui) e continua válido para quem já está logado.
    path: "/suporte",
    element: page(<SupportPublicPage />),
  },
  {
    path: "/suporte/acompanhar/:token",
    element: page(<SupportTrackPage />),
  },
  {
    path: "/",
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      {
        index: true,
        element: (
          <PermissionGate code={PERMISSIONS.DASHBOARD_VIEW}>{page(<DashboardPage />)}</PermissionGate>
        ),
      },
      {
        path: "estoque",
        element: <PermissionGate code={PERMISSIONS.STOCK_VIEW}>{page(<StockPage />)}</PermissionGate>,
      },
      {
        path: "consumo",
        element: (
          <PermissionGate code={PERMISSIONS.CONSUMPTION_VIEW}>{page(<ConsumptionPage />)}</PermissionGate>
        ),
      },
      {
        path: "inventario",
        element: (
          <PermissionGate code={PERMISSIONS.INVENTORY_VIEW}>{page(<InventoryPage />)}</PermissionGate>
        ),
      },
      {
        path: "inventario/:id",
        element: (
          <PermissionGate code={PERMISSIONS.INVENTORY_VIEW}>{page(<InventoryDetailPage />)}</PermissionGate>
        ),
      },
      {
        path: "chamados",
        element: <PermissionGate code={PERMISSIONS.TICKETS_VIEW}>{page(<TicketsPage />)}</PermissionGate>,
      },
      {
        path: "chamados/:id",
        element: (
          <PermissionGate code={PERMISSIONS.TICKETS_VIEW}>{page(<TicketDetailPage />)}</PermissionGate>
        ),
      },
      {
        path: "ordens",
        element: (
          <PermissionGate code={PERMISSIONS.WORKORDERS_VIEW}>{page(<WorkOrdersPage />)}</PermissionGate>
        ),
      },
      {
        path: "ordens/:id",
        element: (
          <PermissionGate code={PERMISSIONS.WORKORDERS_VIEW}>{page(<WorkOrderDetailPage />)}</PermissionGate>
        ),
      },
      {
        path: "compras",
        element: (
          <PermissionGate code={PERMISSIONS.PURCHASES_VIEW}>{page(<PurchasesPage />)}</PermissionGate>
        ),
      },
      {
        path: "compras/:id",
        element: (
          <PermissionGate code={PERMISSIONS.PURCHASES_VIEW}>{page(<PurchaseDetailPage />)}</PermissionGate>
        ),
      },
      {
        path: "catalogo",
        element: <PermissionGate code={PERMISSIONS.CATALOG_VIEW}>{page(<CatalogPage />)}</PermissionGate>,
      },
      {
        path: "patrimonio",
        element: <PermissionGate code={PERMISSIONS.ASSETS_VIEW}>{page(<AssetsPage />)}</PermissionGate>,
      },
      {
        path: "patrimonio/:id",
        element: (
          <PermissionGate code={PERMISSIONS.ASSETS_VIEW}>{page(<AssetDetailPage />)}</PermissionGate>
        ),
      },
      {
        path: "legal",
        element: (
          <PermissionGate code={PERMISSIONS.LEGAL_VIEW}>{page(<LegalPage />)}</PermissionGate>
        ),
      },
      {
        path: "consent",
        element: (
          <PermissionGate code={PERMISSIONS.CONSENT_VIEW}>{page(<ConsentsPage />)}</PermissionGate>
        ),
      },
      {
        path: "dpo",
        element: (
          <PermissionGate code={PERMISSIONS.DPO_VIEW}>{page(<DpoPage />)}</PermissionGate>
        ),
      },
      {
        path: "dsr",
        element: (
          <PermissionGate code={PERMISSIONS.DSR_VIEW}>{page(<DataSubjectRequestsPage />)}</PermissionGate>
        ),
      },
      {
        path: "seguranca",
        element: (
          <PermissionGate code={PERMISSIONS.SEC_VIEW}>{page(<SecurityMeasuresPage />)}</PermissionGate>
        ),
      },
      {
        path: "incidentes",
        element: (
          <PermissionGate code={PERMISSIONS.INCIDENT_VIEW}>{page(<SecurityIncidentsPage />)}</PermissionGate>
        ),
      },
      {
        path: "relatorios",
        element: <PermissionGate code={PERMISSIONS.REPORTS_VIEW}>{page(<ReportsPage />)}</PermissionGate>,
      },
      {
        path: "auditoria",
        element: <PermissionGate code={PERMISSIONS.AUDIT_VIEW}>{page(<AuditPage />)}</PermissionGate>,
      },
      {
        path: "usuarios",
        element: <PermissionGate code={PERMISSIONS.USERS_VIEW}>{page(<UsersPage />)}</PermissionGate>,
      },
      {
        // Área administrativa única (F-18): configurações, aparência e as
        // páginas de administração (catálogo, estrutura, usuários, relatórios,
        // auditoria). Cada seção valida a própria permissão; o servidor
        // continua autorizando tudo de novo.
        path: "configuracoes/:section?",
        element: (
          <PermissionGate
            anyOf={[
              PERMISSIONS.SETTINGS_VIEW,
              PERMISSIONS.CATALOG_VIEW,
              PERMISSIONS.STRUCTURE_VIEW,
              PERMISSIONS.REPORTS_VIEW,
              PERMISSIONS.AUDIT_VIEW,
              PERMISSIONS.USERS_VIEW,
            ]}
          >
            {page(<SettingsPage />)}
          </PermissionGate>
        ),
      },
      {
        path: "estrutura",
        element: <PermissionGate code={PERMISSIONS.STRUCTURE_VIEW}>{page(<StructurePage />)}</PermissionGate>,
      },
      {
        // Central de controle: exclusão de cadastros com prévia de impacto.
        // Cada entidade valida a própria permissão no servidor.
        path: "controle",
        element: (
          <PermissionGate
            anyOf={[
              PERMISSIONS.STRUCTURE_VIEW,
              PERMISSIONS.CATALOG_VIEW,
              PERMISSIONS.USERS_VIEW,
              PERMISSIONS.SETTINGS_VIEW,
              PERMISSIONS.ASSETS_VIEW,
            ]}
          >
            {page(<ControlPage />)}
          </PermissionGate>
        ),
      },
      { path: "perfil", element: page(<ProfilePage />) },
      { path: "ajuda", element: page(<HelpPage />) },
      { path: "ajuda/:id", element: page(<SupportThreadPage />) },
      { path: "*", element: page(<NotFoundPage />) },
    ],
  },
]);
