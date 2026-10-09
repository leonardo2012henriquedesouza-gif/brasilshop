# OpenDev Community

Comunidade de programação com visual escuro inspirado em dashboards de repositórios. O estado inicial é vazio: sem projetos, curtidas, perfis, mensagens ou ranking falsos.

## Requisitos
- Node.js 18+ (recomendado Node 20+)
- Aplicação Discord criada no Developer Portal para OAuth
- HTTPS em produção para microfone e compartilhamento de tela

## Rodar localmente
1. Extraia o ZIP e abra esta pasta no VS Code.
2. No terminal, execute `npm install`.
3. Copie `.env.example` para `.env`.
4. Preencha `SESSION_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` e `DISCORD_CALLBACK_URL`.
5. No Discord Developer Portal > OAuth2, cadastre o redirect URI exatamente igual a `DISCORD_CALLBACK_URL`.
6. Execute `npm start` e abra `http://localhost:3000`.

## OAuth Discord
O login é implementado com OAuth2 `identify`. Nunca coloque o client secret no frontend. Em hospedagem, configure variáveis de ambiente e um callback HTTPS.

## Administradores
Os IDs autorizados solicitados estão no `.env.example`:
- `1552721267415584799`
- `1355150439057985687`

A autorização é verificada no backend. Configure `ADMIN_DISCORD_IDS` nas variáveis de ambiente do servidor.

## O que está implementado
- Dashboard responsivo escuro e verde-lima, baseado na referência.
- Exploração sem login; ações de criação/curtida protegidas por login.
- OAuth Discord real quando as credenciais estiverem configuradas.
- Publicação de projetos, ordenação por curtidas e DevRank calculado a partir de dados existentes.
- Tópicos do DevForum.
- Perfil editável (nome público, bio e URL de avatar).
- Painel admin restrito por ID e envio de notificações com indicador.
- Aviso de entrada para `https://discord.gg/programador`.
- Área de mensagens diretas com lista de conversas, descoberta de perfis, envio de mensagens e botão para chamada privada com a pessoa da DM.
- Chat geral em tempo real via Socket.IO, com foto de perfil ao lado das mensagens e envio de imagens/GIFs (PNG, JPG, WEBP e GIF, até 1,5 MB). O histórico fica limitado à memória do processo.
- Grade de contribuições com animação, foco por teclado e detalhes rápidos ao passar o cursor/clicar.
- Atalhos de início para publicar projetos, abrir o chat, criar tópico e acessar salas de voz.
- Salas de voz padrão e criação de salas temporárias, removidas quando o último participante sai.
- Controles de microfone e compartilhamento de tela quando o navegador oferece a API necessária. A prévia da tela é privada para quem está transmitindo; dispositivos móveis podem não oferecer captura de tela no navegador.
- Emblemas transparentes de administrador e membro ao lado dos nomes, fundo preto, cartões com animação suave e navegação responsiva para celular.
- Socket.IO com sessão compartilhada para identificar usuários conectados.

## Importante: persistência e chamadas em grupo
Esta versão é um starter executável, não um serviço pronto para produção. Os dados de projetos, curtidas, usuários, notificações, fórum e DMs ficam em memória e serão perdidos ao reiniciar. Antes de abrir ao público, use PostgreSQL (ou equivalente), migrações, rate limiting, validação de URLs, moderação e armazenamento de imagens.

Os controles de microfone e tela demonstram permissões/controles locais. Para chamadas reais entre múltiplos usuários com áudio e compartilhamento de tela, integre um SFU WebRTC como LiveKit ou mediasoup, com tokens gerados no backend e salas autenticadas. Socket.IO sozinho não transporta mídia. A base inclui eventos de sinalização, mas não afirma que uma chamada em grupo esteja completa.

O chat geral, as DMs, as salas temporárias e os projetos continuam em memória nesta versão; reiniciar o servidor limpa esses dados. As salas exibem presença em tempo real, mas áudio em grupo real ainda precisa de um servidor SFU/WebRTC. A função de adicionar usuário no painel verifica contas que já fizeram login; não cria contas Discord arbitrárias. O progresso de desafios e a correção automática ainda precisam de armazenamento e executor seguro.


### Atualização de recursos
- Os dados de usuários, projetos, curtidas, mensagens privadas, chat geral, tópicos/respostas e notificações são gravados em `data/community.json`. Faça backup desse arquivo.
- Configure `BETA_DISCORD_IDS` no `.env` com IDs Discord separados por vírgula para atribuir o selo Beta.
- O selo Top 1 é calculado automaticamente com base no ranking de curtidas e projetos.
- A preferência de tema claro/escuro é salva no navegador.
- O áudio em chamadas depende de permissão de microfone, HTTPS (fora de localhost) e suporte WebRTC; em algumas redes é necessário um servidor TURN para conectividade confiável.


## Cargos, insígnias e moderação

- Fundador: ID `1552721267415584799`, com a insígnia de fundador.
- Administrador: ID `664656129770389545` e IDs adicionais em `ADMIN_DISCORD_IDS`.
- Moderadores: configure IDs separados por vírgula em `MODERATOR_DISCORD_IDS`.
- Os moderadores podem apagar mensagens do chat geral, tópicos, projetos e remover contas comuns. Administradores/fundador têm hierarquia superior.
- Insígnias de cargo, Beta e Top 1 são exibidas no perfil público.
- Contas removidas pela moderação são bloqueadas pelo ID e seus conteúdos da comunidade são apagados.

