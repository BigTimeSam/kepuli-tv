---
title: Player de portal Stalker no navegador, com seu endereço MAC | Kepuli-TV
description: Assista a um portal Stalker (MAG) no Chrome ou no Firefox sem set-top box. O Kepuli-TV usa o endereço do portal e o endereço MAC registrado na sua assinatura.
alt: Canais ao vivo no Kepuli-TV, um deles tocando ao lado da lista
---

# Player de portal Stalker no navegador

Um provedor que vende o serviço para set-top boxes MAG fornece um endereço de
portal, muitas vezes terminado em `/c/`, e registra um endereço MAC para o
aparelho. Não há nome de usuário nem senha. O Kepuli-TV conversa com esse
tipo de portal a partir de uma aba do navegador, e assim dá para assistir à
assinatura sem o aparelho.

## Conecte-se a um portal

1. Instale o Kepuli-TV e clique no ícone dele na barra de ferramentas.
2. Cole o endereço do portal em **Endereço da assinatura ou da playlist**.
   Um endereço terminado em `/c/` é reconhecido, e o formulário passa para
   **Portal Stalker (endereço MAC)**.
3. Informe o endereço MAC registrado na sua assinatura.
4. Pressione **Conectar** e escolha **Permitir** quando o navegador
   perguntar se o Kepuli-TV pode acessar o portal.

> [!IMPORTANT]
> Use apenas o endereço MAC registrado na sua própria assinatura. O de outra
> pessoa, ou um tirado de uma lista compartilhada, não pode ser usado: veja
> os [termos de uso](/terms/).

## O que funciona

- **Canais, filmes e séries** como o portal os lista.
- **Os dados de programação do próprio portal** na lista e no
  [guia de programação](/iptv-epg-guide/).
- **Reconexão**: o link de transmissão de um portal costuma valer para uma
  única conexão, então o player pede um novo sempre que uma transmissão ao
  vivo é aberta de novo.

## O que ainda não funciona

- **O arquivo do portal** (catch-up) ainda não está disponível.
- **A sincronização** deixa a conta Stalker de fora, a menos que **Incluir
  senhas** esteja ativado, já que o endereço MAC vale tanto quanto uma senha.

## Como ele acessa o portal

Um portal espera um aparelho MAG: o endereço MAC em um cookie e o nome de um
set-top box no lugar do nome do navegador. Uma página web não consegue
definir isso sozinha, então a extensão define esses valores apenas para as
suas próprias requisições ao servidor do portal, e a regra some quando o
navegador é fechado. Os detalhes estão no
[guia do usuário](https://github.com/BigTimeSam/kepuli-tv/blob/main/docs/user-guide.md#stalker-portals)
(em inglês).
