---
title: Player de playlist M3U no navegador, por endereço ou arquivo | Kepuli-TV
description: Reproduza uma lista M3U ou M3U8 no Chrome ou no Firefox com o Kepuli-TV. Cole o endereço da playlist ou escolha o arquivo e tenha grupos, logotipos, guia de programação XMLTV e catch-up.
alt: Canais de uma playlist agrupados por país no Kepuli-TV, um deles em reprodução
---

# Player de playlist M3U no navegador

O Kepuli-TV reproduz uma playlist M3U em uma aba do navegador. Informe o
endereço da playlist ou o próprio arquivo, e os canais, filmes e séries dela
aparecem em listas que você pode pesquisar, filtrar e marcar como favoritos.

## Adicione uma playlist pelo endereço

1. Instale o Kepuli-TV e clique no ícone dele na barra de ferramentas.
2. Cole o endereço da playlist em **Endereço da assinatura ou da playlist**.
   O formulário começa em **Endereço da playlist (M3U)**.
3. Pressione **Conectar**. O navegador pergunta se o Kepuli-TV pode acessar
   esse servidor: escolha **Permitir**, o que vale só para esse servidor.

Uma playlist que não exige login, como uma gratuita, vai no mesmo campo.

## Ou escolha o arquivo

**Escolher um arquivo…**, abaixo do endereço, aceita uma playlist que você
tem no dispositivo: `.m3u`, `.m3u8` ou compactada com gzip. Ela é lida pelo
navegador quando você pressiona **Conectar**, e nada é baixado para isso.
Para atualizá-la, escolha o arquivo de novo em **Configurações**: a conta, os
favoritos e o histórico dela permanecem.

## O que é lido da playlist

- **Grupos, logotipos e ids de guia** de uma lista `m3u_plus`, de modo que os
  canais já vêm organizados por país e tema.
- **O guia de programação**: o endereço XMLTV que a playlist indica no
  cabeçalho, ou um que você informa em **Endereço do guia de programação
  (XMLTV)**. Veja [o guia de programação](/iptv-epg-guide/).
- **Catch-up**, quando a playlist marca o arquivo de um canal.
- **Filmes e séries** na mesma lista, cada um em sua aba.
- **Uma lista simples, sem grupos**, que marca as seções com linhas de título
  (“===== Suécia =====”) é agrupada sob esses títulos.

## Quando não funciona

- **O endereço não retornou uma playlist M3U.** significa que o servidor
  respondeu com uma página web ou um erro: muitas vezes uma página de login
  ou um aviso de que a conta expirou. Confira o endereço com o seu provedor.
- Se a playlist vem de um servidor Xtream Codes, o player avisa depois de
  conectar e oferece **Conectar como Xtream Codes**, que traz as categorias,
  as capas e o guia do servidor. Veja
  [Xtream Codes](/xtream-codes-player/).

Várias playlists podem ficar lado a lado como contas, cada uma com seus
favoritos e seu histórico. Mais no [guia do usuário](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#several-accounts) (em inglês).
