// Corrige fichas cujo id virou só o ano (títulos sem letras latinas): passa a usar o código do IMDb.
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
console.log(`${n} fichas corrigidas. Os filmes que foram sobrescritos voltam rodando de novo: node scripts/semear.js 5`);
