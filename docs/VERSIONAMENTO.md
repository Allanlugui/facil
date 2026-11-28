# Versionamento e releases

## Regra

O Facil usa **SemVer** adaptado ao estágio pré-1.0:

- **patch** (`0.1.1` → `0.1.2`): correções, segurança, ajustes de interface,
  documentação do produto e qualquer alteração em arquivo assinado;
- **minor** (`0.1.x` → `0.2.0`): funcionalidade nova ou mudança de
  comportamento relevante;
- **major** (`1.0.0`): primeira versão estável, com compatibilidade e
  operação consideradas maduras.

Enquanto o produto estiver em `0.x`, mudanças incompatíveis também podem subir
o **minor**. O número nunca é reutilizado.

## O que exige bump

Exige incremento de versão:

- código do Worker, cliente, migrations, seeds, scripts, testes;
- `docs/`, `CHANGELOG.md`, arquivos de marca e configuração publicada;
- qualquer arquivo incluído no manifesto assinado.

Não exige bump:

- `memory/` (notas operacionais) e `ux-shots/` (evidências), que ficam fora do
  manifesto assinado;
- alterações apenas locais que não serão publicadas.

Na dúvida, suba o patch. Uma release publicada nunca é reescrita.

## Fluxo oficial

1. Implementar e validar a mudança.
2. Atualizar `CHANGELOG.md` com a versão, a data e o resumo.
3. Rodar `npm version patch --no-git-tag-version` (ou `minor`/`major`).
4. Rodar `npm run deploy` — assina, executa `npm run check`, compila e publica.
5. Verificar `/api/health`, `/build-info.json` e os cabeçalhos `X-Facil-*`.
6. Rodar `npm run verify`.
7. Commit, tag `vX.Y.Z` e push.

## Onde a versão aparece

- `package.json` e `package-lock.json`;
- `CHANGELOG.md`;
- `SIGNATURE.json` (manifesto assinado);
- `/build-info.json` e `/api/health`;
- cabeçalhos `X-Facil-Release`, `X-Facil-Signed-At`, `X-Facil-Tree-Sha256` e
  `X-Facil-Author`.

## Assinatura

Cada release é assinada com Ed25519 por **Allan Luiz Silveira Lima**. A chave
privada fica fora do repositório. O manifesto SHA-256 cobre todos os arquivos
do produto, exceto `memory/` e `ux-shots/`.

Detalhes em `docs/ASSINATURA.md`.

## Primeira etapa

A primeira etapa foi encerrada na versão **0.1.2**, em 20/10/2026, após a
auditoria completa de bugs, falhas e vulnerabilidades.

A segunda etapa foi entregue na versão **0.2.0**, em 20/10/2026: fluxo
corporativo de compras, adjudicação por item, pedidos por fornecedor, outbox de
integração e preparação de NetSuite/ServiceNow. Por ser uma funcionalidade nova
com mudança relevante de comportamento, a versão subiu o **minor**.

A terceira etapa foi entregue na versão **0.3.0**, em 20/10/2026: solicitação de
itens que ainda não existem no catálogo, com descrição livre e cadastro rápido no
recebimento. Também é uma funcionalidade nova, portanto subiu o **minor**.

A quarta etapa foi entregue na versão **0.4.0**, em 21/10/2026: compras v3 por
setor (gestor → Compras autoriza → comprador cota → aprovação → pedido → estoque
lança nota fiscal), setores/gestores, formas de pagamento e chat de suporte em
tempo real (Durable Object + WebSocket com fallback de polling). Funcionalidades
novas com mudança relevante de comportamento: subiu o **minor**.

A quinta etapa foi entregue na versão **0.5.0**, em 21/10/2026: usabilidade de
Compras com formulário do solicitante simplificado, entrada de itens em lote com
vínculo ao catálogo, detalhe sem rolagem horizontal e criação v3 com forma de
pagamento/modo definidos por Compras na autorização. Funcionalidade nova e
mudança relevante de comportamento: subiu o **minor**.

