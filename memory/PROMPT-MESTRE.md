<!-- RECUPERADO DE: sessao OpenCode ses_eb866a2bbffeXV0ExchetkHH1a, mensagem seq=600, criada em 2026-10-16/17 (epoch ms 1792203256286). -->
<!-- Copia fiel do PROMPT MESTRE original enviado pelo usuario. Documento de referencia para a auditoria de aderencia (2026-10-17). -->
# PROMPT MESTRE — PLATAFORMA UNIFICADA DE GESTÃO DE FACILITIES

## 1. Seu papel e sua missão

Atue como arquiteto de software sênior, analista de negócios, especialista em gestão de Facilities, designer de UX/UI, engenheiro de dados, especialista em segurança e desenvolvedor full-stack.

Sua missão é analisar o projeto que está aberto no ambiente de desenvolvimento, transformar os requisitos deste documento em um planejamento técnico e funcional completo e, **na sequência, executar o próprio planejamento até entregar o máximo possível de um sistema funcional, integrado, seguro e testado**.

O sistema será utilizado por um gerente de Facilities e por sua equipe, incluindo colaboradores responsáveis por recepção, limpeza, manutenção, estoque e compras.

O objetivo é substituir planilhas dispersas e processos manuais por uma plataforma centralizada que permita controlar operações, materiais, consumo, solicitações, compras, entregas, manutenções, colaboradores e históricos, com rastreabilidade de todas as ações relevantes.

Não interprete esta solicitação como um pedido para apenas elaborar uma proposta, desenhar telas ou produzir documentação. O planejamento será uma etapa obrigatória, mas a implementação também faz parte da missão.

**Regra central: analise, planeje, registre as decisões, execute, teste, corrija e valide. Não pare depois de entregar o planejamento e não solicite autorização a cada etapa do trabalho.**

---

## 2. Princípios obrigatórios de execução

1. Antes de implementar, investigue o projeto atual. Identifique a tecnologia utilizada, a arquitetura, as funcionalidades existentes, o banco de dados, a autenticação, as permissões, os testes, os componentes visuais, as integrações e o estado real da aplicação.
2. Se o projeto já tiver funcionalidades relacionadas a Facilities, estoque, ordens de serviço ou compras, evolua a estrutura existente. Não crie um segundo sistema independente nem duplique recursos sem necessidade.
3. Preserve as funcionalidades que já funcionam, os dados existentes, as configurações, as integrações, a identidade visual aproveitável e as decisões arquiteturais válidas.
4. Não substitua uma tecnologia, framework, banco de dados, autenticação ou arquitetura funcional apenas por preferência pessoal. Justifique e registre qualquer mudança realmente necessária.
5. Não invente funcionalidades já implementadas, resultados de testes, arquivos, integrações ou dados. Toda afirmação sobre o estado do projeto deve ter sido verificada.
6. Prefira uma arquitetura organizada, segura, modular e simples de manter. Não adicione dependências, bibliotecas, servidores, MCPs ou serviços externos sem necessidade comprovada.
7. Desenvolva funcionalidades reais, integradas ao banco de dados e às regras de negócio. Não use botões sem ação, dados fictícios como se fossem reais, telas meramente demonstrativas ou operações que só funcionam visualmente.
8. Faça escolhas técnicas de forma autônoma quando existirem alternativas razoáveis. Registre a justificativa e siga com a solução de menor risco e melhor compatibilidade com o projeto.
9. Não interrompa a execução para pedir aprovação de decisões comuns, etapas intermediárias ou escolhas que possam ser resolvidas com segurança.
10. Interrompa somente quando houver um impedimento real, como credenciais ausentes, serviço externo inacessível, decisão irreversível de negócio, risco relevante de perda de dados ou necessidade de autorização humana para uma operação sensível. Nesse caso, conclua todas as outras partes independentes e documente precisamente o bloqueio.
11. Se o escopo for grande demais para concluir de uma vez, priorize módulos completos e funcionais, mantenha um backlog explícito e continue até o limite seguro do ambiente. Não declare o sistema completo enquanto houver funcionalidades obrigatórias não entregues.

## 3. Etapa inicial obrigatória: diagnóstico e planejamento

### 3.1. Faça uma auditoria do projeto

Antes de alterar o código, verifique:

- Estrutura de diretórios e arquivos.
- Tecnologias, versões e dependências.
- Organização do frontend e backend.
- Banco de dados, tabelas, relacionamentos, migrações e políticas de acesso.
- Autenticação, gerenciamento de usuários e autorização.
- Funcionalidades já implementadas e seu grau real de conclusão.
- Padrões visuais e componentes reutilizáveis.
- Testes existentes, erros conhecidos, pendências e riscos.
- Configuração de desenvolvimento, build, publicação e variáveis de ambiente.
- Documentação e arquivos de continuidade do projeto.

Se houver um ambiente de memória operacional Cérebro/OpenCode no projeto, leia as instruções globais e locais pertinentes antes de tomar decisões. Respeite a hierarquia dos arquivos, as regras de preservação, os registros de decisões e os procedimentos de continuidade existentes.

Não exponha segredos encontrados durante a auditoria.

### 3.2. Produza um planejamento executável

Crie ou atualize a documentação de planejamento nos locais adequados ao projeto. No mínimo, registre:

- Diagnóstico do estado atual.
- Objetivo e limites do produto.
- Requisitos funcionais e não funcionais.
- Arquitetura proposta e justificativas.
- Modelo de dados e relacionamentos.
- Matriz de usuários, permissões e escopos de acesso.
- Fluxos operacionais.
- Integrações entre módulos.
- Plano de implementação por fases e dependências.
- Estratégia de testes e critérios de aceitação.
- Riscos, limitações e dependências externas.
- Critérios para determinar se cada etapa foi concluída.

