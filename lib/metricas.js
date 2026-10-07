// Métricas diárias para o console de administração (/admin): buscas, visitantes, gasto do Jev e do Gemini, bloqueios e erros.
// Ficam em memória e são gravadas em $JEV_DADOS/metricas.json a cada poucos segundos. Guarda os últimos 90 dias.
// Também controla o teto de gasto diário (JEV_TETO_DIARIO_USD) e a pausa manual feita pelo console.
const fs = require("fs");
const path = require("path");

const DADOS = process.env.JEV_DADOS || path.join(__dirname, "..", "data");
const ARQ = path.join(DADOS, "metricas.json");
const FUSO = process.env.JEV_FUSO || "America/Fortaleza";
const TETO = Number(process.env.JEV_TETO_DIARIO_USD ?? 2);

let db;
try { db = JSON.parse(fs.readFileSync(ARQ, "utf8")); } catch { db = {}; }
db.dias ??= {}; db.eventos ??= []; db.pausado ??= false;

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function dia(d = hoje()) {
  return db.dias[d] ??= { buscas: 0, identificacoes: 0, catalogacoes: 0, fundo: 0, bloqueios: 0, pausadas: 0, erros: 0, avaliacoes: 0,
    visitantes: {}, jev: { chamadas: 0, input_tokens: 0, output_tokens: 0, custo_usd: 0 },
    gemini: { chamadas: 0, falhas: 0, input_tokens: 0, output_tokens: 0, custo_usd: 0 } };
}

let pendente = null;
function salvarDepois() {
  if (pendente) return;
  pendente = setTimeout(() => {
    pendente = null;
    const limite = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    for (const d of Object.keys(db.dias)) if (d < limite) delete db.dias[d];
    db.eventos = db.eventos.slice(-100);
    try { fs.writeFileSync(ARQ, JSON.stringify(db)); } catch (e) { console.error("Falha ao gravar metricas.json:", e.message); }
  }, 3000);
  pendente.unref?.();
}

// tipo: "busca", "identificacao", "catalogacao", "fundo" (importações em segundo plano), "bloqueio", "pausada", "erro", "avaliacao".
// uso: o retorno de med.fechar(). visitante: código do visitante (só para contar visitantes únicos do dia).
function registrar(tipo, uso = null, visitante = null, detalhe = null) {
  const d = dia();
  const campo = { busca: "buscas", identificacao: "identificacoes", catalogacao: "catalogacoes", fundo: "fundo", bloqueio: "bloqueios",
    pausada: "pausadas", erro: "erros", avaliacao: "avaliacoes" }[tipo];
  if (campo) d[campo]++;
  if (visitante) d.visitantes[visitante] = (d.visitantes[visitante] || 0) + 1;
  if (uso) {
    d.jev.chamadas += uso.chamadas || 0; d.jev.input_tokens += uso.input_tokens || 0;
    d.jev.output_tokens += uso.output_tokens || 0; d.jev.custo_usd += uso.custo_usd || 0;
    d.gemini.chamadas += uso.ia_chamadas || 0; d.gemini.falhas += uso.ia_falhas || 0; d.gemini.input_tokens += uso.ia_input_tokens || 0;
    d.gemini.output_tokens += uso.ia_output_tokens || 0; d.gemini.custo_usd += uso.ia_custo_usd || 0;
  }
  if (tipo !== "fundo") db.eventos.push({ em: new Date().toISOString(), tipo, visitante,
    custo_usd: uso ? (uso.custo_usd || 0) + (uso.ia_custo_usd || 0) : 0, ...(detalhe || {}) });
  salvarDepois();
}

const gastoHoje = () => { const d = dia(); return d.jev.custo_usd + d.gemini.custo_usd; };

// null se pode gastar; senão o motivo ("pausado" pelo console ou "teto" diário atingido).
function bloqueioGasto() {
  if (db.pausado) return "pausado";
  if (TETO > 0 && gastoHoje() >= TETO) return "teto";
  return null;
}
function pausar(v) { db.pausado = !!v; salvarDepois(); return db.pausado; }

// Últimos n dias, do mais recente para o mais antigo, com o número de visitantes únicos no lugar da lista.
function resumo(n = 30) {
  return {
    hoje: hoje(), fuso: FUSO, teto_usd: TETO, pausado: db.pausado, gasto_hoje_usd: gastoHoje(), bloqueio: bloqueioGasto(),
    dias: Object.keys(db.dias).sort().reverse().slice(0, n).map(d => {
      const { visitantes, ...x } = db.dias[d];
      return { dia: d, visitantes: Object.keys(visitantes).length, ...x };
    }),
    eventos: db.eventos.slice(-40).reverse(),
  };
}

module.exports = { registrar, bloqueioGasto, pausar, resumo, TETO };
