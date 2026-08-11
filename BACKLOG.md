# Backlog — E-commerce Tracker

Registrado em 07/08/2026. Os nomes abaixo seguem a interface atual.

## Prioridade alta — dados e navegação

### DASH-01 — Simplificar o bloco de Vendas Reais no Dashboard

**Tipo:** melhoria de interface
No bloco `Shopify — Vendas Reais · período`, reduzir o cabeçalho e deixar em evidência somente as métricas necessárias, como **Vendas Shopify**, **Vendas Facebook**, **Receita Real**, **CPA Real** e demais métricas configuráveis. O período e a origem podem ficar discretos em tooltip ou filtros.

### DASH-02 — Conversão Real no Calendário de Métricas

**Tipo:** melhoria funcional / possível bug de cálculo
Fazer a métrica `Conversão + Real` funcionar com a fórmula:

`Conversão Real = número de vendas reais do produto (dados extraídos pela IA) ÷ visitas do produto na Shopify × 100`

Requisitos:

- Respeitar o produto e o intervalo de datas selecionados.
- Permitir filtrar e visualizar por país.
- Exibir fonte dos dados, período e aviso quando vendas ou visitas estiverem indisponíveis.
- Não misturar vendas de Facebook com vendas reais da Shopify no numerador.

### DASH-03 — Conversão Real em Top Produtos

**Tipo:** melhoria funcional
Adicionar `Conversão Real` como métrica/coluna e opção de ordenação em `Top Produtos`/`Ranking`, usando a mesma fórmula e filtros do calendário.

### NAV-01 — Reordenar itens do menu lateral

**Tipo:** melhoria de navegação
Permitir arrastar e soltar os menus e submenus do menu lateral para definir a ordem, persistindo por usuário.

### NAV-02 — Mapa/preview de navegação

**Tipo:** melhoria de navegação
Adicionar um menu compacto no canto da tela que mostre uma visão geral dos módulos, subseções e localização atual; deve permitir ir diretamente a cada seção.

## Prioridade alta — Estúdio de Produto

### STUDIO-01 — Remover menu Brands

**Tipo:** alteração de informação arquitetural
Remover o item `Brands` do AI Ad Hub/menu lateral e ajustar links/rotas dependentes.

### STUDIO-02 — Recent Edits sem histórico

**Tipo:** bug
`Recent Edits` não exibe histórico. Salvar e listar as edições recentes com produto, miniatura, data/hora, tipo de operação, prompt usado e link para reabrir.

**Critério de aceite:** após gerar ou editar uma imagem, ela aparece imediatamente no histórico e persiste após recarregar a página.

### STUDIO-03 — Seletor de produto confuso/inconsistente

**Tipo:** melhoria de UX
Redesenhar o seletor de produto do Estúdio de Produto e padronizá-lo em todos os fluxos que usam produto-base/molde, incluindo `Lançamento`.

Requisitos: busca, miniatura, nome, SKU/loja, produto recentemente usado, estado vazio e seleção inequívoca.

### STUDIO-04 — Ordenar fotos de produto como na Shopify

**Tipo:** melhoria funcional
Em `Editar produto`, permitir reordenar as fotos por arrastar e soltar, com miniaturas e ordem persistida — comportamento equivalente ao da Shopify.

### STUDIO-05 — Cenários e ângulos de geração

**Tipo:** melhoria de geração por IA
No Estúdio, oferecer os mesmos cenários disponíveis para os mesmos produtos e um menu de ângulos predefinidos (por exemplo: frontal, 3/4 esquerdo, 3/4 direito, lateral, traseiro, superior, detalhe/macro, em uso e packshot). Permitir selecionar um ou vários ângulos para gerar em lote.

### STUDIO-06 — Tooltips nos botões de imagens geradas

**Tipo:** bug de usabilidade
No menu inferior das fotos geradas, exibir tooltip/texto explicativo ao passar o mouse em cada botão; todos os botões devem ter ação funcional e acessível por teclado.

### STUDIO-07 — Biblioteca de prompts