O planejamento deve distinguir o que já existe, o que será reutilizado, o que precisa ser modificado e o que será desenvolvido do zero.

### 3.3. Execute o planejamento logo após elaborá-lo

Depois de registrar o planejamento, inicie a implementação sem esperar uma nova mensagem do usuário.

Organize o desenvolvimento na ordem lógica das dependências. Atualize o planejamento à medida que descobrir fatos novos, registrando alterações relevantes e suas justificativas.

Não sacrifique a segurança ou a integridade dos dados para cumprir uma etapa mais rapidamente.

---

## 4. Visão geral do produto

Desenvolva uma plataforma integrada de gestão de Facilities, com interface em português brasileiro, navegação intuitiva, boa experiência em computador e celular e telas adequadas tanto ao gerente quanto aos colaboradores operacionais.

A plataforma deve ter, conforme a análise de arquitetura e a estrutura existente:

1. Painel principal.
2. Estoque e catálogo de materiais.
3. Movimentações e rastreabilidade.
4. Consumo operacional por setor, ambiente e período.
5. Inventário periódico.
6. Tickets e chamados.
7. Ordens de serviço e manutenções.
8. Solicitações de compra, pedidos e recebimentos.
9. Colaboradores, usuários e permissões.
10. Estrutura organizacional e locais físicos.
11. Configurações e cadastros auxiliares.
12. Relatórios e indicadores.
13. Histórico e auditoria de atividades.

Os módulos não devem funcionar como sistemas isolados. Devem compartilhar dados, respeitar as mesmas permissões e manter os vínculos necessários para possibilitar rastreamento ponta a ponta.

Exemplo: um material solicitado para uma manutenção deve poder ser rastreado desde sua entrada no estoque até sua utilização na ordem de serviço, identificando a origem, a quantidade, a data, o responsável e a finalidade.

---

## 5. Estrutura da empresa e dos ambientes

Crie um módulo configurável para cadastrar a estrutura física e organizacional da companhia.

A estrutura deve comportar, conforme a realidade da empresa:

- Unidades ou filiais.
- Prédios.
- Andares.
- Setores.
- Salas.
- Salas de reunião.
- Recepção.
- Copas.
- Banheiros.
- Almoxarifados.
- Áreas técnicas.
- Outros ambientes personalizados.

Permita estabelecer relações hierárquicas entre os locais, de modo que seja possível identificar, por exemplo:

Unidade → Prédio → Andar → Setor → Ambiente.

A hierarquia não deve ser rígida demais: os tipos de local precisam ser configuráveis de acordo com o projeto.

Cada local poderá ter identificação, nome, código, tipo, estado ativo/inativo e informações adicionais pertinentes.

A plataforma deverá permitir pesquisar e filtrar os registros por unidade, setor, andar e ambiente.

Esses cadastros serão usados pelo estoque, consumo, manutenção, limpeza, compras e relatórios.

**Regra importante:** um produto pode ter origem em um almoxarifado e destino em uma sala de reunião, copa ou banheiro. O sistema deve preservar essa relação sem depender de texto digitado livremente sempre que existir um local cadastrado.

---

## 6. Usuários, colaboradores, perfis e permissões

Crie um módulo de gerenciamento de usuários e equipe.

Deverá ser possível cadastrar, convidar ou administrar usuários de acordo com o mecanismo de autenticação existente, bem como manter informações dos colaboradores relacionadas à operação.

Considere inicialmente os seguintes perfis, adaptáveis à realidade encontrada:

- Administrador do sistema.
- Gerente de Facilities.
- Comprador.
- Responsável pelo estoque.
- Líder de limpeza.
- Colaborador da limpeza.
- Recepcionista.
- Técnico de manutenção.
- Solicitante de serviços.

Não conceda todas as permissões automaticamente a esses perfis. Construa uma matriz de autorização configurável, partindo do princípio do menor privilégio.

O sistema deve controlar permissões por módulo e ação, incluindo, quando aplicável:

- Visualizar.
- Criar.
- Editar.
- Aprovar.
- Executar.
- Registrar consumo.
- Ajustar estoque.
- Realizar inventário.
- Exportar relatórios.
- Gerenciar usuários.
- Configurar cadastros.
- Alterar permissões.
- Consultar históricos.
- Cancelar registros.

Quando necessário, restrinja também o acesso por unidade, setor ou ambiente.

Exemplo: uma recepcionista pode registrar a reposição de água em salas de reunião, mas não pode editar o saldo do almoxarifado por meio de um ajuste administrativo, alterar permissões ou excluir o histórico de movimentações.

Um líder de limpeza pode registrar o consumo semanal dos materiais sob sua responsabilidade, sem necessariamente poder alterar as regras globais do estoque.

O gerente deve possuir as permissões gerenciais pertinentes e poder configurar acessos dentro dos limites administrativos definidos.

A interface deve ocultar ou desabilitar ações não permitidas, mas **a autorização verdadeira deve ser aplicada no backend e no banco de dados, conforme a arquitetura existente**. Ocultar um botão não constitui segurança suficiente.

As permissões administrativas devem impedir que um usuário conceda a si próprio privilégios que não tem autorização para administrar.

O sistema deve permitir ativar, desativar e administrar acessos sem apagar o histórico do colaborador.

---

## 7. Módulo de estoque

Implemente um módulo de estoque completo, integrado ao restante da plataforma.

### 7.1. Cadastro de produtos e materiais

Permita cadastrar e manter:

