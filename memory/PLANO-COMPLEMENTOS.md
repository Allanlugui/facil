# Plano de Complementos — 17/10/2026

Backlog estruturado dos pedidos do usuário (mensagens de 17/10/2026). Este arquivo é a
referência de execução; o `TODO.md` aponta para cá. Nada aqui remove o que já funciona.

## Situação

- **CORRIGIDO E VERIFICADO (P-12):** painel vazava dados globais (tickets/OS/compras/estoque/
  inventário/recentes) para quem só tem `dashboard.view` (ex.: solicitante) — risco LGPD.
  Correção: escopo por permissão no servidor (`dashboard.ts`) + gating por permissão no cliente
  + teste novo (`painel nao expoe dados de outras areas ao solicitante`). 109/109 testes.
- **CORRIGIDO E VERIFICADO (F-12):** cadastro rápido de produto durante o recebimento de compras.
  Item sem produto no catálogo pode ser recebido informando apenas o nome; o produto nasce
  `catalog_status = 'incomplete'`, entra no estoque, gera auditoria (`product.quick_register`) e
  notificação para quem tem `catalog.manage`; o alerta no painel/catálogo só desaparece quando o
  cadastro for completado ("Marcar cadastro como completo" no produto). Migration `0007`.
- **RESPOSTA (fluxo atual de compras):** quem aprova é o perfil **Gerente de Facilities**
  (`purchases.approve`; admin também possui). O comprador **não** aprova (só pede/recebe) —
  `role_buyer` não tem `purchases.approve`. Solicitante não vê compras.
- **CONCLUÍDO (revisão UX/UI, 17/10/2026):** pt-BR integral (código + dados demo), pluralização
  automática, P-14 (links de notificação) e limpeza do rastro de smoke no D1 — relatório em
  `memory/REVISAO-UX-2026-10-17.md`.
- **FEITO (F-17, 17/10/2026):** **Central de Suporte** — canal público `/suporte` (funciona sem
  sessão; "Esqueceu a senha? Clique aqui" na tela de login), pedido com link/token de
  acompanhamento (conversa + posição discreta na fila), fila de atendimento para o administrador,
  central de ajuda interna `/ajuda` (informativos, segurança, FAQ), gestão de artigos e caixa de
  saída de e-mails (pendentes até configurar provedor — F-13). Migration `0008_support.sql`.
- **FEITO (F-18, 18/10/2026):** Configurações reorganizadas (o grupo "Gestão" saiu da barra
  lateral; Catálogo, Estrutura, Relatórios, Auditoria e Usuários dentro de Configurações, URLs
  preservadas, menu por seção) + **5 temas** (Clássico, Corporativo, Noturno, Violeta, Âmbar) com
  padrão do sistema pelo admin e escolha pessoal no perfil. Migration `0009_themes.sql`;
  `11-preferences.spec.ts`; pipeline verde (121/121); verificação visual desktop/mobile.
- **FEITO (F-19, 18/10/2026):** Anexos de arquivo no chat de suporte (screenshot/PDF/documento)
  **até 20 MB por arquivo** via **Cloudflare R2** (binding `ATTACHMENTS`, bucket
  `facil-attachments`; simulado no dev/testes; metadados em D1; BLOBs antigos do D1 continuam
  legíveis). Padrão **20 MB configurável** (`attachments.max_bytes`, catálogo até 50 MB); uploads
  anônimos por token com regras mais restritas (5 MB/3 arquivos/tipos reduzidos); download por
  sessão ou token; remoção com auditoria. Migration `0012`; `14-support-attachments.spec.ts`
  (6 testes); verificação visual real (`ux-shots/f19-*.png`); guia `docs/anexos-suporte.md`.
  Decisão registrada em D-18. Próximo sugerido: Grupo 1 (compras — F-01/F-02), após a decisão do
  usuário sobre cotação.
