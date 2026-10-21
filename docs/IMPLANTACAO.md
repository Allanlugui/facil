# Implantação corporativa - Facil na CorpServices Group

Guia para a equipe de TI copiar, implantar e manter o sistema na companhia.
Tudo roda no **plano gratuito** da Cloudflare, sem servidor próprio.

- **Autor:** Allan Luiz Silveira Lima (Allanlugui)
- **Repositório:** privado (GitHub) — peça acesso ao autor
- **Assinatura de releases:** `docs/ASSINATURA.md`
- **Licença:** `LICENSE` (proprietária, uso interno)

---

## 1. Visão geral

```
Navegador  ──HTTPS──►  Cloudflare Worker "facil"
                         ├── /api/*        API Hono (autenticação, regras, auditoria)
                         ├── /*            React (assets estáticos servidos pelo Worker)
                         ├── D1 "facil-db" banco SQLite gerenciado (dados + sessões + auditoria)
                         └── R2 "facil-attachments"  anexos do chat de suporte (opcional)
```

- **Sem servidor para administrar:** o Worker roda na borda da Cloudflare.
- **Banco:** D1 (SQLite gerenciado) com migrations versionadas em `migrations/`.
- **Anexos de chamados/OS:** gravados no próprio D1 (limite configurável, padrão 20 MB por arquivo).
- **Anexos do chat de suporte:** R2 (bucket opcional; sem ele o chat funciona, mas sem anexos).
- **Sessões:** token aleatório com hash no D1; cookie `facil_session` (HttpOnly/SameSite).
- **Senhas:** PBKDF2 com salt individual; nunca em texto puro.

### Requisitos

- Conta **Cloudflare** (plano gratuito) com Workers, D1 e (opcional) R2 habilitados.
- **Node.js 22+** e **npm** na máquina de build.
- Conta **GitHub** com acesso ao repositório privado.
- (Opcional) domínio próprio na Cloudflare para URL corporativa.

---

## 2. Primeira implantação (passo a passo)

### 2.1 Obter o código

```bash
git clone https://github.com/<conta>/facil.git
cd facil
npm install
```

### 2.2 Autenticar no Cloudflare

```bash
npx wrangler login
```

### 2.3 Criar o banco D1

```bash
npx wrangler d1 create facil-db
```

Copie o `database_id` retornado e substitua o placeholder em `wrangler.jsonc`:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "facil-db",
    "database_id": "<cole-o-id-real-aqui>",
    "migrations_dir": "migrations"
  }
]
```

### 2.4 Aplicar as migrations

```bash
npx wrangler d1 migrations apply facil-db --remote
```

São 20 migrations (`0001`..`0020`). Elas criam estrutura, permissões (53),
compras/cotação, anexos, OS filha, fluxo corporativo de compras (v2), centros de
custo, pedidos por fornecedor, outbox de integração e compras v3 por setor
(setores, gestores, formas de pagamento). **Não** carregam dados demo.

A migration `0019_purchase_workflow.sql` é aditiva: preserva solicitações
antigas na versão 1 e cria as tabelas do fluxo novo. A migration
`0020_organization_purchases.sql` também é aditiva: cria `departments`,
`department_managers`, `payment_methods` e as colunas do v3
(`workflow_version`, `flow_revision`, `purchase_mode`, `payment_method_id`,
`payment_terms`, nota fiscal no recebimento e permissões do setor de Compras).
Faça backup do D1 antes de aplicar em produção.

### 2.5 (Opcional) Bucket R2 para anexos do suporte

```bash
npx wrangler r2 bucket create facil-attachments
```

- O R2 precisa estar **habilitado no painel da Cloudflare** (a ativação exige
  cadastro de cobrança, mesmo no plano gratuito de 10 GB).
- Sem o bucket, o chat de suporte continua funcionando **sem anexos**; os demais
  anexos (chamados/OS) usam o D1 e não dependem do R2.

### 2.5.1 (Opcional) Chave do intake ServiceNow

Para receber chamados do ServiceNow, configure uma chave longa e aleatória:

```bash
npx wrangler secret put TICKET_INTAKE_KEY
```

Sem a chave, `POST /api/intake/tickets` responde `503 INTAKE_DISABLED`. A chave
não deve ser escrita no repositório, em `wrangler.jsonc` ou em documentação.
Detalhes em `docs/INTEGRACOES.md`.

### 2.6 Assinar a release e publicar

```bash
npm run deploy
```

O comando executa, nesta ordem:

1. `node scripts/sign-release.mjs` — gera `SIGNATURE.json` e `build-info.json`;
2. `npm run check` — typecheck + lint + contrato de API + 169 testes;
3. `npm run build` — interface + Worker;
4. `wrangler deploy` — publica.

Ao final, o Wrangler imprime a URL `https://facil.<sua-conta>.workers.dev`.

