# JevMDB (versão 0.6)

Recomendador de filmes que usa o **Jev** (TypeSafe, endpoint SystemOne) para comparar as fichas do catálogo.

## Como funciona
1. **Filme de referência.** Você digita o nome (em português ou o original) e escolhe numa lista que junta o catálogo e o IMDb, com pôster, ano e atores. Se o filme for novo, o servidor monta a ficha juntando IMDb, Wikidata e Wikipedia (e TMDB e OMDb, se houver chave), pede ao Jev as tags de estilo (primitivo `noul`) e salva.
2. **Critérios.** Você marca um ou mais: estilo, atores, ano, enredo.
3. **Comparação.** Para cada filme candidato, o servidor faz uma chamada ao Jev com as duas fichas e uma pergunta `score` (5 níveis) por critério. Cada nota é convertida para 0 a 100. Com vários critérios, a nota final é a média simples.
4. **Resultado.** Até 10 sugestões, com a nota de cada critério, mais o custo, o tempo, as chamadas e os tokens da busca.

A tela tem duas abas exclusivas: **Escolher filme** (filme + critérios) ou **Descrever em texto** (o Jev entende o filme e os critérios pelo texto; só para filmes do catálogo). Custo, tokens, chamadas, tempo e o total gasto desde que o servidor subiu ficam na barra do topo.

## Rodar localmente
Precisa do Node 18 ou mais novo. Não tem dependências.

```bash
cd jev-app
# coloque a chave em .env (já ignorado pelo git):  TYPESAFE_API_KEY=sua-chave
node server.js
# abra http://localhost:3000
```

O `server.js` lê o arquivo `.env` da pasta sozinho.

Scripts:
- `node scripts/completar-fichas.js`: completa código do IMDb, pôster, notas do IMDb e do TMDB e onde assistir nas fichas (não chama o Jev).
- `node scripts/semear.js 5`: traz para o catálogo os filmes populares e mais bem avaliados do TMDB (5 páginas de cada lista, cerca de 200 filmes; uma chamada ao Jev por filme novo).

Sem chave, ou com `JEV_MOCK=1`, roda em **modo simulado**: as notas são uma heurística de palavras, só para testar a tela.

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `PORT` | 3000 | Porta do servidor |
| `HOST` | (todas) | Endereço de escuta; em produção use 127.0.0.1 atrás do proxy |
| `JEV_ATRAS_DE_PROXY` | (vazio) | `1` quando houver Caddy/Nginx na frente: o IP da trava passa a vir do X-Forwarded-For |
| `JEV_MOSTRAR_USO` | 1 | `0` esconde do público o custo, os tokens e o total gasto (a barra do topo some) |
| `JEV_DADOS` | ./data | Pasta das fichas e da trava (no servidor, fora da pasta do código) |
| `JEV_MODEL` | jev-latest | Modelo do Jev |
| `TYPESAFE_API_URL` | https://api.typesafe.ai/v1/systemone | Endpoint |
| `JEV_PRECO_INPUT_POR_M` | 0.042 | US$ por milhão de tokens de entrada |
| `JEV_PRECO_OUTPUT_POR_M` | 0 | US$ por milhão de tokens de saída |
| `MAX_RESULTADOS` | 10 | Máximo de sugestões |
| `MAX_CANDIDATOS` | 60 | Máximo de filmes enviados ao Jev por busca |
| `JEV_PARALELO` | 8 | Chamadas simultâneas ao Jev |
| `JEV_COTA_ANONIMA` | 1 | `0` desliga a trava da consulta grátis (útil para testar) |
| `TMDB_API_KEY` | (vazio) | Opcional. Título e sinopse em pt-BR, elenco, pôster e nota do TMDB (chave grátis em themoviedb.org) |
| `OMDB_API_KEY` | (vazio) | Opcional. Nota e dados do IMDb pelo OMDb (chave grátis em omdbapi.com) |
| `GEMINI_API_KEY` | (vazio) | Opcional. Na aba de texto, o Gemini identifica o filme (mesmo com erro de digitação ou fora do catálogo) |
| `GEMINI_MODEL` | gemini-flash-latest | Modelo do Gemini (se estiver sobrecarregado, tenta gemini-flash-lite-latest e gemini-2.5-flash; se todos falharem, o Jev escolhe no catálogo) |
| `JEV_MIN_CATALOGO` | 40 | Com menos filmes que isso, a busca primeiro traz do TMDB os filmes vizinhos da referência (na hora). Acima disso, os vizinhos entram em segundo plano depois de cada busca |
| `JEV_COTA_LIMITE_IP` | 5 | Consultas grátis por IP em 24 h antes de o IP bloquear sozinho |
| `JEV_SEGREDO` | gerado em `data/.segredo` | Chave que assina o cookie do visitante |

