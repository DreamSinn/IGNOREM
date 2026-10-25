# Entregas

## Base hospedável e persistência

- O projeto deve iniciar um processo Node persistente que responda em `/health` sem exigir login do Discord para o health check.
- O banco deve manter configurações por servidor, contratos, participantes, pagamentos e parcelas individuais após reinicializações.
- O token do Discord e o DSN não podem ser gravados no código ou em arquivos `.env` versionados.

## Painel administrativo dentro do Discord

- `/painel` deve abrir ou atualizar uma mensagem de painel na sala privada de configuração.
- O painel deve usar botões, menus e modais para configurar cargos autorizados, criar/atualizar a estrutura, abrir contratos e consultar finanças.
- O proprietário/Administrator deve conseguir inicializar o painel antes de os cargos gerenciais serem definidos.
- Após a configuração, somente administradores e gerentes autorizados podem executar ações administrativas e financeiras.

## Estrutura temática da guilda

- O bot deve criar categorias de comando, contratos, finanças, operações e configuração.
- O bot deve criar salas de texto, salas de voz e a sala privada do painel sem duplicar canais já existentes com os mesmos nomes.
- A estrutura deve usar nomes discretos e textos naturais, sem flood de emojis.
- Cada contrato criado deve receber um tópico próprio no canal de contratos em andamento.

## Contratos e histórico

- O painel deve permitir criar contrato com título, contratante, valor em septims, descrição e local.
- Contratos devem ser consultáveis por disponível, aceito, em andamento, concluído, cancelado e arquivado.
- Gerentes/administradores devem conseguir adicionar participantes por seleção de usuários e alterar o estado do contrato.
- O bot deve mostrar contrato, tópico, participantes, valor e situação do pagamento.

## Pagamentos em septims

- Apenas gerente/administrador pode registrar o pagamento de um contrato concluído.
- O pagamento deve usar o valor total do contrato por padrão e dividir em partes iguais entre os participantes.
- O histórico deve registrar total pago, quantidade de participantes, valor individual e quem lançou o pagamento.
- O bot deve impedir um segundo pagamento para o mesmo contrato e preservar o ajuste de centavos necessário para fechar o total.
