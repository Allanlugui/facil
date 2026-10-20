# Identidade visual — depósito de imagens

Solte aqui as imagens originais, soltas na pasta, com qualquer nome. O agente
identifica, corta, redimensiona, otimiza, renomeia e coloca cada uma no lugar
certo do sistema. Os arquivos desta pasta são a **fonte** — nada aqui é editado
ou apagado.

## O que enviar (nomes sugeridos são bem-vindos, mas opcionais)

| # | Imagem | Nome sugerido | Formato ideal | Onde vai aparecer |
|---|--------|---------------|---------------|-------------------|
| 1 | Logo principal (fundo claro) | `logo.png` ou `logo.svg` | PNG com fundo transparente ou SVG; altura ≥ 400 px | Menu lateral + tela de login |
| 2 | Logo para fundo escuro | `logo-escuro.png` | Idem, versão clara (para o tema Noturno) | Menu lateral no tema escuro |
| 3 | Símbolo (só o ícone, sem texto) | `marca.png` | Quadrado, ≥ 512×512 | Favicon, aba do navegador, app no celular |
| 4 | Papel de parede do login | `login-fundo.jpg` | ≥ 1920×1080 (uma versão vertical opcional para celular) | Fundo da tela de login |
| 5 | Imagem de abertura | `splash.png` | 1080×1080 ou maior, ou 1920×1080 | Tela "carregando o sistema" |
| 6 | Capas | `capa-*.jpg` | ≥ 1920 px de largura | Faixas de topo das telas (conforme combinado) |

## Regras práticas

- Pode mandar grande e sem compressão (até ~20 MB por arquivo) — a otimização é por nossa conta.
- Evite texto embutido na imagem: o texto entra pelo sistema, por cima da imagem.
- Fundo transparente é melhor que fundo branco (funciona nos 5 temas).
- Sem logo definitivo? Começamos com o que tiver; trocar depois é só substituir o arquivo.
- Aceito também SVG de conjunto de ícones, se quiser personalizar os ícones internos.

## O que acontece com os arquivos

1. A cópia processada vive em `src/client/public/branding/` — entra no build junto com o sistema.
2. Nada vai para a internet: tudo continua local até autorização explícita de deploy.

## O que já foi gerado a partir destes arquivos (19/10/2026)

| Original (aqui) | Processado (em `src/client/public/branding/`) | Como foi feito |
|---|---|---|
| `logo.png` (2752×1536, fundo branco) | `logo.webp` e `logo-dark.webp` (1200×580, com transparência) | Geometria do círculo medida no original e extração **pixel a pixel em canvas**: dentro do círculo o pixel é intacto (círculo preto + "Corp" em branco + ponto laranja); fora, o branco vira transparente e o cinza do "Services" é preservado. A variante escura é a **inversão** fora do laranja (círculo branco, "Corp" preto, ponto laranja intacto). Ver D-37. |
| `marca.png` (2048×2048) | `favicon.png` (64 px) e `apple-touch-icon.png` (180 px) | Recorte do símbolo com fundo próprio (a versão transparente some em aba clara). |
| `capa.jpg` (2752×1536) | `cover.webp` (1920 px) e `cover-mobile.webp` | Pré-corte em faixa com a marca centralizada, para o `object-fit: cover` não cortar o logo em telas largas. |
| `login-fundo.jpg` (2752×1536) | `login-bg.webp` (1920 px) | Conversão para WebP. |
| `splash.png` (1536×2752) | `splash.webp` | Conversão para WebP. |

Observação: `logo-escuro.png` **não é mais usado** — o logo do tema escuro é a variante invertida
do próprio `logo.png` (o arquivo original tinha o círculo preto sobre fundo escuro e sumia no
menu Noturno). `logo.svg` também saiu do build; ele continua aqui como original do usuário.