## Consulta grátis
Cada visitante sem cadastro faz **uma** consulta. A trava (`lib/cota.js`) combina três sinais, nesta ordem:
1. **Fingerprint do navegador** (calculado na página e enviado no cabeçalho `X-Jev-FP`): se já foi usado, bloqueia, mesmo que a pessoa apague o cookie ou troque de IP.
2. **Cookie assinado** pelo servidor: se já foi usado, bloqueia.
3. **IP** (guardado só como hash): sozinho não bloqueia, para não barrar colegas no mesmo escritório ou na mesma rede móvel. Só bloqueia se o pedido vier sem fingerprint, ou se o mesmo IP já fez `JEV_COTA_LIMITE_IP` consultas grátis em 24 h (padrão 5).

Só conta a consulta que trouxe resultado. Os sinais ficam em `data/cota.json`, criado na primeira consulta contada com a trava ligada. Para zerar durante os testes, apague esse arquivo. `JEV_COTA_ANONIMA=0` desliga a trava; a variável pode ir no `.env` ou na linha de comando (a linha de comando vale mais que o `.env`).

## Arquivos
- `server.js`: rotas HTTP e entendimento do pedido.
- `lib/recomendar.js`: critérios, níveis de cada score e comparação.
- `lib/importar.js`: busca de candidatos (catálogo + IMDb) e catalogação juntando IMDb, Wikidata, Wikipedia, TMDB e OMDb.
- `lib/gemini.js`: identificação do filme no texto livre (opcional).
- `lib/i18n.js`: idiomas e tradução das tags. `lib/buscas.js`: buscas feitas, avaliação e limpeza.
- `scripts/completar-fichas.js` e `scripts/semear.js`: manutenção e crescimento do catálogo. `scripts/limpar-buscas.js`: limpeza por cron.

## Idiomas
O site é trilíngue: português do Brasil (padrão), inglês americano e espanhol. As bandeiras redondas no topo mostram os outros dois idiomas; a escolha fica guardada no navegador e também vale por `?lang=pt|en|es`. Títulos, sinopses e gêneros em inglês e espanhol vêm do TMDB e ficam na ficha (`i18n`); as tags de estilo são traduzidas por dicionário (`lib/i18n.js`). As comparações do Jev continuam em português por dentro.

## Buscas feitas e avaliação
Cada resultado exibido é gravado em `data/buscas-feitas/<id>.json` (sem dados do visitante) com prazo de **60 dias**. Abaixo do card de busca aparece "muito ruim ★★★★★★★★★★ excelente"; a nota é opcional e, se for **menor que 7**, o prazo cai para **15 dias**. Depois da nota aparece um campo para comentário opcional. O servidor apaga as buscas vencidas ao subir e a cada 24 h; `node scripts/limpar-buscas.js` faz o mesmo por cron.

## Catálogo que cresce sozinho
Depois de cada busca, o servidor traz em segundo plano até 20 filmes que o TMDB lista como "recomendados" e "parecidos" com a referência (uma vez a cada 30 dias por filme). Se o catálogo tiver menos de `JEV_MIN_CATALOGO` filmes, isso acontece antes da comparação. Abaixo da lista há a caixa "Sentiu falta de algum filme?": o pedido vai para `data/pedidos-filmes.jsonl` e o filme é catalogado na hora, em segundo plano.

## Onde assistir
Vem do TMDB (dados do JustWatch) para o país do idioma (Brasil, EUA ou México) e fica guardado na ficha por 7 dias. A tela carrega depois dos resultados, sem atrasar a busca.
- `lib/jev.js`: cliente do Jev, com medição de custo e tempo.
- `lib/store.js`: leitura e gravação das fichas. É o único módulo a trocar para migrar ao Postgres.
- `lib/mock.js`: respostas simuladas.
- `lib/cota.js`: trava da consulta grátis.
- `data/filmes/*.json`: uma ficha por filme.
- `public/index.html`: a tela.