- Nome do item.
- Código interno ou SKU, quando aplicável.
- Descrição.
- Categoria.
- Subcategoria, se necessária.
- Unidade de medida.
- Embalagem comercial.
- Fator de conversão entre embalagem e unidade de consumo, quando aplicável.
- Quantidade atual por local de estoque.
- Quantidade mínima.
- Local de armazenamento.
- Fornecedor habitual, quando pertinente.
- Estado ativo/inativo.
- Observações.
- Informações adicionais úteis ao controle operacional.

Considere categorias como:

- Limpeza.
- Higiene e descartáveis.
- Alimentos e bebidas.
- Ferramentas.
- Materiais elétricos.
- Materiais hidráulicos.
- Peças e componentes.
- Material de escritório.
- Outros.

As categorias deverão ser configuráveis. Não limite a plataforma aos exemplos fornecidos.

Produtos comprados em caixas, pacotes, fardos, galões ou unidades precisam ser representados de forma coerente. Quando houver conversão entre embalagens e unidades individuais, ela deverá ser explícita, validada e usada nos cálculos.

### 7.2. Entradas, saídas e transferências

Cada movimentação deverá registrar automaticamente, no mínimo:

- Identificador único.
- Data e hora de registro.
- Usuário autenticado responsável.
- Tipo de movimentação.
- Item movimentado.
- Quantidade.
- Unidade de medida.
- Origem, quando aplicável.
- Destino, quando aplicável.
- Motivo ou finalidade.
- Referência à solicitação, compra, inventário, ticket ou ordem de serviço relacionada, quando existir.
- Informações complementares ou anexos, quando pertinentes.

Considere movimentos como:

- Entrada de compra recebida.
- Saída de material.
- Transferência entre locais.
- Reposição de ambiente.
- Consumo operacional.
- Consumo vinculado à manutenção.
- Devolução.
- Perda ou descarte.
- Ajuste de inventário.

Cada movimentação confirmada precisa atualizar o estoque de maneira consistente e auditável.

Implemente as operações críticas de forma transacional para evitar que o histórico seja salvo sem atualizar o saldo, ou que o saldo seja alterado sem o registro correspondente.

Evite duplicidade de movimentos em caso de repetição de requisições ou tentativas de envio.

Não permita estoque negativo por padrão. Exceções só poderão existir se houver uma regra administrativa explícita, autorização adequada e registro da justificativa.

### 7.3. Registro rápido de saída

A saída de materiais deve ser rápida e simples.

Fluxo esperado:

1. O usuário acessa a opção de movimentação.
2. Seleciona o item.
3. Informa a quantidade.
4. Escolhe a finalidade, o destino ou o responsável pertinente.
5. Confirma a operação.
6. O sistema registra a movimentação, atualiza o saldo e identifica automaticamente o usuário e o horário.

Não obrigue o colaborador a preencher informações desnecessárias. Campos condicionais devem aparecer somente quando relevantes ao tipo de movimento.

A aplicação deve preservar a identidade do usuário autenticado, sem oferecer um campo editável que permita assinar em nome de outra pessoa.

### 7.4. Reposição de água nas salas de reunião

Implemente um fluxo operacional específico para exemplificar a simplicidade desejada.

A recepcionista entra no sistema, seleciona o item água, informa a quantidade e escolhe o ambiente de destino, como:

- Sala de reunião 1.
- Sala de reunião 2.
- Recepção.
- Outros ambientes previamente cadastrados.

Ao confirmar, o registro recebe data e hora automáticas e identificação do usuário responsável.

O sistema deve distinguir a retirada do almoxarifado, a transferência para um ambiente e o consumo efetivo quando essa distinção fizer parte do controle adotado.

Não registre automaticamente que a água foi consumida apenas porque foi levada para uma sala. O destino do material e o consumo efetivo são informações diferentes.

O desenho do controle por local deverá permitir visualizar quanto material foi enviado a cada ambiente e, quando houver dados suficientes, comparar a reposição por período.

### 7.5. Consumo de limpeza e higiene

Inclua um fluxo simplificado para registrar o consumo periódico de:

- Detergente.
- Desinfetante.
- Papel toalha.
- Papel higiênico.
- Sacos de lixo.
- Outros produtos e descartáveis cadastrados.

A operação pode ser semanal, por equipe, período, setor ou ambiente, conforme a configuração.

O responsável seleciona o período, os itens utilizados, as quantidades e os locais de referência. O sistema registra automaticamente o momento do lançamento e o usuário responsável.

Não exija o registro individual de cada saco de lixo ou folha de papel. O objetivo é medir o consumo operacional em uma periodicidade útil, não criar trabalho administrativo desnecessário.

Diferencie as baixas efetivas de estoque dos registros de medição de consumo, para evitar que o mesmo material seja descontado duas vezes.

Se houver necessidade de consolidar vários locais em um único lançamento, implemente esse recurso sem perder a possibilidade de rastrear a distribuição quando ela for informada.

### 7.6. Consumo de alimentos e materiais das copas

Implemente o controle de itens como:

- Café.
- Chá.
- Açúcar.
- Adoçantes.
- Copos.
- Colheres descartáveis.
- Palitos.
- Guardanapos.
- Outros itens cadastrados.

O controle deve considerar embalagens comerciais e unidades de consumo.

Exemplo: um pacote de colheres descartáveis foi destinado à copa do segundo andar. O registro deve permitir identificar o produto, a quantidade, o local de destino, quem realizou o lançamento e quando isso aconteceu.

O responsável poderá realizar a contagem semanal dos itens utilizados. O sistema deverá permitir o lançamento de vários produtos em uma mesma sessão, diminuindo o número de cliques e facilitando a rotina.

