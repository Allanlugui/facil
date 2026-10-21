# Deploy: Facil

## Política padrão para NOVOS projetos: Cloudflare Workers + Workers Builds

- Desenvolvimento local separado da produção.
- GitHub como origem do código para o pipeline, quando configurado.
- Build e publicação automáticos via Workers Builds.
- Preview Build para validar antes de integrar à produção.
- Produção somente com evidências reais (build concluído, check aprovado, URL acessível, conteúdo
  esperado).
- Segredos somente pelos mecanismos da plataforma (Wrangler/Cloudflare), nunca commitados no repo.
- Projetos EXISTENTES preservam sua plataforma atual (ex.: Vercel) — nunca migrar automaticamente.
- Em projetos que usem Wrangler/Workers, avaliar `"previews": {}` no nível superior, conforme o fluxo
  de Preview aplicável e a documentação oficial vigente. Não adicionar em projetos sem Wrangler.
- Não transformar `npx wrangler deploy` local em requisito de cada publicação quando o pipeline
  configurado for o fluxo oficial.
- Cloudflare Pages não substitui Workers sem justificativa técnica documentada.
- Vercel não deve ser escolhida para um projeto novo apenas por familiaridade.
- Não conectar serviços que exijam novos compromissos financeiros sem autorização.
- Não publicar em produção sem autorização explícita.

## Estado real (20/10/2026) — PUBLICADO (release 0.3.0)

- **URL:** `https://facil.cf-pilot-disposable.workers.dev` (Worker `facil`; `workers.dev`, sem
  domínio próprio nem Cloudflare Access).
- **Repositório:** privado `Allanlugui/facil`, branch `main`; deploy oficial por `npm run deploy`
  (assina → `npm run check` → build → `wrangler deploy`), não por CI.
- **Banco:** D1 remoto `facil-db` (`10365b4d-7ed0-4e8e-8aba-65ebf354cb25`, ENAM), migrations
  `0001`–`0019`; instalação inicial concluída pelo titular (`needsSetup: false`).
- **Release:** **0.3.0**, 168 arquivos assinados (Ed25519), tree
  `8757a04ed013ff3425f69837af402007b1a9c1f27a0c07154dde64dfc85a9c10`, 20/10/2026 23:04:14 −03:00,
  Worker `cf468e3f-7a2f-4b06-96c2-948e6b38243e`. Versões futuras seguem `docs/VERSIONAMENTO.md`.
- **R2:** desligado nesta conta; anexos do chat de suporte respondem 503 `R2_UNAVAILABLE`. O restante
  do produto usa D1.
- **Intake ServiceNow:** implementado; responde `503 INTAKE_DISABLED` até o segredo
  `TICKET_INTAKE_KEY` ser criado no Worker.
- **Verificação:** `/api/health` com bloco `release`; `/build-info.json`; cabeçalhos `X-Facil-*`,
  CSP/HSTS/COOP, `_headers` estático e cache imutável dos assets conferidos em produção.
- **Rollback:** `npx wrangler deployments list` e `npx wrangler rollback <version-id>`; o D1 não
  volta com o Worker — migrations são aditivas e o backup é responsabilidade do titular.

## Histórico (17/10/2026) — CONFIGURADO, NÃO PUBLICADO

- **Repositório Git: NÃO INICIALIZADO** (pré-requisito do Workers Builds). Todo o código existe apenas
  no diretório local, sem versionamento.
- **`wrangler.jsonc` pronto e validado:** `name facil`, entry `src/worker/index.ts`, assets em
  `dist/client` com `run_worker_first: ["/api/*"]` (SPA com fallback + API no mesmo Worker),
  binding D1 `DB` e `migrations_dir`. `npx wrangler deploy --dry-run` executou sem erro.
- **D1 local:** migrations `0001`–`0012` aplicadas; banco remoto **não existe**; `database_id` é
  placeholder.
- **R2 (F-19):** bucket local simulado (`facil-attachments`, binding `ATTACHMENTS`); em produção,
  criar com `npx wrangler r2 bucket create facil-attachments` (plano gratuito; ver
  `docs/anexos-suporte.md`).
- **Nenhuma conta Cloudflare, token ou projeto vinculado por este agente.** Nenhum deploy
  realizado; nenhuma URL existe.
- **Integração GitHub ↔ Cloudflare: não configurada** — só fará sentido quando o repositório existir.

### Passos para publicar (quando autorizado)

1. `git init` + primeiro commit (o código está pronto; falta apenas versionar).
2. Criar o banco remoto: `npx wrangler d1 create facil-db` → colar o `database_id` real no
   `wrangler.jsonc`.
3. Criar o bucket R2 dos anexos do suporte: `npx wrangler r2 bucket create facil-attachments`
   (binding já declarado; ver `docs/anexos-suporte.md`).
4. Aplicar migrations no remoto: `npx wrangler d1 migrations apply facil-db --remote`.
5. Conectar o repositório ao **Workers Builds** (build: `npm run build`; sem segredos extras — não
   há `vars` sensíveis; tudo vem dos bindings D1/R2).
6. Preview Build → validar URL com o conteúdo esperado → **produção somente com autorização
   explícita**.
7. Após o primeiro deploy, rodar o setup inicial pela URL (o sistema nasce em "necessita setup") e
   reconfigurar o e-mail do suporte (a configuração vive no D1; o novo banco nasce sem ela).

## Critérios para declarar o deploy validado (quando houver deploy)

1. Build reproduzível executado com o comando real do projeto.
2. Checks do pipeline aprovados (lint, typecheck, testes, build) — sem mascarar erros.
3. URL de preview acessível e com o conteúdo esperado, verificada de fato.
4. Produção somente após preview validado **e** autorização explícita do usuário.
5. Segredos conferidos nos mecanismos da plataforma, nunca no repositório.
6. Registro do resultado real (aprovado / reprovado / não executado) na memória do projeto.
