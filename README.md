# Companhia de Mercenários — bot Discord

Bot para uma organização de mercenários de RP de Skyrim. A operação acontece no Discord: o comando `/painel` inicializa uma sala privada onde administradores e gerentes usam botões, menus de seleção e modais para controlar a estrutura, contratos e pagamentos.

## O que a primeira versão faz

O bot cria categorias de comando, contratos, finanças, operações e configuração; cria salas de texto e voz sem duplicar canais com os mesmos nomes; cria um tópico para cada contrato; mantém os estados disponível, aceito, em andamento, concluído, cancelado e arquivado; e registra pagamentos em septims com divisão igual entre os participantes.

A divisão é feita em centavos. Quando o valor não divide exatamente, os centavos restantes são distribuídos de forma determinística entre os primeiros participantes registrados para que a soma das parcelas seja sempre igual ao total pago.

## Criar o aplicativo Discord

1. Acesse o [Discord Developer Portal](https://discord.com/developers/applications) e crie uma Application.
2. Em **Bot**, crie o bot e copie o token apenas para o armazenamento seguro do projeto. Nunca publique o token no chat ou no Git.
3. Em **OAuth2 > URL Generator**, selecione os escopos `bot` e `applications.commands`. Conceda as permissões necessárias para criar e editar canais, enviar mensagens, criar tópicos, gerenciar tópicos e usar menus/modais. O convite deve ser feito por um administrador do servidor.
4. Depois que o bot estiver no servidor, execute `/painel`. O proprietário ou alguém com Administrator pode inicializar a estrutura.
5. Na sala privada criada, use **Definir cargos** e informe os IDs dos cargos de gerente e administrador. O modo desenvolvedor do Discord permite copiar IDs.

## Variáveis protegidas

Configure `DATABASE_URL` pelo banco gerenciado do projeto e `DISCORD_TOKEN` pelo recurso de segredos do projeto. `DISCORD_GUILD_ID` é opcional e serve para registrar `/painel` imediatamente em um servidor durante a instalação; sem ele, o comando é registrado globalmente e pode levar algum tempo para aparecer. `PORT` usa 3000 por padrão.

## Execução local

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install
pnpm typecheck
pnpm start
```

O endpoint `GET /health` retorna o estado do processo e se o cliente Discord está conectado. O schema é aplicado automaticamente na inicialização e também pode ser aplicado com `pnpm migrate`.

## Hospedagem

A imagem de produção usa o `Dockerfile`, inicia `pnpm start` e expõe `GET /health` para o health check. O banco é a fonte durável; a imagem e o filesystem do processo não devem ser usados para guardar dados da guilda.

## Segurança operacional

Apenas proprietário/Administrator ou cargos de administrador configurados podem alterar cargos, textos e estrutura. Gerentes e administradores podem criar contratos, consultar contratos, montar equipes, alterar estados e registrar pagamentos. O bot não realiza pagamentos reais: septims são uma unidade fictícia registrada para o RP.
