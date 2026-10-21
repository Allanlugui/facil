# Facil — Plataforma de Gestão de Facilities

Sistema interno de facilities da **CorpServices Group**: estrutura e locais,
estoque e consumo, inventário, chamados, ordens de serviço, compras com cotação
e adjudicação, relatórios, usuários/permissões e auditoria.

**Autor:** Allan Luiz Silveira Lima (Allanlugui)  
**Licença:** proprietária, todos os direitos reservados (ver `LICENSE`).  
**Assinatura:** cada release é assinada com Ed25519 (ver `docs/ASSINATURA.md`).  
**Versão atual:** `0.3.0` (itens fora do catálogo no fluxo de compras).

> A autoria é registrada apenas pelo nome. CPF e e-mail pessoal do autor não são
> armazenados nem exibidos pelo sistema, pela documentação ou pelo repositório.

## O que o sistema faz

| Módulo | Entrega |
| --- | --- |
| Estrutura | Unidades, almoxarifados, salas, tipos de local e escopo por usuário |
| Catálogo | Produtos, SKUs, unidades, fornecedores, categorias e preços |
| Estoque | Saldos por local, entradas, saídas, transferências, ajustes e inventário |
| Consumo | Consumo por equipe, centro de custo e período |
| Chamados | Abertura, triagem, atribuição, prioridade, categoria, SLA e anexos |
| Ordens de serviço | Checklist, materiais, responsável, execução e conclusão |
| Compras v1 | Fluxo legado: aprovação única, cotação, pedido e recebimento |
| Compras v2 | Gestor → direção → compras, envio direto, compra direta, adjudicação por item, pedidos por fornecedor e itens fora do catálogo |
| Relatórios | Estoque, movimentos, consumo, chamados, ordens, compras e exportação |
| Administração | Usuários, perfis, permissões, configurações, auditoria e notificações |
| Integrações | Outbox transacional para NetSuite/ServiceNow e intake externo de chamados |

## Stack

- **Cloudflare Workers** (runtime) + **Hono 4** (API)
- **D1** (banco SQLite gerenciado, plano gratuito) + **R2** (anexos do suporte, opcional)
- **React 19 + Vite 7 + Tailwind v4 + React Router 7** (interface)
- **Zod 4** (validação) + **Vitest 5** (169 testes em 18 arquivos)
- **Wrangler 4** (desenvolvimento, migrations e deploy)
- **Ed25519** (assinatura de release, chave privada fora do repositório)

Não há serviço pago obrigatório. O sistema foi desenhado para rodar no plano
gratuito da Cloudflare e em qualquer rede com acesso HTTPS.

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
npm run check           # typecheck + lint + contrato de API + 169 testes
npm run build           # build da interface + Worker
npm run verify          # confere a assinatura da release atual
```

O `npm run check` cobre:

- TypeScript do Worker e do cliente;
- ESLint;
- contrato entre as rotas chamadas pelo cliente e as rotas registradas na API;
- testes de integração no runtime real do Workers (`workerd` + Miniflare) com
  D1 isolado por arquivo e migrations reais.

## Publicar

```bash
npx wrangler d1 create facil-db          # uma vez; cole o id no wrangler.jsonc
npx wrangler d1 migrations apply facil-db --remote
npx wrangler r2 bucket create facil-attachments   # opcional (anexos do suporte)
npm run deploy                           # assina a release + checks + build + deploy
```

Ordem recomendada para esta versão:

1. Aplicar a migration `0019_purchase_workflow.sql` no D1 remoto.
2. Configurar `TICKET_INTAKE_KEY` com `wrangler secret put` (sem colocar no repo).
3. Rodar `npm run deploy`.
4. Abrir a URL e concluir a **Instalação inicial** (empresa, administrador e senha).
5. Validar `/api/health`, `/build-info.json` e os cabeçalhos `X-Facil-*`.

Guia completo para a equipe de TI: **`docs/IMPLANTACAO.md`**.

## Fluxo corporativo de compras

O fluxo v2 é o padrão para solicitações novas. O v1 continua disponível para
solicitações antigas e integrações que declarem `workflowVersion: 1`.

```text
Solicitante
  └─ cria e envia
       └─ Gestor do setor aprova a necessidade
            └─ Direção analisa orçamento e autoriza
                 └─ Compras registra propostas
                      └─ Comprador devolve a cotação
                           └─ Compras adjudica item a item
                                └─ Comprador emite pedido por fornecedor
                                     └─ Compras/comprador recebe e conclui
