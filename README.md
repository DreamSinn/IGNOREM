# Companhia da Lua de Ferro — bot Discord

Bot para a Companhia da Lua de Ferro, uma guilda de mercenários de RP de Skyrim. Toda a operação acontece no Discord: o `/painel` abre uma sala privada com botões, menus e formulários para administrar a estrutura, os contratos, as equipes e os pagamentos em septims (moeda fictícia do RP; o bot não movimenta dinheiro real).

## Estrutura criada no servidor

O `/painel` (ou o botão **Sincronizar estrutura**) cria cinco categorias, reutilizando canais que já existam com o mesmo nome:

| Categoria | Canais | Uso |
|---|---|---|
| ⚔️ Comando | 🔒 Painel | Sala privada de configuração (somente proprietário, administradores e cargos autorizados) |
| 📜 Contratos | 📜 Contratos, 🗃️ Arquivo | Cartões das missões em andamento e registros concluídos, cancelados ou arquivados |
| 💰 Finanças | 💰 Caixa da Guilda | Saldo e totais da guilda (somente leitura para membros) |
| 🏕️ Operações | 💬 Chat-Geral, 🔊 Sala de Operações (voz) | Conversa e reuniões da companhia |
| 🛠️ Configuração | 🧾 Auditoria | Registro das ações administrativas (restrito a gerentes e administradores) |

Se você está atualizando uma instalação anterior, o bot move os canais existentes para as novas categorias e remove a categoria antiga "COMPANHIA" quando ela fica vazia.

## Comandos

- `/painel`: abre ou atualiza o painel na sala privada. Usa-se uma vez na instalação.
- `/estrutura`: sincroniza categorias, canais e permissões. Use após atualizar o bot.
- `/novo-contrato`: abre o formulário de novo contrato (gerentes e administradores).
- `/contrato`: abre o cartão e os controles de um contrato. Tem autocomplete: digite parte do código ou do título e escolha na lista (gerentes e administradores).
- `/contratos`: quadro de missões, com filtro por situação (gerentes e administradores).
- `/meus-contratos`: lista as missões em que você participa. Disponível para todos.
- `/identidade`: aplica as imagens de perfil (avatar e banner do bot, foto e banner do servidor) configuradas no painel. Administradores.
- `/pagamentos`: livro-caixa com os pagamentos lançados (gerentes e administradores).

## Imagens

As imagens são configuradas pelo próprio painel, sem mexer em arquivos:

- **Imagens dos cartões** (botão no painel): banner padrão (painel e contratos disponíveis), e banners de aceito, em andamento, concluído, cancelado e arquivado.
- **Imagens de perfil** (botão no painel): arquivado, avatar do bot, banner do bot, foto do servidor (também usada como miniatura dos cartões) e banner do servidor.

Cole o link direto de cada imagem (precisa começar com `https://` e apontar para um arquivo de imagem). O bot confere cada link antes de salvar; se algum estiver errado, nada é gravado e o bot mostra o que corrigir. Campo vazio volta para a imagem padrão.

Dicas:
- Use um link permanente (por exemplo Imgur, GitHub ou outro serviço de imagens). Links do CDN do próprio Discord expiram e a imagem deixa de aparecer.
- Os banners dos cartões mudam na próxima atualização de cada contrato. Para atualizar um cartão antigo na hora, use **Sincronizar anúncio** no detalhe do contrato.
- Depois de trocar as imagens de perfil, execute `/identidade` para aplicá-las no bot e no servidor. O Discord limita a troca de avatar e banner do bot.

Se nenhum link for configurado, o bot usa as imagens padrão. Isso exige a variável `PUBLIC_BASE_URL`, pois o Discord busca as imagens padrão pelo endereço público do bot.

## Ciclo de um contrato

1. **Disponível.** O gerente cria o contrato; ele aparece no canal Contratos com o botão **Tenho interesse** para os membros.
2. **Aceito.** O gerente aprova os interessados na equipe (o membro recebe uma DM). Ao aprovar, o contrato passa para aceito.
3. **Em andamento.** O gerente avança a missão pelo botão **Detalhes / atualizar** do cartão ou pelo `/contrato`.
4. **Concluído.** O gerente conclui a missão e lança o pagamento. Cada participante recebe uma DM com a sua parte. O cartão vai para o Arquivo.
5. **Arquivado.** Registro final. Missões canceladas também podem ser arquivadas.

Em qualquer etapa, o cartão mostra uma barra de progresso e a situação atual. Cada ação relevante (criação, aprovação, mudança de situação, pagamento e alteração de cargos) é registrada no canal Auditoria.

