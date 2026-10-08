// Gemini (opcional): lê o pedido em texto livre e devolve o filme mais provável (título e ano).
// Só identifica o filme. Os critérios e todas as comparações continuam com o Jev.
const KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
// Se o modelo principal estiver sobrecarregado (429/5xx), tenta os seguintes.
const RESERVAS = ["gemini-flash-lite-latest", "gemini-2.5-flash"].filter(m => m !== MODEL);

const PROMPT = `Você recebe o pedido de um usuário (em português, inglês ou espanhol) que quer recomendações de filmes parecidos com um filme de referência.
Identifique o filme de referência, mesmo com erro de digitação, título em português ou descrição vaga (ator, ano, enredo).
Responda só com JSON: {"titulo_original": string ou null, "titulo_br": string ou null, "ano": número ou null, "confianca": número de 0 a 1}.
Se não houver filme identificável, use null nos títulos e confianca 0.

Pedido: `;

async function identificarFilme(pedido, med) {
  if (!KEY) return null;
  let ultimoErro;
  for (const modelo of [MODEL, ...RESERVAS]) {
    try { return { modelo, ...(await chamar(modelo, pedido, med)) }; }
    catch (e) { ultimoErro = e; if (!e.temporario) break; }
  }
  throw ultimoErro;
}

async function chamar(modelo, pedido, med) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PROMPT + pedido.slice(0, 1000) }] }],
      // Sem "raciocínio" (thinking): para só identificar o filme não muda a resposta e gasta cerca de 6x menos tokens
      // (testado: 188 → 32 tokens no mesmo pedido). Os modelos "lite" já não raciocinam e recusam o parâmetro.
      generationConfig: { responseMimeType: "application/json", temperature: 0, ...(modelo.includes("lite") ? {} : { thinkingConfig: { thinkingBudget: 0 } }) },
    }),
  });
  const body = await r.text();
  if (med) med.ia_chamadas = (med.ia_chamadas || 0) + 1;
  if (!r.ok) {
    if (med) med.ia_falhas = (med.ia_falhas || 0) + 1;
    const e = new Error(`Gemini (${modelo}) respondeu ${r.status}: ${body.slice(0, 200)}`);
    e.temporario = r.status === 429 || r.status >= 500;
    throw e;
  }
  const j = JSON.parse(body);
  const u = j.usageMetadata || {};
  if (med) {
    med.ia_tokens = (med.ia_tokens || 0) + (u.totalTokenCount || 0);
    med.ia_in = (med.ia_in || 0) + (u.promptTokenCount || 0);
    // Os tokens de "raciocínio" do modelo são cobrados como saída.
    med.ia_out = (med.ia_out || 0) + (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
  }
  const txt = j.candidates?.[0]?.content?.parts?.map(p => p.text).join("") || "{}";
  try { return JSON.parse(txt.replace(/^```(?:json)?|```$/g, "").trim()); } catch { return {}; }
}

module.exports = { identificarFilme, ATIVO: !!KEY, MODEL };
