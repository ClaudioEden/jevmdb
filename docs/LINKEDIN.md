# Posts para o LinkedIn: JevMDB

Dois rascunhos. Troque o que não soar como você. Números reais dos testes: cerca de US$ 0,002 por busca, 178 filmes catalogados por cerca de US$ 0,0076, três idiomas.

---

## Post 1: autopromoção (vanguarda, dor real e custo)

Trabalho com desenvolvimento há anos, e uma coisa que aprendi: quem para de estudar fica para trás rápido. Por isso mantenho sempre um projeto de estudo no ar, de verdade, não só um tutorial.

O da vez nasceu de uma dor minha. Termino um filme e quero outro igualzinho. Perguntei por perto e várias pessoas disseram o mesmo. Então construí o JevMDB: você diz o filme e o que importa (estilo, atores, ano ou história) e recebe até 10 sugestões, com a porcentagem de semelhança e onde assistir.

O que mais me interessou nem foi o filme. Foi o custo.

Uso um modelo de decisão (o Jev, da TypeSafe) que não gera texto: ele dá notas e escolhe entre opções. Resultado:
• cerca de US$ 0,002 por busca, ou seja, mil buscas custam uns US$ 2;
• catalogar 178 filmes custou menos de 1 centavo de dólar;
• uma IA de texto (Gemini) entra só quando a pessoa descreve o filme em vez de digitar o nome, e só para descobrir o título.

Isso muda a conversa dentro de uma empresa. Muita gente joga um modelo gigante em tudo e só descobre o preço na fatura. Escolher a ferramenta certa para cada etapa é o que transforma uma ideia de IA em algo que cabe no orçamento, e economia assim aparece direto no resultado.

Fica aberto para quem quiser testar: https://jevmdb.w3pd.com.br
São 5 buscas grátis. Se quiser mais, me chama no WhatsApp que eu libero.

Se ele errar feio, me conta o filme nos comentários 👇

#Desenvolvimento #IA #ProjetoPessoal #Custos #Tecnologia

---

## Post 2: técnico (do zero ao ar, resumido)

Fiz um recomendador de filmes com IA do zero até o ar, e o código está aberto. Resumo de como foi, em 5 passos.

1️⃣ Ideia
Escolher um filme e o que importa (estilo, atores, ano, enredo) e receber os 10 mais parecidos, com nota por critério. A ideia central: a IA dá notas, não inventa resposta. Usei o Jev (TypeSafe), que responde perguntas fechadas com probabilidades, então não alucina filme que não existe.

2️⃣ Stack
Node 22 sem nenhuma dependência, fichas em JSON, front em uma página só. Dados do TMDB, OMDb, Wikidata e Wikipedia. Gemini só para entender texto livre ("aquele do Tom Cruise na Terra abandonada" vira Oblivion). Três idiomas (pt, en, es). Cada filme novo é catalogado na hora e fica salvo.

3️⃣ Implementação com IA
Construí com o Claude, conversando e revisando cada passo, do esquema das fichas ao deploy. A IA acelerou, mas as decisões foram minhas: o que vai para o modelo, quanto custa cada chamada, o que fica local.

4️⃣ Publicação: 3 caminhos, 1 escolha
• VPS direta com systemd + Caddy: simples, mas eu cuido de tudo à mão;
• Docker Compose: reproduzível, ainda com proxy e atualização por minha conta;
• Dokploy: deploy a cada push no GitHub, HTTPS automático, logs e variáveis num painel.
Fui de Dokploy na minha VPS de testes. Tropecei em duas coisas (caminho do Dockerfile e variáveis de ambiente) e ambas viraram parágrafo no guia.

5️⃣ Proteção antes de divulgar
Não tenho cobrança, então coloquei limite de 5 buscas grátis por pessoa, um teto de gasto por dia e um console que mostra consumo do Jev e do Gemini, buscas e saúde do servidor.

🎁 Brinde: o projeto está pronto para qualquer pessoa baixar e instalar. Repositório público (MIT) com Dockerfile, docker-compose e um guia passo a passo de VPS.

Código: https://github.com/ClaudioEden/jevmdb
Para testar: https://jevmdb.w3pd.com.br

#NodeJS #IA #Docker #Dokploy #OpenSource #Claude
