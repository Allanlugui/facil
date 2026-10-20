# Design e UX: Facil

- **Estado (17/10/2026):** **DEFINIDO E IMPLEMENTADO.** Interface completa em pt-BR, verificada no
  Playwright em desktop (1440×900) e mobile (390×844), com fluxo operacional real executado.

## Princípios aplicados

- **Operação primeiro:** telas densas e previsíveis; ações primárias visíveis, filtros persistidos na
  URL (ex.: `/estoque?tab=movements`), feedback imediato por toast.
- **pt-BR integral**, sem jargão técnico exposto (erros traduzidos, códigos internos só na auditoria).
- **Consistência antes de novidade:** um único design system (`src/client/lib/ui.tsx`) — nenhuma
  página cria botão/input/diálogo próprio.

## Tokens e linguagem visual

- **Cor:** paleta `brand` (azul institucional) para ações primárias e navegação ativa; neutros
  `slate` para estrutura; tons semânticos para estado (verde=sucesso/ok, âmbar=atenção, vermelho=
  erro/perigo, azul=informação), sempre acompanhados de texto/ícone — nunca só cor.
- **Superfícies:** cards `rounded-xl border-slate-200 bg-white shadow-sm`; cabeçalhos de card com
  título `text-sm font-semibold` + descrição `text-xs text-slate-500`.
- **Tipografia:** sans padrão; títulos de página em `PageHeader` (h1 + descrição + ações).
- **Densidade:** tabelas compactas (py-2.5), números tabulares nos relatórios; foco em leitura rápida
  de muitos registros.

## Componentes (contrato único)

`Button` (primary/secondary/ghost/subtle/danger, com `loading`), `Field` (label/hint/error/required),
`Input`/`Select`/`Textarea` (estado `invalid`), `Card`, `Stat` (indicador do painel), `Table` +
paginador, `Tabs`, `Dialog` (com `wide` e rodapé de ações), `Badge` e `Dot` (status), `Alert`,
`Toast` (global via `ToastProvider`), `EmptyState`, `LoadingBlock`, `ErrorBlock`, `PageHeader`.

## Layout e navegação

- **AppShell:** quadro de altura fixa (`h-full`); a rolagem fica **no contêiner do conteúdo**, então a
  sidebar (agrupada por área: Operação, Gestão) e o rodapé "empresa · fuso" ficam **sempre visíveis**
  no desktop — a navegação rola internamente se faltar altura (P-15). Topbar fixo com nome da
  empresa, campainha de notificações e menu do usuário; conteúdo `max-w-7xl`; troca de rota volta a
  rolagem ao topo.
- **Mobile:** sidebar vira drawer (botão \"Abrir menu\" + overlay + \"Fechar menu\"); conteúdo em
  coluna única; tabelas rolam dentro do card (nunca a página).
- **Rotas públicas** (setup, login, troca de senha e o canal de suporte `/suporte` +
  `/suporte/acompanhar/:token`) usam layout próprio, sem shell.

## Padrões de formulário e diálogo

- Validação no cliente espelha o servidor, mas o servidor decide (erro 400 vira mensagem no
  formulário ou toast); botão primário com estado `loading`; proteção contra envio duplicado por
  `request_key` gerado no clique.
- Diálogos fecham por Escape/overlay; ações destrutivas pedem confirmação explícita (ex.: reversão de
  movimento, exclusões de cadastro).
- Estados vivem no URL quando fazem sentido (aba, busca, filtros) — link compartilhável.

## Fuso, datas e números

- Datas/horas exibidas em `America/Sao_Paulo` (setting `company.timezone`) via `lib/format.ts`;
  entradas de data (filtros) em `type=date` interpretadas no fuso local da operação.
- Quantidades formatadas a partir de milésimos com unidade de medida; dinheiro em BRL (centavos →
  formatação pt-BR).

## Acessibilidade

- HTML semântico (main/nav/header/section), labels associados, `aria-label` em ícones interativos,
  foco visível (`focus-visible`), contraste adequado, alvos de toque confortáveis no mobile.
- Diálogo com `role=dialog`, título e botão de fechar acessíveis; toasts com `role=status/alert`.

## Verificação visual (evidência)

- **Desktop:** painel, estoque (posição e movimentações), catálogo, relatórios, usuários,
  configurações — todos renderizando dados reais do seed demo.
- **Mobile:** painel, estoque, drawer de navegação; varredura das **14 rotas** com
  `scrollWidth === clientWidth` em 390 px (após correção P-05).
- **Fluxo E2E:** movimentação de correção registrada pela interface → saldo, painel e auditoria
  refletiram a mudança (framing completo do ciclo operacional).

## Revisão UX/UI completa (17/10/2026)

- Varredura de pt-BR em todo o produto: código, seeds, migrations e **dados do banco demo**
  (acentuação + pluralização com o helper `plural()` em `lib/format.ts`).
- Corretivas: links de notificação passaram a apontar para as rotas reais (`/chamados/:id`,
  `/ordens/:id`); saudação "Olá"; "Desejada para" com data formatada; nome da empresa no
  `settings`; limpeza do rastro de smoke no D1.
- Evidência: `ux-shots/v2-*.png` (15 capturas desktop/mobile); relatório em
  `memory/REVISAO-UX-2026-10-17.md`.

## Central de Suporte (17/10/2026)

- **Público (`/suporte`)** sem shell: cabeçalho com a marca, dois cartões de ação ("Esqueci minha
  senha" / "Preciso de ajuda"), caixa "Já abriu um pedido?" (aceita o link completo ou o token
  colado) e grade de artigos com leitura em diálogo. `?tipo=senha` (link da tela de login) abre o
  formulário direto.
- **Acompanhamento (`/suporte/acompanhar/:token`):** status com badge (âmbar "Na fila" com a posição
  **discreta** na fila, azul "Em atendimento", verde "Resolvido"), conversa em balões (solicitante ×
  suporte) e atualização automática a cada 20 s; pedido resolvido bloqueia o envio (abrir novo).
- **Interno (`/ajuda`, item "Suporte" no menu):** abas Central de ajuda / Meus pedidos para todos;
  Fila de atendimento, Conteúdo e E-mails somente com `support.manage` (o servidor autoriza — as
  abas apenas escondem).
- **Atendimento (`/ajuda/:id`):** ficha do solicitante (setor/matrícula), conversa, ações do staff
  (marcar em atendimento / resolver com confirmação / reabrir na fila) e lista dos e-mails do
  pedido com situação da fila de envio.

## Pendências

- Central de Suporte: e-mails ficam `pending` até configurar um provedor (F-13); captcha entra
  apenas como camada final, após validação do processo em uso real (D-15).
- Nenhuma bloqueante. Melhorias futuras sem prioridade declarada: estados de esqueleto (skeleton) em
  carregamentos lentos, atalhos de teclado em tabelas densas, tema escuro (não solicitado).