Deve ser possível identificar o consumo por período, copa, setor e item, de acordo com os dados disponíveis.

### 7.7. Quantidade mínima e alertas

Cada produto deve aceitar uma quantidade mínima configurável.

O painel principal e a área de estoque deverão identificar itens cujo saldo esteja abaixo do limite estabelecido.

Os alertas devem apresentar, no mínimo:

- Produto.
- Saldo atual.
- Quantidade mínima.
- Diferença para o mínimo.
- Local de estoque.
- Atalho para visualizar o item e suas movimentações.

Diferencie estoque baixo, estoque zerado e outras situações relevantes.

Considere os saldos por local quando a regra do produto assim exigir. A tela não deverá ocultar a falta em um almoxarifado apenas porque existe saldo em outro local sem transferência disponível.

Não crie notificações falsas nem indique que houve reposição sem movimentação confirmada.

---

## 8. Módulo de inventário periódico

Crie uma área própria para inventários, com foco no fechamento mensal do estoque.

### 8.1. Abertura de inventário

Deve ser possível criar um ciclo de inventário para um período e local definidos.

A sessão deverá apresentar os itens que precisam ser conferidos, com identificação e status individual.

Separe claramente:

- Itens pendentes de inventário.
- Itens já inventariados.
- Itens com divergência.
- Itens que precisam de revisão, quando aplicável.

Itens novos ou inativos devem ser tratados de acordo com regras explícitas, para não desaparecerem silenciosamente de um ciclo aberto.

### 8.2. Contagem e conferência

Para cada produto, exiba a quantidade registrada no sistema e disponibilize um campo para informar a quantidade física encontrada.

O responsável poderá:

- Confirmar que a quantidade física está correta.
- Informar uma quantidade diferente.
- Registrar uma observação.
- Informar uma justificativa para a divergência, quando necessário.

Ao salvar a conferência individual, o sistema deverá alterar seu estado para inventariado, desde que a validação seja bem-sucedida.

O processo deve preservar os registros anteriores. Uma nova contagem ou correção não deverá apagar silenciosamente a contagem original.

### 8.3. Ajustes de inventário

Quando houver divergência, calcule a diferença entre o saldo registrado e a contagem física.

O ajuste efetivo deverá gerar um movimento próprio de ajuste de inventário, identificando o inventário de origem, o produto, a diferença, o usuário, o horário e a justificativa.

Confirme que o usuário possui a permissão necessária para efetuar o ajuste.

Não altere diretamente um saldo sem gerar o registro correspondente no histórico de movimentações.

### 8.4. Relatório de fechamento

Ao final do inventário, gere um relatório contendo:

- Identificação e período do inventário.
- Responsáveis.
- Itens conferidos e pendentes.
- Quantidade registrada no sistema.
- Quantidade física.
- Diferença por item.
- Itens com excesso.
- Itens com falta.
- Itens abaixo da quantidade mínima.
- Ajustes realizados.
- Justificativas.
- Data e hora do fechamento.

Não permita um fechamento aparentemente completo enquanto houver itens obrigatórios pendentes, salvo se existir um procedimento autorizado e explicitamente documentado para exceções.

Depois do fechamento, preserve a evidência do resultado. Uma eventual reabertura deve ser excepcional, autorizada e auditada.

Disponibilize consulta histórica dos inventários anteriores.

---

## 9. Tickets, chamados e ordens de serviço

Implemente um fluxo integrado de atendimento e manutenção.

### 9.1. Abertura de ticket

Um colaborador deve conseguir abrir um ticket informando:

- Título.
- Descrição do problema ou solicitação.
- Categoria.
- Local ou ambiente.
- Prioridade.
- Solicitante identificado automaticamente.
- Data e hora automáticas.
- Fotografias ou anexos, quando disponíveis.
- Informações complementares pertinentes.

O processo deve ser simples, inclusive para usuários com pouca familiaridade com sistemas administrativos.

As categorias de atendimento precisam ser configuráveis.

Considere limpeza, hidráulica, elétrica, estrutura predial, mobiliário, equipamentos e outras categorias úteis.

### 9.2. Resolução direta ou conversão em ordem de serviço

O ticket deverá seguir um de dois caminhos:

**Caminho A — Resolução imediata:** o responsável executa a ação diretamente, registra o que foi feito e resolve o ticket.

**Caminho B — Conversão:** quando o atendimento exigir execução posterior, o ticket é convertido em ordem de serviço.

A conversão precisa preservar o vínculo com o ticket original. Não crie um registro sem ligação com o pedido que lhe deu origem.

O sistema deve evitar criar ordens duplicadas quando a mesma ação for enviada mais de uma vez.

### 9.3. Gestão da ordem de serviço

A ordem de serviço deverá contemplar:

- Identificador.
- Ticket de origem, se houver.
- Categoria e descrição.
- Local de execução.
- Responsável ou equipe.
- Prioridade.
- Status.
- Datas de abertura, planejamento, execução e encerramento, conforme aplicável.
- Registro das atividades executadas.
- Fotografias anteriores e posteriores, quando pertinentes.
- Comentários.
- Materiais utilizados.
- Observações e resultado final.

Implemente estados coerentes, como aberta, planejada, em andamento, aguardando material, concluída e cancelada, conforme as regras definidas no planejamento.

Não presuma que toda ordem precisa de material.

### 9.4. Consumo de material em tickets e ordens de serviço

Tanto um ticket resolvido imediatamente quanto uma ordem de serviço devem permitir registrar materiais utilizados, quando houver.

Exemplo: durante um reparo hidráulico, o técnico utilizou uma conexão de PVC, uma borracha ou uma tampa de ralo.