**Tipo:** nova funcionalidade
Permitir salvar, editar, excluir e reutilizar prompts no Estúdio e no Lançamento. A biblioteca precisa aceitar categorias e subcategorias — por exemplo `Imagem > Cenários`, `Imagem > Edição`, `Copy > Títulos`, `Copy > Descrição`.

### STUDIO-08 — Seleção de imagens ao clicar na imagem

**Tipo:** melhoria funcional
Ao clicar em uma imagem/campo de imagem, abrir o seletor com: fotos do produto, imagens geradas daquele produto, imagens-base e imagens enviadas pelo usuário. Não limitar esse acesso ao botão de IA.

### STUDIO-09 — Edição de imagem com recursos equivalentes

**Tipo:** melhoria funcional
Na edição de fotos por IA, incluir foto de referência, cenários, ângulos, biblioteca de prompts e controle de formato/proporção da imagem.

### STUDIO-10 — Padronização/otimização de arquivos de imagem

**Tipo:** requisito técnico
Todas as imagens criadas, editadas ou selecionadas devem passar pelo motor existente de compressão e conversão para WebP, preservando a associação ao produto e registrando dimensões/tamanho final.

## Lançamento de Produto

### LAUNCH-01 — Gerar nome de produto com IA

**Tipo:** nova funcionalidade
No campo `Nome do novo produto`, adicionar um botão discreto de geração com IA. Ele deve sugerir nomes relacionados ao produto e orientados à conversão, permitindo regenerar, editar e aplicar uma sugestão.

### LAUNCH-02 — Etapa 2: fotos com cenários, ângulos e fontes flexíveis

**Tipo:** melhoria funcional
Na fase 2/Fotos, disponibilizar cenários predefinidos, geração de todos os ângulos e fontes de imagem:

- produto-base;
- foto enviada pelo usuário;
- imagem existente na memória/biblioteca;
- descrição textual opcional da alteração.

Remover a obrigatoriedade de preencher `Descreva o que quer mudar` quando houver foto de referência, cenário ou outra instrução suficiente.

### LAUNCH-03 — Etapa 3: IA e biblioteca de prompts

**Tipo:** nova funcionalidade
Na etapa 3, permitir gerar conteúdo com IA e aplicar um prompt salvo da biblioteca, incluindo prompts de copy.

### LAUNCH-04 — Seções de página com bloco de conteúdo e IA

**Tipo:** melhoria funcional
Nas seções da página, disponibilizar blocos para adicionar texto e imagem, gerar imagem com IA e os mesmos recursos de referência, cenário, ângulos, prompts e formatos definidos acima.

### LAUNCH-05 — Ícones de foto sem rótulo e sem ação

**Tipo:** bug
Há menus/ícones de foto nas seções cujo propósito não é identificável e que não funcionam. Adicionar rótulos/tooltips, estados de carregamento/erro e implementar/corrigir as respectivas ações.

### LAUNCH-06 — Criar múltiplas páginas em uma execução

**Tipo:** nova funcionalidade
Permitir criar várias páginas de produto simultaneamente, com diferentes copys, estruturas e/ou variações de criativo; exibir uma revisão antes de publicar/salvar.

### LAUNCH-07 — Rascunhos não localizáveis

**Tipo:** bug
Não há caminho claro para encontrar os rascunhos. Criar área `Rascunhos` com busca, filtros, data de atualização, produto vinculado e ação para continuar, duplicar ou excluir.

**Critério de aceite:** um lançamento salvo como rascunho pode ser localizado após recarregar e retomado no mesmo passo em que foi salvo.

## Ordem sugerida de execução

1. Corrigir `Recent Edits`, `Rascunhos` e ícones sem ação/rótulo.
2. Validar a origem e a fórmula de `Conversão Real` no Dashboard e Top Produtos.
3. Padronizar o seletor de produtos e a seleção de imagens.
4. Criar biblioteca de prompts, cenários e geração por ângulos como componentes reutilizáveis.
5. Aplicar esses componentes no Estúdio, Lançamento, edição de fotos e seções de página.
6. Adicionar reorganização do menu, mapa de navegação e criação em lote de páginas.