Faça backup de `data/community.json` antes de atualizar o servidor.

## DevRank mensal do chat

O DevRank agora classifica a participação pelo número de mensagens enviadas no chat geral durante o mês corrente. A contagem fica em `data/community.json` no objeto `chatActivity` e muda para uma temporada nova automaticamente quando o mês do servidor muda. O primeiro colocado recebe o destaque Top 1; no mês seguinte, a classificação começa novamente do zero. Mensagens de texto e mensagens com imagem/GIF contam como uma participação cada.

O compositor do chat foi refinado para usar toda a largura disponível, alinhar o seletor de Foto/GIF à esquerda e manter a caixa de texto e o botão Enviar numa linha equilibrada, inclusive em telas pequenas.

### Presença e menções no chat geral
- A presença Online/Offline representa se a conta autenticada mantém uma conexão ativa com o site.
- Para mencionar alguém no chat geral, use `@nomeDeUsuario` (nome público sem espaços). O servidor resolve a menção contra usuários cadastrados e registra a contagem não lida.
- O contador ao lado de “Chat geral” mostra as menções pendentes e é limpo quando a pessoa abre o chat. Se o navegador já tiver permissão para notificações, uma notificação do sistema também é mostrada enquanto o site estiver aberto.
- O status de presença do Discord (Online/Ausente/Não perturbe) não é fornecido pelo OAuth `identify`; para exibi-lo com segurança, configure um bot do Discord no servidor compartilhado, com o intent privilegiado `PRESENCE INTENT`, e sincronize as presenças dos membros. Sem essa integração, o site deve mostrar apenas a presença do próprio site, sem inventar um status Discord.

### Atualização de interface, bot oficial e servidor Discord
- O compositor do chat geral agora mantém o botão de anexar, a caixa de mensagem e o botão Enviar alinhados em uma única linha. Menções `@usuario` recebem destaque visual.
- O bot da comunidade usa o ícone próprio e recebe a etiqueta **OFICIAL** na lista de conversas, no cabeçalho da DM e no perfil.
- A aba **Servidor Discord** mostra um cartão com a identidade visual do Servidor dos Programadores e pode exibir o widget oficial de membros do Discord.
- Para ativar o widget: habilite **Configurações do servidor → Widget** no Discord e defina `DISCORD_GUILD_ID` e `DISCORD_INVITE_URL` no `.env`. Sem um ID de servidor válido e o widget ativado, a aba mostra instruções de configuração em vez de inventar dados.
- O banner personalizado do perfil aceita PNG, JPG, WEBP ou GIF de até 15 MB. A API e o limite de JSON foram ajustados para aceitar o arquivo codificado em Base64.
- As insígnias do Discord e do site aparecem juntas na mesma área do perfil. O site usa os `public_flags` que a API oficial do Discord retorna no login OAuth. O Discord não fornece todos os detalhes privados da conta via `identify`; o site não inventa insígnias ou estado Nitro quando a API não os retorna.
- O painel de moderação só aparece na navegação do fundador do site e do dono do servidor; as permissões continuam sendo validadas no backend.


## Atualizações de interface e integração Discord

- O bot interno usa a logo oficial do Servidor dos Programadores como avatar e o ícone de robô na identificação de cargo.
- O campo de envio do chat geral usa um layout em linha com anexo, texto e envio, adaptado para telas pequenas.
- A aba **Servidor Discord** apresenta um cartão compacto inspirado no convite do Discord. Para carregar membros online e contagem de presença, ative o widget em Configurações do Servidor > Widget e preencha `DISCORD_GUILD_ID` e `DISCORD_INVITE_URL` no `.env`. A contagem total é aproximada e depende de o convite estar acessível.
- O perfil lista as insígnias públicas identificadas em `public_flags`/`flags`; o selo Nitro só aparece quando a resposta OAuth informa explicitamente `premium_type` positivo. O Discord não expõe necessariamente o estado Nitro a todo fluxo OAuth, então o site não inventa esse estado.
- O painel de contribuições permanece exclusivo da página **Início**.


## Atualizações desta revisão
- Sugestões de menção `@usuário` no chat geral com foto e nome de contas cadastradas; a menção inserida usa o identificador Discord para resolver nomes públicos com espaços.
- Missões diárias: presença de 15 minutos, 5 mensagens no chat geral e abertura de 3 perfis diferentes. Até 3 recompensas por dia; a validação e as moedas ficam no servidor.
- Corrigido o protocolo de callback de `room:list`, que impedia o retorno da lista de calls. O estado de microfone mutado/desmutado é transmitido aos participantes.
- O ícone do bot oficial tem o fundo externo transparente.
- Imagens do chat geral aceitam até 100 MB e são salvas como arquivos em `public/uploads`, em vez de persistir o base64 no histórico. O limite do payload Socket.IO/JSON foi elevado para suportar o base64.

Nota: o estado Nitro e algumas insígnias não são fornecidos pela API OAuth do Discord em todos os casos. O site só pode mostrar distintivos públicos efetivamente retornados pelo Discord; não deve inventar um status Nitro.
