// Servidor do Jev Recomendador: serve a página e chama o Jev (TypeSafe SystemOne).
// A chave fica só aqui no servidor, nunca vai para o navegador.
// Uso:  TYPESAFE_API_KEY=sua-chave node server.js     (modo real)
//       JEV_MOCK=1 node server.js                     (modo simulado, sem chave)
// Se existir um arquivo .env na pasta, ele é lido antes de tudo (os módulos leem as variáveis ao carregar).
try { process.loadEnvFile(require("path").join(__dirname, ".env")); } catch {}
const http = require("http");
const fs = require("fs");
const path = require("path");
const store = require("./lib/store");
const { systemOne, novaMedicao, MOCK, MODEL } = require("./lib/jev");
const { recomendar, CRITERIOS, MAX_RESULTADOS } = require("./lib/recomendar");
const { importar, importarPorImdb, buscarCandidatos, buscarImdb, ondeAssistir } = require("./lib/importar");
const gemini = require("./lib/gemini");
const cota = require("./lib/cota");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || undefined; // em produção, 127.0.0.1 para só o proxy enxergar

class ErroUsuario extends Error {}

// Total gasto desde que o servidor subiu, para conferir com o saldo da TypeSafe.
const TOTAL = { buscas: 0, chamadas: 0, input_tokens: 0, output_tokens: 0, custo_usd: 0, desde: new Date().toISOString() };
function somar(uso) {
  TOTAL.buscas++; TOTAL.chamadas += uso.chamadas; TOTAL.input_tokens += uso.input_tokens;
  TOTAL.output_tokens += uso.output_tokens; TOTAL.custo_usd += uso.custo_usd;
  return { ...TOTAL };
}

const PERGUNTA_CRITERIO = {
  estilo: "O usuário quer sugestões com ESTILO parecido (gênero, ambientação, tom)?",
  atores: "O usuário quer sugestões com os mesmos ATORES ou o mesmo diretor?",
  ano: "O usuário quer sugestões lançadas em ANO ou época próxima?",
  enredo: "O usuário quer sugestões com ENREDO ou história parecida?",
};

// Critérios pedidos no texto: um noul do Jev por critério, pois podem ser vários.
async function criteriosDoTexto(pedido, med) {
  const questions = Object.fromEntries(Object.entries(PERGUNTA_CRITERIO).map(([k, p]) => [`quer_${k}`, { type: "noul", instructions: p }]));
  const ans = await systemOne(pedido, questions, med);
  return {
    criterios: Object.keys(CRITERIOS).filter(k => (ans[`quer_${k}`]?.noul ?? 0) >= 0.5),
    probabilidades_criterios: Object.fromEntries(Object.keys(CRITERIOS).map(k => [k, ans[`quer_${k}`]?.noul ?? null])),
  };
}

// Com Gemini: a IA traduz o texto no filme mais provável (aceita erro de digitação e filme fora do catálogo),
// o filme é localizado no IMDb e catalogado se for novo. Os critérios continuam com o Jev.
async function entenderComIA(pedido, med) {
  const g = await gemini.identificarFilme(pedido, med);
  const titulo = g?.titulo_original || g?.titulo_br;
  if (!titulo || (g.confianca ?? 1) < 0.3) return null;
  const achados = await buscarImdb(`${titulo} ${g.ano || ""}`.trim());
  const s = achados.find(x => !g.ano || Math.abs((x.ano || 0) - g.ano) <= 1) || achados[0];
  if (!s) return null;
  const antes = store.todos().length;
  const ref = store.todos().find(f => f.imdb === s.imdb) || await importarPorImdb(s.imdb, med);
  if (!ref) return null;
  return { ref, importado: store.todos().length > antes, ia: g, ...(await criteriosDoTexto(pedido, med)) };
}

// Passo 1 do texto livre: só identifica o filme e os critérios, para o usuário confirmar antes da busca.
// Não compara nada e não gasta a consulta grátis. "rejeitados" são os filmes que o usuário já disse que não eram.
const resumoCandidato = c => ({ id: c.id || null, imdb: c.imdb || null, titulo: c.titulo_br || c.titulo, titulo_original: c.titulo_original || c.titulo,
  ano: c.ano || null, atores: (c.elenco || c.atores || []).slice(0, 2), poster: c.poster || null, no_catalogo: !!c.id });
