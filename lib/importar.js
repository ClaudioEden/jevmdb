// Localiza um filme que não está no catálogo e monta a ficha juntando várias fontes:
//   IMDb (busca por título, aceita título em português e grafia aproximada; dá pôster e atores),
//   Wikidata + Wikipedia (dados estruturados e resumo), TMDB e OMDb (opcionais, com chave grátis).
// Depois usa o Jev para marcar estilo e temas.
const { systemOne } = require("./jev");
const store = require("./store");

const UA = { "User-Agent": "JevRecomendador/0.4 (projeto pessoal; poucas consultas)" };
const getJSON = async url => {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`Falha ao consultar ${new URL(url).host} (${r.status})`);
  return r.json();
};

// Vocabulário de estilo: as tags já usadas no catálogo, mais algumas comuns.
function vocabulario() {
  const v = new Set(["ficção científica", "futuro", "distopia", "pós-apocalíptico", "cyberpunk", "ação", "policial", "crime",
    "thriller", "drama", "comédia", "romance", "animação", "família", "aventura", "fantasia", "horror", "suspense",
    "guerra", "histórico", "biografia", "musical", "faroeste", "esporte", "espaço", "viagem no tempo", "sobrevivência",
    "máfia", "prisão", "assalto", "noir", "sátira", "super-herói", "documentário"]);
  store.todos().forEach(f => f.estilo.forEach(t => v.add(t)));
  return [...v];
}

// 1) Acha o artigo do filme na Wikipedia (pt, depois en).
async function acharArtigo(titulo) {
  for (const lang of ["pt", "en"]) {
    const q = encodeURIComponent(`${titulo} filme`);
    const s = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=5&format=json&origin=*`);
    for (const hit of s.query?.search ?? []) {
      const p = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=pageprops|extracts|info&inprop=url&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(hit.title)}&format=json&origin=*`);
      const page = Object.values(p.query?.pages ?? {})[0];
      const qid = page?.pageprops?.wikibase_item;
      if (!qid) continue;
      const ent = (await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)).entities[qid];
      // P31 = instância de; Q11424 = filme
      const tipos = (ent.claims.P31 ?? []).map(c => c.mainsnak.datavalue?.value?.id);
      if (tipos.includes("Q11424") || tipos.includes("Q24869") || tipos.includes("Q202866")) return { lang, page, ent };
    }
  }
  return null;
}