- **FEITO (F-09, 18/10/2026):** **Checklist de execução na OS** — o técnico (e o gestor de
  facilities) cria as etapas na própria ordem, marca/desmarca o que já executou e anexa **foto por
  etapa**; visível a quem enxerga a OS. Migration `0013` (`work_order_checklist_items` + tipo de
  evento `checklist`); `POST/PATCH/DELETE /api/workorders/:id/checklist` sob `workorders.execute`;
  fotos pelo módulo de anexos (`entity_type = 'work_order_checklist_item'`, sem armazenamento novo);
  rastro na linha do tempo e na auditoria; aviso ao responsável quando outra pessoa adiciona item;
  card com progresso, miniatura e remoção em cascata. 5 testes novos (pipeline **139/139**);
  verificação visual real (técnico Diego Rocha + gestora Ana Souza); capturas `ux-shots/checklist-*.png`.
  Decisão em D-22.
- **FEITO (F-20, 18/10/2026):** **Interfaces por perfil — fase 1** (decisão do usuário): painel
  inicial e menu próprios para o técnico ("Meu dia" — suas ordens, etapas obrigatórias pendentes,
  meus chamados, ações rápidas), o solicitante ("Meus serviços" — meus chamados + "Abrir chamado"
  via `/chamados?novo=1`), o gestor (visão geral + fila de aprovação de compras + ordens travadas
  pelo checklist do gestor) e o admin (visão geral + atalhos do sistema). Tudo no **mesmo**
  `/api/dashboard/summary`, com escopo por permissão/identidade (herança do P-12); nenhum endpoint
  nem app novo. Fase 2 (comprador, estoquista, limpeza, recepção) pendente. Pipeline verde
  **141/141**; verificação visual dos 4 perfis; capturas `ux-shots/perfil-*.png`; decisão em D-23.
- **FEITO (F-11 + escopo do estoque, 18/10/2026):** **busca aproximada de produto** em todos os
  pontos de seleção (consumo, movimentações de estoque, material da OS e do chamado, itens de
  compra com unidade pré-preenchida e filtros dos relatórios de movimentações/consumo) — componente
  `product-picker.tsx` com filtro enquanto digita (trecho do nome/SKU, **sem acento**, termos em
  qualquer ordem, ordenado por proximidade) e busca do servidor normalizada em TS + SQL
  (`src/worker/search.ts`; sem coluna nova). Junto: **o módulo de estoque passa a existir só para
  admin, gerente de facilities e estoquista** (migration `0014`: `stock.view`/`stock.replenish`
  removidos de comprador, técnico, limpeza (líder e colaborador) e recepção) — menu e rota somem
  por permissão e a API recusa chamadas diretas; o técnico registra material pela OS (atalho novo
  "Lançar material na ordem"). Pipeline verde **143/143**; verificação visual real (admin,
  comprador, técnico, mobile 390px); capturas `ux-shots/produto-busca-*.png` e
  `ux-shots/perfil-tecnico-sem-estoque.png`; decisão em D-24.
- **FEITO (F-20 fase 2 + F-16, 18/10/2026):** **painéis e menus por perfil** para **comprador**
  (aguardando aprovação/em andamento/a receber; cartões "Pedidos para registrar" e "Pedidos a
  receber"; alerta de cadastro incompleto), **estoquista** (saldos, mínimo, consumo e inventários;
  movimentações e itens críticos; ações de estoque), **limpeza/liderança** (consumo da equipe,
  chamados e, para o líder, inventários) e **recepção** (meus chamados, igual ao solicitante).
  Servidor: `purchases.awaitingOrder`/`toReceive` no `/api/dashboard/summary` com gate de
  permissão. Menus próprios em `layout.tsx`. Junto: **F-16** — helper
  `locationLabel({ path, unitName })` (`src/shared/locations.ts`) aplicado nos seletores de 8
  páginas + filtro dos relatórios, exibindo `Local — Unidade`. Pipeline verde **146/146** (15
  arquivos); verificação visual dos 5 perfis + mobile; capturas `ux-shots/f20-2-*.png` e
  `ux-shots/f16-local-unidade.png`; decisões em D-25..D-29.

## Fila de execução (ordem sugerida)

### Grupo 1 — Compras: decisão item a item, cotação e rastreio (P1)

