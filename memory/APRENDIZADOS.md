# Aprendizados: Facil

## A-01 — Verificar o caminho real da infraestrutura antes de obedecer ao caminho declarado (16/10/2026)

O protocolo de inicialização afirmava que a memória global ficava em `F:\DEV\memory`. A unidade `F:`
não existe nesta máquina, e o caminho realmente configurado é `D:\DEV\memory` (definido em
`criar-projeto.bat` como `GLOBAL_ROOT`). Seguir a instrução literalmente teria criado uma árvore
global vazia e paralela — exatamente o que o próprio protocolo proíbe.

**Regra prática:** documento declarado é hipótese; `Test-Path` e o arquivo de configuração real são
evidência. Em divergência, a evidência vence — e a divergência é registrada, não silenciada.

## A-02 — Um diretório de projeto criado não prova um projeto utilizável (16/10/2026)

`D:\DEV\Opencode\Facil` contém uma estrutura impecável de memória e **zero** linhas de código.
Estrutura de bootstrap é infraestrutura de continuidade, não funcionalidade.

**Regra prática:** só chamar algo de "implementado" com arquivo + execução + teste. Enquanto não
houver, o estado honesto é "não existe".

## A-03 — Falha de bootstrap gera projetos duplicados se não for reconciliada (16/10/2026)

O bug do `.bat` (P-01) abortou o bootstrap de `facilities-management` às 22:01:51; às 22:17:53 o
arquivo foi corrigido; às 22:36:22 `Facil` foi criado com sucesso. Resultado: dois diretórios para o
mesmo produto, com memórias que começariam a divergir.

**Regra prática:** ao encontrar dois candidatos para o mesmo produto, comparar timestamps e
integridade, eleger um canônico, absorver o conhecimento do outro e **nunca apagar** — a decisão de
descartar é humana.

## A-04 — Encoding: escrever UTF-8 e conferir pelos bytes, não pelo console (16/10/2026)

O terminal do Windows renderiza acentos como `??` mesmo quando o arquivo está correto. A verificação
confiável foi ler os bytes: `C3 A7` = `ç` (UTF-8 válido), sem BOM.

**Regra prática:** para julgar encoding, inspecionar os bytes do arquivo; a saída do console não é
prova de corrupção. Manter os arquivos de memória em UTF-8 sem BOM.

## A-05 — O bundler do wrangler lê o tsconfig da raiz, não os tsconfigs referenciados (17/10/2026)

O esbuild do wrangler resolve `paths` pelo `tsconfig.json` descoberto no diretório do entrypoint.
Um tsconfig \"solution style\" (`files: []` + `references`) **não** propaga os `paths` dos filhos —
resultado: falha de build `Could not resolve "@shared/*"` no dev/deploy, mesmo com tsc e Vite
funcionando. O `alias` do wrangler também não cobre prefixo de subpath (casa caminho exato).

**Regra prática:** com imports de subpath em Worker Cloudflare, declarar `baseUrl` + `paths` no
`tsconfig.json` da raiz do bundle e manter os tsconfigs filhos em sincronia. Verificar com
`wrangler deploy --dry-run` sempre que mexer em resolução de módulos.

## A-06 — Grid + texto `truncate` pode estourar o viewport em silêncio (17/10/2026)

Um item de grid com `min-width: auto` tem mínimo automático baseado em conteúdo; texto com
`truncate` (`white-space: nowrap`) gera min-content largo e o track `auto` cresce além do container,
causando rolagem horizontal só visível em telas pequenas.

**Regra prática:** `min-w-0` nos itens de grid que contenham flex/truncate; validar com varredura
`document.documentElement.scrollWidth === clientWidth` em 390 px em todas as rotas, não só na que
apresentou o defeito.

## A-07 — Seed de usuários exige gerar o hash fora do SQL (17/10/2026)

PBKDF2 não existe em SQL: o `demo.sql` carrega `password_hash`/`password_salt` pré-calculados em
Node (`crypto.pbkdf2Sync`, compatível byte a byte com o `deriveBits` do WebCrypto usado pelo
Worker). Segredos demo públicos (`Demo@Facil2026`) são aceitáveis apenas em dataset de demonstração
local, nunca como credencial de produção.

