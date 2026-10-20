# Revisão UX/UI completa — 17/10/2026

- **Pedido do usuário:** "faça uma revisão completa na ux/ui" — revisão com **correções aplicadas**
  na mesma passada (não apenas relatório).
- **Método:** varredura automatizada de pt-BR (script `acentos.mjs` com dicionário + frases, 6
  rodadas + ajustes manuais), pluralização com helper dedicado, correção dos dados de demonstração
  no D1, varredura de resíduos em código/dados/UI e verificação visual no Playwright
  (desktop 1440×900 + mobile 390×844).

## 1. Acentuação pt-BR integral

- **~140 linhas corrigidas** em `src/**`, `tests/**`, `seeds/**`, `migrations/**` (dicionário com
  ~300 palavras + regras de frase; preservação de caixa; ids/nomes de arquivo/rotas protegidos).
- **Banco demo (D1 local):** 128 UPDATEs com a mesma transformação — produtos, categorias, locais
  (inclusive `path`), movimentos, notificações, permissões, papéis, fornecedores, chamados, OS,
  unidades, usuários, configurações. `settings.value` (`company.name` = "Empresa Demonstração")
  corrigido à parte, pois valores técnicos do settings são excluídos por segurança.
- **Proteções intencionais em ASCII:** rotas da SPA (`/configuracoes`, `/inventario`...), requestKeys,
  e-mails (`recepcao@facil.test`, `tecnico@facil.test`), placeholder `voce@empresa.com.br`, nomes de
  arquivo de exportação (`posicao-estoque.csv`, `divergencias-inventario.csv`), fuso
  `America/Sao_Paulo`, marca "Facil".
- **`router.tsx`** excluído do script (caminhos da SPA); comentários corrigidos manualmente.

## 2. Pluralização

- Helper `plural(count, singular, pluralForm)` em `src/client/lib/format.ts`; ~47 pontos substituídos
  (painel, estoque, compras, relatórios, usuários, OS, consumo, catálogo, chamados, perfil) no lugar
  de padrões "(s)" e frases fixas ("1 itens", "0 chamados").
- Mensagens do worker ajustadas com ternários inline.
- Varredura confirmou **zero** `(s)`/`(ns)`/`(is)`/`(ões)` nas 11 páginas verificadas.

## 3. Defeitos encontrados e corrigidos na revisão

- **P-14 — Links de notificação quebrados:** o worker gerava `/tickets/:id` e `/ordens-servico/:id`,
  mas o cliente usa `/chamados/:id` e `/ordens/:id` → o clique caía em "não encontrada". Corrigido
  no worker (9 pontos, `tickets.ts` e `workorders.ts`) **e** nos dados já gravados no D1.
- **Saudação sem acento:** `Ola,` → `Olá,` no painel.
- **"Desejada para" em ISO** (`2026-10-26`) no detalhe da compra → agora `formatDate` (dd/mm/aaaa).
- **Comentários `modulo.acao`** nas migrations → `módulo.ação`.
- **Palavras fora dos scans por sufixo** (rodadas 4–6 do dicionário): `livro-razao`,
  `superficies`, `cronologica`, `modulos`, `periodico`, `atomico`, `identico`, `dinamico`,
  `numerico`, `deterministica`, `fabrica`, `servico/tecnico` em contextos seguros, `vao`, `copia`,
  `unitario`, `formulario`, `binario`, `calendario`, `contraditorio`, `reservatorio`, `portao`.

## 4. Limpeza dos dados de demonstração

- Rastro de smoke removido do D1: solicitação **SC-2026-000002**, recebimento **REC-2026-000002**,
  produto "Produto smoke fora do catalogo" + notificações, auditoria, movimentos e estoque
  vinculados (FK-safe, 9 comandos).
- **Preservados:** dados reais de teste do usuário — SC-2026-000001 / REC-2026-000003
  (Papel Sulfite + Caneta) — incluindo o produto incompleto ("Papel Sulfite...") que segue como
  pendência de cadastro do próprio fluxo F-12.

## 5. Verificação

- **Pipeline completo verde após TODAS as mudanças:** typecheck, lint, `check:api` (42 caminhos ×
  99 rotas), **109/109 testes**, build.
- **Varredura de resíduos:** 0 no dicionário (código); UI sem palavras faltantes (regex com
  lookbehind unicode nas 11 páginas); dados do banco sem resíduos; mobile **sem overflow**
  (0 px em painel/compras/estoque a 390×844).
- **Evidência visual:** `ux-shots/v2-*.png` — 15 capturas (desktop full-page das principais telas +
  detalhes de compra/inventário/OS/chamado + auditoria + mobile).

## Limitações aceitas (documentadas)

- `audit_log` histórico mantido como gravado — não reescrevemos trilha de auditoria (registro fiel
  do que aconteceu na época).
- Dois locais homônimos "Almoxarifado Central" (um por unidade demo) — mantidos; follow-up **F-16**
  para desambiguar nos seletores.
- Rotas, códigos, e-mails e o fuso permanecem ASCII por design.
- Formato exibido em `<input type="date">` segue o idioma do navegador (comportamento nativo; não
  controlamos o placeholder "dd/mm/aaaa" × "mm/dd/yyyy").

## Adendo — 2ª rodada (vídeo do usuário, 17/10/2026)

O usuário enviou um vídeo navegando pelo produto após as correções e pediu: **menu lateral fixo**
(nunca desaparecer ao rolar) e **rodapé sempre visível**; a rolagem do conteúdo em si está ok
(palavras dele). Achados do vídeo tratados nesta rodada:

- **P-15:** menu lateral sumia ao rolar tabelas longas → shell com rolagem interna; menu e rodapé
  fixos; topo sem vazamento de conteúdo. (`layout.tsx`)
- **P-16:** setas de rolagem fantasma na barra de abas (1px de transbordo) → corrigidas; filtros de
  data da Auditoria ganharam rótulos "De"/"Até". (`ui.tsx`, `audit.tsx`)
- Evidência: `ux-shots/v3-*.png` (6 capturas) + medições Playwright; pipeline verde (109/109).
- Observado no vídeo e **não** alterado: o usuário renomeou a empresa para "CorpServices Group"
  (auditado em `settings.update` às 17:25) — dado dele, mantido.
