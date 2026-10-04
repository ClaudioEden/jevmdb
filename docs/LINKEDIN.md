# Posts para o LinkedIn

Antes de publicar, troque o link do GitHub se o repositório tiver outro nome e confira se o site já está no ar.

---

## Post 1: técnico (mostrando como foi feito)

Fiz um recomendador de filmes que não usa um LLM para dar a nota. Quem compara é o Jev, um modelo da TypeSafe que responde perguntas fechadas sobre um texto, com probabilidade e confiança.

Como funciona, em quatro partes:

1. Catálogo. Cada filme vira uma ficha em JSON: título no Brasil, ano, diretor, elenco, gêneros e sinopse. Os dados vêm do IMDb (busca e pôster), do Wikidata e da Wikipedia, do TMDB (sinopse em português e onde assistir) e do OMDb (nota do IMDb). Quando alguém procura um filme que ainda não está na base, ele é catalogado na hora e fica guardado. Nenhum filme é buscado duas vezes.

2. Tags de estilo. Para cada filme novo, uma única chamada ao Jev faz dezenas de perguntas do tipo sim ou não ("este filme é distopia?", "é noir?"). As tags que passam de 50% entram na ficha.

3. Comparação. Para cada filme candidato, o Jev recebe as duas fichas e uma pergunta de nota de 0 a 4 por critério (estilo, atores, ano, enredo), com a descrição de cada nível. Até o ano é comparado pelo Jev, com faixas de "mesmo ano" a "mais de 30 anos de diferença". A nota vira porcentagem de similaridade.

4. Texto livre. Na aba "descreva o que você quer", o Gemini Flash só identifica o filme, mesmo com erro de digitação ("obvilium com o Tom Cruise" vira Oblivion), e a pessoa confirma antes da busca. Se não for o filme certo, ela dá mais detalhes e o app tenta de novo, sem repetir o que já foi recusado. Os critérios e todas as notas continuam com o Jev.

Números de uma busca típica: 60 comparações, cerca de 50 mil tokens, de 2 a 3 segundos, US$ 0,002. O Jev cobra US$ 42 por bilhão de tokens de entrada.

Para a consulta grátis sem cadastro, a trava combina o fingerprint do navegador, um cookie assinado e o IP guardado só como hash. O fingerprint barra a segunda busca do mesmo computador. O IP só serve de teto (5 por dia), para não bloquear colegas que dividem a mesma rede.

Stack: Node puro, sem nenhuma dependência, fichas em arquivos JSON, rodando numa VPS com Caddy na frente. O próximo passo é Postgres e cadastro por WhatsApp.

O código está aberto: https://github.com/ClaudioEden/jevmdb
Para testar: https://jevmdb.w3pd.com.br

#IA #NodeJS #DesenvolvimentoDeSoftware #Recomendação

---

## Post 2: anúncio discreto

Coloquei no ar um projeto pessoal: o JevMDB.

Você escolhe um filme de que gostou, marca o que importa (estilo, atores, época, enredo) e ele devolve os mais parecidos, com a porcentagem de similaridade, o pôster e onde assistir no Brasil.

Também dá para só descrever: "quero algo parecido com aquele do Stallone de juiz no futuro, da mesma época".

Comecei como um teste do Jev, um modelo que dá notas em vez de escrever texto, e acabou virando algo que eu mesmo uso para escolher o filme do fim de semana.

A primeira busca é grátis, sem cadastro: https://jevmdb.w3pd.com.br

Se testar, me conta se a sugestão acertou. E se quiser ver como foi feito, o código está no GitHub (link nos comentários).

---

### Dicas de publicação

- Publique o técnico e o discreto em dias diferentes. O discreto rende mais com um print ou um vídeo curto de uma busca.
- No post discreto, deixe o link do GitHub no primeiro comentário. O LinkedIn tende a mostrar menos os posts com muitos links no texto.
- Responda os primeiros comentários na primeira hora.