**Regra prática:** ao gerar hashes de seed, usar os mesmos parâmetros do runtime (algoritmo, salt
16 bytes, 100 000 iterações, base64 separado) e conferir o login de verdade pela API depois do seed.

## A-08 — Testar o reset de fábrica é o único jeito de provar o caminho de setup (17/10/2026)

O smoke em instalação existente nunca exercita a criação inicial. Aplicar `reset.sql` (banco local,
destrutível), rodar o smoke — que executa o setup real e cria o administrador — e reaplicar o demo
comprovou o fluxo completo; o preço foram duas restarts do dev server para não concorrer com o
SQLite.

**Regra prática:** ciclos destrutivos de verificação são aceitáveis **no banco local** desde que a
restauração (seed) esteja automatizada e as contagens finais sejam conferidas.

## A-09 — Verificação visual que mede só layout não vê conteúdo quebrado (17/10/2026)

A varredura de páginas media apenas overflow horizontal; a página de inventário exibia
"Rota nao encontrada: /api/inventory" (P-07) e passou por ela — o card de erro cabia na largura.
O bug só apareceu quando o usuário abriu a tela. Lição: presença de elemento não é prova de dado
carregado.

**Regra prática:** a varredura de páginas deve checar o **corpo visível** contra marcadores de erro
("Nao foi possivel carregar", "Rota nao encontrada") além das métricas de layout, e o pareamento
cliente↔servidor deve ter guard automatizado — `scripts/check-api-paths.mjs` (`npm run check:api`)
cruza cada literal `/api/...` do cliente com as rotas reais do worker; um teste negativo confirmou
que ele falha no caminho antigo.

## A-10 — Precisão de URL é requisito do lado cliente, não do teste de API (17/10/2026)

Testes de API chamam caminhos corretos por construção; eles provam o servidor, não a integração da
tela. A cobertura de UI tem que ser comportamental (fluxo real pela interface) ou estrutural (guard
cruzando chamadas do cliente × rotas do worker) — senão erro de digitação em uma página fica
invisível mesmo com 107 testes verdes.

**Regra prática:** ao adicionar um módulo novo, rodar `npm run check:api` e executar ao menos um
fluxo real pela UI da página nova (não só abrir a rota).

## A-11 — `partial()` de schema de criação não é contrato de atualização (17/10/2026)

No zod v4, `ZodOptional` em volta de `ZodDefault` **não** curto-circuita `undefined`: um
`schema.partial()` reaplica os defaults e o handler grava tudo que "veio definido". Efeito: PATCH
parcial apaga campos que o cliente não enviou — prioridade do chamado rebaixada ao mudar status,
tipo padrão/ordem da categoria de chamado zerados ao alternar isActive, categoria inativa
reativada ao ser renomeada. Descoberto e corrigido na Central de Suporte (P-17).

**Regra prática:** todo endpoint de atualização parcial tem schema próprio, sem `.partial()` em
cima de schema com defaults; teste de regressão sempre envia um PATCH mínimo e confere que os
demais campos continuam iguais.

## A-12 — Relay só marca "enviado" com confirmação positiva do contrato (18/10/2026)

Web Apps do Google Apps Script respondem HTTP 200 até quando **não enviam nada** (ex.: chamada cai
na página de login quando a implantação não está pública). Um adaptador que tratasse "2xx = enviado"
marcaria e-mails como enviados sem sair da fila. O contrato adotado exige 2xx **e** corpo JSON
`{"ok": true}`; qualquer outra resposta (HTML, `{"ok": false}`, 404/500) vira `failed` com o motivo.