```

Caminhos alternativos:

- **Envio direto a compras:** o gestor do setor envia a solicitação direto para
  a triagem de compras, sem passar pela direção. A triagem pode devolver à
  direção ou autorizar a compra direta.
- **Compra direta:** compras autoriza a compra sem cotação; os itens são
  marcados como `purchase_mode = direct` e seguem para o pedido.
- **Adjudicação dividida:** fornecedores diferentes podem ganhar itens
  diferentes da mesma solicitação, gerando um pedido por fornecedor.
- **Item fora do catálogo:** o solicitante pode descrever o produto quando ele
  ainda não existe. A compra segue normalmente e o cadastro pode ser concluído
  durante o processo ou no recebimento, com revisão dos dados.

Regras que o backend garante:

- quem solicita não aprova a própria solicitação;
- a segunda aprovação deve ser de outro responsável;
- a direção registra orçamento e autorização;
- a adjudicação cobre todos os itens em cotação;
- o pedido inclui todos os itens aprovados e respeita o fornecedor adjudicado;
- o recebimento atualiza solicitação, pedido e linha do pedido;
- cada operação grava auditoria, notificação e evento de integração.

Detalhes de estados, permissões, payloads e erros: **`docs/COMPRAS.md`**.

## NetSuite e ServiceNow

A integração é preparada, não concluída:

- **Saída:** `integration_outbox` grava eventos na mesma transação da compra.
  Um integrador futuro consome, envia ao NetSuite e confirma por API.
- **Entrada:** `POST /api/intake/tickets` recebe chamados do ServiceNow com
  chave de serviço e idempotência por `externalRef`.
- **Administração:** `GET /api/integrations/outbox` e
  `POST /api/integrations/outbox/:id/ack` permitem inspecionar e confirmar.
- **Sem chamadas externas no caminho crítico:** nenhuma aprovação ou
  recebimento depende de NetSuite/ServiceNow disponível.

Contrato completo, eventos, mapeamento proposto e configuração de segredo:
**`docs/INTEGRACOES.md`**.

## Mapa do repositório

```text
src/worker/                 API Hono e regras de negócio
  index.ts                 montagem das rotas, segurança e estáticos
  auth.ts                  sessão, permissões e escopo
  audit.ts                 trilha de auditoria
  db.ts                    helpers D1 e statements
  errors.ts                formato único de erro
  notify.ts                notificações internas
  outbox.ts                eventos idempotentes de integração
  purchase-access.ts       visibilidade de compras por perfil/local
  routes/
    auth.ts                login, setup, sessão, perfil
    structure.ts           unidades, locais e salas
    users.ts               usuários, perfis e permissões
    catalog.ts             produtos, fornecedores e unidades
    stock.ts               saldos e movimentações
    consumption.ts         consumo
    inventories.ts         inventários
    tickets.ts             chamados
    workorders.ts          ordens de serviço
    purchases.ts           compras v1/v2, cotação, adjudicação, pedidos e recebimentos
    dashboard.ts           resumo e alertas
    reports.ts             relatórios e exportação
    settings.ts            configurações e credenciais
    audit.ts               consulta de auditoria
    attachments.ts         anexos (R2 opcional)
    notifications.ts       notificações
    support.ts             suporte público
    intake.ts              entrada externa de chamados
    integrations.ts        inspeção e confirmação do outbox

src/client/                 interface React
  app/                     layout, guardas, rotas e tema
  pages/                   login, painel, compras, chamados, OS, relatórios etc.
  components/              componentes reutilizáveis
  lib/                     API, sessão, marca, tema e utilitários
  public/branding/         logo, capas, favicon e wallpaper

