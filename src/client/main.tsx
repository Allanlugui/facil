/**
 * Facil — Plataforma de Gestão de Facilities.
 * Assinado por Allan Luiz Silveira Lima (ver SIGNATURE.json / docs/ASSINATURA.md).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./app/router";
import { SessionProvider } from "./lib/session";
import { ToastProvider } from "./lib/ui";
import "./styles.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Elemento #root não encontrado.");

createRoot(rootElement).render(
  <StrictMode>
    <ToastProvider>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ToastProvider>
  </StrictMode>,
);