A sexta etapa foi entregue na versão **0.6.0**, em 21/10/2026: fluxo de compras
v3 completo, com triagem do comprador, aprovação/refinamento do gestor de
Compras, pedido de alinhamento ao solicitante, execução pelo comprador e
recebimento com normalização de itens fora do catálogo para produtos existentes
ou cadastrados na hora. A ordem do fluxo v3 mudou (triagem antes da aprovação) e
há nova migration; por ser funcionalidade nova com mudança relevante de
comportamento, subiu o **minor**.

A sétima etapa foi entregue na versão **0.7.0**, em 22/10/2026: Controle do
sistema com exclusão segura (física sem histórico, arquivamento com histórico e
marca `(excluído)`), prévia de impacto, bloqueios, notificação aos
administradores e múltiplos administradores com proteção do último; devolução da
solicitação de compra ao solicitante para ajuste e reenvio direto à fila do
gestor. Funcionalidades novas com migration 0022 e mudança de comportamento:
subiu o **minor**.

A oitava entrega foi publicada na versão **0.7.1**, em 23/10/2026:
infraestrutura de anexos habilitada em produção (bucket R2 `facil-attachments`
com binding `ATTACHMENTS`, encerrando o 503 dos anexos do suporte) e fundação do
módulo Patrimônio (migration 0023 com tabelas, categorias padrão e permissões,
sem rotas/interface ainda). Habilitação de infraestrutura e schema aditivo sem
mudança de comportamento: subiu o **patch**.

A nona entrega foi publicada na versão **0.7.2**, em 23/10/2026: workflow de CI
no GitHub Actions rodando `npm run check` e `npm run build` em cada push/PR na
`main`. Configuração publicada sem mudança de comportamento do produto: subiu
o **patch**.

A décima entrega foi publicada na versão **0.7.3**, em 23/10/2026: anexos
também em ordens de serviço (card de anexos na tela da OS), reutilizando o
módulo genérico de anexos. Funcionalidade nova para o usuário final (tela da OS
ganha upload/download/remoção de anexos) sem mudança de banco: subiu o **patch**.

A décima primeira entrega foi publicada na versão **0.7.4**, em 23/10/2026:
consumidor do `integration_outbox` com trigger cron a cada 5 minutos e endpoint
de disparo manual. Integração depende de `TICKET_INTAKE_KEY`/`SERVICENOW_INSTANCE_URL`
a serem configuradas pelo titular nas secrets do Worker; sem elas, o consumidor
pula silenciosamente: subiu o **patch**.

A décima segunda entrega foi publicada na versão **0.7.5**, em 23/10/2026:
captcha como camada final (D-15) no login e na abertura de chamados públicos,
desligado por padrão e ativado pelo titular via Configurações (`captcha.enabled`,
`captcha.site_key`, `captcha.secret_key`): subiu o **patch**.

A décima terceira entrega foi publicada na versão **0.8.0**, em 24/10/2026:
módulo **Patrimônio** completo sobre a fundação da 0.7.1 — API `/api/assets`,
telas `/patrimonio` e `/patrimonio/:id`, movimentações auditadas (transferência,
atribuição, situação, condição, manutenção e inventário), histórico, anexos,
categorias e aba **Categorias de patrimônio** na Central de Controle. Ativos não
são excluídos: baixa/descarte são terminais e preservam o histórico. Sem migration
nova (a `0023_assets.sql` já estava aplicada). Funcionalidade nova para o usuário
final: subiu o **minor**.

