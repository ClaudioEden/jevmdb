// Corrige fichas antigas:
//  - id que virou só o ano (títulos sem letras latinas): passa a usar o código do IMDb;
//  - título no Brasil com o de Portugal junto ("O Juiz / Portugal: A Lei de Dredd" vira "O Juiz").
// Uso:  node scripts/corrigir-ids.js
try { process.loadEnvFile(require("path").join(__dirname, "..", ".env")); } catch {}
const store = require("../lib/store");
let n = 0;
for (const f of store.todos()) {
  if (!/^[\d-]+$/.test(f.id)) continue;
  const velho = f.id; delete f.id;
  const novo = store.novoId(f); f.id = velho;
  store.renomear(f, novo); n++;
  console.log(`${velho} -> ${novo}  (${f.titulo_br})`);
}
for (const f of store.todos()) {
  const t = String(f.titulo_br || "").split(/\s*[\/|]\s*(?:portugal|prt|pt)\b|\s*,\s*(?:portugal|prt)\b/i)[0].trim();
  if (t && t !== f.titulo_br) { console.log(`título: ${f.titulo_br} -> ${t}`); f.titulo_br = t; store.salvar(f); n++; }
}
console.log(`${n} fichas corrigidas. Os filmes que foram sobrescritos voltam rodando de novo: node scripts/semear.js 5`);
