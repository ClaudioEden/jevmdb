// Cota de buscas grátis do demo: cada visitante tem JEV_COTA_GRATIS buscas (padrão 5), pela lista ou pelo texto.
// Quem precisar de mais manda o "código do visitante" pelo WhatsApp e o administrador libera mais buscas no /admin.
// Sem cadastro não existe trava perfeita, então combinamos três sinais:
//   1. cookie assinado pelo servidor (não dá para forjar): é dele que sai o código do visitante;
//   2. fingerprint do navegador: conta junto, para apagar o cookie não zerar a cota;
//   3. IP, guardado só como hash. Não bloqueia sozinho quem manda fingerprint (colegas de escritório saem pelo mesmo IP);
//      bloqueia pedidos sem fingerprint depois de JEV_COTA_GRATIS buscas e qualquer IP acima de JEV_COTA_LIMITE_IP buscas em 24 h.
// Os contadores ficam em $JEV_DADOS/cota.json.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ATIVA = process.env.JEV_COTA_ANONIMA !== "0";
const DADOS = process.env.JEV_DADOS || path.join(__dirname, "..", "data");
const ARQ = path.join(DADOS, "cota.json");
const SEGREDO = process.env.JEV_SEGREDO || segredoLocal();
const GRATIS = Number(process.env.JEV_COTA_GRATIS || 5);
const LIMITE_IP = Number(process.env.JEV_COTA_LIMITE_IP || 30);
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

// Código curto que o visitante manda no WhatsApp (sem letras que se confundem, como O/0 e I/1).
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function codigoDe(vid) {
  const h = crypto.createHmac("sha256", SEGREDO).update("codigo:" + vid).digest();
  return Array.from(h.subarray(0, 6), b => ALFABETO[b % ALFABETO.length]).join("");
}

function carregar() {
  let db; try { db = JSON.parse(fs.readFileSync(ARQ, "utf8")); } catch { db = {}; }
  db.visitantes ??= {}; db.fps ??= {}; db.ips ??= {};
  return db;
}
function gravar(db) { fs.writeFileSync(ARQ, JSON.stringify(db)); }

// Atrás de um proxy (Caddy, Traefik do Dokploy), o IP real vem no último item do X-Forwarded-For.
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
  const sinais = { codigo: codigoDe(vid), ip: "i:" + hash(ipDe(req)) };
  if (fp) sinais.fp = "f:" + hash(fp);
  return { sinais, novoCookie };
}

const recentes = (db, ip) => (db.ips[ip] ?? []).filter(t => Date.now() - new Date(t).getTime() < DIA);

// Situação do visitante: quantas usou, quantas tem (grátis + liberadas) e quantas restam.
function saldoDe(db, sinais) {
  const v = db.visitantes[sinais.codigo] || {}, f = (sinais.fp && db.fps[sinais.fp]) || {};
  const usadas = Math.max(v.usadas || 0, f.usadas || 0);
  const limite = GRATIS + Math.max(v.extras || 0, f.extras || 0);
  return { ativa: ATIVA, gratis: GRATIS, usadas, limite, restantes: ATIVA ? Math.max(0, limite - usadas) : GRATIS, codigo: sinais.codigo };
}
const saldo = sinais => saldoDe(carregar(), sinais);

// Devolve o motivo do bloqueio ("limite" ou "ip") ou null se pode buscar.
function motivoBloqueio(sinais) {
  if (!ATIVA) return null;
  const db = carregar(), s = saldoDe(db, sinais);
  if (s.restantes <= 0) return "limite";
  const n = recentes(db, sinais.ip).length;
  if (!sinais.fp && n >= GRATIS) return "ip";
  if (n >= LIMITE_IP) return "ip";
  return null;
}

// Conta uma busca que deu resultado e devolve o saldo atualizado.
function registrarUso(sinais) {
  const db = carregar();
  if (!ATIVA) return saldoDe(db, sinais);
  const agora = new Date().toISOString();
  const v = db.visitantes[sinais.codigo] ??= { usadas: 0, extras: 0, criado: agora };
  const f = sinais.fp ? (db.fps[sinais.fp] ??= { usadas: 0, extras: 0 }) : null;
  v.usadas = Math.max(v.usadas, f?.usadas || 0) + 1;
  v.extras = Math.max(v.extras || 0, f?.extras || 0);
  v.ultimo = agora;
  if (f) { v.fp = sinais.fp; f.usadas = v.usadas; f.extras = v.extras; }
  db.ips[sinais.ip] = [...recentes(db, sinais.ip), agora];
  gravar(db);
  return saldoDe(db, sinais);
}

// Administrador libera mais n buscas para o código que o visitante mandou no WhatsApp.
function liberar(codigo, n = GRATIS) {
  codigo = String(codigo || "").trim().toUpperCase();
  n = Math.max(1, Math.min(50, Number(n) || GRATIS));
  if (!/^[A-Z2-9]{6}$/.test(codigo)) return null;
  const db = carregar(), agora = new Date().toISOString();
  const v = db.visitantes[codigo] ??= { usadas: 0, extras: 0, criado: agora };
  v.extras = (v.extras || 0) + n;
  (v.liberacoes ??= []).push({ em: agora, n });
  if (v.fp && db.fps[v.fp]) db.fps[v.fp].extras = Math.max(db.fps[v.fp].extras || 0, v.extras);
  gravar(db);
  return { codigo, usadas: v.usadas, limite: GRATIS + v.extras, restantes: Math.max(0, GRATIS + v.extras - v.usadas) };
}

// Resumo para o console: visitantes com busca, quantos chegaram no limite e as liberações.
function resumo() {
  const db = carregar(), vs = Object.entries(db.visitantes);
  return {
    ativa: ATIVA, gratis: GRATIS, limite_ip: LIMITE_IP,
    visitantes: vs.length,
    no_limite: vs.filter(([, v]) => (v.usadas || 0) >= GRATIS + (v.extras || 0)).length,
    liberacoes: vs.flatMap(([c, v]) => (v.liberacoes || []).map(l => ({ codigo: c, ...l }))).sort((a, b) => b.em.localeCompare(a.em)).slice(0, 20),
    maiores: vs.map(([c, v]) => ({ codigo: c, usadas: v.usadas || 0, limite: GRATIS + (v.extras || 0), ultimo: v.ultimo || null }))
      .sort((a, b) => b.usadas - a.usadas).slice(0, 10),
  };
}

module.exports = { identificar, motivoBloqueio, registrarUso, saldo, liberar, resumo, ATIVA, GRATIS, LIMITE_IP };
