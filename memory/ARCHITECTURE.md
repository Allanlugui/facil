# Arquitetura: Facil

- **Estado (17/10/2026):** **DEFINIDA E IMPLEMENTADA.** Validada por 107 testes, smoke HTTP,
  build e verificação visual desktop/mobile. Deploy: ver `DEPLOY.md` (não publicado).

## Visão geral

Um único Worker Cloudflare serve **API e assets**: rotas `/api/*` vão para o Hono; todo o resto é o
SPA React (assets estáticos com fallback para `index.html` de rota profunda). Banco D1 (SQLite)
com integridade garantida por constraints/triggers.

```
src/
  shared/    tipos, enumerações (rótulos pt-BR), permissões e contratos comuns
  worker/    Hono: index, auth (sessão), errors, util, rules (estoque), 16 módulos de rota
  client/    React Router 7: app/ (router, guards, shell), lib/ (api, session, hooks, ui, format),
             pages/ (20 rotas), main.tsx
migrations/  0001..0006 (schema, índices, triggers, settings/counters)
tests/       9 specs vitest com D1 isolado por spec
seeds/       demo.sql (dados-mestres) e reset.sql (reset de fábrica)
scripts/     smoke.ps1 (11 checagens HTTP)
```

## Decisões estruturais que a arquitetura incorpora

- **Movimentos = fonte da verdade do saldo.** `movements` registra cada lançamento; `stock` é
  materialização derivada. Nunca há escrita de saldo "direta"; correção só por reversão (novo
  movimento de sinal oposto) — histórico imutável. Detalhe: `DECISOES.md` D-06.
- **Atomicidade sem transação interativa:** D1 não tem `BEGIN/COMMIT` via API; toda operação
  multi-tabela (movimento + saldo + auditoria, recebimento, consumo, OS) grava em `db.batch()`.
- **Integridade no banco, mensagem amigável no app:** triggers impedem saldo negativo
  (`stock.allow_negative=false`); o Worker pré-checa apenas para erro legível e delega ao banco.
- **Idempotência por `request_key` UNIQUE:** envio duplicado falha por constraint → rollback; se
  todas as chaves do lote já existem, responde replay do resultado (`idempotentReplay: true`).
- **Autorização no servidor:** cada rota exige permissão explícita (`requirePermission`,
  `default deny`); escopo de local por usuário; ninguém concede privilégio que não possui.
- **Quantidades em milésimos (`*_milli`) e dinheiro em centavos (`*_cents`)** — a API converte para
  decimal no limite HTTP; nada de ponto flutuante em aritmética de negócio.
- **Tempo:** todo timestamp é gerado no backend em ISO-8601 UTC; o cliente exibe em
  `America/Sao_Paulo` (setting `company.timezone`) via `lib/format.ts`.
- **\"Assinatura eletrônica\"** = autoria autenticada + auditoria com antes/depois; nunca ICP-Brasil.
- **Anexos** ficam no D1 (limite de tamanho validado); sem serviço externo de storage.

## Fluxo de uma requisição

1. `loadSession` lê o cookie `HttpOnly`, valida o token opaco em D1 e injeta o usuário + permissões.
2. Hono roteia; a rota valida entrada com Zod 4, checa permissão e executa regras de negócio.
3. Escritas críticas montam um array de statements (dados + auditoria + counters) e executam em
   `db.batch()` — tudo ou nada.
4. Erros usam envelope único `{ error: { code, message, details? } }` com códigos estáveis
   (`VALIDATION_ERROR`, `BAD_REQUEST`, `CONFLICT`, `TOO_MANY_ATTEMPTS`, ...).
5. O cliente centraliza o fetch em `lib/api.ts` (credenciais por cookie, tratamento de 401/403 e
   toast de erro) — nenhuma página monta fetch cru.

## Cliente

- **Code-splitting por rota** (`React.lazy` + Suspense por rota): entrada pública leve; cada módulo
  operacional é baixado sob demanda (principal 362 kB / 114 kB gzip + chunks por página).
- **Guardas são UX, não segurança:** `RequireSession`, `RequireAnonymous`, `PermissionGate` e o
  `AppShell` escondem o que o usuário não pode fazer; o servidor decide de novo em toda chamada.
- **Design system único** em `lib/ui.tsx` (Button, Field/Input/Select/Textarea, Dialog, Card, Stat,
  Table, Tabs, Badge, Alert, Toast, EmptyState, Loading/Error, PageHeader).
- **Mobile-primeiro de verdade:** drawer de navegação, tabelas com rolagem interna, diálogos
  adaptados; varredura de overflow horizontal em 390 px faz parte da verificação (A-06).

## Testes e verificação

- **vitest + `@cloudflare/vitest-plugin`**: cada spec recebe um D1 novo com as migrations aplicadas —
  os testes exercitam SQL, triggers e regras reais (não há mocks de banco).
- **Smoke HTTP** (`scripts/smoke.ps1`) cobre a instalação completa: SPA, rotas profundas, setup,
  login, sessão, 401 e logout.
- **Playwright** para verificação visual (desktop + mobile) e de fluxo ponta a ponta na interface.

## Restrições e divergências registradas

- Sem Next.js/SSR (D-05): o produto é painel autenticado; SPA + Workers cobre o caso.
- Sem ORM: SQL explícito com prepared statements — transparência e controle de batch.
- Multi-tenant não implementado (uma organização por instalação); requisito do padrão global fica
  registrado como divergência consciente desta versão, sem bloquear o escopo aprovado.
- Limites conhecidos: sem upload externo de arquivos (anexos no D1), sem WebSocket/tempo real
  (atualização por navegação/polling leve), `@types/node` ausente para `wrangler types` (P-06).
