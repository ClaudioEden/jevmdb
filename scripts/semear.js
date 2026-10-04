// Aumenta o catálogo com filmes populares e mais bem avaliados do TMDB.
// Cada filme novo passa pela mesma importação da tela (IMDb + Wikidata + Wikipedia + TMDB + OMDb)
// e custa uma chamada ao Jev para marcar as tags de estilo.
// Uso:  node scripts/semear.js [páginas]    (cada página tem 20 filmes de cada lista; padrão 5)
try { process.loadEnvFile(require("path").join(__dirname, "..", ".env")); } catch {}
const store = require("../lib/store");
const { importarPorImdb, tmdbGet, TMDB_KEY } = require("../lib/importar");
const { novaMedicao, emParalelo, MOCK } = require("../lib/jev");

const PAGINAS = Number(process.argv[2] || 5);
const LISTAS = ["/movie/popular?region=BR", "/movie/top_rated"];

(async () => {
  if (!TMDB_KEY) { console.error("Defina TMDB_API_KEY no .env."); process.exit(1); }
  if (MOCK) { console.error("Sem TYPESAFE_API_KEY: as tags de estilo sairiam do modo simulado. Defina a chave no .env."); process.exit(1); }
  const ids = new Set();
  for (const lista of LISTAS)
    for (let p = 1; p <= PAGINAS; p++)
      (await tmdbGet(`${lista}${lista.includes("?") ? "&" : "?"}page=${p}`)).results.forEach(m => ids.add(m.id));
  const conhecidos = new Set(store.todos().map(f => f.tmdb_id).filter(Boolean));
  const novos = [...ids].filter(id => !conhecidos.has(id));
  console.log(`${ids.size} filmes nas listas, ${novos.length} ainda fora do catálogo.`);
  const med = novaMedicao(); let ok = 0, falhas = 0;
  await emParalelo(novos, 3, async id => {
    try {
      const tt = (await tmdbGet(`/movie/${id}/external_ids`)).imdb_id;
      const antes = store.todos().length;
      const f = tt && await importarPorImdb(tt, med);
      if (f && store.todos().length > antes) { ok++; console.log(`+ ${f.titulo_br} (${f.ano})`); }
      else if (!f) { falhas++; console.log(`- tmdb ${id}: sem dados suficientes`); }
    } catch (e) { falhas++; console.log(`- tmdb ${id}: ${e.message}`); }
  });
  const u = med.fechar();
  console.log(`\nCatalogados: ${ok} · falhas: ${falhas} · catálogo agora: ${store.todos().length} filmes`);
  console.log(`Jev: ${u.chamadas} chamadas, ${u.input_tokens + u.output_tokens} tokens, US$ ${u.custo_usd.toFixed(5)}, ${(u.tempo_ms / 1000).toFixed(0)} s`);
})();
