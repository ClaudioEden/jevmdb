// Servidor do JevMDB: serve a página e chama o Jev (TypeSafe SystemOne).
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
const { importar, importarPorImdb, catalogar, buscarCandidatos, buscarImdb, ondeAssistir, importarVizinhos, importarPedido } = require("./lib/importar");
const gemini = require("./lib/gemini");
const cota = require("./lib/cota");
const buscas = require("./lib/buscas");
const metricas = require("./lib/metricas");
const os = require("os");
const crypto = require("crypto");
const { IDIOMAS, idiomaDe, localizar } = require("./lib/i18n");

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || undefined; // em produção, 127.0.0.1 para só o proxy enxergar

// Erro de uso (400). O "codigo" deixa a tela mostrar a mensagem no idioma escolhido; a frase em português é a reserva.
class ErroUsuario extends Error { constructor(msg, codigo) { super(msg); this.codigo = codigo; } }

// Ficha como vai para a tela, com título, sinopse, gêneros e tags no idioma pedido.
function fichaPublica(f, lang) {
  const l = localizar(f, lang);
  return {
    id: f.id, titulo_br: l.titulo, titulo: l.titulo, titulo_original: f.titulo_original, ano: f.ano, diretor: f.diretor,
    elenco: f.elenco, estilo: l.estilo, generos: l.generos, sinopse: l.sinopse, fonte: f.fonte, fontes: f.fontes || null,
    poster: f.poster || null, imdb: f.imdb || null, nota_imdb: f.nota_imdb ?? null, nota_tmdb: f.nota_tmdb ?? null,
  };
}

// Abaixo disto, a busca primeiro amplia o catálogo com os vizinhos da referência (JEV_MIN_CATALOGO, padrão 40).
const MIN_CATALOGO = Number(process.env.JEV_MIN_CATALOGO || 40);
const DADOS = process.env.JEV_DADOS || path.join(__dirname, "data");
const PEDIDOS = path.join(DADOS, "pedidos-filmes.jsonl");
// WhatsApp para pedir mais buscas (só dígitos, com DDI). Sem ele, a tela não mostra o botão.
const WHATSAPP = String(process.env.JEV_WHATSAPP || "").replace(/\D/g, "");
const ADMIN_SENHA = process.env.JEV_ADMIN_SENHA || "";

// Tarefa em segundo plano (vizinhos do TMDB, "sentiu falta"): o gasto também entra nas métricas do dia.
function emSegundoPlano(rotulo, fn) {
  const med = novaMedicao();
  return fn(med).catch(e => console.error(`${rotulo}:`, e.message)).finally(() => metricas.registrar("fundo", med.fechar()));
}

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
const resumoCandidato = (c, lang = "pt") => ({ id: c.id || null, imdb: c.imdb || null,
  titulo: c.id ? localizar(c, lang).titulo : c.titulo_br || c.titulo, titulo_original: c.titulo_original || c.titulo,
  ano: c.ano || null, atores: (c.elenco || c.atores || []).slice(0, 2), poster: c.poster || null, no_catalogo: !!c.id });
