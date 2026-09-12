# Direção visual do Traje

## Abordagens consideradas

### Abordagem 1 — Atelier Editorial
Uma interface de inventário com linguagem de alfaiataria contemporânea: papel quente, azul-marinho, latão fosco, tipografia editorial e imagens de textura têxtil. A sensação é de um caderno de atelier transformado em produto digital.

**Probability:** 0.07

### Abordagem 2 — Arquivo Noturno
Uma experiência escura e silenciosa, inspirada em provadores privados, com superfícies grafite, brilho pontual e foco absoluto nos indicadores de uso.

**Probability:** 0.04

### Abordagem 3 — Catálogo Solar
Uma interface clara e arejada, com branco mineral, verde sálvia e blocos fotográficos, aproximando o produto de um catálogo de guarda-roupa de fim de semana.

**Probability:** 0.03

## Abordagem escolhida — Atelier Editorial

### Design Movement
Editorial modernism aplicado a um objeto digital de uso diário, com referências de catálogos de alfaiataria, cartões de arquivo e materiais de atelier.

### Core Principles
1. **Arquivo antes de ornamento:** cada peça, conjunto e uso tem um lugar claro e rastreável.
2. **Contraste de material:** fundos mineralizados e painéis de papel se encontram com azul-marinho profundo e detalhes de latão.
3. **Ritmo assimétrico:** o calendário e as ações principais quebram a grade centralizada para criar uma leitura mais natural e editorial.
4. **Feedback discreto:** animações curtas e indicadores cromáticos comunicam estado sem transformar a ferramenta em brinquedo.

### Color Philosophy
O azul-marinho representa confiança e roupa social; o marfim cria a sensação de papel de arquivo; o latão funciona como assinatura de acabamento; o vinho sinaliza uso recente e ação. A paleta é quente o bastante para parecer humana e sóbria o bastante para preservar a legibilidade dos dados.

### Layout Paradigm
A tela usa uma coluna principal de inventário com um trilho lateral de contexto em telas largas. No celular, o trilho se transforma em navegação inferior e os blocos passam a ocupar a largura com respiros laterais generosos. O calendário funciona como âncora visual no topo, seguido por ações rápidas e uma lista de arquivo.

### Signature Elements
- Linha fina de latão sob títulos de seção, como uma marca de alfaiate.
- Indicadores de uso em três quadrados, com progressão vinho–âmbar–verde.
- Cartões de peça com pequenas etiquetas de código em estilo de ficha de arquivo.

### Interaction Philosophy
Ações destrutivas sempre pedem confirmação e explicam impacto. Ações frequentes têm resposta imediata por toast e mudança visual local. O aplicativo não bloqueia o usuário por causa de indicadores de uso; os indicadores informam, nunca julgam.

### Animation
Entradas de cartões usam um deslocamento vertical sutil e opacidade, com atraso de 35 ms entre itens. Modal e drawer entram em até 220 ms com easing de saída forte. Estados ativos mudam por cor e escala mínima. Respeitar `prefers-reduced-motion` e evitar animar layout.

### Typography System
Usar **DM Serif Display** para títulos e momentos de marca, combinada com **Manrope** para interface, dados e microcopy. Títulos têm contraste editorial; códigos, datas e rótulos usam espaçamento de letras ligeiramente ampliado.

### Brand Essence
Um arquivo pessoal de roupas masculinas para quem quer vestir melhor, repetir menos e lembrar do que realmente usa — organizado, elegante, local e sem dependência de nuvem.

**Personalidade:** preciso, sóbrio, cuidadoso.

### Brand Voice
Headlines são curtas e concretas. CTAs usam verbos de ação e contexto. Microcopy explica o que muda e evita linguagem genérica de onboarding.

> “Vista o que faz sentido hoje.”

> “Seu arquivo, sua próxima combinação.”

### Wordmark & Logo
O símbolo é um cabide abstrato que termina em um nó de gravata, desenhado com duas linhas geométricas e espaço negativo. O wordmark deve usar DM Serif Display, com a inicial T tratada como assinatura editorial.

### Signature Brand Color
**Brass Thread — `#B88A4A`**, um latão quente e discreto que aparece em linhas, bordas de foco e pequenos marcadores de acabamento.

## Style Decisions

- Toda tela principal exibe uma assinatura Traje visível no primeiro bloco, usando o símbolo do cabide/nó de gravata e o tratamento editorial do nome.
- As linhas de latão, etiquetas de código e indicadores de três quadrados são motivos obrigatórios nos blocos principais, não apenas detalhes decorativos.
- Ações rápidas usam linguagem de ficha de arquivo, rótulos numerados e acabamento de latão para não parecerem cards SaaS genéricos.
