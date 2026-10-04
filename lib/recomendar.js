// Comparação com o Jev: uma chamada por filme candidato, com uma pergunta "score" por critério marcado.
const { systemOne, emParalelo } = require("./jev");
const store = require("./store");

const MAX_RESULTADOS = Number(process.env.MAX_RESULTADOS || 10);
const MAX_CANDIDATOS = Number(process.env.MAX_CANDIDATOS || 60);
const PARALELO = Number(process.env.JEV_PARALELO || 8);

// Cada critério vira uma pergunta do primitivo "score", com 5 níveis (0 a 4).
const CRITERIOS = {
  estilo: {
    nome: "Estilo",
    instructions: "Quão parecido é o ESTILO do filme candidato com o do filme de referência? Considere gênero, ambientação, época retratada e tom.",
    criteria: [
      "Estilos completamente diferentes",
      "Pouco em comum: só um elemento isolado",
      "Alguns elementos de estilo em comum",
      "Estilo muito parecido",
      "Mesmo estilo: gênero, ambientação e tom praticamente iguais",
    ],
  },
  atores: {
    nome: "Atores",
    instructions: "Quanto o filme candidato compartilha ELENCO PRINCIPAL e DIRETOR com o filme de referência?",
    criteria: [
      "Nenhum ator principal nem diretor em comum",
      "Só o diretor em comum",
      "Um ator principal em comum",
      "Um ator principal e o diretor em comum, ou dois atores principais em comum",
      "Mesmo protagonista e mesmo diretor, ou três ou mais atores principais em comum",
    ],
  },
  ano: {
    nome: "Ano",
    instructions: "Qual a diferença entre o ANO DE LANÇAMENTO do filme candidato e o do filme de referência?",
    criteria: [
      "Mais de 30 anos de diferença",
      "Entre 16 e 30 anos de diferença",
      "Entre 6 e 15 anos de diferença",
      "Entre 1 e 5 anos de diferença",
      "Lançados no mesmo ano",
    ],
  },
  enredo: {
    nome: "Enredo",
    instructions: "Quão parecido é o ENREDO do filme candidato com o do filme de referência? Considere premissa, conflito central e temas.",
    criteria: [
      "Histórias sem relação",
      "Um tema em comum",
      "Alguns temas e situações em comum",
      "Enredo muito parecido",
      "Praticamente a mesma premissa",
    ],
  },
};

function fichaTexto(f) {
  return [
    `Título: ${f.titulo_br} (${f.titulo_original})`,
    `Ano de lançamento: ${f.ano}`,
    `Diretor: ${f.diretor}`,
    `Elenco principal: ${f.elenco.join(", ")}`,
    `Gêneros: ${f.generos.join(", ")}`,
    `Estilo: ${f.estilo.join(", ")}`,
    `Sinopse: ${f.sinopse}`,
    `Temas: ${f.temas.join(", ")}`,
  ].join("\n");
}

// Pré-filtro barato para quando o catálogo crescer: mantém os candidatos com algum sinal em comum.
// Com o catálogo pequeno, todos passam.
function preFiltrar(ref, outros, criterios) {
  if (outros.length <= MAX_CANDIDATOS) return outros;
  const tags = new Set(ref.estilo.map(store.norm));
  const pontos = f => (criterios.includes("estilo") ? f.estilo.filter(t => tags.has(store.norm(t))).length : 0)
    + (criterios.includes("atores") ? f.elenco.filter(a => ref.elenco.includes(a)).length * 2 + (f.diretor === ref.diretor ? 2 : 0) : 0)
    + (criterios.includes("ano") ? Math.max(0, 3 - Math.abs(f.ano - ref.ano) / 5) : 0)
    + (criterios.includes("enredo") ? f.temas.filter(t => ref.temas.includes(t)).length : 0);
  return outros.map(f => [f, pontos(f)]).sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDIDATOS).map(([f]) => f);
}

async function recomendar(ref, criterios, foco, med) {
  const outros = preFiltrar(ref, store.todos().filter(f => f.id !== ref.id), criterios);
  const refTxt = fichaTexto(ref) + (foco?.length ? `\nO usuário quer que o estilo se pareça principalmente em: ${foco.join(", ")}` : "");
  const questions = Object.fromEntries(criterios.map(c => [c, { type: "score", instructions: CRITERIOS[c].instructions, criteria: CRITERIOS[c].criteria }]));

  const resultados = await emParalelo(outros, PARALELO, async f => {
    const state = `FILME DE REFERÊNCIA\n${refTxt}\n\nFILME CANDIDATO\n${fichaTexto(f)}`;
    const ans = await systemOne(state, questions, med);
    const notas = Object.fromEntries(criterios.map(c => {
      const max = CRITERIOS[c].criteria.length - 1;
      return [c, Math.round(((ans[c]?.score ?? 0) / max) * 100)];
    }));
    const media = Math.round(criterios.reduce((t, c) => t + notas[c], 0) / criterios.length);
    return { filme: f, notas, media };
  });
  return {
    candidatos_avaliados: outros.length,
    ranking: resultados.sort((a, b) => b.media - a.media).slice(0, MAX_RESULTADOS),
  };
}

module.exports = { recomendar, CRITERIOS, fichaTexto, MAX_RESULTADOS };
