// Apaga as buscas feitas com prazo vencido (60 dias, ou 15 dias quando a nota foi menor que 7).
// O servidor já faz isso sozinho a cada 24 h; este script é para rodar por cron, se preferir.
// Uso:  node scripts/limpar-buscas.js
try { process.loadEnvFile(require("path").join(__dirname, "..", ".env")); } catch {}
const { limpar, DIR } = require("../lib/buscas");
console.log(`${limpar()} buscas vencidas apagadas em ${DIR}`);