async function rotulos(ids) {
  if (!ids.length) return {};
  const r = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.slice(0, 50).join("|")}&props=labels&languages=pt-br|pt|en|mul&format=json&origin=*`);
  // "mul" é o rótulo padrão que o Wikidata passou a usar para nomes de pessoas (vale para todas as línguas).
  return Object.fromEntries(Object.entries(r.entities).map(([id, e]) => [id, (e.labels["pt-br"] || e.labels.pt || e.labels.en || e.labels.mul)?.value || id]));
}

// Monta a ficha a partir do Wikidata (dados estruturados) e do resumo da Wikipedia.
async function montarFicha({ lang, page, ent }) {
  const ids = p => (ent.claims[p] ?? []).map(c => c.mainsnak.datavalue?.value?.id).filter(Boolean);
  const elencoIds = ids("P161").slice(0, 5), dirIds = ids("P57").slice(0, 2), genIds = ids("P136").slice(0, 5), paisIds = ids("P495").slice(0, 2);
  const L = await rotulos([...elencoIds, ...dirIds, ...genIds, ...paisIds]);
  const data = ent.claims.P577?.[0]?.mainsnak.datavalue?.value?.time || "";
  const ano = Number(data.slice(1, 5)) || null;
  const dur = ent.claims.P2047?.[0]?.mainsnak.datavalue?.value?.amount;
  const tituloPt = (ent.labels["pt-br"] || ent.labels.pt)?.value;
  const tituloOrig = ent.claims.P1476?.[0]?.mainsnak.datavalue?.value?.text || ent.labels.en?.value || page.title;
  const extrato = (page.extract || "").replace(/\s+/g, " ");
  // A Wikipedia em português costuma trazer "(bra: Título no Brasil; prt: ...)" na primeira frase.
  const bra = /\(\s*(?:no\s+)?bra(?:sil)?:\s*([^;)]+?)(?:\s+ou\s+[^;)]+)?\s*[;)]/i.exec(extrato)?.[1]?.trim();
  const limpo = extrato.replace(/\s*\((?:[^()]*\b(?:bra|prt|pt)\s*:[^()]*)\)/gi, "");
  const frases = limpo.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
  return {
    titulo_br: bra || tituloPt || page.title.replace(/ \(.*\)$/, ""),
    titulo_original: tituloOrig,
    ano,
    diretor: dirIds.map(i => L[i]).join(", "),
    elenco: elencoIds.map(i => L[i]),
    generos: genIds.map(i => L[i]),
    duracao_min: dur ? Math.round(Number(dur)) : null,
    pais: paisIds.map(i => L[i]).join(", "),
    sinopse: frases,
    temas: [],
    estilo: [],
    fonte: page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    wikidata: ent.id,
    coletado_em: new Date().toISOString().slice(0, 10),
    origem: "importado",
  };
}

// 2) Jev marca as tags de estilo: uma pergunta "noul" (sim/não) por tag, tudo numa chamada só.
async function marcarEstilo(ficha, med) {
  const vocab = vocabulario();
  const state = `Filme: ${ficha.titulo_br} (${ficha.titulo_original}, ${ficha.ano})\nGêneros: ${ficha.generos.join(", ")}\nResumo: ${ficha.sinopse}`;
  const questions = Object.fromEntries(vocab.map((t, i) => [`t${i}`, { type: "noul", instructions: `Este filme pode ser descrito como "${t}"?` }]));
  const ans = await systemOne(state, questions, med);
  const marcadas = vocab.map((t, i) => [t, ans[`t${i}`]?.noul ?? 0]).filter(([, p]) => p >= 0.5).sort((a, b) => b[1] - a[1]);
  ficha.estilo = marcadas.slice(0, 8).map(([t]) => t);
  ficha.temas = ficha.estilo.slice();
  return ficha;
}

// ---------- Busca em várias fontes ----------

const TMDB_KEY = process.env.TMDB_API_KEY;
const OMDB_KEY = process.env.OMDB_API_KEY;
const TIPOS_FILME = new Set(["movie", "tvMovie"]);
const sugestoes = new Map(); // tt -> sugestão do IMDb, para importar sem buscar de novo

// IMDb: endpoint de sugestões do próprio site (sem chave). Entende "O Poderoso Chefão" e erros leves de digitação.
async function buscarImdb(q) {
  const termo = encodeURIComponent(store.norm(q).slice(0, 60));
  if (!termo) return [];
  const r = await getJSON(`https://v3.sg.media-imdb.com/suggestion/x/${termo}.json`).catch(() => ({ d: [] }));
  return (r.d ?? []).filter(x => TIPOS_FILME.has(x.qid) && /^tt\d+$/.test(x.id)).map(x => {
    const s = { imdb: x.id, titulo: x.l, ano: x.y || null, atores: x.s ? x.s.split(", ") : [], poster: x.i?.imageUrl ? x.i.imageUrl.replace("._V1_.", "._V1_QL75_UX300_.") : null, popularidade: x.rank ?? null };
    sugestoes.set(s.imdb, s);
    return s;
  });
}

// Lista de candidatos para o usuário escolher: primeiro o que já está no catálogo, depois o IMDb.
async function buscarCandidatos(q) {
  const nq = store.norm(q);
  const locais = store.todos().filter(f => store.norm(f.titulo_br).includes(nq) || store.norm(f.titulo_original).includes(nq)).slice(0, 5);
  const imdb = await buscarImdb(q);
  const ids = new Set(locais.map(f => f.imdb).filter(Boolean));
  const doCatalogo = f => ({ id: f.id, imdb: f.imdb || null, titulo: f.titulo_br, titulo_original: f.titulo_original, ano: f.ano, atores: f.elenco.slice(0, 2), poster: f.poster || null, no_catalogo: true });
  return [
    ...locais.map(doCatalogo),
    ...imdb.filter(s => !ids.has(s.imdb)).map(s => {
      const f = store.todos().find(x => x.imdb === s.imdb);
      return f ? doCatalogo(f) : { ...s, titulo_original: s.titulo, no_catalogo: false };
    }),
  ].slice(0, 8);
}

async function sugestaoImdb(tt) {
  if (sugestoes.has(tt)) return sugestoes.get(tt);
  return (await buscarImdb(tt)).find(s => s.imdb === tt) || null;
}