async function identificar({ pedido = "", rejeitados = [] }, med) {
  if (pedido.trim().length < 3) throw new ErroUsuario("Escreva o que você procura.");
  const fora = new Set(rejeitados.map(r => r.imdb || r.id).filter(Boolean));
  const nomes = rejeitados.map(r => `${r.titulo}${r.ano ? ` (${r.ano})` : ""}`).join("; ");
  let candidatos = [], ia = null;
  if (gemini.ATIVO) {
    try {
      const g = await gemini.identificarFilme(nomes ? `${pedido}
(O usuário já disse que NÃO é nenhum destes: ${nomes}.)` : pedido, med);
      const titulo = g?.titulo_original || g?.titulo_br;
      if (titulo && (g.confianca ?? 1) >= 0.3) {
        ia = g;
        const achados = (await buscarImdb(`${titulo} ${g.ano || ""}`.trim())).filter(x => !fora.has(x.imdb));
        const melhor = achados.find(x => !g.ano || Math.abs((x.ano || 0) - g.ano) <= 1) || achados[0];
        candidatos = [melhor, ...achados.filter(x => x !== melhor)].filter(Boolean)
          .map(s => resumoCandidato(store.todos().find(f => f.imdb === s.imdb) || s));
      }
    } catch (e) { console.error("Gemini falhou, usando o Jev no catálogo:", e.message); }
  }
  if (!candidatos.length) {
    const e = await entenderPedido(pedido, med);
    const f = store.porId(e.filme?.choice);
    if (f && !fora.has(f.imdb || f.id)) candidatos = [resumoCandidato(f)];
  }
  const crit = await criteriosDoTexto(pedido, med);
  return {
    candidato: candidatos[0] || null, alternativas: candidatos.slice(1, 4), ia,
    criterios: crit.criterios.length ? crit.criterios : ["estilo"], probabilidades_criterios: crit.probabilidades_criterios,
  };
}

// Sem Gemini: o Jev escolhe o filme entre os do catálogo (choice) e os critérios (noul).
async function entenderPedido(pedido, med) {
  const filmes = Object.fromEntries(store.todos().map(f => [f.id, `${f.titulo_br} / ${f.titulo_original} (${f.ano}), com ${f.elenco.slice(0, 2).join(" e ")}`]));
  filmes.__outro__ = "Um filme que não está nesta lista";
  const questions = {
    filme: { type: "choice", instructions: "Qual filme o usuário usa como referência?", criteria: filmes },
    ...Object.fromEntries(Object.entries(PERGUNTA_CRITERIO).map(([k, p]) => [`quer_${k}`, { type: "noul", instructions: p }])),
  };
  const ans = await systemOne(pedido, questions, med);
  return {
    filme: ans.filme,
    criterios: Object.keys(CRITERIOS).filter(k => (ans[`quer_${k}`]?.noul ?? 0) >= 0.5),
    probabilidades_criterios: Object.fromEntries(Object.keys(CRITERIOS).map(k => [k, ans[`quer_${k}`]?.noul ?? null])),
  };
}

async function handleRecomendar(body, med) {
  const { pedido = "", filme = "", imdb = "", criterios = [], foco = [] } = body;
  let ref = null, importado = false, entendido = null;

  if (imdb) {
    ref = store.todos().find(f => f.imdb === imdb);
    if (!ref) {
      const antes = store.todos().length;
      ref = await importarPorImdb(imdb, med);
      if (!ref) throw new ErroUsuario("Achei o filme no IMDb, mas as fontes não trazem sinopse nem gênero para comparar. Tente outro título.");
      importado = store.todos().length > antes;
    }
  } else if (filme.trim()) {
    ref = store.porId(filme) || store.porTitulo(filme);
    if (!ref) {
      ref = await importar(filme, med);
      if (!ref) throw new ErroUsuario(`Não encontrei o filme "${filme}" no IMDb nem na Wikipedia. Confira o título.`);
      importado = true;
    }
  }
  // Com Gemini, a IA identifica o filme. Se ela falhar (fora do ar, sobrecarregada), cai no Jev escolhendo no catálogo.
  let falhaIA = null;
  if (!ref && pedido.trim() && gemini.ATIVO) {
    try {
      const r = await entenderComIA(pedido, med);
      if (!r) throw new ErroUsuario("Não consegui identificar o filme no seu texto. Tente citar o título, o ano ou um ator.");
      ({ ref, importado } = r);
      entendido = { filme: { choice: r.ref.id }, ia: r.ia, criterios: r.criterios, probabilidades_criterios: r.probabilidades_criterios };
    } catch (e) {
      if (e instanceof ErroUsuario) throw e;
      console.error("Gemini falhou, usando o Jev no catálogo:", e.message);
      falhaIA = e.message;
    }
  }
  if (!ref && !filme.trim() && !imdb && pedido.trim()) {
    entendido = await entenderPedido(pedido, med);
    if (entendido.filme?.choice === "__outro__")
      throw new ErroUsuario("O filme do pedido ainda não está no catálogo. Use a aba Escolher filme para procurar e catalogar.");
    ref = store.porId(entendido.filme?.choice);
    if (falhaIA) entendido.falha_ia = falhaIA;
  }
  if (!ref) throw new ErroUsuario("Informe o filme de referência ou escreva um pedido.");

  let crits = criterios.filter(c => CRITERIOS[c]);
  if (!crits.length) crits = entendido?.criterios?.length ? entendido.criterios : ["estilo"];

  const r = await recomendar(ref, crits, foco, med);
  return {
    referencia: ref, importado, entendido, criterios: crits,
    candidatos_avaliados: r.candidatos_avaliados,
    ranking: r.ranking.map(({ filme: f, notas, media }) => ({
      id: f.id, titulo_br: f.titulo_br, titulo_original: f.titulo_original, ano: f.ano, diretor: f.diretor,
      elenco: f.elenco, estilo: f.estilo, sinopse: f.sinopse, fonte: f.fonte, fontes: f.fontes || null,
      poster: f.poster || null, imdb: f.imdb || null, nota_imdb: f.nota_imdb ?? null, nota_tmdb: f.nota_tmdb ?? null, notas, media,
    })),
  };
}

