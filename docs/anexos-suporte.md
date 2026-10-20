# Anexos no suporte (R2) — F-19

Guia curto de como os anexos das conversas de suporte funcionam e o que fazer no deploy.

## O que dá para enviar

- **Solicitante pelo link de acompanhamento (sem login):** até **3 arquivos por mensagem**, no
  máximo **5 MB por arquivo** e **5 MB somando a mensagem**; tipos: imagem (png/jpg/etc.), PDF e
  texto (txt/csv).
- **Usuário logado e suporte (staff):** até **10 arquivos por mensagem**, respeitando
  `attachments.max_bytes` por arquivo **e** por mensagem (padrão **20 MB**); inclui documentos de
  escritório (doc/docx/xls/xlsx).
- Limite geral por atendimento: **40 anexos** (abra um novo pedido se precisar de mais).
- Arquivo vazio é recusado; o servidor sempre revalida tudo (o navegador faz só pré-checagem).

O administrador pode ajustar o teto em **Configurações → Anexos** (`attachments.max_bytes`,
de 10 KB a 50 MB). Os limites efetivos aparecem abaixo do campo de mensagem na conversa.

## Onde os arquivos ficam

- **Binário:** bucket **Cloudflare R2** `facil-attachments` (binding `ATTACHMENTS` do Worker).
  No R2 o plano gratuito cobre com folga o uso previsto.
- **Metadados:** tabela `attachments` do D1 (nome, tipo, tamanho, quem enviou, chave do R2) —
  ligados à mensagem da conversa.
- **Anexos antigos** (tickets e demais módulos) continuam gravados como BLOB no próprio D1 e
  seguem funcionando normalmente; nada foi migrado à força.
- Se o envio falhar no meio (erro ao gravar a mensagem), os arquivos recém-subidos são apagados
  do bucket — sem lixo órfão.

## Remoção

- Só o **suporte (staff)** remove um anexo: botão ✕ ao lado do arquivo na conversa interna.
  A remoção apaga o objeto no R2 e fica registrada na auditoria (`support.attachment.delete`).
- A mensagem permanece na conversa (com o texto, sem o arquivo).

## Deploy (produção)

1. Criar o bucket uma vez: `npx wrangler r2 bucket create facil-attachments`.
2. O binding já está declarado em `wrangler.jsonc` (`r2_buckets` → `ATTACHMENTS`).
3. No `wrangler dev` e nos testes o bucket é **simulado localmente** — nada a configurar.

Sem custo: R2 tem plano gratuito (armazenamento e operações mensais) suficiente para o uso
esperado; não é preciso cartão para o tier gratuito.