// Wikidata pelo código do IMDb (propriedade P345), com o resumo da Wikipedia em português ou inglês.
async function wikidataPorImdb(tt) {
  const s = await getJSON(`https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P345=${tt}&srlimit=1&format=json&origin=*`);
  const qid = s.query?.search?.[0]?.title;
  if (!qid) return null;
  const ent = (await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)).entities[qid];
  for (const lang of ["pt", "en"]) {
    const t = ent.sitelinks?.[`${lang}wiki`]?.title;
    if (!t) continue;
    const p = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|info&inprop=url&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(t)}&format=json&origin=*`);
    const page = Object.values(p.query?.pages ?? {})[0];
    if (page?.extract) return { lang, page, ent };
  }
  return { lang: "en", page: { title: ent.labels?.en?.value || qid, extract: "", fullurl: `https://www.wikidata.org/wiki/${qid}` }, ent };
}

// TMDB (opcional): título e sinopse em português do Brasil, gêneros, elenco, diretor, pôster e nota.
// Aceita a chave v3 (api_key) ou o token de leitura v4 (começa com "eyJ").
async function tmdbGet(path) {
  const bearer = TMDB_KEY.startsWith("eyJ");
  const url = `https://api.themoviedb.org/3${path}${path.includes("?") ? "&" : "?"}language=pt-BR${bearer ? "" : `&api_key=${TMDB_KEY}`}`;
  const r = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${TMDB_KEY}` } : {} });
  if (!r.ok) throw new Error(`TMDB respondeu ${r.status}`);
  return r.json();
}

async function tmdb(tt) {
  if (!TMDB_KEY) return null;
  const get = tmdbGet;
  const achado = (await get(`/find/${tt}?external_source=imdb_id`)).movie_results?.[0];
  if (!achado) return null;
  const m = await get(`/movie/${achado.id}?append_to_response=credits`);
  return {
    titulo_br: m.title, titulo_original: m.original_title, ano: Number((m.release_date || "").slice(0, 4)) || null,
    sinopse: m.overview || "", generos: (m.genres ?? []).map(g => g.name),
    elenco: (m.credits?.cast ?? []).slice(0, 5).map(c => c.name),
    diretor: (m.credits?.crew ?? []).filter(c => c.job === "Director").map(c => c.name).join(", "),
    duracao_min: m.runtime || null, pais: (m.production_countries ?? []).map(c => c.name).slice(0, 2).join(", "),
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    nota_tmdb: m.vote_average ? Math.round(m.vote_average * 10) / 10 : null,
    url: `https://www.themoviedb.org/movie/${m.id}`, tmdb_id: m.id,
  };
}

// Onde assistir no Brasil, pelo TMDB (os dados vêm do JustWatch). Fica guardado na ficha por 7 dias.
const TIPO_OFERTA = { flatrate: "assinatura", free: "grátis", ads: "grátis com anúncios", rent: "aluguel", buy: "compra" };
const SETE_DIAS = 7 * 24 * 3600 * 1000;
async function ondeAssistir(ficha) {
  if (!TMDB_KEY) return null;
  const o = ficha.onde_assistir;
  if (o && Date.now() - new Date(o.atualizado).getTime() < SETE_DIAS) return o;
  if (!ficha.tmdb_id && ficha.imdb) ficha.tmdb_id = (await tmdbGet(`/find/${ficha.imdb}?external_source=imdb_id`)).movie_results?.[0]?.id || null;
  if (!ficha.tmdb_id) return null;
  const br = (await tmdbGet(`/movie/${ficha.tmdb_id}/watch/providers`)).results?.BR || {};
  const vistos = new Set(), plataformas = [];
  for (const [chave, tipo] of Object.entries(TIPO_OFERTA))
    for (const p of br[chave] ?? []) {
      if (vistos.has(p.provider_name)) continue;
      vistos.add(p.provider_name);
      plataformas.push({ nome: p.provider_name, tipo, logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : null });
    }
  ficha.onde_assistir = { plataformas, link: br.link || null, atualizado: new Date().toISOString() };
  store.salvar(ficha);
  return ficha.onde_assistir;
}

// OMDb (opcional): dados do IMDb, como a nota e a sinopse curta (em inglês).
async function omdb(tt) {
  if (!OMDB_KEY) return null;
  const o = await getJSON(`https://www.omdbapi.com/?i=${tt}&plot=short&apikey=${OMDB_KEY}`);
  if (o.Response !== "True") return null;
  const lista = s => (s && s !== "N/A" ? s.split(", ") : []);
  return {
    titulo_original: o.Title, ano: parseInt(o.Year) || null, sinopse: o.Plot !== "N/A" ? o.Plot : "",
    generos: lista(o.Genre), elenco: lista(o.Actors), diretor: o.Director !== "N/A" ? o.Director : "",
    duracao_min: parseInt(o.Runtime) || null, pais: o.Country !== "N/A" ? o.Country : "",
    poster: o.Poster && o.Poster !== "N/A" ? o.Poster : null, nota_imdb: o.imdbRating !== "N/A" ? Number(o.imdbRating) : null,
  };
}

