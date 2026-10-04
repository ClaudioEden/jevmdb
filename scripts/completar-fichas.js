// Completa as fichas do catálogo com o que estiver faltando: código do IMDb, pôster, notas do IMDb (OMDb) e do TMDB,
// e onde assistir no Brasil. Fichas importadas trocam o resumo da Wikipedia pela sinopse do TMDB em português.
// Não chama o Jev.  Uso:  node scripts/completar-fichas.js
try { process.loadEnvFile(require("path").join(__dirname, "..", ".env")); } catch {}
const store = require("../lib/store");
const { buscarImdb, tmdb, omdb, ondeAssistir } = require("../lib/importar");

const perto = (f, x) => !f.ano || Math.abs((x.ano || 0) - f.ano) <= 1;

(async () => {
  for (const f of store.todos()) {
    const antes = JSON.stringify(f);
    if (!f.imdb) {
      const s = (await buscarImdb(`${f.titulo_original} ${f.ano || ""}`).catch(() => [])).find(x => perto(f, x))
        || (await buscarImdb(f.titulo_original).catch(() => [])).find(x => perto(f, x));
      if (!s) { console.log(`sem par no IMDb: ${f.titulo_br} (${f.ano})`); continue; }
      f.imdb = s.imdb; f.poster = f.poster || s.poster;
    }
    const [tm, om] = await Promise.all([tmdb(f.imdb).catch(() => null), omdb(f.imdb).catch(() => null)]);
    if (tm) {
      f.tmdb_id = tm.tmdb_id; f.nota_tmdb = tm.nota_tmdb ?? f.nota_tmdb ?? null;
      f.poster = tm.poster || f.poster;
      if (f.origem === "importado" && tm.sinopse) f.sinopse = tm.sinopse;
    }
    if (om?.nota_imdb) f.nota_imdb = om.nota_imdb;
    await ondeAssistir(f).catch(() => null);
    if (JSON.stringify(f) !== antes) store.salvar(f);
    const pl = (f.onde_assistir?.plataformas || []).filter(p => p.tipo === "assinatura").map(p => p.nome).join(", ");
    console.log(`${f.titulo_br} (${f.ano}) imdb ${f.nota_imdb ?? "-"} tmdb ${f.nota_tmdb ?? "-"}${pl ? " | " + pl : ""}`);
  }
})();
