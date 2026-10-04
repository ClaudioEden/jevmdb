// Trava da consulta grátis anônima: cada visitante tem direito a UMA consulta.
// Sem cadastro não existe trava perfeita, então combinamos três sinais, nesta ordem:
//   1. fingerprint do navegador: se já foi usado, bloqueia (mesmo que a pessoa apague o cookie ou troque de IP);
//   2. cookie assinado pelo servidor (não dá para forjar): se já foi usado, bloqueia;
//   3. IP, guardado só como hash. Sozinho NÃO bloqueia na primeira vez, para não barrar colegas de escritório
//      ou de rede móvel que saem pelo mesmo IP. Ele só bloqueia:
//        - se o pedido vier sem fingerprint (quem tira o fingerprint para burlar cai na regra do IP);
//        - ou se o mesmo IP já fez JEV_COTA_LIMITE_IP consultas grátis nas últimas 24 h (padrão 5).
// Os sinais usados ficam em data/cota.json, criado na primeira consulta grátis com a trava ligada.
// Em produção isso vai para uma tabela no banco.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ATIVA = process.env.JEV_COTA_ANONIMA !== "0";
const DADOS = process.env.JEV_DADOS || path.join(__dirname, "..", "data");
const ARQ = path.join(DADOS, "cota.json");
const SEGREDO = process.env.JEV_SEGREDO || segredoLocal();
const LIMITE_IP = Number(process.env.JEV_COTA_LIMITE_IP || 5);
const DIA = 24 * 3600 * 1000;

function segredoLocal() {
  // Sem JEV_SEGREDO definido, gera um e guarda em data/.segredo para os cookies continuarem válidos entre reinícios.
  const f = path.join(DADOS, ".segredo");
  fs.mkdirSync(DADOS, { recursive: true });
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"));
  return fs.readFileSync(f, "utf8").trim();
}

const hash = s => crypto.createHmac("sha256", SEGREDO).update(String(s)).digest("hex").slice(0, 32);
const assinar = id => `${id}.${hash("cookie:" + id).slice(0, 16)}`;
function lerCookie(req) {
  const m = /(?:^|;\s*)jev_vid=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const [id, sig] = m[1].split(".");
  return sig && assinar(id) === m[1] ? id : null;
}

function carregar() {
  let db; try { db = JSON.parse(fs.readFileSync(ARQ, "utf8")); } catch { db = {}; }
  db.usados ??= {}; db.ips ??= {};
  return db;
}
function gravar(db) { fs.writeFileSync(ARQ, JSON.stringify(db, null, 2)); }

// Atrás de um proxy (Caddy, Nginx), o IP real vem no último item do X-Forwarded-For, que o proxy acrescenta.
// Sem proxy, o cabeçalho é ignorado, porque o próprio visitante poderia inventá-lo.
const ATRAS_DE_PROXY = process.env.JEV_ATRAS_DE_PROXY === "1";
function ipDe(req) {
  if (ATRAS_DE_PROXY) {
    const xff = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1];
  }
  return req.socket.remoteAddress || "";
}

// Calcula os sinais do visitante e devolve o cookie a enviar se ele ainda não tiver um.
function identificar(req) {
  let vid = lerCookie(req), novoCookie = null;
  if (!vid) { vid = crypto.randomUUID(); novoCookie = `jev_vid=${assinar(vid)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`; }
  const fp = String(req.headers["x-jev-fp"] || "").slice(0, 128);
  const sinais = { cookie: "c:" + hash(vid), ip: "i:" + hash(ipDe(req)) };
  if (fp) sinais.fp = "f:" + hash(fp);
  return { sinais, novoCookie };
}

// Consultas grátis feitas por este IP nas últimas 24 h.
const recentes = (db, ip) => (db.ips[ip] ?? []).filter(t => Date.now() - new Date(t).getTime() < DIA);

// Devolve o motivo do bloqueio ("fingerprint", "cookie", "ip") ou null se pode consultar.
function motivoBloqueio(sinais) {
  if (!ATIVA) return null;
  const db = carregar();
  if (sinais.fp && db.usados[sinais.fp]) return "fingerprint";
  if (db.usados[sinais.cookie]) return "cookie";
  const n = recentes(db, sinais.ip).length;
  if (!sinais.fp && n > 0) return "ip";
  if (n >= LIMITE_IP) return "ip";
  return null;
}
const jaUsou = sinais => motivoBloqueio(sinais) !== null;

function registrarUso(sinais) {
  if (!ATIVA) return;
  const db = carregar(), agora = new Date().toISOString();
  db.usados[sinais.cookie] = agora;
  if (sinais.fp) db.usados[sinais.fp] = agora;
  db.ips[sinais.ip] = [...recentes(db, sinais.ip), agora];
  gravar(db);
}

module.exports = { identificar, jaUsou, motivoBloqueio, registrarUso, ATIVA, LIMITE_IP };