O técnico seleciona os itens, informa as quantidades e confirma o lançamento.

O sistema registra automaticamente o usuário responsável, o horário, a ordem ou ticket relacionado e as movimentações de estoque correspondentes.

A ausência de material deve ser permitida e não pode impedir a conclusão de um atendimento que não exigiu insumos.

Quando o estoque estiver insuficiente, aplique a validação correspondente e apresente uma explicação clara.

### 9.5. Histórico e acompanhamento

Permita visualizar o histórico completo do chamado, incluindo mudanças de status, responsáveis, comentários, anexos, consumo de materiais e encerramento.

Deve ser possível filtrar chamados e ordens por período, status, categoria, prioridade, ambiente e responsável, de acordo com as permissões.

---

## 10. Módulo centralizado de compras

Desenvolva um fluxo completo para controlar solicitações, compras e recebimentos, reduzindo o trabalho de conferir planilhas e rastrear entregas manualmente.

### 10.1. Solicitações de compra

Permita registrar solicitações contendo:

- Número identificador.
- Solicitante.
- Data e hora.
- Setor ou ambiente de destino.
- Justificativa.
- Itens e quantidades solicitados.
- Unidade de medida.
- Prioridade.
- Data desejada, se aplicável.
- Anexos e observações.

Quando existir um estoque cadastrado, a solicitação poderá exibir o saldo e a quantidade mínima para ajudar na decisão de compra.

O sistema não deve converter automaticamente toda solicitação em compra sem considerar o fluxo de autorização configurado.

### 10.2. Processo de compra

Estruture o ciclo de vida da solicitação e dos respectivos itens, contemplando os estados necessários, como:

- Rascunho.
- Pendente de aprovação.
- Aprovada.
- Em cotação, quando utilizada.
- Em compra.
- Pedido realizado.
- Parcialmente recebido.
- Recebido integralmente.
- Cancelado.

A nomenclatura final poderá ser ajustada para representar claramente o processo operacional. Não crie uma quantidade excessiva de status sem utilidade prática.

Mantenha registro do fornecedor, pedido, número de referência, datas, quantidades e outras informações realmente necessárias.

Se uma solicitação tiver diversos itens, cada item deverá ter seu próprio acompanhamento de compra e recebimento. A entrega de um produto não pode marcar os demais como entregues automaticamente.

### 10.3. Controle de entrega e recebimento

O objetivo é permitir que o comprador acompanhe visualmente o que foi solicitado, comprado, entregue e efetivamente recebido.

Implemente uma tela operacional com filtros, indicadores e ações rápidas.

Cada item deverá informar:

- Quantidade solicitada.
- Quantidade aprovada ou comprada, conforme o fluxo adotado.
- Quantidade recebida.
- Quantidade pendente.
- Fornecedor.
- Status de entrega.
- Data e hora de cada recebimento.
- Responsável pelo recebimento.
- Observações e evidências de divergência.

Permita recebimento parcial.

Exemplo: foram compradas 10 unidades, mas chegaram somente 7. O usuário registra 7 como recebidas, mantendo 3 pendentes. Quando o restante chegar, ele registra o recebimento complementar.

Permita registrar divergências de quantidade, item incorreto, avarias e outros problemas.

Quando fizer sentido, aceite anexar comprovantes, fotografias, notas ou documentos de recebimento.

Não considere um item recebido apenas porque foi marcado como comprado ou pedido realizado.

### 10.4. Integração entre compras e estoque

O recebimento aceito deverá permitir gerar a respectiva entrada de estoque, respeitando as regras de autorização.

O vínculo entre recebimento e entrada deverá impedir que o mesmo recebimento crie múltiplas entradas indevidas por causa de cliques repetidos ou reprocessamentos.

O estoque só deve ser acrescido das quantidades efetivamente recebidas e aceitas, segundo o procedimento configurado.

Mantenha rastreabilidade da solicitação original até o estoque, incluindo o item, a quantidade e o responsável pelo recebimento.

Pedidos parcialmente recebidos devem continuar visíveis até que sejam completados ou encerrados de forma autorizada.

### 10.5. Painel de compras

Crie uma visão centralizada contendo:

- Solicitações pendentes.
- Compras aguardando aprovação.
- Pedidos realizados.
- Entregas pendentes.
- Entregas parciais.
- Entregas concluídas.
- Itens em atraso, quando houver prazo definido.
- Divergências de recebimento.
- Compras canceladas.
- Histórico de compras.

Deve ser possível descobrir rapidamente o que precisa ser comprado, o que já foi comprado, o que chegou e o que ainda está faltando.

Não assuma que existe uma integração eletrônica com fornecedores ou transportadoras. Na ausência de integração disponível e validada, desenvolva um controle interno funcional, permitindo que os colaboradores registrem os acontecimentos reais.

---

## 11. Assinatura eletrônica operacional e auditoria

Todas as ações relevantes devem ser rastreáveis.

Ao confirmar uma movimentação, o sistema deve associá-la automaticamente à identidade autenticada do responsável.

Cada registro relevante deverá preservar, conforme aplicável:

- Identificador do evento.
- Usuário responsável e seu identificador interno.
- Data e hora confiáveis do registro.
- Ação executada.
- Tipo e identificador do registro afetado.
- Valores anteriores e posteriores em alterações relevantes.
- Resultado da operação.
- Justificativa, quando exigida.
- Origem operacional da ação.
- Referências aos objetos relacionados.

Utilize o nome do colaborador para leitura humana, mas preserve também sua identificação interna para manter a rastreabilidade ao longo do tempo.

