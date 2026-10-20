# Envio de e-mails via relay no Gmail (custo zero)

Dispara os e-mails do Facil para **qualquer endereço** sem provedor pago e sem
domínio próprio, usando a sua própria conta Google como remetente.

> **Alternativa mais simples:** se preferir não criar o script abaixo, use o
> provedor `gmail` (senha de app) — mesma conta, sem Apps Script, com a senha
> de 16 letras no lugar do Web App. Guia: `docs/email-gmail-senha-app.md`.

## Como funciona

O Facil entrega cada e-mail da caixa de saída para um **Web App do Google Apps
Script** que roda na sua conta. O script chama `MailApp` e o e-mail sai de
verdade pela conta Google — ou seja, quem assina a mensagem é o Google
(entrega normal, sem o risco de spam de "remetente Gmail via serviço de
terceiros" nem a restrição do Resend grátis de só enviar para o próprio dono).

- Limite do Gmail comum: ~100 destinatários/dia (Google Workspace: ~1.500/dia).
- O remetente exibido é o **nome da empresa** (`company.name`) seguido do seu
  endereço Gmail: `Empresa <voce@gmail.com>`.

## Passo 1 — criar o Web App no Google

1. Acesse <https://script.google.com> logado na conta que vai enviar e clique em
   **Novo projeto**.
2. Apague o conteúdo de `Código.gs` e cole o código abaixo.
3. Troque `TROQUE-ESTE-SEGREDO...` por um valor longo e aleatório — ele será o
   mesmo `mail.relay_secret` configurado no Facil (ex.: 40+ caracteres).
4. Salve (Ctrl+S).
5. No seletor de funções escolha `testeEnvio` e clique em **Executar** →
   autorize as permissões (o aviso "app não verificado" é normal em projeto
   pessoal: **Avançado → Acessar**). O e-mail de teste chega na sua caixa.
6. Clique em **Implantar → Nova implantação → App da Web**:
   - Executar como: **Eu**
   - Quem tem acesso: **Qualquer pessoa**
   Clique em **Implantar** e copie a URL terminada em `/exec`.

```javascript
/**
 * Relay de e-mail do Facil (Google Apps Script).
 * Recebe { secret, to, subject, text, name } via POST e envia pela conta.
 * Contrato: responder HTTP 200 com {"ok": true} em caso de sucesso; qualquer
 * outra coisa marca o e-mail como falho na caixa de saída do Facil.
 */
const SEGREDO = 'TROQUE-ESTE-SEGREDO-POR-UM-VALOR-LONGO-E-ALEATORIO';

function doPost(e) {
  var payload;
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (erro) {
    return responder({ ok: false, error: 'Corpo da requisição não é JSON.' });
  }
  if (!payload || payload.secret !== SEGREDO) {
    return responder({ ok: false, error: 'Segredo incorreto.' });
  }
  var para = String(payload.to || '').trim();
  var assunto = String(payload.subject || '').trim();
  var texto = String(payload.text || '');
  if (para === '' || assunto === '') {
    return responder({ ok: false, error: 'Campos "to" e "subject" são obrigatórios.' });
  }
  try {
    MailApp.sendEmail({
      to: para,
      subject: assunto,
      body: texto,
      name: String(payload.name || 'Facil')
    });
  } catch (erro) {
    return responder({ ok: false, error: 'Falha ao enviar: ' + erro });
  }
  return responder({ ok: true });
}

// Rode esta função uma vez para autorizar o script e conferir a entrega.
function testeEnvio() {
  MailApp.sendEmail({
    to: Session.getActiveUser().getEmail(),
    subject: 'Teste do relay do Facil',
    body: 'Se você recebeu este e-mail, o relay está pronto. Cole a URL /exec no Facil.',
    name: 'Facil'
  });
}

function responder(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
```

## Passo 2 — configurar no Facil

Em **Configurações → Suporte e e-mail**:

| Chave               | Valor                                      |
| ------------------- | ------------------------------------------ |
| `mail.enabled`      | ligado (`true`)                            |
| `mail.provider`     | `relay` (Relay — Google Apps Script)       |
| `mail.relay_url`    | a URL `.../exec` copiada no passo 1        |
| `mail.relay_secret` | o mesmo segredo usado no código do script  |

`mail.api_key` e `mail.from` valem só para Resend/Brevo e ficam sem uso no
modo relay. Salve — o efeito é imediato.

## Passo 3 — testar

1. Abra um pedido de suporte de teste (ex.: a página pública `/ajuda`) com um
   e-mail seu de fora.
2. Em **Suporte → E-mails**, o item deve aparecer como **Enviado**; se aparecer
   **Falhou**, o motivo exato está na coluna **Erro** (e dá para corrigir e
   usar o botão de reenviar).
3. Se o pedido foi aberto antes da configuração, ele fica **Pendente** — o
   botão de reenviar entrega na hora.

## Segurança

- O script só aceita chamadas com o segredo correto. O Web App precisa ser
  "Qualquer pessoa" para o Facil conseguir chamar, mas sem o segredo ninguém
  dispara e-mails pela sua conta.
- O segredo viaja no corpo da requisição por HTTPS (o sistema só aceita URLs
  `https://`).
- Se o segredo vazar, troque nos dois lados: no código do script (nova versão
  da implantação) e em `mail.relay_secret`.

## Trocar o endereço remetente

O endereço remetente é a própria conta Google (o nome exibido vem de
`company.name`). Para enviar como `suporte@suaempresa.com` é preciso ter o
domínio verificado — nesse caso, `resend` ou `brevo` (também grátis) passam a
ser a melhor escolha; basta trocar `mail.provider` e as credenciais.

## Se parar de funcionar

- **"Relay não confirmou o envio"**: a URL respondeu algo diferente de
  `{"ok": true}` — normalmente URL errada, implantação removida ou segredo
  divergente. Confira `mail.relay_url`/`mail.relay_secret`.
- **"Relay respondeu 429/500"**: cota diária do Gmail estourada ou instabilidade
  do Google; os e-mails ficam como `failed` e podem ser reenviados depois.
- Alterou o código do script? É preciso **Implantar → Gerenciar implantações →
  editar → Nova versão** para a URL continuar valendo.
