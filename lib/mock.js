// Modo simulado: devolve respostas no formato do Jev usando sobreposição de palavras.
// Serve só para testar a tela e o fluxo sem chave. Não reflete a qualidade do Jev.
const norm = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const words = s => new Set(norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 2));

function systemOne(state, questions) {
  const answers = {};
  const sw = words(state);
  // Para score, compara o bloco da referência com o do candidato.
  const [refTxt = "", candTxt = ""] = state.split("FILME CANDIDATO");
  const rw = words(refTxt), cw = words(candTxt);
  for (const [k, q] of Object.entries(questions)) {
    if (q.type === "choice") {
      const raw = Object.fromEntries(Object.entries(q.criteria).map(([id, d]) => {
        let hit = 0; words(id.replace(/-/g, " ") + " " + d).forEach(w => sw.has(w) && hit++);
        return [id, Math.exp(hit / 2)];
      }));
      const tot = Object.values(raw).reduce((a, b) => a + b, 0);
      const probabilities = Object.fromEntries(Object.entries(raw).map(([id, v]) => [id, v / tot]));
      const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
      answers[k] = { type: "choice", choice, probabilities, confidence: probabilities[choice] };
    } else if (q.type === "score") {
      let inter = 0; rw.forEach(w => cw.has(w) && inter++);
      const j = inter / Math.max(1, Math.min(rw.size, cw.size));
      const max = q.criteria.length - 1;
      answers[k] = { type: "score", score: Math.min(max, j * max * 2.5), confidence: 0.5 };
    } else {
      const hit = [...words(q.instructions)].some(w => sw.has(w));
      answers[k] = { type: "noul", noul: hit ? 0.8 : 0.2 };
    }
  }
  return { answers, usage: { input_tokens: Math.ceil((state.length + JSON.stringify(questions).length) / 4), output_tokens: 0 } };
}
module.exports = { systemOne };