A data e a hora de registro deverão ser geradas de forma confiável pelo backend ou pelo mecanismo equivalente da arquitetura. Não confie exclusivamente no relógio ou nos dados enviados pelo navegador.

Armazene e exiba datas de modo consistente, utilizando o fuso horário `America/Sao_Paulo` na experiência do usuário, com uma estratégia de armazenamento compatível com o banco de dados.

**Definição importante:** neste projeto, “assinatura eletrônica” significa atribuição autenticada da ação ao usuário, com registro auditável de identidade e horário. Não apresente isso como assinatura digital qualificada, certificação ICP-Brasil ou garantia jurídica específica sem uma solução formal apropriada e validada.

A auditoria deve contemplar entradas, saídas, transferências, ajustes, inventários, compras, recebimentos, atendimentos, ordens de serviço, alterações de permissões e configurações sensíveis.

Não permita que usuários comuns apaguem o histórico de auditoria.

Movimentações confirmadas não devem ser sobrescritas ou excluídas silenciosamente. Correções devem seguir um processo controlado, com reversão ou lançamento corretivo, justificativa e referência ao evento original.

Cadastros inativos podem deixar de aparecer nas opções de novas operações, mas suas referências históricas devem continuar preservadas.

Crie telas para consultar e filtrar os registros conforme as permissões de cada usuário.

---

## 12. Painel principal e notificações

Desenvolva um painel útil para a operação diária, e não apenas uma tela de boas-vindas.

Para o gerente de Facilities, considere indicadores como:

- Itens com estoque baixo.
- Itens sem saldo.
- Inventário mensal pendente.
- Tickets em aberto.
- Ordens de serviço em andamento.
- Manutenções aguardando material.
- Compras aguardando aprovação.
- Entregas pendentes ou parciais.
- Consumo por período.
- Divergências de inventário.
- Atividades recentes relevantes.

Para os demais perfis, apresente somente os indicadores e as ações pertinentes às suas funções e permissões.

Os indicadores deverão utilizar dados reais do banco, com filtros e períodos bem definidos.

Implemente alertas internos coerentes com os eventos e regras de negócio. Não adicione serviços externos de mensagens sem justificativa e autorização.

Os alertas devem levar o usuário ao registro que precisa de atenção.

---

## 13. Relatórios e consultas

Crie uma área centralizada de relatórios, com filtros por período, produto, categoria, local, setor, responsável, status e outros critérios pertinentes.

Inclua, no mínimo:

**Relatórios de estoque:** saldos atuais, entradas, saídas, transferências, ajustes, movimentações por item, estoque baixo e histórico de produtos.

**Relatórios de consumo:** consumo semanal e mensal por produto, categoria, setor, copa, banheiro, sala de reunião e demais ambientes cadastrados, respeitando o nível de detalhe dos dados coletados.

**Relatórios de inventário:** quantidade de itens conferidos, divergências, excessos, faltas, ajustes e evolução entre períodos.

**Relatórios de manutenção:** tickets abertos e resolvidos, ordens de serviço por status, categoria, local, responsável e período, além dos materiais consumidos em cada atendimento.

**Relatórios de compras:** solicitações, pedidos, itens comprados, entregas totais e parciais, quantidades pendentes, divergências, fornecedores e prazos quando disponíveis.

**Relatórios de auditoria:** ações por usuário, período, módulo e tipo de operação, conforme as permissões.

Quando adequado, permita exportar os dados para formatos úteis, como CSV e PDF, respeitando permissões e filtros aplicados.

Os relatórios devem refletir os registros persistidos, sem fabricar números ou misturar unidades de medida incompatíveis.

Os totais precisam ser verificáveis e coerentes com os movimentos registrados.

---

## 14. Configurações gerais

Crie uma área administrativa organizada para gerenciar as configurações necessárias ao funcionamento do sistema.

Ela deverá contemplar, conforme o escopo validado no planejamento:

- Categorias e subcategorias de produtos.
- Unidades de medida e embalagens.
- Categorias de tickets e serviços.
- Tipos de ordem de serviço.
- Status e prioridades.
- Setores e estrutura física da empresa.
- Tipos de ambiente.
- Usuários e equipes.
- Perfis e permissões.
- Regras de estoque mínimo.
- Periodicidade dos lançamentos de consumo.
- Regras de inventário.
- Parâmetros de compras e recebimentos.
- Preferências de relatório.
- Configurações gerais e de segurança.

Não concentre todas as configurações em uma tela desorganizada. Agrupe-as por finalidade.

Proteja configurações sensíveis por autorização específica e registre suas alterações na auditoria.

Os cadastros auxiliares devem ser reutilizados pelos diversos módulos, evitando categorias duplicadas e divergências entre telas.

---

## 15. Experiência de uso e interface

A plataforma será utilizada em atividades operacionais, muitas vezes com pouco tempo disponível. Portanto, facilidade de uso e produtividade são requisitos fundamentais.

Desenvolva uma interface com aparência profissional, organização visual consistente, hierarquia clara e poucos passos para as tarefas frequentes.

Priorize:

- Navegação simples e previsível.
- Layout responsivo.
- Formulários objetivos.
- Busca rápida.
- Filtros úteis.
- Tabelas legíveis.
- Ações contextuais claras.
- Feedback de sucesso e erro.
- Confirmação para operações sensíveis.
- Mensagens em português brasileiro.
- Formatação apropriada de datas, números e quantidades.
- Estados de carregamento e estados vazios.
- Acessibilidade e uso em telas menores.

Para tarefas recorrentes, como registrar consumo semanal, repor água, lançar materiais e conferir recebimentos, procure reduzir cliques, digitação e navegação desnecessária.