- [x] **F-01 Decisão item a item (compra direta × cotação). — FEITO 19/10/2026.** Na análise do
      gestor, cada item é marcado como `direct` (compra direta) ou `quote` (cotar);
      `purchase_request_items.purchase_mode` (migration `0016`); aprovação com qualquer item em
      cotação leva a solicitação para **"Em cotação"** (o comprador continua o fluxo) e o detalhe
      mostra o selo por item. Testes + verificação real (SC-2026-000004). D-31.
- [x] **F-02 Retorno da cotação e aprovação final. — FEITO 19/10/2026.** Comprador registra as
      propostas (**fornecedor + valor por item**, mínimo 1 — D-26; repetir fornecedor atualiza) e
      devolve ao gestor ("Cotação retornada"); gestor aprova a vencedora ("Cotação aprovada" — as
      demais viram "Não escolhida") ou recusa (volta para cotação); o pedido nasce da proposta
      aprovada: **fornecedor obrigatório da proposta e preço herdado** por item. Tabelas
      `purchase_quotes`/`purchase_quote_items`; notificações próprias; pedido bloqueado durante a
      cotação. Testes + verificação real (COT-2026-000001/0002). D-31.
- [x] **F-03 Onde está comprando (fornecedor). — FEITO 19/10/2026.** O relatório de compras ganhou
      **"Pedidos por fornecedor"** no período (itens, quantidade e valor comprometido — valor
      herdado da proposta quando houver) e a **exportação** ganhou as colunas Modo, Cotação
      aprovada, Referência do pedido, Valor total e Último recebimento; o fornecedor também aparece
      na linha do tempo e no selo do pedido. D-32.
- [x] **F-04 Relatório de compras ampliado. — FEITO 19/10/2026.** Além dos cartões existentes:
      **"Cotações no período"** (total + situação), **"Pedidos por fornecedor"** e **"Ciclo das
      solicitações"** por solicitação (situação, solicitante, itens, itens cotados, propostas,
      fornecedor, valor pedido, previsto × recebido, recebimentos; até 100) com **filtro de
      situação** e exportação ampliada. D-32.
- [x] **F-05 Linha do tempo da solicitação. — FEITO 19/10/2026.** Timeline derivada do `audit_log`
      (sem tabela nova): cada passo do ciclo — criação, análise/decisão, propostas registradas,
      devolução, aprovação/recusa, pedido, recebimento — com autor, data e código (COT-/REC-),
      fornecedor e nota; card "Linha do tempo" no detalhe da solicitação. D-32.
- [x] **F-06 Destino final do material. — FEITO 19/10/2026 (formato decidido).** No recebimento, o
      item marcado como **"Uso direto"** entra e sai no mesmo lote (entrada `purchase_receipt` +
      saída `consumption` no livro-razão) com **uma justificativa** obrigatória (≥5 caracteres) por
      lote; o rastro contábil fica na razão e na linha do tempo e o recebimento exibe o selo "Uso
      direto". Reenvio do mesmo lote continua idempotente. D-32.

### Grupo 2 — Chamados/OS (operacional) (P1)

- [x] **F-07 Foto somente por câmera na execução. — FEITO 19/10/2026.** O checklist de execução
      ganhou o diálogo de câmera (`src/client/lib/camera.tsx`, `getUserMedia` + quadro para JPEG via
      canvas): "Tirar foto" abre a imagem ao vivo, "Capturar foto" gera o arquivo e anexa à etapa
      pelo módulo de anexos; **não existe mais seletor de arquivo** nesse fluxo. Metadados: o
      horário da captura vai no nome do arquivo (`foto-<ISO>.jpg`) e o anexo guarda autor/hora e a
      etapa (`entityType`/`entityId`). Permissão negada/sem câmera mostram orientação clara (sem
      caminho alternativo). Verificação real com câmera simulada (`canvas.captureStream`):
      JPEG 640×480 gravado e baixado com os pixels capturados; capturas `ux-shots/f07-*.png`. D-33.
