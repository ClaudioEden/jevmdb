// Repositório de fichas: um arquivo JSON por filme em data/filmes/ (ou em $JEV_DADOS/filmes/).
// Toda leitura e escrita de fichas passa por aqui, então trocar por Postgres (JSONB) é trocar só este módulo.
const fs = require("fs");
const path = require("path");

const DIR = path.join(process.env.JEV_DADOS || path.join(__dirname, "..", "data"), "filmes");
fs.mkdirSync(DIR, { recursive: true });
let cache = null;

function carregar() {
  if (cache) return cache;
  cache = fs.readdirSync(DIR).filter(n => n.endsWith(".json"))
    .map(n => JSON.parse(fs.readFileSync(path.join(DIR, n), "utf8")));
  return cache;
}

const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function slug(s) { return norm(s).replace(/ /g, "-").slice(0, 60); }

function todos() { return carregar(); }
function porId(id) { return carregar().find(f => f.id === id); }

// Procura pelo título no Brasil ou original, ignorando acentos e maiúsculas.
function porTitulo(titulo) {
  const q = norm(titulo);
  if (!q) return null;
  const fs_ = carregar();
  return fs_.find(f => norm(f.titulo_br) === q || norm(f.titulo_original) === q)
    || fs_.find(f => norm(f.titulo_br).includes(q) || norm(f.titulo_original).includes(q))
    || null;
}

// Id legível a partir do título. Título sem letras latinas (japonês, coreano...) viraria só o ano e um filme
// sobrescreveria o outro; nesse caso o id vem do código do IMDb (ou do TMDB).
function novoId(ficha) {
  const base = slug(ficha.titulo_original || "") || slug(ficha.titulo_br || "");
  let id = base && /[a-z]/.test(base) ? slug(`${base} ${ficha.ano || ""}`) : (ficha.imdb || (ficha.tmdb_id ? `tmdb-${ficha.tmdb_id}` : slug(`filme ${ficha.ano || ""} ${Date.now()}`)));
  const outro = porId(id);
  if (outro && ficha.imdb && outro.imdb && outro.imdb !== ficha.imdb) id = `${id}-${ficha.imdb}`;
  return id;
}

function salvar(ficha) {
  const id = ficha.id || novoId(ficha);
  ficha.id = id;
  fs.writeFileSync(path.join(DIR, `${id}.json`), JSON.stringify(ficha, null, 2));
  const lista = carregar();
  const i = lista.findIndex(f => f.id === id);
  if (i >= 0) lista[i] = ficha; else lista.push(ficha);
  return ficha;
}

// Troca o id de uma ficha (renomeia o arquivo).
function renomear(ficha, novo) {
  const velho = ficha.id;
  if (!velho || velho === novo) return ficha;
  ficha.id = novo;
  fs.writeFileSync(path.join(DIR, `${novo}.json`), JSON.stringify(ficha, null, 2));
  fs.rmSync(path.join(DIR, `${velho}.json`), { force: true });
  return ficha;
}

module.exports = { todos, porId, porTitulo, salvar, renomear, novoId, norm };
