# AGENTS - Regras Especificas: Facil

## Ordem de leitura obrigatoria

1. `D:\dev\memory\regras-agente.md`
2. `D:\dev\memory\padroes-codigo.md`
3. `D:\dev\memory\SUBCONSCIENTE.md`
4. `memory/AGENTS.md`
5. `memory/INDEX.md`
6. `memory/STATUS.md`
7. `memory/TODO.md`
8. `D:\dev\memory\Facil\INDEX.md`

## Hierarquia

Regras globais do ambiente.

Subconsciente Universal.

Regras especificas deste projeto.

Planejamento oficial deste projeto.

## Camadas

Memoria local = continuidade operacional.

Conhecimento global = conhecimento reutilizavel.

Subconsciente = indice de descoberta.

Serena = memoria contextual nativa do agente.

## Regra de Memoria

Atualizar a memoria automaticamente apos analises, planejamentos,
implementacoes, correcoes, decisoes e validacoes relevantes.

Extrair conhecimento reutilizavel para o cerebro global.

Nao tratar o cerebro global como espelho da memoria local.

## Execucao Autonoma Continua

Apos validar uma sub tarefa, consultar o proximo item de TODO
e continuar a execucao sem pausas intermediarias.

Encerrar somente ao concluir a fase, encontrar bloqueio critico
ou chegar a uma decisao arquitetural que exija revisao humana.

## Regra de publicacao (decidida em 22/10/2026)

Toda alteracao de produto (codigo, schema, configuracao ou documentacao
funcional) deve ser publicada para conferencia, sem parar no commit local:

1. Subir a versao SemVer em `package.json`, `package-lock.json`, README,
   CHANGELOG e `docs/VERSIONAMENTO.md` (patch/minor conforme o caso).
2. Rodar `npm run check` e `npm run build`.
3. Aplicar migrations remotas pendentes com `npm run db:migrate:remote`.
4. Publicar com `npm run deploy`.
5. Conferir `https://facil.cf-pilot-disposable.workers.dev/build-info.json`
   com a versao nova e abrir a aplicacao para validacao visual.
6. Commitar os artefatos assinados (`SIGNATURE.json`, `build-info.json`,
   `build-info.generated.ts`), enviar `main` e criar/enviar a tag `vX.Y.Z`.

Memoria operacional (`memory/`) nao exige nova versao nem deploy.
