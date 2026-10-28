# Situação do projeto

Atualizado para a versão 0.2.0. Itens marcados como concluídos já estão no código; o restante são pendências.

## Concluído

- [x] Base hospedável: processo Node, `/health` sem depender do Discord, encerramento gracioso.
- [x] Persistência no MySQL: configurações por servidor, contratos, equipes, pagamentos e parcelas.
- [x] Painel privado com botões, menus e formulários; cargos autorizados configuráveis.
- [x] Estrutura em cinco categorias (comando, contratos, finanças, operações, configuração), com canal de voz e canal de auditoria.
- [x] Movimentação de canais existentes para as novas categorias e remoção da categoria antiga vazia.
- [x] Ciclo completo do contrato: disponível, aceito, em andamento, concluído, cancelado e arquivado.
- [x] Avanço e cancelamento pelo botão Detalhes / atualizar do cartão, e cancelamento direto nele.
- [x] `/contrato` com autocomplete e `/meus-contratos` para membros.
- [x] Barra de progresso e situação colorida nos cartões.
- [x] Registro de auditoria das ações administrativas.
- [x] Notificação por mensagem privada ao aprovado na equipe e a cada participante no pagamento.
- [x] Pagamentos com centavos inteiros e arredondamento determinístico.
- [x] Remoção da ação de apagar todos os canais do servidor.

## Pendências

- [ ] Decidir a regra financeira: manter a reserva de 10% ou dividir o total entre os participantes, como descrito no plano original.
- [ ] Permitir alterar o percentual do caixa pelo painel, se a reserva for mantida.
- [ ] Decidir se o caixa da guilda deve ser visível a todos os membros.
- [ ] Reconciliação automática de contrato criado no banco com tópico ou anúncio faltando.
- [ ] Testes automatizados para a divisão de pagamentos e as transições de estado.
- [ ] Validação em banco MySQL real e em servidor de teste do Discord com permissões reais.
- [ ] Imagem do painel hospedada em local próprio (hoje aponta para um CDN externo).