src/shared/                 tipos, permissões e contratos usados nos dois lados
migrations/                 migrations D1 (0001..0019)
seeds/                      dados demo e reset local
tests/                      testes de integração (Worker + D1)
scripts/                    contrato de API, assinatura e release
docs/                       implantação, assinatura, compras, integrações e versão
memory/                     decisões, status, histórico, problemas e TODO
```

## Dados e migrations

- 19 migrations aplicadas em sequência; a última é
  `0019_purchase_workflow.sql`.
- Tabelas centrais do fluxo novo: `cost_centers`, `purchase_awards`,
  `purchase_orders`, `purchase_order_items`, `integration_outbox`,
  `ticket_intake_events`.
- A migration 0019 é **aditiva**: adiciona colunas e tabelas, marca solicitações
  antigas como versão 1 e não remove dados.
- A migration não cria o usuário `user_intake` em banco novo antes da
  instalação inicial; ele é criado no primeiro intake.
- Centros de custo iniciais: `CC-ADM`, `CC-OPE`, `CC-MAN`, `CC-LIM`.

## Decisões que não devem ser desfeitas sem migração

1. **v1 e v2 convivem.** Remover o v1 quebra histórico e integrações antigas.
2. **Permissões separadas.** `view_all`, `authorize`, `award` e `direct` não
   podem voltar a ser um único `purchases.approve`.
3. **Adjudicação por item.** O vencedor é por item, não por solicitação.
4. **Pedido por fornecedor.** Um pedido por fornecedor; o recebimento pode ser
   parcial e por pedido.
5. **Outbox na mesma transação.** Evento e operação precisam continuar juntos.
6. **Idempotência do intake.** `(source, external_ref)` é único.
7. **Valores em centavos.** Não usar float para dinheiro.
8. **Segredo fora do repositório.** Chaves só por `wrangler secret put`.

## Segurança e privacidade

- Sessão por cookie `HttpOnly`, `SameSite` e expiração; senhas com hash e salt.
- Permissões verificadas no Worker, não apenas na interface.
- Escopo de local aplicado em chamados, OS, compras, estoque e relatórios.
- Cabeçalhos de segurança, CSP, HSTS, `no-store` na API e proteção de mesma
  origem para escritas.
- Uploads com validação de tipo e limite; SVG/HTML bloqueados.
- Credenciais de configuração mascaradas e redigidas na auditoria.
- Nenhum segredo de produção no repositório ou no manifesto assinado.
- CPF/e-mail do autor não são armazenados nem exibidos; a autoria é só o nome.
- O repositório deve permanecer privado.

## Erros conhecidos e limitações

| Situação | Efeito | Contorno |
| --- | --- | --- |
| R2 não configurado | Anexos do suporte retornam `503 R2_UNAVAILABLE` | Configurar bucket R2 ou operar sem anexos |
| `TICKET_INTAKE_KEY` ausente | Intake externo retorna `503 INTAKE_DISABLED` | Configurar o segredo antes de habilitar o ServiceNow |
| Sem domínio próprio | URL permanece `*.workers.dev` | Configurar domínio e Cloudflare Access |
| Sem CI | Deploy é local e assinado | Rodar `npm run check` e `npm run deploy` |
| Força bruta | Limitação localizada no login/suporte, não WAF global | Ativar Cloudflare Access/WAF se exposto |
| NetSuite | Outbox pronto, consumidor não | Construir integrador e homologar mapeamento fiscal |
| Centros de custo | Seed fixo na migration; sem CRUD na UI | Editar por SQL/API ou criar tela administrativa |
| Alçada por valor | Não há aprovação automática por faixa de valor | Definir regra antes de produção ampla |

## Operação e recuperação

- **Backup:** exportar D1 periodicamente (`wrangler d1 export`) e guardar fora da
  Cloudflare. A chave de assinatura também precisa de backup próprio.
- **Atualização:** aplicar migrations antes do deploy; nunca editar uma release
  já publicada.
- **Rollback:** o Worker pode voltar para a release anterior, mas migrations
  aditivas não são revertidas automaticamente. Faça backup antes.
- **Assinatura:** `npm run sign` gera `SIGNATURE.json`; `npm run verify` confere
  versão, árvore e autor.
- **Produção atual:** `https://facil.cf-pilot-disposable.workers.dev`
  (release 0.3.0; `/api/health` informa o hash da árvore em execução).

## Memória e continuidade

- `memory/STATUS.md` — estado real, validações e pendências.
- `memory/DECISOES.md` — decisões arquiteturais e de produto.
- `memory/TODO.md` — próximos passos priorizados.
- `memory/PROBLEMAS.md` — problemas conhecidos e contornos.
- `memory/HISTORICO.md` — linha do tempo das etapas.
- `memory/INDEX.md` — índice da memória.
- `docs/COMPRAS.md` — fluxo v2 em detalhe.
- `docs/INTEGRACOES.md` — outbox, NetSuite e ServiceNow.
- `docs/IMPLANTACAO.md` — implantação corporativa, domínio, backup e atualização.
- `docs/ASSINATURA.md` — assinatura digital e custódia da chave.

## Handoff para a próxima equipe

1. Ler `memory/STATUS.md`, `docs/COMPRAS.md` e `docs/INTEGRACOES.md`.
2. Rodar `npm install`, `npm run check` e `npm run build`.
3. Aplicar a migration 0019 no D1 de destino e configurar
   `TICKET_INTAKE_KEY`.
4. Validar o fluxo v2 com os perfis reais (gestor, direção, compras,
   comprador) antes de abrir para a empresa.
5. Homologar centros de custo, plano de contas e alçadas com a controladoria.
6. Construir o consumidor do outbox e o mapeamento NetSuite.
7. Configurar domínio, Cloudflare Access, backup e rotação de credenciais.
8. Subir a versão, assinar, publicar e registrar a validação em `memory/`.

## Estrutura de documentação

- `docs/IMPLANTACAO.md` — implantação corporativa, domínio, backup, atualização.
- `docs/ASSINATURA.md` — assinatura digital, verificação e custódia da chave.
- `docs/COMPRAS.md` — fluxo corporativo de compras.
- `docs/INTEGRACOES.md` — outbox, NetSuite e ServiceNow.
- `docs/VERSIONAMENTO.md` — regra de versão e release.
- `docs/SEGURANCA-AUDITORIA-2026-10-20.md` — auditoria de segurança.
- `docs/anexos-suporte.md` — anexos do suporte (R2).
- `docs/email-gmail-senha-app.md` / `docs/email-relay-gmail.md` — e-mail.
- `memory/` — decisões, status e histórico do projeto.