// Custo, tokens e total gasto aparecem na tela só se JEV_MOSTRAR_USO não for "0" (em produção, pode esconder do público).
const MOSTRAR_USO = process.env.JEV_MOSTRAR_USO !== "0";
function send(res, code, data, type = "application/json; charset=utf-8", extra = {}) {
  if (!MOSTRAR_USO && data && typeof data === "object" && !Buffer.isBuffer(data)) { const { uso, uso_total, ...resto } = data; data = resto; }
  res.writeHead(code, { "Content-Type": type, ...extra });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html"))
      return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html")), "text/html; charset=utf-8");
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/api/buscar-filme") {
      // Só procura candidatos (IMDb + catálogo). Não chama o Jev e não gasta a consulta grátis.
      const q = (url.searchParams.get("q") || "").trim();
      return send(res, 200, { resultados: q.length < 2 ? [] : await buscarCandidatos(q) });
    }
    if (req.method === "GET" && url.pathname === "/api/onde-assistir") {
      // Plataformas no Brasil para os filmes do resultado. Usa o que já está na ficha; só busca no TMDB o que venceu.
      const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 20);
      const pares = await Promise.all(ids.map(async id => {
        const f = store.porId(id);
        return [id, f ? await ondeAssistir(f).catch(() => null) : null];
      }));
      return send(res, 200, Object.fromEntries(pares));
    }
    if (req.method === "GET" && req.url === "/api/catalogo")
      return send(res, 200, {
        modo: MOCK ? "simulado" : "jev", modelo: MODEL, max_resultados: MAX_RESULTADOS, cota_anonima: cota.ATIVA, uso_total: TOTAL, mostrar_uso: MOSTRAR_USO, ia_texto: gemini.ATIVO,
        criterios: Object.fromEntries(Object.entries(CRITERIOS).map(([k, c]) => [k, c.nome])),
        filmes: store.todos().map(({ id, titulo_br, titulo_original, ano, estilo }) => ({ id, titulo_br, titulo_original, ano, estilo })),
      });
    if (req.method === "POST" && req.url === "/api/identificar") {
      let raw = ""; for await (const c of req) raw += c;
      const med = novaMedicao();
      try {
        const r = await identificar(JSON.parse(raw || "{}"), med);
        const uso = med.fechar();
        return send(res, 200, { ...r, uso, uso_total: somar(uso) });
      } catch (e) {
        if (!(e instanceof ErroUsuario)) console.error(e);
        const uso = med.fechar();
        return send(res, e instanceof ErroUsuario ? 400 : 502, { erro: e.message, uso, uso_total: somar(uso) });
      }
    }
    if (req.method === "POST" && req.url === "/api/recomendar") {
      let raw = ""; for await (const c of req) raw += c;
      const { sinais, novoCookie } = cota.identificar(req);
      const cookie = novoCookie ? { "Set-Cookie": novoCookie } : {};
      const motivo = cota.motivoBloqueio(sinais);
      if (motivo)
        return send(res, 402, { erro: "Você já usou sua consulta grátis.", precisa_cadastro: true, motivo }, undefined, cookie);
      const med = novaMedicao();
      try {
        const resultado = await handleRecomendar(JSON.parse(raw || "{}"), med);
        cota.registrarUso(sinais); // só conta a consulta que deu resultado
        const uso = med.fechar();
        return send(res, 200, { ...resultado, uso, uso_total: somar(uso) }, undefined, cookie);
      } catch (e) {
        // Mesmo com erro a busca pode ter gastado tokens (por exemplo, numa importação), então o uso volta junto.
        if (!(e instanceof ErroUsuario)) console.error(e);
        const uso = med.fechar();
        return send(res, e instanceof ErroUsuario ? 400 : 502, { erro: e.message, uso, uso_total: somar(uso) }, undefined, cookie);
      }
    }
    send(res, 404, { erro: "Não encontrado" });
  } catch (e) {
    if (!(e instanceof ErroUsuario)) console.error(e);
    send(res, e instanceof ErroUsuario ? 400 : 502, { erro: e.message });
  }
}).listen(PORT, HOST, () => console.log(`Jev Recomendador em http://localhost:${PORT}  (modo ${MOCK ? "simulado, sem chave" : MODEL})`));
