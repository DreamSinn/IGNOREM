# Companhia da Lua de Ferro — plano do bot Discord

## Escopo aprovado

Construir um bot instalável e hospedável para a Companhia da Lua de Ferro, uma guilda de mercenários de RP de Skyrim, no Discord. O bot deve criar uma estrutura temática discreta, sem excesso de emojis ou textos artificiais; manter contratos e pagamentos em septims; distribuir o valor igualmente entre os participantes; e permitir que toda a configuração operacional seja feita por um painel privado dentro do próprio Discord.

## Implementação

- Runtime: Node.js 20+ com TypeScript, `discord.js` v14 e um servidor HTTP mínimo para health checks.
- Persistência: banco MySQL gerenciado do projeto, acessado por `mysql2`; a migração é idempotente e roda na inicialização antes de aceitar operações administrativas.
- Discord: slash command `/painel` apenas como ponto de entrada. A operação principal usa botões, menus de seleção, modais e tópicos.
- Autorização: proprietário do servidor e membros com Administrator podem inicializar o painel; depois, os IDs dos cargos de administradores e gerentes ficam persistidos por servidor e são usados em todas as ações administrativas e financeiras.
- Estrutura: cinco categorias (comando, contratos, finanças, operações e configuração), com canais de texto e voz; canais existentes com o mesmo nome são reaproveitados e movidos para a categoria correta. O estado atual está descrito no README.
- Contratos: estados `available`, `accepted`, `in_progress`, `completed`, `cancelled` e `archived`; cada contrato tem um código, tópico próprio, participantes e histórico financeiro.
- Pagamentos: (o código atual reserva 10% para o caixa antes da divisão; ver README e TODO) ao registrar um pagamento, o bot calcula a divisão igual em centavos e distribui eventual sobra de arredondamento de forma determinística, preservando o valor total pago e cada parcela individual.
- Segurança: tokens e DSN somente em variáveis protegidas; não gravar segredos no repositório nem pedir token em mensagem comum.

## Estrutura de arquivos (estado atual no README)

- `src/index.ts`: inicialização do banco, cliente Discord e servidor de saúde.
- `src/db.ts`: migração idempotente, configurações de guilda, contratos, participantes e pagamentos.
- `src/discord.ts`: comandos, permissões, painel, provisionamento de canais, tópicos e interações.
- `sql/001_init.sql`: schema durável.
- `Dockerfile`: imagem de produção com entrada do worker.
- `public/manus-routes.json`: manifesto mínimo de rotas do projeto.
- `README.md`: configuração segura, convite do bot e operação.

## Direção de linguagem e aparência

Alternativas consideradas: Companhia nórdica sóbria (0,07), quadro de guilda medieval (0,06), dark fantasy ornamental (0,05). Escolha: **Companhia nórdica sóbria**.

- Movimento: fantasia nórdica funcional, com linguagem curta e operacional.
- Princípios: hierarquia clara, poucos adornos, informação acionável e histórico auditável.
- Cor/voz: embeds usam tons escuros e dourado discreto apenas como referência visual; textos não dependem de emojis.
- Layout: o painel organiza ações em blocos de administração, estrutura, contratos e finanças.
- Assinaturas: separadores simples, códigos de contrato e tópicos dedicados.
- Interação: cada ação destrutiva ou financeira pede confirmação explícita; operações comuns retornam mensagens efêmeras.
- Animação: nenhuma; Discord deve parecer uma ferramenta de guilda, não uma interface promocional.
- Tipografia: limitada à tipografia nativa do Discord; títulos em caixa alta moderada, corpo em frases diretas.
- Essência: um livro-caixa e quadro de operações para uma companhia mercenária; sóbrio, direto, rastreável.
- Voz: “Registre o contrato. Defina a equipe. Feche a missão.” / “Pagamento lançado. O histórico permanece.”

## Limites desta primeira entrega

A hospedagem será preparada no projeto gerenciado, mas a ativação final depende do token do bot Discord e da criação do aplicativo/servidor pelo usuário. O bot não movimenta dinheiro real: septims são uma moeda fictícia registrada no banco.