Permita salvar vários itens na mesma sessão quando isso simplificar o trabalho sem prejudicar a validação individual.

Evite excesso de caixas, cartões, gráficos ou elementos meramente decorativos. A interface precisa facilitar decisões e operações.

Não sacrifique a correção dos dados pela conveniência visual.

---

## 16. Segurança, integridade e arquitetura de dados

A segurança deve fazer parte da implementação desde o início.

Adapte os seguintes requisitos à tecnologia existente:

- Autenticação consistente e controle de sessão.
- Autorização no servidor para operações protegidas.
- Restrições de acesso no banco de dados quando suportadas pela arquitetura.
- Validação dos dados no backend.
- Restrições de integridade e relacionamentos.
- Transações para operações críticas.
- Prevenção de duplicidade.
- Proteção de arquivos e anexos.
- Limitação de acesso a dados conforme perfil e escopo.
- Proteção de credenciais e segredos.
- Registros de auditoria confiáveis.
- Tratamento adequado de erros.
- Indexação e consultas eficientes.
- Gestão segura de migrações.
- Preservação do histórico e da integridade referencial.

Se o projeto utilizar Supabase, por exemplo, avalie políticas RLS, restrições, funções e transações de acordo com a implementação existente. Não considere uma política segura apenas porque ela está cadastrada: verifique seu comportamento.

Não exponha chaves privadas ou credenciais administrativas no frontend.

Não implemente permissões somente com condições visuais no cliente.

Não crie mecanismos paralelos e inconsistentes para calcular o mesmo saldo. Defina uma fonte de verdade para as movimentações e derive os saldos de modo consistente.

Evite exclusão física de registros que tenham relevância histórica.

---

## 17. Restrições arquiteturais e operacionais

As regras desta seção são obrigatórias e acompanham todo o planejamento.

**Não faça o seguinte:**

- Não recrie a aplicação inteira quando uma evolução incremental for suficiente.
- Não substitua componentes funcionais sem necessidade comprovada.
- Não remova funcionalidades existentes apenas para simplificar a implementação.
- Não altere silenciosamente o schema ou elimine dados existentes.
- Não aplique migrações destrutivas ou alterações irreversíveis em produção sem autorização explícita.
- Não publique uma versão de produção nem altere configurações críticas de produção sem autorização explícita.
- Não conecte serviços pagos, fornecedores externos ou integrações que exijam novos compromissos financeiros sem autorização.
- Não simule o recebimento de mercadorias, consumo ou ajustes reais para demonstrar que uma funcionalidade funciona.
- Não permita correções silenciosas em movimentações confirmadas.
- Não misture código de teste, arquivos temporários e artefatos descartáveis com a estrutura principal sem necessidade.
- Não introduza bibliotecas ou arquitetura adicionais só por preferência pessoal.
- Não esconda limitações, falhas de testes ou dependências pendentes.
- Não declare como validado algo que não foi executado ou inspecionado.

Ao trabalhar com banco de dados ou ambientes existentes, inspecione primeiro o estado atual. Prepare mudanças incrementais, compatíveis e reversíveis sempre que possível.

Testes e desenvolvimento devem ocorrer em um ambiente seguro. Se faltar uma credencial ou um serviço externo, implemente e valide o que puder sem expor dados reais nem inventar respostas.

Não tente contornar permissões, credenciais ou controles do ambiente.

---

## 18. Plano de implementação e prioridade

Use as fases abaixo como referência, adaptando-as ao estado real do projeto sem perder nenhum requisito obrigatório.

### Fase 0 — Diagnóstico

Auditar o projeto, identificar o que já funciona e registrar riscos e lacunas.

**Critério de conclusão:** diagnóstico documentado, funcionalidades atuais identificadas e plano coerente com o repositório real.

### Fase 1 — Arquitetura e fundamentos

Validar o modelo de dados, autenticação, autorização, estrutura física, cadastros compartilhados, padrões visuais e auditoria.

**Critério de conclusão:** estrutura preparada para os demais módulos, com relacionamentos e regras de segurança coerentes.

### Fase 2 — Base operacional de estoque

Implementar produtos, unidades, locais, entradas, saídas, transferências, histórico e alertas de estoque mínimo.

**Critério de conclusão:** movimentações persistem, atualizam o estoque corretamente e identificam o usuário e o horário.

### Fase 3 — Consumo e inventário

Implementar reposição de ambientes, consumo periódico, conferência mensal, ajustes e relatórios de inventário.

**Critério de conclusão:** os usuários conseguem executar os fluxos previstos e as quantidades não são contabilizadas duas vezes.

### Fase 4 — Tickets e manutenção

Implementar abertura, resolução imediata, conversão em ordem de serviço, acompanhamento, anexos e consumo de materiais.

**Critério de conclusão:** os vínculos entre solicitações, serviços, estoque e histórico funcionam de ponta a ponta.

### Fase 5 — Compras e recebimentos

Implementar solicitações, aprovação, acompanhamento dos pedidos, recebimento parcial e integral e integração com o estoque.

**Critério de conclusão:** cada item pode ser rastreado do pedido ao recebimento, sem duplicar entradas.

### Fase 6 — Administração e relatórios

Implementar gestão de usuários e permissões, configurações, histórico consultável, indicadores e relatórios.

**Critério de conclusão:** cada perfil acessa somente o que está autorizado e os relatórios são coerentes com os dados persistidos.

### Fase 7 — Validação geral

Executar testes, corrigir falhas, verificar segurança, integridade de dados, usabilidade e compatibilidade com o ambiente de implantação.