- [x] **F-08 Anexos auxiliares (PDF/planilha) somente para superiores. — FEITO 19/10/2026.**
      Permissão nova `attachments.documents` (migration `0017`; administração e gerência) — documento
      (não-imagem) em chamado/OS é recusado no servidor (403) para os demais; a imagem (evidência de
      campo) continua livre para quem enxerga a entidade. No cliente, o card de anexos do chamado
      mostra "Anexar foto" (só imagem) para quem não tem a permissão e "Anexar arquivo" para a
      gestão. Teste em `05-tickets.spec.ts`; verificação real das duas faces; capturas
      `ux-shots/f08-*.png`. D-33.
- [x] **F-09 Checklist pessoal do técnico na OS (FEITO 18/10/2026).** Criar itens, marcar/desmarcar,
      anexar fotos por etapa; visível ao próprio técnico (e gestores). Entregue com migration
      `0013`, rotas sob `workorders.execute`, fotos pelo módulo de anexos, rastro na linha do tempo
      e na auditoria; D-22.
- [x] **F-10 OS filha. — FEITO 19/10/2026.** Vínculo `parent_work_order_id` (migration `0018`,
      auto-referência definida na criação; pai inexistente → 404, pai cancelada → 409) com a árvore
      pai/filha na tela da OS: link para a OS pai, lista de filhas com situação/responsável e
      "Abrir OS filha" (diálogo com local herdado). É informação de gestão: servidor e interface só
      devolvem/mostram a árvore para `facilities_manager`/`admin` (mesmo critério do painel); a
      linha do tempo registra a origem e a auditoria guarda o vínculo. `06-workorders.spec.ts` +1
      cenário; verificação real com a OS-2026-000008 criada a partir da OS-2026-000007; capturas
      `ux-shots/f10-*.png`. D-34.

### Grupo 3 — UX de estoque (P2)

- [x] **F-11 Autocomplete/type-ahead (FEITO 18/10/2026).** Todos os pontos de seleção de produto
      (consumo, movimentações, material de OS/chamado, itens de compra e filtros de relatórios) com
      busca enquanto digita — trecho de nome/SKU, sem acento, termos em qualquer ordem e ordenação
      por proximidade; componente `ProductPicker` + normalização TS/SQL em `src/worker/search.ts`
      (sem coluna nova). Junto: o módulo de estoque ficou restrito a admin/gerente/estoquista
      (migration `0014`); D-24.
- [ ] **F-12 (FEITO)** Cadastro rápido de produto no recebimento.

### Grupo 4 — Notificações por e-mail (P2 — depende de decisão de provedor)

- [x] **F-13 E-mail para notificações (FEITO E ATIVADO 18/10/2026 — relay e Gmail).** Notificação
      interna também vira e-mail; a fila `email_outbox` já era o caminho único. O envio para
      **qualquer** endereço sem custo e sem domínio funciona por duas vias: provedor `relay`
      (Web App do Google Apps Script — guia `docs/email-relay-gmail.md`) ou provedor `gmail`
      (**SMTP direto com senha de app**, sem script no Google — guia `docs/email-gmail-senha-app.md`);
      Resend/Brevo seguem disponíveis para quando houver domínio próprio. **Via ativa na conta do
      usuário: `gmail`** (18/10) — 4 e-mails reais entregues (teste + SUP-2026-000002), status
      "Enviado" no banco; nada mais a fazer do lado do usuário. Detalhes em D-20 e D-21.

### Grupo 5 — Estrutura e auditoria (P3)

- [x] **F-14 Revisar usabilidade da gestão de estrutura (FEITO 19/10/2026).** Árvore visual dos
      locais como visão padrão (seletor Árvore|Tabela; expandir/recolher; ações no nó, inclusive
      "+ Sublocal" com pai pré-selecionado) e diálogo enxuto com Código/Observações sob "Mais
      opções". Filtro "Todos os pais" removido por ser auto-referente; funções preservadas.
      Verificação real com Palco/Camarim criados pela tela; capturas `ux-shots/f14-*.png`. D-35
      (pendente: aceite do usuário da nova UX).
