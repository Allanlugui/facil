# Auditoria de Aderência ao PROMPT MESTRE — Projeto Facil

**Data da auditoria:** 17/10/2026
**PROMPT MESTRE:** recuperado da sessão OpenCode `ses_eb866a2bbffeXV0ExchetkHH1a` (seq=600, 45.390 chars) e salvo em `memory/PROMPT-MESTRE.md`.
**Memória global:** `F:\DEV\memory` não existe; raiz canônica é `D:\DEV\memory` (validado em D-01). Conhecimento global do projeto em `D:\DEV\memory\Facil\`.

---

## A. Resumo executivo

**Estado geral:** A plataforma está **substantivamente aderente** ao PROMPT MESTRE. A arquitetura (Workers + Hono + D1 + React 19 + Vite) foi implementada por completo, com 16 módulos de rota no worker, 17 páginas no cliente, migrations 0001–0006, 107 testes automatizados (real D1) e validação visual desktop/mobile. A grande maioria dos requisitos funcionais, de segurança e de auditoria está atendida com evidência.

**Comprovadamente funcional (ATENDIDO):**
- Autenticação (PBKDF2 100k, sessão opaca em cookie HttpOnly, throttle 10 falhas/15 min, rehash automático, rotação de sessão na troca de senha, setup single-shot).
- Autorização no servidor com matriz `role_permissions`, `default deny`, escopo por local, guardas contra escalonamento de privilégio e auto-atribuição.
- Motor de estoque: movimentos como fonte de verdade, saldo derivado, `db.batch()` atômico, idempotência por `request_key` UNIQUE + replay, triggers anti-negativo (configurável via `stock.allow_negative`), reversão controlada com justificativa.
- Consumo operacional: dois modos (medição sem baixa + baixa efetiva), reposição de água que não duplica dedução, periodicidade, cancelamento com reversão, anti-duplicidade por índice parcial.
- Inventário periódico: snapshot com regras explícitas (inativos marcados), contagem preservando histórico (`inventory_counts`), ajuste gerando movimento real, fechamento com exceção justificada, reabertura auditada, relatório de fechamento.
- Tickets/OS: abertura com anexos, resolução imediata, conversão com vínculo preservado (UNIQUE), materiais via motor compartilhado, status transitions, comentários, histórico de auditoria.
- Compras: ciclo completo (rascunho → aprovação → cotação/pedido → recebimento parcial/integral), idempotência de recebimento, entrada de estoque correspondente, divergências.
- Anexos: upload/download/delete com validação de MIME/tamanho, controle de acesso por entidade, auditoria.
- Painel com indicadores reais, alertas, notificações internas.
- Relatórios (9 visões + exportação CSV com BOM/`;`).
- Auditoria append-only com antes/depois, filtros e exportação.
- Configurações tipadas com efeito real (trigger anti-negativo lê `stock.allow_negative`).
- Estrutura organizacional: hierarquia livre com validação de ciclos, path materializado, soft-delete com guards.
- Usuários/perfis/permissões com escopo por local.

**Parcialmente funcional (PARCIAL):**
1. **Gestão da estrutura organizacional no cliente:** o backend tem CRUD completo (`/api/structure/*`), mas **não existe nenhuma página no cliente** para cadastrar/editar/inativar unidades, tipos de local ou locais. A estrutura só é gerenciável via API direta. (master §5, §14)
2. **Relatório de divergências de inventário (`/api/reports/inventory-variances`):** retorna **500 Internal Server Error** — a query SQL referencia colunas inexistentes (`inv.scheduled_for`, `ii.qty_expected_milli`, `ii.qty_counted_milli`). Afeta tanto o endpoint JSON quanto a exportação CSV. (master §8.4, §13)
3. **Anexos:** backend suporta `work_order`, `purchase_request`, `purchase_receipt`, `inventory`, `consumption_record`, `product`, `location`, mas a UI só expõe anexos em chamados. (master §9.1, §10.3)
4. **Configurações:** apenas settings tipados + categorias de ticket. Faltam: tipos de local (estão em estrutura, mas sem UI), categorias de produto (na tela de catálogo — OK), UMs (na tela de catálogo — OK), status/prioridades (fixos por enum), tipos de OS (reutiliza categorias de ticket), periodicidade de manutenção, preferências de relatório, configurações de segurança.
5. **PDF:** exportação apenas CSV; master §13 menciona "CSV e PDF, quando adequado".

**Ausente (AUSENTE):**
1. **Manutenção programada/periodicidade:** não existe agendamento de manutenção preventiva. Master §9.3 menciona "Programação e periodicidade de manutenção, se exigidas" — condicional.
2. **Centros de custo / departamentos:** não implementados. Master §4.1 lista "se exigidos pela operação" — condicional.
3. **Tipos de movimentação configuráveis:** fixos no CHECK constraint do banco. Master §4.1 lista "Tipos de movimentação e motivos de ajuste de estoque" — a implementação tem motivos livres (campo `reason` TEXT) mas tipos fixos.
4. **Cancelamento de inventário:** schema tem status 'cancelled' mas não há rota para cancelar. Apenas fechar/reabrir.
5. **Permissão de "editar" separada de "gerenciar":** a maioria dos módulos usa `manage` como permissão única de escrita. Master §6 lista "Editar" como ação distinta — granularidade menor que a especificação.

**Riscos identificados:**
- P0: Nenhum risco P0 identificado. A segurança está robusta (autorização no servidor, triggers no banco, idempotência, escopo por local).
- P1: Relatório de divergências de inventário quebrado (500) — afeta operação de fechamento mensal. Sem UI de gestão de estrutura — impede operação sem API direta.
- P2: Anexos não acessíveis em OS/compras/etc. Settings incompletos. Cancelamento de inventário ausente.
- P3: PDF export, manutenção preventiva, centros de custo, granularidade de permissões.

---

## B. Matriz de rastreabilidade (resumo por módulo)

| ID | Módulo | Requisito (resumo) | Estado | Evidência |
|----|--------|---------------------|--------|-----------|
| R-01 | Auth | Login/logout/sessão PBKDF2 | ATENDIDO | `worker/routes/auth.ts`, `worker/auth.ts`, testes 01-auth |
| R-02 | Auth | Throttle de login (10/15min) | ATENDIDO | `auth.ts` L232-260, audit_log |
| R-03 | Auth | Troca de senha obrigatória (must_change) | ATENDIDO | `auth.ts` L369-418, `users.must_change_password` |
| R-04 | Auth | Setup single-shot | ATENDIDO | `auth.ts` L91-96 (COUNT users = 0) |
| R-05 | Estrutura | Unidades CRUD | ATENDIDO (backend) / AUSENTE (UI) | `structure.ts` L64-113, sem página cliente |
| R-06 | Estrutura | Tipos de local configuráveis | ATENDIDO (backend) / AUSENTE (UI) | `structure.ts` L163-210, 13 tipos no seed |
| R-07 | Estrutura | Locais hierárquicos CRUD | ATENDIDO (backend) / AUSENTE (UI) | `structure.ts` L264-518, validação de ciclos |
| R-08 | Estrutura | Soft-delete com guards | ATENDIDO | `structure.ts` L473-518 (children + stock) |
| R-09 | Estrutura | Path materializado | ATENDIDO | `recomputePaths()` L557-590 |
| R-10 | Estrutura | Escopo por local | ATENDIDO | `user_location_scopes`, `assertLocationAllowed` |
| R-11 | Usuários | CRUD de usuários | ATENDIDO | `users.ts` L352-410, página `users.tsx` |
| R-12 | Usuários | Perfis/roles configuráveis | ATENDIDO | `users.ts` L114-161, 9 perfis no seed |
| R-13 | Usuários | Matriz de permissões editável | ATENDIDO | `users.ts` L199-229, `users.permissions` guard |
| R-14 | Usuários | Escalonamento de privilégio bloqueado | ATENDIDO | `users.ts` L223-226, L588-591 |
| R-15 | Usuários | Ativar/desativar sem apagar histórico | ATENDIDO | `users.is_active`, `users.ts` L436 |
| R-16 | Catálogo | Produtos CRUD | ATENDIDO | `catalog.ts`, página `catalog.tsx` |
| R-17 | Catálogo | Categorias com subcategorias | ATENDIDO | `product_categories.parent_id`, seed |
| R-18 | Catálogo | UMs configuráveis | ATENDIDO | `uoms`, seed 13 UMs, CRUD na UI |
| R-19 | Catálogo | Fornecedores CRUD | ATENDIDO | `suppliers`, CRUD na UI |
| R-20 | Catálogo | Embalagem comercial + fator conversão | ATENDIDO | `products.pack_uom_id`, `pack_factor` |
| R-21 | Catálogo | Estoque mínimo | ATENDIDO | `products.min_qty_milli`, alertas no dashboard |
| R-22 | Estoque | Entradas/saídas/transferências | ATENDIDO | `stock.ts` POST /movements, 7 tipos |
| R-23 | Estoque | Reposição de ambiente | ATENDIDO | tipo `replenish`, master §7.4 |
| R-24 | Estoque | Consumo operacional | ATENDIDO | `consumption.ts`, 2 modos |
| R-25 | Estoque | Perda/descarte | ATENDIDO | tipo `loss`, permissão `stock.loss` |
| R-26 | Estoque | Devolução | ATENDIDO | tipo `return` |
| R-27 | Estoque | Ajuste de estoque | ATENDIDO | tipo `correction`, permissão `stock.adjust` |
| R-28 | Estoque | Saldo negativo bloqueado (configurável) | ATENDIDO | triggers + `stock.allow_negative` |
| R-29 | Estoque | Anti-duplicidade de movimentos | ATENDIDO | `request_key` UNIQUE + replay |
| R-30 | Estoque | Histórico de movimentações | ATENDIDO | `/api/stock/movements` com filtros |
| R-31 | Estoque | Reversão controlada | ATENDIDO | `/movements/:id/reverse` |
| R-32 | Estoque | Alertas de estoque baixo | ATENDIDO | dashboard + reports/low-stock |
| R-33 | Estoque | Alertas por local | ATENDIDO | `stock.low_stock_scope = per_location` |
| R-34 | Consumo | Reposição de água sem auto-consumo | ATENDIDO | replenish ≠ consumption (master §7.4) |
| R-35 | Consumo | Consumo semanal por equipe/período | ATENDIDO | `consumption_records.periodicity` |
| R-36 | Consumo | Consumo de copas (vários itens) | ATENDIDO | `consumption.items` array |
| R-37 | Consumo | Anti-duplicidade de consumo | ATENDIDO | `idx_consumption_request_key` |
| R-38 | Consumo | Cancelamento com reversão | ATENDIDO | `/consumption/:id/cancel` |
| R-39 | Inventário | Abertura de ciclo | ATENDIDO | `/inventories` POST |
| R-40 | Inventário | Snapshot com inativos marcados | ATENDIDO | `is_inactive_product` flag |
| R-41 | Inventário | Sync de novos produtos | ATENDIDO | `/inventories/:id/sync-items` |
| R-42 | Inventário | Contagem com histórico | ATENDIDO | `inventory_counts` + superseded_by |
| R-43 | Inventário | Skip com justificativa | ATENDIDO | `/items/:itemId/skip` |
| R-44 | Inventário | Ajuste gerando movimento real | ATENDIDO | `/items/:itemId/adjust` |
| R-45 | Inventário | Fechamento com exceção | ATENDIDO | `/close` com force + reason |
| R-46 | Inventário | Reabertura auditada | ATENDIDO | `/reopen` com reason |
| R-47 | Inventário | Relatório de fechamento | ATENDIDO | `/inventories/:id/report` |
| R-48 | Inventário | Cancelamento de inventário | AUSENTE | schema tem 'cancelled' mas sem rota |
| R-49 | Inventário | Relatório de divergências | COM DEFEITO | 500 — colunas inexistentes |
| R-50 | Tickets | Abertura com anexos | ATENDIDO | `tickets.tsx` AttachmentsCard |
| R-51 | Tickets | Categorias configuráveis | ATENDIDO | `ticket_categories` + settings UI |
| R-52 | Tickets | Resolução imediata | ATENDIDO | `/tickets/:id/resolve` |
| R-53 | Tickets | Conversão em OS (sem duplicação) | ATENDIDO | `/tickets/:id/convert` + UNIQUE |
| R-54 | Tickets | Materiais em ticket | ATENDIDO | `/tickets/:id/materials` |
| R-55 | Tickets | Histórico completo | ATENDIDO | audit_log + comments + materials |
| R-56 | Tickets | Filtros | ATENDIDO | status, priority, category, location, etc. |
| R-57 | Tickets | Visibilidade (próprios vs todos) | ATENDIDO | `visibilityClause`, `tickets.view_all` |
| R-58 | OS | CRUD de OS | ATENDIDO | `workorders.ts`, página `workorders.tsx` |
| R-59 | OS | Status transitions | ATENDIDO | `/status`, `STATUS_TIMESTAMP_COLUMN` |
| R-60 | OS | Materiais em OS | ATENDIDO | `/workorders/:id/materials` |
| R-61 | OS | Close/cancel | ATENDIDO | `/close`, `/cancel` |
| R-62 | OS | Comentários | ATENDIDO | `/comments` |
| R-63 | Compras | Solicitação de compra | ATENDIDO | `purchases.ts` POST / |
| R-64 | Compras | Aprovação/rejeição | ATENDIDO | `/decide` com self-approval guard |
| R-65 | Compras | Pedido (cotação) | ATENDIDO | `/order` |
| R-66 | Compras | Recebimento parcial/integral | ATENDIDO | `/receipts` com caps |
| R-67 | Compras | Entrada de estoque correspondente | ATENDIDO | movement_id UNIQUE |
| R-68 | Compras | Idempotência de recebimento | ATENDIDO | `request_key` UNIQUE |
| R-69 | Compras | Divergências de recebimento | ATENDIDO | `has_discrepancy`, `discrepancy_note` |
| R-70 | Compras | Painel de compras | ATENDIDO | página `purchases.tsx` |
| R-71 | Dashboard | Indicadores reais | ATENDIDO | `/dashboard/summary`, `/alerts` |
| R-72 | Dashboard | Notificações internas | ATENDIDO | `notifications.ts` |
| R-73 | Relatórios | 9 visões + filtros | ATENDIDO | `reports.ts` (10 endpoints) |
| R-74 | Relatórios | Exportação CSV | ATENDIDO | `/export` com BOM/`;` |
| R-75 | Relatórios | Exportação PDF | AUSENTE | apenas CSV |
| R-76 | Auditoria | Trilha append-only | ATENDIDO | `audit_log` + `audit.ts` |
| R-77 | Auditoria | Filtros e exportação | ATENDIDO | `/audit` com facets |
| R-78 | Anexos | Upload/download/delete | ATENDIDO | `attachments.ts`, UI em tickets |
| R-79 | Anexos | Validação MIME/tamanho | ATENDIDO | `ALLOWED_MIME_PREFIXES`, `max_bytes` |
| R-80 | Anexos | Controle de acesso por entidade | ATENDIDO | `ENTITY_PERMISSIONS` |
| R-81 | Settings | Settings tipados com efeito real | ATENDIDO | `settings.ts`, trigger lê config |
| R-82 | Settings | Categorias de ticket | ATENDIDO | settings UI tab |
| R-83 | Settings | Gestão de estrutura (UI) | AUSENTE | backend OK, sem UI |
| R-84 | Settings | Tipos de manutenção/periodicidade | AUSENTE | não implementado |
| R-85 | Settings | Preferências de relatório | AUSENTE | não implementado |
| R-86 | Settings | Configurações de segurança | AUSENTE | não implementado |

---

## C. Inventário dos cadastros

| Cadastro | Existe (DB) | Tela funcional | Persistência | Campos implementados | Campos faltando | Módulos dependentes | Correção |
|----------|-------------|----------------|-------------|---------------------|-----------------|---------------------|----------|
| Unidades (units) | Sim | **Não** | Sim | name, code, address, notes, is_active | — | estrutura, estoque, consumo, inventário, tickets, compras | Criar página de gestão de estrutura no cliente |
| Tipos de local (location_types) | Sim | **Não** | Sim | name, code, description, sort_order, is_active | — | estrutura | Mesmo acima |
| Locais (locations) | Sim | **Não** | Sim | unit_id, parent_id, type_id, name, code, path, notes, is_active | — | todos os módulos operacionais | Mesmo acima |
| Perfis (roles) | Sim | Sim (users.tsx) | Sim | name, code, description, is_system, is_active | — | usuários, permissões | — |
| Permissões (permissions) | Sim | Sim (users.tsx) | Sim | code, module, action, description | — | todos | — |
| Usuários (users) | Sim | Sim (users.tsx) | Sim | name, email, role, unit, employee_code, phone, job_title, notes, is_active, must_change_password | — | todos | — |
| Categorias de produto (product_categories) | Sim | Sim (catalog.tsx) | Sim | name, parent_id, description, sort_order, is_active | — | catálogo, estoque | — |
| UMs (uoms) | Sim | Sim (catalog.tsx) | Sim | code, name, allows_decimal, is_active | — | catálogo, compras | — |
| Fornecedores (suppliers) | Sim | Sim (catalog.tsx) | Sim | name, doc, contact_name, phone, email, notes, is_active | — | catálogo, compras | — |
| Produtos (products) | Sim | Sim (catalog.tsx) | Sim | sku, name, description, category, uom, pack_uom, pack_factor, min_qty, supplier, requires_location, is_active, notes | — | estoque, consumo, inventário, compras | — |
| Categorias de ticket (ticket_categories) | Sim | Sim (settings.tsx) | Sim | name, code, default_kind, description, sort_order, is_active | — | tickets, OS | — |
| Settings (settings) | Sim | Sim (settings.tsx) | Sim | key, value, description, updated_at, updated_by | — | todos | — |

---

## D. Auditoria da árvore estrutural

- **Níveis hierárquicos existentes:** Unidade → Local (parent_id livre) → ... com tipos configuráveis (13 tipos seed: unidade, prédio, andar, setor, sala, sala de reunião, recepção, copa, banheiro, almoxarifado, área técnica, auditório, estacionamento, outro).
- **Armazenamento:** `locations` com `unit_id` (FK), `parent_id` (FK auto-referência), `type_id` (FK location_types), `path` materializado (recalculado após mudanças).
- **Interface:** Backend completo (GET tree, POST, PATCH, DELETE). **Frontend: nenhuma página de gestão.** Apenas leitura via lookups.
- **Configurabilidade:** Tipos de local são configuráveis via API. Hierarquia é livre (sem restrição de tipo-pai), intencionalmente flexível.
- **Validações:** Self-parent bloqueado, ciclos prevenidos (CTE recursivo), parent da mesma unidade exigido, soft-delete com guards (children ativos + saldo ≠ 0).
- **Uso pelos módulos:** Todas as tabelas operacionais referenciam `locations(id)` (tickets, work_orders, consumption_records, inventories, purchase_requests, stock, movements). Filtros por local em todas as listagens.
- **Lacunas:** Sem UI de gestão. Sem restrição de tipo-pai (um "banheiro" pode ser pai de um "prédio" — flexível demais, mas não bloqueante).

---

## E. Auditoria técnica e de segurança

**Persistência:** D1 (SQLite) com migrations versionadas, constraints FK, triggers, índices. Quantidades em milli-units (INTEGER), dinheiro em centavos (INTEGER), datas ISO-8601 UTC (TEXT). Todas as operações críticas usam `db.batch()`.

**Validações:** Zod 4 no backend para todos os endpoints. Validações de negócio (saldo suficiente, local ativo, produto ativo, etc.) no worker. Triggers no banco como última linha de defesa.

**Permissões:** 45 permissões em 12 módulos. `requirePermission` por rota, `default deny`. Escopo por local via `user_location_scopes`. Guardas contra escalonamento (não concede permissão que não possui, não atribui role com permissões que não possui). Telas escondem ações por UX, servidor decide de novo.

**Integridade de dados:** Movimentos são fonte de verdade. Saldo derivado. Histórico imutável (reversão, não edição). `stock_from_movements` view para reconciliação. Idempotência por `request_key`.

**Transações:** `db.batch()` para todas as operações multi-tabela (movimento + saldo + auditoria, consumo, recebimento, OS, inventário).

**Trilha de auditoria:** `audit_log` append-only com actor_id, actor_name, module, action, entity_type/id, before/after JSON, result, reason, ip, user_agent, created_at. Presente em todas as operações relevantes.

**Testes:** 107/107 em 9 spec files (auth, stock, consumption, inventory, tickets, workorders, purchases, settings, reports). D1 isolado por spec (real SQL, triggers, regras). Smoke HTTP 11/11. Typecheck (worker + cliente) limpo. Lint limpo. Build OK. `wrangler deploy --dry-run` OK.

**Segredos:** Nenhum segredo exposto no código. PBKDF2 com salt aleatório. Tokens opacos (não JWT). Cookie HttpOnly + SameSite=Lax + Secure (quando HTTPS).

**Uploads:** Limite de tamanho configurável (400 KB), MIME allowlist, validação de entidade existente, controle de acesso por entidade, owner-or-admin delete.

**Vulnerabilidade encontrada (durante auditoria):** `/api/reports/inventory-variances` retorna 500 — query SQL com colunas inexistentes (`inv.scheduled_for`, `ii.qty_expected_milli`, `ii.qty_counted_milli`). Afeta também a exportação CSV. **COM DEFEITO.**

---

## F. Plano de correção priorizado

### P0 — Crítico
Nenhum item P0. A segurança e a integridade de dados estão robustas.

### P1 — Essencial

**P1-1: Corrigir relatório de divergências de inventário**
- **Objetivo:** Fazer o endpoint `/api/reports/inventory-variances` e a exportação CSV funcionarem.
- **Arquivos:** `src/worker/routes/reports.ts` (linhas 752-827 e 1118-1170).
- **Correção:** Substituir `inv.scheduled_for` por `inv.opened_at` (ou remover), `ii.qty_expected_milli` por `ii.system_qty_milli`, `ii.qty_counted_milli` por `ii.counted_qty_milli`.
- **Risco:** Baixo. Correção de nomes de coluna.
- **Critério de aceite:** `GET /api/reports/inventory-variances` retorna 200 com dados; CSV exportável.

**P1-2: Criar UI de gestão da estrutura organizacional**
- **Objetivo:** Permitir cadastrar/editar/inativar unidades, tipos de local e locais via interface.
- **Arquivos:** Nova página `src/client/pages/structure.tsx` (ou seção em settings), registro no `router.tsx`, nav no `layout.tsx`.
- **Dependências:** Backend já pronto (`/api/structure/*`).
- **Risco:** Médio. Nova página com formulários hierárquicos.
- **Critério de aceite:** Usuário com `structure.manage` consegue criar unidade → local pai → local filho via UI; árvore navegável.

### P2 — Importante

**P2-1: Expor anexos em OS, compras e inventário na UI**
- **Objetivo:** Reutilizar o `AttachmentsCard` de tickets em workorders, purchases, inventory.
- **Arquivos:** `src/client/pages/workorders.tsx`, `purchases.tsx`, `inventory.tsx`.
- **Dependências:** Backend já suporta (ENTITY_PERMISSIONS).
- **Risco:** Baixo.

**P2-2: Cancelamento de inventário**
- **Objetivo:** Adicionar rota `POST /inventories/:id/cancel` com justificativa, respeitando status (apenas 'open').
- **Arquivos:** `src/worker/routes/inventory.ts`, `src/client/pages/inventory.tsx`.
- **Risco:** Baixo.

**P2-3: Completar settings**
- **Objetivo:** Adicionar tabs para tipos de local (ou mover para estrutura), status/prioridades (se configuráveis), preferências de relatório.
- **Risco:** Médio. Requer decisão de escopo.

**P2-4: Granularidade de permissões (editar vs gerenciar)**
- **Objetivo:** Separar `*.edit` de `*.manage` onde fizer sentido (ex: editar produto sem gerenciar categorias).
- **Risco:** Médio. Requer migração de permissões e atualização de matriz.

### P3 — Evolução

**P3-1: Exportação PDF**
- **Objetivo:** Adicionar geração de PDF nos relatórios (master §13 "CSV e PDF, quando adequado").
- **Risco:** Médio. Requer biblioteca de PDF no worker.

**P3-2: Manutenção preventiva/periodicidade**
- **Objetivo:** Agendamento de manutenção com periodicidade.
- **Risco:** Alto. Novo módulo.

**P3-3: Centros de custo / departamentos**
- **Objetivo:** Cadastro de centros de custo se a operação exigir.
- **Risco:** Médio. Novo cadastro + vínculos.

**P3-4: Tipos de movimentação configuráveis**
- **Objetivo:** Mover tipos de movimento do CHECK constraint para tabela configurável.
- **Risco:** Alto. Alteração de schema.

---

## G. Critérios para considerar o projeto aderente

Um módulo é considerado concluído quando:
1. **Funcionalidade real:** operações persistem no banco e são verificáveis.
2. **Regras de negócio:** validações no backend + banco (triggers, constraints).
3. **Autorização:** permissões checadas no servidor, não apenas na UI.
4. **Integração:** vínculos com outros módulos funcionam (ex: material em OS gera movimento).
5. **Auditoria:** operações relevantes registradas com antes/depois.
6. **Testes:** pelo menos 1 teste automatizado cobrindo o fluxo principal.
7. **UI:** página acessível, formulários com validação, feedback de sucesso/erro, responsiva.
8. **Documentação:** memory files atualizados.

**Módulos que atendem todos os critérios:** Auth, Estoque, Consumo, Inventário (exceto relatório de divergências), Tickets, OS, Compras, Dashboard, Auditoria, Anexos (parcialmente — apenas tickets na UI), Catálogo.

**Módulos que NÃO atendem todos os critérios:** Estrutura (sem UI), Relatórios (inventory-variances quebrado), Settings (incompleto).

---

## H. Dúvidas e decisões pendentes

### Requisitos explícitos do PROMPT MESTRE
- Manutenção programada: "Programação e periodicidade de manutenção, se exigidas" (§9.3) — condicional, não implementado. Decisão: implementar ou marcar como fora do escopo?
- Centros de custo: "se exigidos pela operação" (§4.1) — condicional.
- Tipos de movimentação configuráveis: "Tipos de movimentação e motivos de ajuste" (§4.1) — motivos são livres, tipos fixos.

### Decisões técnicas já documentadas
- D-04: Stack Workers + Hono + D1 (validado).
- D-05: Sem Next.js/Supabase (validado).
- D-06: Modelo de dados com milli-units, centavos, ISO UTC (validado).
- D-10: Deploy planejado, não publicado (validado).

### Propostas novas (não são obrigações do prompt)
- CI no GitHub Actions espelhando `npm run check` (opcional).
- Anexos em OS/compras (backend pronto, UI pendente).
- Granularidade de permissões edit/manage.

### Ambiguidades que exigem decisão humana
1. A gestão de estrutura deve ser uma página separada ou tab em settings?
2. PDF é necessário ou CSV é suficiente ("quando adequado")?
3. Manutenção preventiva e centros de custo são necessários para a operação real?
4. O relatório de divergências deve incluir `scheduled_for` (campo que não existe) ou `opened_at`/`closed_at`?

---

## Conclusão

O projeto Facil está **altamente aderente** ao PROMPT MESTRE. A grande maioria dos requisitos está implementada com robustez técnica (autorização no servidor, integridade no banco, idempotência, auditoria, testes reais). Os gaps identificados são:

1. **1 bug real** (relatório inventory-variances retorna 500) — P1, correção trivial.
2. **1 lacuna de UI** (sem gestão de estrutura no cliente) — P1, backend pronto.
3. **Vários itens P2/P3** (anexos em mais entidades, settings incompletos, cancelamento de inventário, PDF, manutenção preventiva, centros de custo) — a maioria condicional ou evolutiva.

**Nenhum risco P0 (segurança/integridade).** O sistema pode ser considerado pronto para deploy após correção do P1-1 e P1-2.

---

## Atualizacao: correcoes P1 aplicadas (17/10/2026)

Ambos os itens P1 foram corrigidos e verificados:

- **P-10 (RESOLVIDO):** colunas SQL do relatorio inventory-variances corrigidas
  (scheduled_for -> opened_at, qty_expected_milli -> system_qty_milli,
  qty_counted_milli -> counted_qty_milli). Endpoint retorna 200. Verificado via API.
- **P-11 (RESOLVIDO):** pagina de gestao de estrutura criada (structure.tsx com 3 abas:
  Unidades, Tipos de local, Locais). Rota /estrutura e link no menu adicionados.
  Build + typecheck + lint + check:api verdes.

Pipeline completo verde: typecheck, lint, check:api (42 caminhos), 107/107 testes, build OK.

Itens P2/P3 permanecem no backlog (anexos em mais entidades, settings incompletos,
cancelamento de inventario, PDF, manutencao preventiva, centros de custo).
