# Revisão tripla do projeto

**Data:** 25/10/2026  
**Escopo:** fluxo Discord, persistência/MySQL, segurança, finanças, consistência entre código e documentação, e inicialização do serviço.

## Resultado geral

Foram feitas três revisões independentes e uma consolidação. O projeto tinha falhas funcionais importantes; portanto, a versão anterior não deveria ser considerada totalmente validada. As correções descritas abaixo foram aplicadas no código desta versão.

## Correções aplicadas

- O schema agora cria `contract_applicants`, `guild_finance` e `guild_ledger`, que eram consultadas pelo código mas estavam ausentes. Os dois arquivos SQL foram sincronizados. A inicialização continua adicionando as colunas de mensagem aos bancos existentes e também garante índices necessários.
- Participantes e pagamentos agora bloqueiam a mesma linha do contrato em transações, evitando que uma inclusão concorrente apareça depois do pagamento sem receber parcela. A aprovação do candidato e sua entrada na equipe passaram a ser atômicas; inscrições e mudanças de estado também revalidam o status sob lock.
- Os cálculos financeiros usam centavos inteiros. A geração do código temporário de contrato deixou de usar um valor fixo, prevenindo colisões quando há criações simultâneas.
- O cartão público e o cartão do tópico são atualizados em vez de republicados. O cartão passa ao canal do novo estado e o anterior é removido; cartões duplicados recentes são reconciliados. Os upserts do painel e do caixa usam marcadores compatíveis com os próprios embeds para editar mensagens existentes.
- Canais de arquivo e caixa negam explicitamente envio a membros comuns; o cargo `@everyone` é rejeitado como cargo autorizado, inclusive em configurações antigas. Ao atualizar os cargos, as permissões operacionais também são sincronizadas.
- As interações demoradas relevantes agora são deferidas, as opções de estado exibidas respeitam as transições válidas e respostas extensas são limitadas/paginadas para caber nos limites do Discord.
- O endpoint `/health` começa a responder antes da inicialização do banco e do Discord. O TLS do MySQL valida certificados por padrão; `DATABASE_CA_PATH` permite informar uma CA privada.
- O README foi ajustado para não descrever canais de voz/categorias que esta implementação ainda não cria e para explicitar a regra financeira atual.

## Pendências que exigem decisão ou trabalho adicional

1. **Regra financeira divergente:** o código reserva por padrão 10% do pagamento para o caixa e divide o restante entre os participantes. O plano e o TODO descrevem dividir o valor total entre os participantes. Não alterei esse comportamento sem confirmação, pois é uma regra de negócio; além disso, não há controle no painel para configurar o percentual. É necessário decidir se a reserva de 10% deve existir.
2. **Estrutura da guilda incompleta em relação ao plano/TODO:** a implementação ainda provisiona uma categoria e canais de texto, não as categorias separadas de comandos, contratos, finanças, operações e configuração nem salas de voz. O README agora informa essa limitação; o plano e o TODO continuam descrevendo a estrutura pretendida.
3. **Recuperação de criação parcialmente concluída:** se o registro no banco for criado e uma etapa posterior no Discord falhar, o bot informa o código já salvo e pede para não recriar o contrato. Ainda não há um reconciliador automático para reparar tópico/anúncio órfão.
4. **Recuperação de mensagens antigas:** a busca de cartões anteriores examina as últimas 100 mensagens nos canais de contratos e arquivo. Cópias mais antigas que esse limite podem exigir limpeza manual.
5. **Validação de produção pendente:** não foram fornecidos token Discord nem DSN do banco; por isso, não foi possível executar a migração em MySQL real, simular permissões da guilda ou testar interações contra o Discord.

## Verificações executadas

- `pnpm typecheck`: passou após as alterações.
- Verificação automatizada: o SQL contém todas as oito tabelas requeridas pelo código e se divide corretamente em oito instruções `CREATE TABLE`.
- Teste local de `/health` sem `DATABASE_URL` nem token Discord: o processo abriu o endpoint e respondeu JSON com estado `database: false`, HTTP 503. Isso confirma que a rota responde antes das dependências; não substitui teste com banco pronto nem prova o comportamento do Discord.
- O arquivo SQL espelhado na raiz deve permanecer idêntico a `sql/001_init.sql`.