- [x] **F-15 "Assinatura digital" das ações — DECIDIDO (18/10/2026):** manter a trilha de auditoria
      atual (ator, hora, antes/depois, linha do tempo e CSV), **sem** hash encadeado (D-27).
- [x] **F-16 Desambiguar locais homônimos nos seletores (FEITO 18/10/2026).** Helper
      `locationLabel({ path, unitName })` em `src/shared/locations.ts` exibe
      `Local — Unidade`; aplicado nos seletores/filtros de estoque, consumo, inventário, chamados,
      OS, compras, usuários e relatórios. Evidência: `15-locations.spec.ts` e captura
      `ux-shots/f16-local-unidade.png` (D-29).

### Grupo 6 — Suporte (CONCLUÍDO)

- [x] **F-17 Central de Suporte (FEITO 17/10/2026).** Detalhes na "Situação" acima. Pendências
      ligadas: captcha (D-15, só como camada final) e provedor de e-mail (F-13).

### Grupo 7 — Configurações, aparência e anexos (18/10/2026)

- [x] **F-18 (FEITO 18/10/2026).** Reorganização de Configurações (grupo "Gestão" extinto; itens
      dentro de Configurações com URLs preservadas) + 5 temas com padrão do sistema e escolha
      pessoal. Migration `0009_themes`; `11-preferences.spec.ts`; pipeline 121/121. Detalhes na
      "Situação" e em D-17.
- [x] **F-19 Anexos grandes no chat de suporte (FEITO 18/10/2026).** Screenshot/PDF/documento até
      **20 MB por arquivo** via **Cloudflare R2** (binding `ATTACHMENTS`; metadados em D1; BLOBs
      antigos do D1 continuam funcionando). Padrão **20 MB configurável**
      (`attachments.max_bytes`); uploads anônimos por token com regras mais restritas (5 MB,
      3 arquivos, tipos reduzidos). Migration `0012`; `14-support-attachments.spec.ts` (6 testes);
      pipeline 134/134; verificação visual real; guia `docs/anexos-suporte.md`. Decisão em D-18.

### Grupo 8 — Interfaces por perfil (18/10/2026)

- [x] **F-20 fase 1 (FEITO 18/10/2026):** painel + menu por perfil para técnico, gestor, solicitante
      e admin (D-23). Detalhes na "Situação".
- [x] **F-20 fase 2 (FEITO 18/10/2026):** perfis **comprador**, **estoquista**, **liderança de
      limpeza**, **equipe de limpeza** e **recepção** — painéis próprios com dados do resumo já
      escopados (fila de pedidos/recebimentos, saldos/movimentações, consumo da equipe, meus
      chamados), menus próprios em `layout.tsx`; blocos compartilhados extraídos. Detalhes na
      "Situação" e em D-29.

## Decisões pendentes do usuário

1. ~~E-mail: qual provedor/domínio pode ser usado~~ **RESOLVIDO E ATIVO (18/10/2026):** Gmail da
   própria conta do usuário, **sem Apps Script** — senha de app + SMTP direto (D-21; guia
   `docs/email-gmail-senha-app.md`), com o relay por Apps Script (D-20) mantido como alternativa.
   Já entregou e-mails reais. Domínio próprio continua sendo o upgrade futuro (Resend/Brevo).
2. ~~Cotação (F-02): propostas de fornecedores × só sinalizar itens~~ **RESOLVIDO (18/10/2026):**
   **propostas de fornecedor com valor por item**, comparação e aprovação do gestor; o pedido nasce
   da proposta aprovada (D-26).
3. ~~Assinatura digital (F-15): manter trilha × hash encadeado~~ **RESOLVIDO (18/10/2026):** manter
   a trilha atual (ator/hora/antes-depois/CSV), sem hash encadeado (D-27).
4. Captcha (D-15): entra como camada final, depois de o usuário validar o processo em uso real —
   vale para o suporte e para os logins.

**Escopo aprovado (18/10/2026):** fechar todo o backlog funcional antes da identidade visual
(D-25); a identidade usa imagens de `branding/` e capas apenas no topo dos painéis iniciais e no
login (D-28).