**Regra prática:** integração com terceiros só registra sucesso com confirmação positiva; "não deu
erro" não é prova de entrega. Em teste, o stub de `fetch` deve devolver um `Response` **novo a cada
chamada** — no workerd, ler I/O criado no contexto de outra requisição falha ("Cannot perform I/O on
behalf of a different request").

## A-13 — O Worker consegue enviar e-mail sozinho: SMTP cru por `cloudflare:sockets` (18/10/2026)

Não existe biblioteca de e-mail no runtime, mas existem **sockets TCP com TLS**
(`import { connect } from "cloudflare:sockets"`, `secureTransport: "on"`). Um cliente SMTP mínimo
(~150 linhas: EHLO, `AUTH PLAIN` com fallback 334, envelope, DATA, QUIT; respostas multi-linha
`250-…`) autentica no `smtp.gmail.com:465` com **senha de app** e entrega para qualquer
destinatário. Sonda local (Node) antes de codar confirmou credencial + porta; o diálogo inteiro é
testável com um socket simulado (`ReadableStream`/`WritableStream` manuais) — só a conexão fica
atrás de uma função injetável; o envio real fecha a verificação.

**Regra prática:** senhas de app do Google vêm coladas em grupos de 4 ("abcd efgh …") — remova os
espaços na autenticação e diga isso na interface. E lembrança de SMTP: `250` no fim do DATA é
**aceitação**, não entrega — devoluções (bounce) chegam depois na caixa do **remetente**, inclusive
para domínios inexistentes (o Gmail aceita `admin@facil.local` sem pestanejar).

## A-14 — Anexo grande: binário no R2, metadado no D1 — e o custo de afrouxar um `NOT NULL` no SQLite (18/10/2026)

O SQLite **não remove `NOT NULL` por `ALTER TABLE`**: para permitir anexo sem BLOB (agora vive no
R2) e upload sem usuário (token anônimo), a `attachments` foi **reconstruída** na migration
(rename → create nova → `INSERT … SELECT` → drop), com `CHECK (content IS NOT NULL OR r2_key IS
NOT NULL)` garantindo que a linha sempre aponte para algum binário. A tabela antiga era nova e
pequena (F-19 no mesmo dia), então a cópia foi trivial — mas o padrão vale para qualquer tabela:
esse é o caminho oficial do SQLite para mudar restrição de coluna.

Lição de desenho: **binário e metadado têm ciclos de vida diferentes** — R2 guarda bytes, D1
guarda nome/tipo/tamanho/autor/visibilidade. O upload é um "commit" em duas fases sem transação
compartilhada: sobe primeiro para o R2, depois grava o batch no D1; se o batch falhar, os objetos
recém-gravados são apagados (best-effort) para não deixar órfãos. O download nunca "proxyza" o
arquivo inteiro: faz streaming de `object.body` com `content-length`/`etag`/`content-disposition`
(a versão D1 antiga continua servindo o BLOB).

**Regra prática:** R2 funciona simulado no `wrangler dev` e nos testes (o binding vem do
`wrangler.jsonc`); nenhum código muda entre dev e produção. Adicionar binding novo pede regenerar
`worker-configuration.d.ts` (`npm run types`) — que voltou a funcionar depois de instalar
`@types/node` (P-06).

## A-15 — Upload sem sessão: duas políticas, caminho binário→banco e um default-allow escondido no módulo genérico (18/10/2026)

O moderador de risco de um upload público não é o tamanho do arquivo — é o **contexto**: quem
envia. Mesmo endpoint de mensagem, dois contratos: sessão (staff/solicitante logado) até 10
arquivos e teto configurável por arquivo/mensagem; token anônimo com 3 arquivos, 5 MB e lista
reduzida de tipos — o limite de **mensagem** ser igual ao de arquivo manteve o corpo JSON dentro
de um tamanho que o Worker lê em memória sem drama. O servidor revalida tudo (o cliente só faz
pré-checagem) e o teto de anexos por pedido (40) fecha o abuso por repetição.

Outro achado: o módulo genérico de anexos tratava a permissão **por tipo mapeado** — um
`entity_type` novo (ex.: `support_message`) caía num caminho que pulava a checagem de leitura:
default-allow silencioso. A correção foi inverter a lógica — negar o que não é do módulo
(`FORBIDDEN`) e deixar o suporte servir os próprios anexos — em vez de só adicionar mais um caso
ao mapa.

**Regra prática:** checagem de acesso se escreve por **negação default** ("só passa quem está no
mapa e tem permissão"), nunca por enumeração de casos permitidos. E todo fluxo que grava em dois
sistemas (R2 + D1) precisa de trilha de compensação explícita para a falha parcial.
