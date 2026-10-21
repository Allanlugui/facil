/**
 * Facil — Plataforma de Gestão de Facilities.
 * Assinado por Allan Luiz Silveira Lima (ver SIGNATURE.json / docs/ASSINATURA.md).
 */
import { Hono } from "hono";
import type { AppEnv } from "./types";
import { BUILD_INFO } from "./build-info.generated";
import { loadSession } from "./auth";
import { ApiError, errorBody } from "./errors";
import { nowIso } from "./util";
export { SupportRoom } from "./support-room";
import authRoutes from "./routes/auth";
import structureRoutes from "./routes/structure";
import userRoutes from "./routes/users";
import catalogRoutes from "./routes/catalog";
import stockRoutes from "./routes/stock";
import consumptionRoutes from "./routes/consumption";
import inventoryRoutes from "./routes/inventory";
import ticketRoutes from "./routes/tickets";
import workOrderRoutes from "./routes/workorders";
import purchaseRoutes from "./routes/purchases";
import dashboardRoutes from "./routes/dashboard";
import reportRoutes from "./routes/reports";
import settingsRoutes from "./routes/settings";
import auditRoutes from "./routes/audit";
import attachmentRoutes from "./routes/attachments";
import notificationRoutes from "./routes/notifications";
import supportRoutes from "./routes/support";
import intakeRoutes from "./routes/intake";
import integrationRoutes from "./routes/integrations";

const app = new Hono<AppEnv>();

// Normaliza barras finais em rotas de API: `/api/tickets/` e `/api/tickets`
// respondem igual. Sem isso, um cliente que envia barra final recebe 404 e
// interpreta como "rota inexistente" em vez de erro de formato.
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
    return app.fetch(new Request(url.toString(), c.req.raw), c.env, c.executionCtx);
  }
  await next();
});

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
].join("; ");

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  // Definidos antes do handler: assim também cobrem respostas de erro.
  c.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("X-Request-Id", c.get("requestId"));
  if (c.req.path.startsWith("/api/")) {
    c.header("Cache-Control", "no-store");
  }
  // Digital de cada deploy (D-39): release assinada em SIGNATURE.json.
  c.header("X-Facil-Release", BUILD_INFO.version);
  c.header("X-Facil-Signed-At", BUILD_INFO.signedAt);
  c.header("X-Facil-Tree-Sha256", BUILD_INFO.treeHash);
  c.header("X-Facil-Author", BUILD_INFO.author);
  await next();
});

/**
 * Defesa em profundidade contra CSRF: a API só aceita escrita de navegador
 * quando o `Origin` é o mesmo host da requisição (ou ausente, para clientes
 * HTTP e testes). SameSite=Lax sozinho não basta em `*.workers.dev`, porque
 * outro Worker no mesmo site pode disparar POSTs "same-site".
 */
app.use("/api/*", async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("origin");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (!originHost || originHost !== new URL(c.req.url).host) {
        throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "Origem da requisição não permitida.");
      }
    }
  }
  await next();
});

// Toda rota de API passa pelo carregamento de sessão. A autorização fina e
// aplicada por rota (requirePermission), nunca apenas no frontend.
app.use("/api/*", loadSession);

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "facil",
    time: nowIso(),
    requestId: c.get("requestId"),
    release: {
      version: BUILD_INFO.version,
      author: BUILD_INFO.author,
      company: BUILD_INFO.company,
      signedAt: BUILD_INFO.signedAt,
      treeHash: BUILD_INFO.treeHash,
      keyFingerprint: BUILD_INFO.keyFingerprint,
    },
  }),
);

app.route("/api/auth", authRoutes);
app.route("/api/structure", structureRoutes);
app.route("/api/users", userRoutes);
app.route("/api/catalog", catalogRoutes);
app.route("/api/stock", stockRoutes);
app.route("/api/consumption", consumptionRoutes);
app.route("/api/inventories", inventoryRoutes);
app.route("/api/tickets", ticketRoutes);
app.route("/api/workorders", workOrderRoutes);
app.route("/api/purchases", purchaseRoutes);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/reports", reportRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/audit", auditRoutes);
app.route("/api/attachments", attachmentRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/support", supportRoutes);
app.route("/api/intake", intakeRoutes);
app.route("/api/integrations", integrationRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json(errorBody("NOT_FOUND", `Rota não encontrada: ${c.req.path}`), 404);
  }
  return c.text("Not found", 404);
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json(errorBody(err.code, err.message, err.details), err.status as 400);
  }

  // Erros não previstos: registra no log do Worker (observability) e devolve
  // mensagem genérica, sem vazar SQL, stack trace ou detalhes internos.
  console.error(
    JSON.stringify({
      level: "error",
      requestId: c.get("requestId"),
      path: c.req.path,
      method: c.req.method,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return c.json(errorBody("INTERNAL_ERROR", "Erro interno ao processar a requisição."), 500);
});

export default app;