## Permissões

- **Proprietário ou Administrator** do servidor pode criar a estrutura, definir cargos e textos e fazer tudo o que os administradores configurados fazem.
- **Administradores configurados** podem alterar cargos, textos e estrutura e limpar mensagens do canal atual.
- **Gerentes configurados** podem criar contratos, abrir contratos, montar equipes, alterar situações e registrar pagamentos.
- **Membros** veem os contratos, registram interesse e consultam as próprias missões.

Os cargos são definidos no painel, no botão **Cargos autorizados**. Use IDs de cargo; o `@everyone` não pode ser autorizado.

## Regra financeira

Ao lançar um pagamento, o bot reserva o percentual configurado para o caixa da guilda (10% por padrão) e divide o restante igualmente entre os participantes. Os centavos que sobram são distribuídos de forma determinística entre os primeiros participantes, então o total pago sempre fecha. O percentual está salvo no banco, mas ainda não há controle para alterá-lo pelo painel. O plano original previa dividir o valor total sem reserva; essa diferença ainda precisa ser confirmada.

## Criar o aplicativo Discord

1. Crie uma Application no [Discord Developer Portal](https://discord.com/developers/applications).
2. Em **Bot**, crie o bot e copie o token para o armazenamento seguro do projeto. Nunca publique o token em chat ou no Git.
3. Em **OAuth2 > URL Generator**, selecione os escopos `bot` e `applications.commands`, e as permissões: Ver canais, Enviar mensagens, Enviar mensagens em tópicos, Incorporar links, Gerenciar canais, Gerenciar tópicos, Gerenciar mensagens, Ler histórico de mensagens. Convide o bot com um administrador do servidor.
4. Execute `/painel` no servidor. O proprietário ou alguém com Administrator inicializa a estrutura.
5. Na sala privada, use **Cargos autorizados** e informe os IDs dos cargos de gerente e administrador (modo desenvolvedor do Discord permite copiar IDs).

## Variáveis de ambiente

- `DATABASE_URL`: conexão MySQL (`mysql://usuario:senha@host:3306/banco`). Configure pelo banco gerenciado do projeto.
- `DATABASE_CA_PATH`: caminho para a CA, se o banco usar certificado privado. O TLS valida certificados por padrão.
- `DISCORD_TOKEN`: token do bot. Configure pelo recurso de segredos do projeto.
- `DISCORD_GUILD_ID`: opcional. Registra os comandos imediatamente em um servidor; sem ele, o registro é global e pode levar algum tempo.
- `PORT`: porta do servidor HTTP (padrão 3000).
- `PUBLIC_BASE_URL`: endereço público do serviço (ex.: `https://bot.exemplo.com`), usado só pelas imagens padrão em `/assets/<nome>`. Não é necessário se você configurar os links no painel.

## Execução local

```bash
corepack enable
corepack prepare pnpm@10.15.0 --activate
pnpm install
pnpm typecheck
pnpm start
```

O schema (incluindo candidaturas, finanças e auditoria) é aplicado na inicialização. Também é possível aplicá-lo separadamente com `pnpm migrate`.

## Hospedagem e saúde

A imagem de produção é gerada pelo `Dockerfile`, que inicia `pnpm start`. `GET /health` responde antes da conexão com o banco e com o Discord: retorna 200 quando o banco está pronto, e 503 enquanto não estiver. O campo `discord` informa se o bot está conectado. O processo trata SIGTERM e SIGINT encerrando o servidor HTTP, o cliente Discord e o pool do banco.

O banco é a fonte durável dos dados. Não use o filesystem do container para guardar dados da guilda.

## Limitações conhecidas

- O caixa da guilda é visível para todos os membros, porque o saldo é exibido no canal de leitura. Se preferir restringir, ajuste as permissões em `syncOperationalPermissions`.
- Para localizar cartões antigos, o bot percorre até 10.000 mensagens por canal (Contratos e Arquivo). Cópias mais antigas que isso precisam ser removidas manualmente.
- Se o registro de um contrato for salvo no banco e uma etapa posterior falhar no Discord, o bot informa o código e pede que não recrie o contrato. Não há reconciliação automática nesse caso.
- O bot depende das permissões do cargo para apagar as próprias mensagens na troca de canal (Contratos para Arquivo). Se faltar a permissão, o bot mantém o cartão original atualizado e avisa.
- Não há suíte de testes automatizados. A validação atual é a compilação (`pnpm typecheck`) e testes manuais em um servidor de teste.
