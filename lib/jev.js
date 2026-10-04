// Cliente do Jev (TypeSafe SystemOne), com contagem de tokens, custo e tempo.
const KEY = process.env.TYPESAFE_API_KEY;
const MOCK = process.env.JEV_MOCK === "1" || !KEY;
const MODEL = process.env.JEV_MODEL || "jev-latest";
const API = process.env.TYPESAFE_API_URL || "https://api.typesafe.ai/v1/systemone";
// Preço em US$ por milhão de tokens. Confira em console.typesafe.ai e ajuste pelas variáveis.
const PRECO_IN = Number(process.env.JEV_PRECO_INPUT_POR_M ?? 0.042);
const PRECO_OUT = Number(process.env.JEV_PRECO_OUTPUT_POR_M ?? 0);

// Acumula uso de uma operação (uma busca ou uma importação).
function novaMedicao() {
  return { chamadas: 0, input_tokens: 0, output_tokens: 0, inicio: Date.now(),
    fechar() {
      return { chamadas: this.chamadas, input_tokens: this.input_tokens, output_tokens: this.output_tokens,
        custo_usd: (this.input_tokens * PRECO_IN + this.output_tokens * PRECO_OUT) / 1e6,
        tempo_ms: Date.now() - this.inicio, modelo: MOCK ? "simulado" : MODEL, ia_tokens: this.ia_tokens || 0 };
    } };
}

async function systemOne(state, questions, med) {
  const resp = MOCK ? require("./mock").systemOne(state, questions) : await chamar(state, questions);
  if (med) {
    med.chamadas++;
    med.input_tokens += resp.usage?.input_tokens ?? Math.ceil((state.length + JSON.stringify(questions).length) / 4);
    med.output_tokens += resp.usage?.output_tokens ?? 0;
  }
  return resp.answers ?? resp.choices ?? resp;
}

async function chamar(state, questions) {
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, state, questions }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Jev respondeu ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

// Executa tarefas com no máximo `n` em paralelo.
async function emParalelo(itens, n, fn) {
  const out = new Array(itens.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; out[k] = await fn(itens[k], k); }
  }));
  return out;
}

module.exports = { systemOne, novaMedicao, emParalelo, MOCK, MODEL };