**Critério de conclusão:** não existem defeitos críticos conhecidos ocultados por indicadores de sucesso, e as limitações restantes estão documentadas.

Não conclua uma fase apenas porque suas telas estão prontas. Valide os fluxos completos, incluindo banco de dados, autorização, movimentações, histórico e tratamento de erros.

---

## 19. Testes e critérios de aceitação

Crie ou atualize os testes apropriados à stack existente. Não substitua testes reais por declarações manuais de que tudo funciona.

Inclua testes para, no mínimo, os cenários abaixo:

1. Uma entrada de compra aumenta o estoque uma única vez.
2. Uma saída autorizada reduz o estoque e identifica corretamente o responsável.
3. Uma saída sem saldo suficiente é impedida, conforme as regras configuradas.
4. Uma reposição de água identifica corretamente o ambiente e não é automaticamente tratada como consumo efetivo.
5. O registro semanal de consumo preserva o período, a quantidade e o responsável.
6. O lançamento de consumo não desconta duas vezes a mesma quantidade.
7. Um inventário registra a quantidade física, calcula a diferença e gera ajuste rastreável quando autorizado.
8. Itens pendentes não aparecem como inventariados.
9. Um ticket pode ser concluído sem consumo de materiais.
10. Um ticket pode ser convertido em ordem de serviço mantendo seu histórico.
11. Um material utilizado em manutenção gera a movimentação correspondente e mantém o vínculo com a ordem.
12. Uma entrega parcial atualiza apenas as quantidades efetivamente recebidas.
13. Uma segunda tentativa de confirmar o mesmo recebimento não gera uma entrada duplicada.
14. Um recebimento integral encerra corretamente as pendências do item.
15. Um usuário sem permissão não consegue executar uma operação protegida, mesmo que tente chamar diretamente a API ou rota correspondente.
16. Alterações de permissões e ajustes de estoque ficam registrados na auditoria.
17. Os saldos, os relatórios e os históricos permanecem coerentes depois de operações sucessivas.
18. Operações simultâneas não produzem saldos inconsistentes.
19. Os formulários apresentam mensagens de validação úteis.
20. Os módulos principais permanecem funcionais depois das alterações.

Além dos testes automatizados, faça validações de build, lint, tipagem e demais verificações existentes e pertinentes ao projeto.

Quando algum teste não puder ser executado, registre qual foi o bloqueio. Diferencie claramente testes aprovados, reprovados e não executados.

---

## 20. Continuidade operacional e documentação

Mantenha a documentação do projeto atualizada durante a execução.

Se existirem arquivos de memória operacional, como STATUS, TODO, DECISOES, PROBLEMAS, HISTORICO, ARCHITECTURE ou equivalentes, atualize-os conforme os padrões existentes, preservando suas regras de hierarquia e gravação.

Registre:

- O que foi analisado.
- O que foi planejado.
- O que foi implementado.
- As decisões arquiteturais e seus motivos.
- Os arquivos relevantes modificados.
- As migrações criadas.
- Os testes executados e seus resultados.
- Os problemas identificados.
- O que foi concluído.
- O que permanece pendente.
- As dependências de ações humanas.
- A forma segura de retomar a execução.

Não duplique a mesma documentação em vários locais sem necessidade.

Mantenha uma única referência principal para o plano e o backlog, vinculando os documentos auxiliares pertinentes.

---

## 21. Entrega final obrigatória

Ao concluir o trabalho possível no ambiente atual, apresente um relatório final objetivo e verificável.

O relatório deverá informar:

**A. Diagnóstico:** qual era a situação encontrada no projeto.

**B. Planejamento:** quais fases foram definidas e quais mudanças relevantes foram feitas no plano original.

**C. Implementação:** quais módulos e funcionalidades foram realmente concluídos.

**D. Testes:** quais verificações foram executadas, com resultados reais.

**E. Banco de dados:** quais alterações foram realizadas, quais migrações foram criadas e se alguma depende de aplicação manual ou autorização.

**F. Segurança:** como os acessos e as movimentações são protegidos, além das limitações conhecidas.

**G. Pendências:** o que ainda não foi implementado, validado ou conectado, com a razão específica de cada pendência.

**H. Execução e publicação:** como iniciar e testar a aplicação no ambiente existente e qual é o estado real da implantação, sem alegar publicação se ela não aconteceu.

**I. Próximos passos:** apresente somente ações necessárias e claramente identificadas, sem transferir ao usuário tarefas que o agente ainda consegue executar com segurança.

Não apresente uma lista de funcionalidades desejadas como se elas já estivessem implementadas.

Não classifique uma etapa como concluída quando houver apenas um layout, um protótipo ou uma implementação incompleta.

---

## 22. Instrução final de execução

Comece agora pela inspeção do projeto e do ambiente atual.

Em seguida, elabore e salve o planejamento mestre com requisitos, arquitetura, dependências, prioridades, critérios de aceitação e restrições.

Depois, execute esse planejamento automaticamente, de forma incremental, preservando o que já funciona, registrando decisões, implementando funcionalidades reais e executando os testes correspondentes.

Não encerre sua atuação somente com o planejamento.

Não peça autorização para avançar entre as fases normais de desenvolvimento.

Se identificar um impedimento que exija intervenção humana, trabalhe nas demais partes independentes e informe exatamente o que ficou bloqueado e por quê.

**Resultado esperado: uma plataforma profissional, integrada, segura e rastreável de gestão de Facilities, adequada à rotina real de um gerente e de sua equipe, com controle de estoque, consumo, inventários, tickets, ordens de serviço, compras, recebimentos, permissões e relatórios, construída sobre uma arquitetura consistente e validada por testes.** 