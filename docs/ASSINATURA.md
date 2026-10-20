# Autoria e assinatura digital

**Projeto:** Facil — Plataforma de Gestão de Facilities
**Autor:** Allan Luiz Silveira Lima (Allanlugui)
**Empresa:** Corp Services Group
**Formato:** manifesto SHA-256 de todo o código-fonte assinado com **Ed25519**.

> **Privacidade:** CPF e e-mail do autor **não** são gravados no projeto nem no
> sistema. A autoria é provada pela chave Ed25519, pelo manifesto de hashes e
> pela data/hora de cada release — não por dados pessoais.

## O que é assinado

A cada release (`npm run release`), o script `scripts/sign-release.mjs`:

1. lista todos os arquivos do produto (código, migrations, seeds, docs, marca)
   — ficam de fora `memory/` (notas operacionais) e `ux-shots/` (evidências);
2. calcula o SHA-256 de cada arquivo;
3. calcula o **tree hash** (SHA-256 da lista ordenada `caminho + hash`);
4. assina o manifesto com a **chave privada Ed25519 do autor**;
5. grava `SIGNATURE.json` (manifesto, assinatura e chave pública) e publica o
   resumo em `/build-info.json` e nos cabeçalhos do Worker (`/api/*`).

O arquivo `SIGNATURE.json` responde a duas perguntas:

- **o código é exatamente o que foi assinado?** (hashes por arquivo);
- **quem assinou e quando?** (assinatura Ed25519 + data/hora de Brasília).

## Como verificar

```bash
node scripts/verify-release.mjs           # assinatura + integridade dos arquivos
node scripts/verify-release.mjs --signed  # só a assinatura (código alterado depois)
```

Saída esperada: `assinatura Ed25519 valida`, autor, data/hora, tree hash e
`manifesto intacto: N arquivos conferidos`.

## Custódia da chave

- A chave **privada** fica **fora do repositório**, em
  `%USERPROFILE%\.facil-signing\facil-ed25519-private.pem` (ou no caminho de
  `FACIL_SIGNING_KEY`).
- A chave **pública** fica versionada em `signing/facil-ed25519-public.pem` e
  também dentro de `SIGNATURE.json`.
- **Backup:** guarde a chave privada em local seguro (gerenciador de senhas,
  cofre, pendrive cifrado). Sem ela não é possível assinar novas releases em
  nome do autor — mas as releases antigas continuam verificáveis.
- O sistema ainda **não** usa registro externo (ex.: OpenTimestamps, GPG no
  GitHub). A prova é criptográfica e local: assinatura + data/hora + hash do
  código. Se quiser uma prova pública de existência, basta publicar o
  `SIGNATURE.json` em um carimbo de tempo (RFC 3161) ou OpenTimestamps.

## Cada deploy

O `npm run deploy` executa `npm run release` (assinatura + checks + build) antes
do `wrangler deploy`. Todo deploy publicado carrega:

- `/build-info.json` com autor, data/hora, tree hash, fingerprint e assinatura;
- cabeçalhos `X-Facil-Release`, `X-Facil-Signed-At`, `X-Facil-Tree-Sha256` e
  `X-Facil-Author` nas respostas de `/api/*`;
- o mesmo resumo no endpoint público `/api/health`.

Assim, qualquer pessoa pode confirmar que o sistema publicado corresponde ao
código assinado por Allan Luiz.