async function identificar({ pedido = "", rejeitados = [] }, med, lang = "pt") {
  if (pedido.trim().length < 3) throw new ErroUsuario("Escreva o que você procura.", "pedido_vazio");
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
          .map(s => resumoCandidato(store.todos().find(f => f.imdb === s.imdb) || s, lang));
      }
    } catch (e) { console.error("Gemini falhou, usando o Jev no catálogo:", e.message); }
  }
  if (!candidatos.length) {
    const e = await entenderPedido(pedido, med);
    const f = store.porId(e.filme?.choice);
    if (f && !fora.has(f.imdb || f.id)) candidatos = [resumoCandidato(f, lang)];
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

async function handleRecomendar(body, med, lang = "pt") {
  const { pedido = "", filme = "", imdb = "", criterios = [], foco = [] } = body;
  let ref = null, importado = false, entendido = null;

  if (imdb) {
    ref = store.todos().find(f => f.imdb === imdb);
    if (!ref) {
      const antes = store.todos().length;
      ref = await importarPorImdb(imdb, med);
      if (!ref) throw new ErroUsuario("Achei o filme no IMDb, mas as fontes não trazem sinopse nem gênero para comparar. Tente outro título.", "sem_dados");
      importado = store.todos().length > antes;
    }
  } else if (filme.trim()) {
    ref = store.porId(filme) || store.porTitulo(filme);
    if (!ref) {
      ref = await importar(filme, med);
      if (!ref) throw new ErroUsuario(`Não encontrei o filme "${filme}" no IMDb nem na Wikipedia. Confira o título.`, "filme_nao_encontrado");
      importado = true;
    }
  }
  // Com Gemini, a IA identifica o filme. Se ela falhar (fora do ar, sobrecarregada), cai no Jev escolhendo no catálogo.
  let falhaIA = null;
  if (!ref && pedido.trim() && gemini.ATIVO) {
    try {
      const r = await entenderComIA(pedido, med);
      if (!r) throw new ErroUsuario("Não consegui identificar o filme no seu texto. Tente citar o título, o ano ou um ator.", "nao_identificado");
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
      throw new ErroUsuario("O filme do pedido ainda não está no catálogo. Use a aba Escolher filme para procurar e catalogar.", "fora_catalogo");
    ref = store.porId(entendido.filme?.choice);
    if (falhaIA) entendido.falha_ia = falhaIA;
  }
  if (!ref) throw new ErroUsuario("Informe o filme de referência ou escreva um pedido.", "sem_referencia");

  let crits = criterios.filter(c => CRITERIOS[c]);
  if (!crits.length) crits = entendido?.criterios?.length ? entendido.criterios : ["estilo"];

  // Catálogo pequeno: antes de comparar, traz na hora os filmes que o TMDB considera vizinhos da referência.
  let ampliado = 0;
  if (store.todos().length - 1 < MIN_CATALOGO) ampliado = await importarVizinhos(ref, med, 15).catch(() => 0);
  const r = await recomendar(ref, crits, foco, med);
  // Em segundo plano, o catálogo continua crescendo com os vizinhos (para as próximas buscas).
  emSegundoPlano("Vizinhos", m => importarVizinhos(ref, m, 20));
  return {
    referencia: fichaPublica(ref, lang), importado, entendido, criterios: crits, ampliado,
    candidatos_avaliados: r.candidatos_avaliados,
    ranking: r.ranking.map(({ filme: f, notas, media }) => ({ ...fichaPublica(f, lang), notas, media })),
  };
}

// Custo, tokens e total gasto aparecem na tela só se JEV_MOSTRAR_USO não for "0" (em produção, pode esconder do público).
const MOSTRAR_USO = process.env.JEV_MOSTRAR_USO !== "0";
function send(res, code, data, type = "application/json; charset=utf-8", extra = {}) {
  if (!MOSTRAR_USO && data && typeof data === "object" && !Buffer.isBuffer(data)) { const { uso, uso_total, ...resto } = data; data = resto; }
  res.writeHead(code, { "Content-Type": type, ...extra });
  res.end(type.startsWith("application/json") ? JSON.stringify(data) : data);
}

// Antes de gastar com o Jev ou o Gemini: teto diário e pausa manual (console), depois a cota do visitante.
// Devolve [status, corpo] da recusa, ou null se pode seguir. Não conta a busca; isso só acontece quando ela dá resultado.
function recusa(sinais) {
  const g = metricas.bloqueioGasto();
  if (g) { metricas.registrar("pausada", null, sinais.codigo); return [503, { erro: "Pausado por alto volume. Tente amanhã.", codigo: "pausado", motivo: g }]; }
  const motivo = cota.motivoBloqueio(sinais);
  if (motivo) {
    metricas.registrar("bloqueio", null, sinais.codigo, { motivo });
    return [402, { erro: "Suas buscas grátis acabaram.", codigo: "cota", motivo, cota: cota.saldo(sinais), whatsapp: WHATSAPP || null }];
  }
  return null;
}

// Console: senha no cabeçalho X-Admin-Senha, comparada em tempo constante; erros demais por IP bloqueiam por 15 min.
const FALHAS_ADMIN = new Map();
function adminOk(req) {
  if (!ADMIN_SENHA) return [404, { erro: "Console desligado. Defina JEV_ADMIN_SENHA." }];
  const ip = req.socket.remoteAddress + "|" + (req.headers["x-forwarded-for"] || "");
  const recentes = (FALHAS_ADMIN.get(ip) || []).filter(t => Date.now() - t < 15 * 60e3);
  if (recentes.length >= 10) return [429, { erro: "Tentativas demais. Espere 15 minutos." }];
  const h = s => crypto.createHash("sha256").update(String(s)).digest();
  if (crypto.timingSafeEqual(h(req.headers["x-admin-senha"] || ""), h(ADMIN_SENHA))) return null;
  FALHAS_ADMIN.set(ip, [...recentes, Date.now()]);
  return [401, { erro: "Senha incorreta." }];
}

// Últimas linhas de um arquivo .jsonl (avaliações, pedidos de filme).
function ultimas(arq, n = 20) {
  try { return fs.readFileSync(arq, "utf8").trim().split("\n").slice(-n).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}

// Situação da máquina. Dentro do Docker, memória e carga são as da VPS inteira; "processo" é só o JevMDB.
function servidor() {
  let disco = null;
  try { const st = fs.statfsSync(DADOS); disco = { total: st.blocks * st.bsize, livre: st.bavail * st.bsize }; } catch {}
  let dados_bytes = 0;
  try { for (const f of fs.readdirSync(DADOS)) { const st = fs.statSync(path.join(DADOS, f)); if (st.isFile()) dados_bytes += st.size; } } catch {}
  return {
    carga: os.loadavg(), cpus: os.cpus().length, memoria: { total: os.totalmem(), livre: os.freemem() },
    processo: { rss: process.memoryUsage().rss, uptime_s: Math.round(process.uptime()), node: process.version },
    maquina_uptime_s: Math.round(os.uptime()), disco, dados_bytes, filmes: store.todos().length,
  };
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html"))
      return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "index.html")), "text/html; charset=utf-8");
    if (req.method === "GET" && url.pathname === "/admin")
      return send(res, 200, fs.readFileSync(path.join(__dirname, "public", "admin.html")), "text/html; charset=utf-8",
        { "X-Robots-Tag": "noindex", "Cache-Control": "no-store" });
    if (url.pathname.startsWith("/api/admin/")) {
      const negado = adminOk(req);
      if (negado) return send(res, ...negado);
      if (req.method === "GET" && url.pathname === "/api/admin/resumo")
        return send(res, 200, { servidor: servidor(), metricas: metricas.resumo(30), cota: cota.resumo(), total_desde_reinicio: TOTAL,
          avaliacoes: ultimas(buscas.REGISTRO), pedidos: ultimas(PEDIDOS), gemini: gemini.ATIVO ? gemini.MODEL : null, modo: MOCK ? "simulado" : MODEL });
      let raw = ""; for await (const c of req) raw += c;
      const b = JSON.parse(raw || "{}");
      if (req.method === "POST" && url.pathname === "/api/admin/liberar") {
        const r = cota.liberar(b.codigo, b.n);
        return r ? send(res, 200, r) : send(res, 400, { erro: "Código inválido. São 6 letras ou números." });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/pausar")
        return send(res, 200, { pausado: metricas.pausar(b.pausado) });
      return send(res, 404, { erro: "Não encontrado" });
    }
    if (req.method === "GET" && url.pathname === "/api/cota") {
      // Quantas buscas grátis o visitante ainda tem, e o código dele para pedir mais pelo WhatsApp.
      const { sinais, novoCookie } = cota.identificar(req);
      return send(res, 200, { ...cota.saldo(sinais), whatsapp: WHATSAPP || null, pausado: !!metricas.bloqueioGasto() }, undefined,
        novoCookie ? { "Set-Cookie": novoCookie } : {});
    }
    if (req.method === "GET" && url.pathname === "/api/buscar-filme") {
      // Só procura candidatos (IMDb + catálogo). Não chama o Jev e não gasta a consulta grátis.
      const q = (url.searchParams.get("q") || "").trim(), lang = idiomaDe(req, url);
      const resultados = q.length < 2 ? [] : await buscarCandidatos(q, IDIOMAS[lang].tmdb);
      for (const r of resultados) if (r.id) { const f = store.porId(r.id); if (f) r.titulo = localizar(f, lang).titulo; }
      return send(res, 200, { resultados });
    }
    if (req.method === "GET" && url.pathname === "/api/onde-assistir") {
      // Plataformas do país do idioma (pt: Brasil, en: EUA, es: México). Usa o que já está na ficha; só busca no TMDB o que venceu.
      const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean).slice(0, 20);
      const regiao = IDIOMAS[idiomaDe(req, url)].regiao;
      const pares = await Promise.all(ids.map(async id => {
        const f = store.porId(id);
        return [id, f ? await ondeAssistir(f, regiao).catch(() => null) : null];
      }));
      return send(res, 200, Object.fromEntries(pares));
    }
    if (req.method === "GET" && url.pathname === "/api/catalogo")
      return send(res, 200, {
        modo: MOCK ? "simulado" : "jev", modelo: MODEL, max_resultados: MAX_RESULTADOS, cota_anonima: cota.ATIVA, cota_gratis: cota.GRATIS, whatsapp: WHATSAPP || null, uso_total: TOTAL, mostrar_uso: MOSTRAR_USO, ia_texto: gemini.ATIVO,
        criterios: Object.fromEntries(Object.entries(CRITERIOS).map(([k, c]) => [k, c.nome])),
        filmes: store.todos().map(f => ({ id: f.id, titulo_br: f.titulo_br, titulo_original: f.titulo_original, ano: f.ano,
          estilo: f.estilo, estilo_tr: localizar(f, idiomaDe(req, url)).estilo })),
      });
    if (req.method === "POST" && url.pathname === "/api/identificar") {
      // Identificar não conta como busca, mas usa o Gemini, então quem já está sem buscas (ou com o site pausado) para aqui.
      let raw = ""; for await (const c of req) raw += c;
      const { sinais, novoCookie } = cota.identificar(req);
      const cookie = novoCookie ? { "Set-Cookie": novoCookie } : {};
      const r0 = recusa(sinais);
      if (r0) return send(res, r0[0], r0[1], undefined, cookie);
      const med = novaMedicao();
      try {
        const r = await identificar(JSON.parse(raw || "{}"), med, idiomaDe(req, url));
        const uso = med.fechar();
        metricas.registrar("identificacao", uso, sinais.codigo);
        return send(res, 200, { ...r, uso, uso_total: somar(uso) }, undefined, cookie);
      } catch (e) {
        if (!(e instanceof ErroUsuario)) console.error(e);
        const uso = med.fechar();
        metricas.registrar(e instanceof ErroUsuario ? "identificacao" : "erro", uso, sinais.codigo, e instanceof ErroUsuario ? null : { erro: e.message.slice(0, 200) });
        return send(res, e instanceof ErroUsuario ? 400 : 502, { erro: e.message, codigo: e.codigo || "erro", uso, uso_total: somar(uso) }, undefined, cookie);
      }
    }
    if (req.method === "POST" && url.pathname === "/api/catalogar") {
      // Filme escolhido na lista que ainda não está no catálogo: baixa a ficha agora (IMDb, Wikidata, Wikipedia, TMDB, OMDb).
      let raw = ""; for await (const c of req) raw += c;
      const { sinais } = cota.identificar(req);
      const r0 = recusa(sinais);
      if (r0) return send(res, ...r0);
      const med = novaMedicao(), lang = idiomaDe(req, url);
      try {
        const antes = store.todos().length;
        const f = await catalogar(JSON.parse(raw || "{}"), med);
        const uso = med.fechar();
        metricas.registrar("catalogacao", uso, sinais.codigo);
        if (!f) return send(res, 400, { erro: "Sem dados suficientes", codigo: "sem_dados", uso, uso_total: somar(uso) });
        emSegundoPlano("Vizinhos", m => importarVizinhos(f, m, 20));
        return send(res, 200, { filme: { ...fichaPublica(f, lang), estilo_pt: f.estilo }, importado: store.todos().length > antes, uso, uso_total: somar(uso) });
      } catch (e) {
        console.error(e);
        const uso = med.fechar();
        metricas.registrar("erro", uso, sinais.codigo, { erro: e.message.slice(0, 200) });
        return send(res, 502, { erro: e.message, codigo: "erro", uso, uso_total: somar(uso) });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/sentiu-falta") {
      // "Senti falta deste filme": grava o pedido e tenta catalogar em segundo plano.
      let raw = ""; for await (const c of req) raw += c;
      const { texto = "", busca_id = null } = JSON.parse(raw || "{}");
      const t = String(texto).trim().slice(0, 120);
      if (t.length < 2) return send(res, 400, { erro: "Pedido vazio", codigo: "pedido_vazio" });
      const registrar = extra => { try { fs.appendFileSync(PEDIDOS, JSON.stringify({ em: new Date().toISOString(), texto: t, busca_id, idioma: idiomaDe(req, url), ...extra }) + "\n"); } catch (e) { console.error(e.message); } };
      registrar({ status: "recebido" });
      emSegundoPlano("Sentiu falta", m => importarPedido(t, m).then(f => registrar({ status: f ? "catalogado" : "nao_encontrado", id: f?.id || null }))
        .catch(e => registrar({ status: "erro", erro: e.message })));
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/api/avaliar") {
      // Nota de 1 a 10 estrelas (e comentário opcional) para uma busca feita.
      let raw = ""; for await (const c of req) raw += c;
      const { busca_id, estrelas, comentario } = JSON.parse(raw || "{}");
      const r = buscas.avaliar(busca_id, { estrelas, comentario });
      if (r) metricas.registrar("avaliacao", null, null, { estrelas: Number(estrelas) || null });
      return r ? send(res, 200, { ok: true, ...r }) : send(res, 400, { erro: "Avaliação inválida", codigo: "avaliacao_invalida" });
    }
    if (req.method === "POST" && url.pathname === "/api/recomendar") {
      let raw = ""; for await (const c of req) raw += c;
      const { sinais, novoCookie } = cota.identificar(req);
      const cookie = novoCookie ? { "Set-Cookie": novoCookie } : {};
      const r0 = recusa(sinais);
      if (r0) return send(res, r0[0], r0[1], undefined, cookie);
      const med = novaMedicao();
      try {
        const pedidoBody = JSON.parse(raw || "{}"), lang = idiomaDe(req, url);
        const resultado = await handleRecomendar(pedidoBody, med, lang);
        const saldo = cota.registrarUso(sinais); // só conta a busca que deu resultado
        const uso = med.fechar();
        metricas.registrar("busca", uso, sinais.codigo, { ref: resultado.referencia.titulo, ano: resultado.referencia.ano, criterios: resultado.criterios });
        // Guarda o resultado exibido (sem dados do visitante) por 60 dias, para a avaliação e para análise depois.
        const busca_id = buscas.salvar({ idioma: lang, pedido: pedidoBody, referencia: resultado.referencia, criterios: resultado.criterios,
          candidatos_avaliados: resultado.candidatos_avaliados, ranking: resultado.ranking, entendido: resultado.entendido, uso });
        return send(res, 200, { ...resultado, busca_id, cota: saldo, uso, uso_total: somar(uso) }, undefined, cookie);
      } catch (e) {
        // Mesmo com erro a busca pode ter gastado tokens (por exemplo, numa importação), então o uso volta junto.
        if (!(e instanceof ErroUsuario)) console.error(e);
        const uso = med.fechar();
        metricas.registrar(e instanceof ErroUsuario ? "identificacao" : "erro", uso, sinais.codigo, e instanceof ErroUsuario ? null : { erro: e.message.slice(0, 200) });
        return send(res, e instanceof ErroUsuario ? 400 : 502, { erro: e.message, codigo: e.codigo || "erro", uso, uso_total: somar(uso) }, undefined, cookie);
      }
    }
    send(res, 404, { erro: "Não encontrado" });
  } catch (e) {
    if (!(e instanceof ErroUsuario)) console.error(e);
    send(res, e instanceof ErroUsuario ? 400 : 502, { erro: e.message });
  }
}).listen(PORT, HOST, () => console.log(`JevMDB em http://localhost:${PORT}  (modo ${MOCK ? "simulado, sem chave" : MODEL})`));

// Limpeza das buscas vencidas: ao subir e a cada 24 h.
const limparBuscas = () => { const n = buscas.limpar(); if (n) console.log(`${n} buscas vencidas apagadas`); };
limparBuscas();
setInterval(limparBuscas, 24 * 3600 * 1000).unref();
