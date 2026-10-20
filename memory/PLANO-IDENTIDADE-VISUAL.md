# Fase — Identidade visual e acabamento (preparação em 18/10/2026)

**Estado: MARCA APLICADA (19/10/2026 — D-36)** — o funcional foi fechado (F-01..F-20) e as imagens
chegaram em `branding/`; foram processadas e aplicadas: logo no menu e no login, papel de parede do
login, favicon, tela de abertura e **capas no topo das homes por perfil** (+ variante mobile).
Decisões do usuário (18/10/2026, D-25..D-28): fechar todo o funcional antes da identidade, cotação
por propostas (D-26), assinatura pela trilha atual (D-27) e capas no topo dos painéis iniciais +
login (D-28). **Falta:** refinar os ícones internos, motion (transições/microinterações) e o aceite
do usuário sobre o resultado visual.

## Auditoria de pendências (antes de encerrar a funcionalidade)

Nenhum bug aberto; o que falta é o backlog planejado (12 itens de execução + 2 decisões)
e o deploy:

- **Rápidas (sem decisão):** F-20 fase 2 (painéis de comprador, estoquista, limpeza e
  recepção); F-16 (locais homônimos nos seletores).
- **Compras (P1):** F-01 decisão item a item; F-02 cotação com retorno (**decisão de
  formato pendente**: propostas por item × só sinalizar); F-03 fornecedor visível na
  trilha; F-04 relatório ampliado; F-05 linha do tempo da solicitação; F-06 destino final
  do material.
- **OS (P1):** F-07 foto só por câmera na execução; F-08 anexos restritos a superiores
  (permissão a definir); F-10 OS filha.
- **Estrutura (P3):** F-14 usabilidade da tela de estrutura (usuário achou confusa).
- **Decisões:** F-15 assinatura (manter trilha × hash encadeado); captcha já decidido como
  camada final (D-15). Opcionais: anexos em OS, CI no GitHub Actions, limpeza do Serena.
- **Deploy:** `git init` + primeiro commit; Cloudflare real (D1/R2, migrations remotas);
  publicar SÓ com autorização (D-10). Nota: a stack é Workers + D1 + R2 — **Vercel não
  executa**; alvo é Cloudflare. Intranet pura exigiria servidor local (projeto à parte).

## Fase de identidade visual — escopo previsto

**Decisões do usuário (18/10/2026):** capas de imagem apenas **no topo dos painéis iniciais**
(home de cada perfil) e **no login** (papel de parede); telas internas limpas (D-28). Os 5 temas
(F-18) continuam valendo e todo motion respeita `prefers-reduced-motion`.

1. **Depósito:** originais em `branding/` → processados em `src/client/public/branding/`
   (copiados no build; servidos pelo binding de assets do Worker).
2. **Integrações:** login (papel de parede + logo no lugar do "F" atual), menu lateral
   (logo + variante para o tema Noturno), favicon/aba do navegador, splash de carregamento
   (estático no `index.html` + tela de carregamento), capas de topo das homes.
3. **Ícones internos:** refinar o conjunto atual (traço 1.6) ou aplicar conjunto novo do
   usuário (SVGs aceitos no mesmo depósito).
4. **Motion:** transições de página, abertura de diálogos e microinterações — com
   `prefers-reduced-motion` respeitado; auditoria com os guias de animação do agente.
5. **Regras:** os 5 temas (F-18) preservados; nada publicado sem autorização; evidência
   visual em `ux-shots/` ao final.

## Pendências desta preparação

- [x] Usuário joga as imagens em `branding/` (qualquer nome; o agente renomeia) — 8 arquivos em
      19/10/2026; processados em `src/client/public/branding/` e aplicados (D-36).
- [x] Decisões: escopo (fechar tudo — D-25); cotação F-02 (propostas por item — D-26);
      assinatura F-15 (trilha atual — D-27); capas (topo dos painéis iniciais + login — D-28).
- [ ] Ícones internos: refinar o conjunto atual (traço 1.6) ou aplicar conjunto novo do usuário.
- [ ] Motion: transições de página, abertura de diálogos e microinterações (com
      `prefers-reduced-motion` respeitado).
- [ ] Aceite do usuário sobre o resultado visual (capturas `ux-shots/vi-*.png`).
