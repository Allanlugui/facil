import { Hono } from "hono";
import type { AppEnv } from "./types";
import { loadSession } from "./auth";
import { ApiError, errorBody } from "./errors";
import { nowIso } from "./util";
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

app.use("*", async (c, next) => {
  c.set("requestId", crypto.randomUUID());
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "same-origin");
  c.header("X-Request-Id", c.get("requestId"));
});

// Toda rota de API passa pelo carregamento de sessão. A autorização fina e
// aplicada por rota (requirePermission), nunca apenas no frontend.
app.use("/api/*", loadSession);

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "facil", time: nowIso(), requestId: c.get("requestId") }),
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
