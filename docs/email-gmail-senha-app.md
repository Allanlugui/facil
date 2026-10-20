# Envio de e-mails pelo Gmail com senha de app (custo zero)

Dispara os e-mails do Facil para **qualquer endereço** pela sua própria conta
Gmail, sem provedor pago, sem domínio próprio e **sem Apps Script**. O Facil
fala SMTP direto com o Gmail (`smtp.gmail.com:465`, TLS) autenticando com uma
**senha de app** de 16 letras — o Google assina a mensagem e a entrega é normal
(sem o risco de spam de "remetente Gmail via serviço de terceiros").

## Passo 1 — criar a senha de app

1. A conta precisa ter **Verificação em duas etapas** ativada. Confira em
   <https://myaccount.google.com/security>.
2. Com a verificação em duas etapas ativa, abra
   <https://myaccount.google.com/apppasswords> (menu **Senhas de app**).
3. Dê um nome qualquer (ex.: `Facil`) e clique em criar.
4. Copie a senha de **16 letras** que aparece (o formato é `abcd efgh ijkl mnop`).

> A senha de app vale só para esse fim; ela pode ser revogada a qualquer
> momento na mesma tela (e trocada no Facil).

## Passo 2 — configurar no Facil

Em **Configurações → Suporte e e-mail**:

| Chave | Valor |
| --- | --- |
| `mail.enabled` | ligado |
| `mail.provider` | `gmail` (Gmail — senha de app) |
| `mail.from` | seu endereço Gmail completo (ex.: `conta@gmail.com`) |
| `mail.gmail_app_password` | a senha de 16 letras (pode colar com espaços) |

Salve. O envio passa a valer imediatamente para os próximos e-mails; os que
estão na fila podem ser enviados com **Reenviar** na aba E-mails do Suporte.

## Limites e observações

- Limite de envio do Gmail comum: ~500 destinatários/dia (contas Workspace têm
  limites maiores).
- O destinatário vê o **nome da empresa** (`company.name`) como remetente,
  seguido do seu endereço Gmail.
- No modo Gmail, `mail.api_key`, `mail.relay_url` e `mail.relay_secret` ficam
  sem uso (podem ficar vazios).
- Espaços na senha de app são ignorados; não é preciso “limpar” a colagem.

## Problemas comuns

- **`535 Username and Password not accepted`**: senha de app errada, revogada ou
  conta sem verificação em duas etapas. Gere outra senha e atualize
  `mail.gmail_app_password`.
- **Tempo esgotado / falha de conexão**: rede bloqueando a porta 465; teste em
  outra rede. O e-mail fica na fila como `failed`, com o motivo — dá para
  reenviar depois.
- **E-mail não chegou**: confira spam e o endereço digitado em `mail.from`
  (um único caractere errado muda a conta autenticada).
