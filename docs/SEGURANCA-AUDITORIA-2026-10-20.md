# Auditoria de segurança — 20/10/2026

**Versão auditada:** 0.1.0 (código em produção) e correções para 0.1.2
**Escopo:** autorização, isolamento por local, anexos, configurações secretas,
cabeçalhos, uploads e limites de entrada.
**Método:** revisão rota a rota do Worker, matriz de permissões, testes de
integração, testes de regressão e consultas somente leitura ao D1 de produção.

## Resultado

**12 achados corrigidos. Nenhum achado crítico ou alto permanece aberto.**

| # | Severidade | Achado | Correção |
|---|------------|--------|----------|
| 1 | Alto | Gestor com `users.manage` podia zerar o próprio escopo de local e ampliar o acesso. | O usuário não pode remover o próprio escopo; a operação exige outro gestor autorizado. |
| 2 | Alto | Gestor podia editar administrador, trocar papel/e-mail ou conceder autoridade superior à sua. | Verificação de autoridade por permissão e hierarquia em criação, edição, desativação e escopo. |
| 3 | Alto | Relatórios aceitavam `locationId` fora do escopo. | `assertLocationAllowed` em todos os filtros de local. |
| 4 | Alto | Rotas por ID de ordem de serviço não revalidavam escopo nem responsável. | Escopo em leitura/escrita e regra de responsável/gestor para edição, status, checklist, materiais e conclusão. |
| 5 | Alto | `done` podia ser aplicado pelo atalho de status; cancelamento não exigia a permissão própria. | `done` bloqueado no atalho; cancelamento exige `workorders.cancel`. |
| 6 | Alto | `PATCH /tickets/:id` usava `tickets.view_all` como autoridade de escrita. | Mudança de status exige `tickets.resolve`/`tickets.cancel`; edição de campos continua separada. |
| 7 | Alto | Ações de chamado não revalidavam visibilidade/escopo do ticket. | `assertTicketVisible` em assign, resolve, cancel, convert, materiais e anexos. |
| 8 | Médio | Detalhe e decisões de compras não checavam o local da solicitação. | Escopo aplicado em detalhe, recebimentos, edição, envio, decisões, cotações e ordens. |
| 9 | Médio | Detalhe, itens, relatório, sincronização e `skip` de inventário não checavam o local. | Escopo em todas as rotas do inventário. |
| 10 | Médio | Anexos autorizavam pelo módulo, não pela entidade de origem. | Validação da entidade (ticket, OS, checklist, compra, recebimento, inventário, consumo, produto, local). |
| 11 | Baixo | Detalhe do produto expunha estoque de todos os locais. | `stockByLocation` filtrado pelo escopo. |
| 12 | Baixo | Detalhes de consumo, movimentação e local não aplicavam escopo. | Escopo aplicado nas três rotas. |

## Endurecimento adicional

- SVG e HTML bloqueados como anexo; arquivos não visuais forçados a download.
- `Content-Type` normalizado e disposição segura.
- Limite de 1 MB para JSON, pré-checagem de `Content-Length` em anexos e
  multipart.
- Segredos mascarados nas respostas de configuração e redigidos na auditoria;
  limpeza explícita na interface.
- CSP, HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` e `no-store` na API.
- Verificação de mesma origem para escritas.
- Limite de senha no login e throttle de 10 pedidos públicos de suporte por
  hora por IP.
- `theme-boot.js` externo para permitir CSP com `script-src 'self'`.

## Evidências

- `npm run check`: typecheck, lint, 50 caminhos do cliente conferidos e
  **162/162 testes** em 17 arquivos.
- `tests/16-security.spec.ts`: cabeçalhos, origem, limite de JSON.
- `tests/17-authorization.spec.ts`: escopo próprio, autoridade sobre admin,
  relatório, compra, status de OS, PATCH de chamado e anexo alheio.
- `npm audit`: 0 vulnerabilidades.
- D1 de produção (somente leitura): 0 linhas `settings.update`, 0 anexos,
  chaves `mail.*` vazias.

## Riscos residuais aceitos

1. **R2 desativado** — anexos do chat de suporte retornam 503; o restante do
   produto usa D1.
2. **Sem domínio próprio/Access** — URL `*.workers.dev`, sem Cloudflare Access.
3. **Sem WAF/rate limit global** — a proteção é localizada (login e suporte
   público).
4. **Auditoria append-only por convenção** — não há trigger de banco impedindo
   alteração por quem tiver acesso direto ao D1.
5. **Sem antivírus** — anexos são validados por tipo e tamanho, não escaneados.
6. **Chave de assinatura** — a custódia e o backup são responsabilidade do
   titular; a chave privada não está no repositório.
7. **Primeiro setup** — a corrida de criação do primeiro administrador é um
   risco baixo, mitigado pelo estado `needsSetup` e pelo uso imediato.
