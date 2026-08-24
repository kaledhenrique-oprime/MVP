# CRM compartilhado e finalização pela seleção de perfis

## Objetivo

Adicionar ao painel um CRM compartilhado em formato de planilha, melhorar o aproveitamento visual dos cartões de atividade, permitir finalizar uma sessão diretamente na seleção de perfis e exibir a foto do consultor no histórico.

## Registro de atividades

Os oito cartões manterão as dimensões e a grade atuais. Ícones, títulos, descrições, contadores e botões de incremento/decremento serão ampliados para ocupar melhor a área interna. O cartão de cobranças e o cartão de timers continuarão respeitando o limite da grade, sem criar rolagem horizontal.

## Finalização na seleção de perfis

Um perfil com sessão ativa exibirá duas ações independentes:

- **Continuar expediente:** abre o painel existente.
- **Finalizar expediente:** encerra a sessão sem precisar entrar no perfil.

Antes da finalização, o cliente consulta as métricas da sessão ativa. Quando houver ao menos um registro, o comportamento permanece igual ao fluxo normal: confirmação, encerramento, gravação no histórico e relatório copiável.

Quando todas as métricas estiverem zeradas, será exibido o diálogo **Salvar dados?** com duas opções:

- **Sim:** encerra a sessão, preserva no histórico um relatório com valores zerados e abre o relatório copiável.
- **Não:** encerra a sessão sem manter o expediente no histórico e sem abrir relatório.

O endpoint de encerramento aceitará explicitamente a escolha de persistência. A exclusão da sessão sem dados será atômica e não removerá relatórios anteriores.

## Foto no histórico

A resposta de histórico incluirá a foto atual do consultor. O cartão do expediente usará essa imagem quando disponível e manterá as iniciais como fallback. A foto terá as mesmas regras de corte circular e tamanho dos demais avatares.

## Tela CRM’s

Um item **CRM’s** será adicionado à barra lateral e estará disponível para todos os consultores. A tela será exibida dentro do painel, sem abrir outra aplicação.

### Colunas

1. Concluído
2. Data
3. Consultor
4. Matrícula/ID
5. Nome do cliente
6. Prioridade
7. Assunto
8. Detalhes do CRM
9. Acompanhamento
10. Status

### Interação

- Um botão **Novo registro** abre um formulário com todos os campos editáveis.
- Cada linha terá ação de edição e exclusão.
- O checkbox **Concluído** poderá ser alterado diretamente na linha.
- Prioridade e status serão exibidos como etiquetas coloridas.
- Filtros permitirão selecionar consultor, prioridade e status.
- A tabela terá cabeçalho fixo e rolagem própria em telas estreitas, sem afetar o restante do painel.
- Todos os consultores poderão visualizar, criar, editar, concluir e excluir qualquer registro.

### Valores controlados

Prioridade terá os valores **Sem prioridade**, **Quando possível**, **Importante** e **Urgente**. Status terá **Pendente**, **Acompanhar** e **Feito**. O checkbox concluído e o status Feito permanecerão sincronizados: marcar concluído define Feito; selecionar Feito marca concluído.

## Persistência e API

O banco JSON receberá a coleção `crmRecords`. Registros antigos continuarão válidos porque a leitura do banco preencherá a coleção ausente com uma lista vazia.

Endpoints:

- `GET /api/crm` lista registros.
- `POST /api/crm` cria registro.
- `PATCH /api/crm/:id` edita registro ou conclusão.
- `DELETE /api/crm/:id` exclui após confirmação no cliente.

Campos de texto serão normalizados; data, consultor, nome do cliente e assunto serão obrigatórios. O servidor rejeitará consultores inexistentes, datas inválidas e valores de prioridade/status fora das listas permitidas.

## Tratamento de erros

Falhas de API manterão o formulário aberto e exibirão uma mensagem legível. Exclusões pedirão confirmação. A interface vazia mostrará que ainda não existem registros de CRM. O encerramento direto impedirá cliques duplicados enquanto a requisição estiver em andamento.

## Testes

A suíte cobrirá:

- aumento dos controles sem quebra da grade;
- presença das duas ações em perfis ativos;
- finalização zerada com e sem persistência;
- preservação do fluxo com métricas;
- foto e fallback no histórico;
- criação, edição, conclusão, filtragem e exclusão de CRM;
- validações dos endpoints;
- ausência de regressões em timers, relatórios e reset das métricas.