A décima quarta entrega foi publicada na versão **0.11.0**, em 28/11/2026:
**Volta consistente em todo o sistema + sidebar desktop colapsável com motion**.
- `PageHeader` ganha `backTo`/`backLabel`; componente `BackButton` reutilizável (`<Link>` ou `history.back()` com fallback). Cobertura 100%: todas as rotas de detalhe (`:id`), subseções `/configuracoes/<secao>`, páginas administrativas (`/controle`, `/catalogo`, `/estrutura`, `/usuarios`, `/relatorios`, `/auditoria`), `/perfil`, `/ajuda/:id`, `/patrimonio/:id`, módulos LGPD (`/legal`, `/consent`, `/dpo`, `/dsr`, `/seguranca`, `/incidentes`). Páginas-nível-topo do sidebar (`/`, `/estoque`, `/consumo`, `/inventario`, `/chamados`, `/ordens`, `/compras`, `/patrimonio`, `/ajuda`) não recebem Voltar (navegação via sidebar).
- Sidebar desktop (lg+): botão seta (`ChevronIcon`, `aria-expanded`, `aria-label`) colapsa 256 px → 72 px (ícones + tooltip), motion 180–220 ms `ease-out-soft`, itens em cascata (stagger ~30 ms, translate 6 px + fade), estado em `localStorage.facil.sidebarCollapsed` (default expandido). Mobile drawer inalterado.
- Motion reutilizado: tokens `--motion-fast/base/slow`, `--ease-out-soft`, classes CSS `facil-sidebar*`, sem nova biblioteca. Respeita `prefers-reduced-motion` (sem delay/stagger).
- Acessibilidade: foco visível, alvo ≥44 px, navegação por teclado colapsado.
- Nenhuma rota logada prende o usuário. Funcionalidade nova + mudança de comportamento: subiu o **minor**.

A décima quarta entrega corrigida foi publicada na versão **0.11.1**, em 28/11/2026:
**Sidebar colapsável: fechar espelha abrir + Brand/footer colapsados (patch)**.
- Fechamento da sidebar (desktop): espelha a abertura aprovada — **Fase 1**: labels somem em cascata reversa (último some primeiro) com fade + slide leve (250ms, gap 60ms), ícones **permanecem visíveis** o tempo todo; **Fase 2**: barra recolhe para 88px (350ms) só DEPOIS dos labels. Nav continua clicável no modo só-ícones (title nativo para tooltip). Sem `opacity: 0` brusco no nav inteiro, sem `display: none` seco nos labels.
- Brand colapsada: logo centralizado (h-9 w-9, `object-contain`, `flex-shrink-0`) sem deformação; textos (nome + subtítulo) somem com fade rápido; padding ajustado.
- Cabeçalho da seção ("Operação"/"Meu dia"): esconde com fade no colapsado.
- Footer colapsado: esconde company/timezone; mantém versão curta centralizada.
- Velocidade: fechar total ~1.4s (labels ~1s + barra 350ms), sutil e rápido — não demorado.
- Abertura inalterada: barra 350ms + labels cascata 250ms/80ms gap (~1.8s total). Correção de interface: subiu o **patch**.

A décima quinta entrega foi publicada na versão **0.11.2**, em 28/11/2026:
**Ajuste fino da Brand colapsada: só logo, tamanho de ícone (patch)**.
- **Brand no modo colapsado**: mantém **apenas o logotipo**, sem nome do sistema ("Facil") nem subtítulo ("Gestão de Facilities"). Logo reduzida ao tamanho dos ícones do menu (24px / `size-6`), centralizada na barra de 88px com padding simétrico. Sem espremer, deformar ou cortar (`object-contain`, `flex-shrink-0`, aspect-ratio preservado).
- **Modo expandido**: inalterado (logo 36px + "Facil" + "Gestão de Facilities").
- **Transição**: logo anima suavemente entre 36px ↔ 24px junto com a barra (350ms, mesma curva), sem alterar tempos/delays do fechar/abrir já aprovados.
- **Acessibilidade**: `alt`/`title` da logo mantidos; `prefers-reduced-motion` respeitado; mobile inalterado. Ajuste visual cirúrgico: subiu o **patch**.

A décima sexta entrega foi publicada na versão **0.11.3**, em 28/11/2026:
**Logo da sidebar sem distorção (patch)**.
- **Causa**: `.brand-logo img` forçava `36×36` quadrado numa logo horizontal `1200×580` — esmagava a marca no modo expandido.
- **Expandido**: altura fixa `32px`, largura automática, `max-width 180px`, `object-contain` à esquerda — logo por inteiro, sem esmagar.
- **Colapsado**: container `32px` com `overflow hidden` exibe só o símbolo (círculo "Corp"), `28px` de altura, sem esticar.
- **Sem mudança de API/banco.** Correção visual: subiu o **patch**.
