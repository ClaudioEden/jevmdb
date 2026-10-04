// Idiomas do site: português do Brasil (padrão), inglês americano e espanhol (latino-americano).
// As comparações do Jev continuam em português internamente; aqui só se traduz o que aparece na tela.
const IDIOMAS = {
  pt: { tmdb: "pt-BR", regiao: "BR" },
  en: { tmdb: "en-US", regiao: "US" },
  es: { tmdb: "es-MX", regiao: "MX" },
};

function idiomaDe(req, url) {
  const v = String(req.headers["x-jev-lang"] || url?.searchParams.get("lang") || "pt").slice(0, 2).toLowerCase();
  return IDIOMAS[v] ? v : "pt";
}

// Tags de estilo (o vocabulário do catálogo está em português).
const TAGS = {
  "ficção científica": ["science fiction", "ciencia ficción"], "futuro": ["future", "futuro"], "distopia": ["dystopia", "distopía"],
  "pós-apocalíptico": ["post-apocalyptic", "posapocalíptico"], "cyberpunk": ["cyberpunk", "cyberpunk"], "ação": ["action", "acción"],
  "policial": ["cop", "policial"], "crime": ["crime", "crimen"], "thriller": ["thriller", "thriller"], "drama": ["drama", "drama"],
  "comédia": ["comedy", "comedia"], "romance": ["romance", "romance"], "animação": ["animation", "animación"], "família": ["family", "familiar"],
  "aventura": ["adventure", "aventura"], "fantasia": ["fantasy", "fantasía"], "horror": ["horror", "terror"], "suspense": ["suspense", "suspenso"],
  "guerra": ["war", "guerra"], "histórico": ["historical", "histórico"], "biografia": ["biography", "biografía"], "musical": ["musical", "musical"],
  "faroeste": ["western", "western"], "esporte": ["sports", "deportes"], "espaço": ["space", "espacio"], "viagem no tempo": ["time travel", "viaje en el tiempo"],
  "sobrevivência": ["survival", "supervivencia"], "máfia": ["mafia", "mafia"], "prisão": ["prison", "prisión"], "assalto": ["heist", "atraco"],
  "noir": ["noir", "noir"], "sátira": ["satire", "sátira"], "super-herói": ["superhero", "superhéroes"], "documentário": ["documentary", "documental"],
  "conspiração": ["conspiracy", "conspiración"], "realidade virtual": ["virtual reality", "realidad virtual"],
};
const tag = (t, lang) => (lang === "pt" ? t : TAGS[t]?.[lang === "en" ? 0 : 1] ?? t);

// Campos da ficha no idioma pedido; o que não tiver tradução fica em português.
function localizar(f, lang) {
  const tr = lang === "pt" ? null : f.i18n?.[lang];
  return {
    titulo: tr?.titulo || f.titulo_br,
    sinopse: tr?.sinopse || f.sinopse,
    generos: tr?.generos?.length ? tr.generos : f.generos,
    estilo: (f.estilo || []).map(t => tag(t, lang)),
  };
}

module.exports = { IDIOMAS, idiomaDe, localizar, tag };
