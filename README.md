# Facil — Plataforma de Gestão de Facilities

Sistema interno de facilities da **Corp Services Group**: estrutura e locais,
estoque e consumo, inventário, chamados, ordens de serviço, compras com cotação,
relatórios, usuários/permissões e auditoria.

**Autor:** Allan Luiz Silveira Lima (Allanlugui)
**Licença:** proprietária, todos os direitos reservados (ver `LICENSE`).
**Assinatura:** cada release é assinada com Ed25519 (ver `docs/ASSINATURA.md`).

## Stack

- **Cloudflare Workers** (runtime) + **Hono 4** (API)
- **D1** (banco SQLite gerenciado, plano gratuito) + **R2** (anexos do suporte, opcional)
- **React 19 + Vite 7 + Tailwind v4 + React Router 7** (interface)
- **Zod 4** (validação) + **Vitest 5** (153 testes)

## Rodar localmente

```bash
npm install
npx wrangler d1 migrations apply facil-db --local
npm run seed            # opcional: dados demo (*@demo.local / Demo@Facil2026)
npm run dev             # API em http://127.0.0.1:8787
npm run dev:client      # interface em http://localhost:5173
```

No Windows, use a interface pela porta **5173** (o watcher de assets do
`wrangler dev` pode falhar com EPERM após o build).

## Verificações

```bash
npm run check           # typecheck + lint + contrato de API + 153 testes
npm run build           # build da interface + Worker
npm run verify          # confere a assinatura da release atual
```

## Publicar

```bash
npx wrangler d1 create facil-db          # uma vez; cole o id no wrangler.jsonc
npx wrangler d1 migrations apply facil-db --remote
npx wrangler r2 bucket create facil-attachments   # opcional (anexos do suporte)
npm run deploy                           # assina a release + checks + build + deploy
```

Depois do primeiro deploy, abra a URL e conclua a **Instalação inicial**
(empresa, administrador e senha).

Guia completo para a equipe de TI: **`docs/IMPLANTACAO.md`**.

## Documentação

- `docs/IMPLANTACAO.md` — implantação corporativa, domínio, backup, atualização.
- `docs/ASSINATURA.md` — assinatura digital, verificação e custódia da chave.
- `docs/anexos-suporte.md` — anexos do suporte (R2).
- `docs/email-gmail-senha-app.md` / `docs/email-relay-gmail.md` — e-mail.
- `memory/` — decisões, status e histórico do projeto (índice em `memory/INDEX.md`).

## Estrutura

```
src/worker/      API (Hono), rotas, autenticação, auditoria
src/client/      interface (React), páginas, componentes, marca
migrations/      migrations D1 (0001..0018)
seeds/           dados demo e reset (ambiente local)
tests/           testes de integração (Worker + D1)
scripts/         verificação de contrato, assinatura e release
docs/            guias de implantação e operação
branding/        originais da marca (fonte)
```
