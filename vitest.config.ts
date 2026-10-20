import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Testes rodam dentro do runtime real do Workers (workerd) via Miniflare,
// com banco D1 isolado por arquivo de teste. Isso valida triggers, CHECKs,
// UNIQUEs e transacoes do SQLite de verdade, e nao uma imitacao.
//
// As migracoes sao lidas aqui (Node) e injetadas no worker de teste como
// binding `TEST_MIGRATIONS`; `tests/setup.ts` as aplica no D1 do Miniflare.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");

  return {
    resolve: {
      alias: {
        // O pool do Vitest compila o Worker com o mesmo `resolve` deste config.
        "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
      },
    },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Cache desabilitado nos testes para evitar estado residual entre casos.
          cache: false,
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      include: ["tests/**/*.spec.ts"],
      setupFiles: ["./tests/setup.ts"],
      // Requisicoes de teste fazem varias idas ao banco; o padrao de 5s e curto
      // quando o Miniflare precisa subir e aplicar migracoes na primeira vez.
      testTimeout: 30000,
      hookTimeout: 60000,
      // Cada arquivo roda em seu proprio worker/banco isolado.
      fileParallelism: false,
    },
  };
});
