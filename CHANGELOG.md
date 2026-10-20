# Changelog

Todas as alterações relevantes do Facil são registradas aqui. O projeto segue o
versionamento descrito em `docs/VERSIONAMENTO.md`.

## [0.1.2] — 2026-10-20

### Corrigido

- Rodapé do login passa a usar o nome configurado da empresa, em vez de um
  texto fixo. Com a configuração atual, exibe **CorpServices Group**.
- Metadados de autoria e documentação alinhados ao nome **CorpServices Group**.

## [0.1.1] — 2026-10-20

Auditoria completa de bugs, falhas e vulnerabilidades.

### Segurança

- Escopo de local aplicado de forma consistente em chamados, ordens de serviço,
  compras, inventário, consumo, movimentações, estrutura e relatórios.
- Gestores não podem mais remover o próprio escopo, alterar administradores ou
  conceder autoridade superior à sua.
- Anexos passam a validar a entidade de origem, e não apenas a permissão do
  módulo: conhecer o UUID de um chamado/OS alheio não permite listar ou baixar
  arquivos.
- Ações de chamado (`assign`, `resolve`, `cancel`, `convert`, materiais) e de
  ordem de serviço (edição, status, reatribuição, checklist, materiais,
  conclusão) revalidam visibilidade, escopo e responsável.
- Alteração de situação de chamado via `PATCH` exige a permissão do fluxo
  (`tickets.resolve`/`tickets.cancel`), não apenas leitura ampla.
- Conclusão de OS não pode mais ser feita pelo atalho genérico de status; usa a
  ação de conclusão com resultado e checklist. Cancelamento exige
  `workorders.cancel`.
- Uploads SVG/HTML bloqueados; anexos não visuais forçados a download;
  `Content-Type` normalizado; limites de tamanho no JSON, multipart e anexos.
- Credenciais de configuração mascaradas nas respostas e redigidas na auditoria;
  a interface usa ação explícita "Limpar credencial".
- Cabeçalhos de segurança e CSP no Worker e nos arquivos estáticos
  (`_headers`), HSTS, proteção contra enquadramento, `no-store` na API e
  verificação de mesma origem para escritas.
- Limite de senha no login e limitação de pedidos públicos de suporte
  (10 por hora por IP).

### Corrigido

- Escopo de local em relatórios, detalhes de compra, inventário, consumo,
  movimentação e local.
- Exibição de estoque por local no catálogo respeita o escopo do usuário.
- Transições de status da OS no cliente não oferecem mais `done` nem
  cancelamento sem permissão.
- Ajustes de testes de segurança, anexos e configurações.

### Validação

- `npm run check`: typecheck, lint, verificação de caminhos da API e
  **162/162 testes** em 17 arquivos.
- Auditoria de autorização com 12 achados corrigidos; relatório em
  `docs/SEGURANCA-AUDITORIA-2026-10-20.md`.
- Verificação de dados históricos no D1 de produção: nenhuma linha de
  `settings.update`, nenhum anexo armazenado e chaves de segredo vazias.
- `npm audit`: 0 vulnerabilidades.

### Limitações conhecidas

- R2 desativado: anexos do chat de suporte retornam `503 R2_UNAVAILABLE`.
- Sem domínio próprio e sem Cloudflare Access; URL `*.workers.dev`.
- Sem CI: o deploy oficial é `npm run deploy` (assina, valida, compila e
  publica).
- Proteção de força bruta é localizada (login e suporte público), não um WAF
  global.