// Preenche só o que ainda está vazio, na ordem de prioridade das fontes.
function completar(ficha, extra) {
  if (!extra) return;
  for (const [k, v] of Object.entries(extra)) {
    if (k === "url") continue;
    const vazio = ficha[k] == null || ficha[k] === "" || (Array.isArray(ficha[k]) && !ficha[k].length);
    if (vazio && v != null && v !== "" && !(Array.isArray(v) && !v.length)) ficha[k] = v;
  }
}

// Importa pelo código do IMDb juntando todas as fontes disponíveis.
async function importarPorImdb(tt, med) {
  if (!/^tt\d+$/.test(tt)) return null;
  const ja = store.todos().find(f => f.imdb === tt);
  if (ja) return ja;
  const [sug, wd, tm, om] = await Promise.all([
    sugestaoImdb(tt), wikidataPorImdb(tt).catch(() => null), tmdb(tt).catch(() => null), omdb(tt).catch(() => null),
  ]);
  if (wd) {
    const mesmo = store.todos().find(f => f.wikidata === wd.ent.id);
    if (mesmo) { mesmo.imdb = tt; if (!mesmo.poster) mesmo.poster = tm?.poster || sug?.poster || null; return store.salvar(mesmo); }
  }
  const imdbUrl = `https://www.imdb.com/title/${tt}/`;
  const ficha = wd ? await montarFicha(wd) : {
    titulo_br: "", titulo_original: "", ano: null, diretor: "", elenco: [], generos: [], duracao_min: null, pais: "",
    sinopse: "", temas: [], estilo: [], fonte: imdbUrl, coletado_em: new Date().toISOString().slice(0, 10), origem: "importado",
  };
  // Título no Brasil: o da Wikipedia em português ("bra: ...") vale mais; senão o do TMDB em pt-BR.
  const brWiki = wd && wd.lang === "pt" && /\bbra(?:sil)?\s*:/i.test(wd.page.extract || "");
  if (tm?.titulo_br && !brWiki) ficha.titulo_br = tm.titulo_br;
  // A sinopse do TMDB em português conta a história; o resumo da Wikipedia costuma falar da produção.
  if (tm?.sinopse) ficha.sinopse = tm.sinopse;
  completar(ficha, tm);
  completar(ficha, om);
  completar(ficha, sug && { titulo_original: sug.titulo, titulo_br: sug.titulo, ano: sug.ano, elenco: sug.atores, poster: sug.poster });
  ficha.imdb = tt;
  ficha.fontes = [
    { nome: "IMDb", url: imdbUrl },
    wd && { nome: wd.page.fullurl?.includes("wikipedia") ? "Wikipedia" : "Wikidata", url: wd.page.fullurl },
    tm && { nome: "TMDB", url: tm.url },
    om && { nome: "OMDb", url: imdbUrl },
  ].filter(Boolean);
  ficha.fonte = ficha.fontes[1]?.url || imdbUrl;
  // Sem sinopse e sem gênero não dá para comparar estilo nem enredo de forma honesta.
  if (!ficha.generos.length && !ficha.sinopse) return null;
  await marcarEstilo(ficha, med);
  return store.salvar(ficha);
}

// Importa por título digitado: tenta o primeiro filme do IMDb e, se não der, a busca antiga na Wikipedia.
async function importar(titulo, med) {
  const [primeiro] = await buscarImdb(titulo);
  if (primeiro) {
    const f = await importarPorImdb(primeiro.imdb, med);
    if (f) return f;
  }
  const achado = await acharArtigo(titulo);
  if (!achado) return null;
  const ja = store.todos().find(f => f.wikidata === achado.ent.id);
  if (ja) return ja;
  const ficha = await montarFicha(achado);
  if (!ficha.generos.length && !ficha.sinopse) return null;
  await marcarEstilo(ficha, med);
  return store.salvar(ficha);
}

module.exports = { rotulos, importar, importarPorImdb, buscarCandidatos, buscarImdb, montarFicha, marcarEstilo, tmdb, omdb, tmdbGet, ondeAssistir, TMDB_KEY };
