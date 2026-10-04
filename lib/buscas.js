// Buscas feitas: cada resultado exibido vira um JSON em $JEV_DADOS/buscas-feitas/, com prazo de validade.
// Prazo padrão de 60 dias; se a pessoa der nota menor que 7 estrelas, o prazo cai para 15 dias.
// A limpeza roda quando o servidor sobe e a cada 24 h (e também pode rodar por cron: scripts/limpar-buscas.js).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DIR = path.join(process.env.JEV_DADOS || path.join(__dirname, "..", "data"), "buscas-feitas");
const DIA = 24 * 3600 * 1000;
const PRAZO_DIAS = 60, PRAZO_NOTA_BAIXA_DIAS = 15, NOTA_MINIMA = 7;
const ID_OK = /^[0-9a-f-]{36}$/;

const arquivo = id => path.join(DIR, `${id}.json`);
const somaDias = (iso, d) => new Date(new Date(iso).getTime() + d * DIA).toISOString();

function salvar(conteudo) {
  fs.mkdirSync(DIR, { recursive: true });
  const id = crypto.randomUUID(), criado_em = new Date().toISOString();
  fs.writeFileSync(arquivo(id), JSON.stringify({ id, criado_em, expira_em: somaDias(criado_em, PRAZO_DIAS), ...conteudo }, null, 2));
  return id;
}

// Nota de 1 a 10 e comentário opcional. Pode ser chamada duas vezes: primeiro a nota, depois o comentário.
function avaliar(id, { estrelas, comentario }) {
  if (!ID_OK.test(String(id))) return null;
  let b; try { b = JSON.parse(fs.readFileSync(arquivo(id), "utf8")); } catch { return null; }
  b.avaliacao ??= {};
  if (estrelas != null) {
    const n = Math.round(Number(estrelas));
    if (!(n >= 1 && n <= 10)) return null;
    b.avaliacao.estrelas = n;
    b.expira_em = somaDias(b.criado_em, n < NOTA_MINIMA ? PRAZO_NOTA_BAIXA_DIAS : PRAZO_DIAS);
  }
  if (comentario != null) b.avaliacao.comentario = String(comentario).slice(0, 1000).trim();
  b.avaliacao.em = new Date().toISOString();
  fs.writeFileSync(arquivo(id), JSON.stringify(b, null, 2));
  return { estrelas: b.avaliacao.estrelas ?? null, expira_em: b.expira_em };
}

// Apaga as buscas com prazo vencido. Devolve quantas apagou.
function limpar() {
  let apagadas = 0;
  if (!fs.existsSync(DIR)) return 0;
  for (const nome of fs.readdirSync(DIR).filter(n => n.endsWith(".json"))) {
    try {
      const { expira_em } = JSON.parse(fs.readFileSync(path.join(DIR, nome), "utf8"));
      if (new Date(expira_em).getTime() < Date.now()) { fs.unlinkSync(path.join(DIR, nome)); apagadas++; }
    } catch {}
  }
  return apagadas;
}

module.exports = { salvar, avaliar, limpar, DIR };