> **Chave de assinatura:** a chave privada fica fora do repositório
> (`%USERPROFILE%\.facil-signing\` no Windows). Ao copiar o projeto para outra
> máquina/equipe, defina `FACIL_SIGNING_KEY` apontando para a chave autorizada
> ou gere uma nova (a autoria da release passa a ser de quem assinar). Detalhes
> em `docs/ASSINATURA.md`.

### 2.7 Instalação inicial (primeiro acesso)

Abra a URL publicada. Enquanto não existir usuário, o sistema mostra a tela
**Instalação inicial**:

- nome da empresa (ex.: `CorpServices Group`);
- nome, e-mail e senha do administrador;
- opção de criar a estrutura inicial (matriz + almoxarifado).

Depois disso, o administrador cria unidades, locais, usuários e permissões em
**Configurações / Usuários**.

### 2.8 Conferir a assinatura do deploy

```bash
curl https://facil.<sua-conta>.workers.dev/api/health
curl https://facil.<sua-conta>.workers.dev/build-info.json
curl -I https://facil.<sua-conta>.workers.dev/api/health
```

Resposta esperada: autor, `signedAt`, `treeHash` e assinatura; os cabeçalhos
`X-Facil-Author`, `X-Facil-Release`, `X-Facil-Signed-At` e
`X-Facil-Tree-Sha256` aparecem nas respostas de `/api/*`.

No repositório:

```bash
npm run verify     # assinatura Ed25519 + integridade dos arquivos
```

---

## 3. Domínio próprio e CI/CD

### 3.1 Domínio corporativo

No painel da Cloudflare (zona do domínio), adicione uma rota/custom domain para
o Worker `facil` (ex.: `facil.corpservices.com.br`). O Worker serve a interface e
a API no mesmo host — não é preciso configuração extra de CORS.

### 3.2 Workers Builds (opcional)

Conecte o repositório privado em **Workers & Pages → facil → Settings → Builds**:

- **Build command:** `npm run release`
- **Deploy command:** `npx wrangler deploy`
- **Root directory:** `/`

Cada push na branch `main` gera uma release assinada e publicada. Segredos
nunca vão para o repositório; a configuração de e-mail vive no D1.

### 3.3 Restringir o acesso (recomendado)

O app já exige login, mas a URL `workers.dev` é pública. Para restringir por
rede/SSO:

- **Cloudflare Access** (Zero Trust, grátis até 50 usuários) sobre o domínio
  próprio; ou
- VPN/intranet corporativa; ou
- regra de WAF por IP/país.

Access exige domínio próprio (não funciona em `*.workers.dev`).

---

## 4. E-mail (opcional)

O envio vive em **Configurações → E-mail** (tabela `settings`) e não em
variáveis de ambiente. Guias:

- `docs/email-gmail-senha-app.md` — Gmail com senha de app (SMTP direto);
- `docs/email-relay-gmail.md` — relay compatível.

Sem configuração, o sistema funciona, mas não envia notificações por e-mail.

---

## 5. Perfis e permissões

- 48 permissões granulares, agrupadas por módulo.
- Perfis padrão: administrador, gestor de facilities, comprador, estoquista,
  técnico, solicitante, limpeza e recepção.
- O **administrador** gerencia usuários, permissões, unidades e configurações.
- A **gestão** (`facilities_manager`/`admin`) vê estoque, documentos e a árvore
  pai/filha de OS; os demais recebem respostas neutras.
- Toda ação relevante gera registro em `audit_log` (com ator, data/hora e
  antes/depois quando aplicável).

---

## 6. Backup e restauração

### Banco (D1)

```bash
# exportar (SQL)
npx wrangler d1 export facil-db --remote --output backup-facil-YYYY-MM-DD.sql

# restaurar em um banco novo
npx wrangler d1 execute facil-db-restore --remote --file backup-facil-YYYY-MM-DD.sql
```

Agende o export diário (script/cron da TI) e guarde fora da máquina de build.
O D1 tem retenção/point-in-time no painel; o export é a cópia portátil.

### Anexos (R2)

```bash
npx wrangler r2 object get facil-attachments <chave> --file <destino>
```

A lista de chaves está na tabela `attachments` (metadados no D1).

---

## 7. Atualização

```bash
git pull
npm install
npx wrangler d1 migrations apply facil-db --remote   # se houver migration nova
npm run deploy
```

- Rode `npm run check` antes de publicar (o `deploy` já roda).
- A assinatura é refeita a cada release; confira com `npm run verify`.
- Para rollback: `npx wrangler deployments list` e
  `npx wrangler rollback <id>` (o banco não volta sozinho — restaure o backup se
  a migration for destrutiva).

---

## 8. Segurança

- Sessões com token aleatório (hash no D1), expiração e revogação por usuário.
- Senhas PBKDF2 + salt; política mínima validada no servidor.
- Autorização **no servidor** por rota/permissão (nunca só no frontend).
- Cabeçalhos `X-Content-Type-Options`, `Referrer-Policy` e `X-Request-Id`.
- Auditoria de ações sensíveis em `audit_log`.
- **Nunca** commite `.dev.vars`, `.env` ou chaves. O `.gitignore` já cobre.
- A chave privada de assinatura fica fora do repositório; faça backup seguro.

---

## 9. Limitações conhecidas

- Sem SSO/SAML nativo (use Cloudflare Access na frente, se necessário).
- Anexos de chamados/OS ficam no D1 (limite prático por arquivo: 20 MB,
  configurável em `attachments.max_bytes`).
- Sem aplicativo móvel nativo (a interface é responsiva).
- R2 precisa de ativação no painel (cobrança cadastrada), mesmo no plano free.
- O horário exibido segue o fuso do navegador; a assinatura usa
  America/Sao_Paulo.

---

## 10. Checklist de aceite da implantação

- [ ] `npx wrangler d1 migrations apply facil-db --remote` sem erro.
- [ ] `npm run deploy` concluído (assinatura + checks + build + deploy).
- [ ] URL abre a tela de **Instalação inicial**.
- [ ] Administrador criado; login funcionando.
- [ ] `/api/health` e `/build-info.json` mostram autor, data/hora e tree hash.
- [ ] `npm run verify` com assinatura válida e manifesto intacto.
- [ ] Backup do D1 agendado e testado (restauração em banco novo).
- [ ] (Opcional) R2 criado e anexo de teste no chat de suporte.
- [ ] (Opcional) domínio próprio + Cloudflare Access.

---

## 11. Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `database_id` inválido no deploy | placeholder não substituído | rode `wrangler d1 create facil-db` e cole o id |
| `Please enable R2 through the Cloudflare Dashboard` | R2 não ativado | ative R2 no painel (dados de cobrança) ou ignore (anexos do suporte ficam off) |
| `/` e `/login` retornam 404 no `wrangler dev` (Windows) | watcher de assets com EPERM | use `npm run dev:client` na porta 5173 |
| Migration falha com "table already exists" | banco com estado parcial | restaure o backup ou aplique só as migrations pendentes |
| E-mail não envia | configuração ausente/credencial inválida | Configurações → E-mail; ver `docs/email-gmail-senha-app.md` |
| Assinatura inválida em `npm run verify` | código alterado após assinar | rode `npm run sign` e faça novo commit/deploy |

---

## 12. Contato

**Allan Luiz Silveira Lima** — autor e responsável técnico (contato interno).
