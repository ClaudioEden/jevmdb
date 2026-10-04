# Colocar o Jev Filmes no ar numa VPS

Endereço final: **https://jev-filmes.w3pd.com.br**

O app é Node puro, sem dependências e sem banco de dados: as fichas e a trava ficam em arquivos JSON numa pasta de dados. Na VPS ele roda como serviço do sistema (systemd), atrás do **Caddy**, que cuida do domínio e do HTTPS (certificado grátis e renovado sozinho).

```
visitante ──HTTPS──> Caddy (portas 80/443) ──> node server.js (127.0.0.1:3000) ──> /var/lib/jev-filmes (fichas + trava)
```

## 0. O que você precisa

- [ ] Uma VPS com **Ubuntu 24.04** (1 vCPU e 1 GB de RAM bastam), com IPv4 fixo e acesso SSH como root ou com sudo.
- [ ] Acesso ao painel onde está o DNS de `w3pd.com.br`.
- [ ] As chaves que hoje estão no seu `.env` (TypeSafe, TMDB, OMDb, Gemini).
- [ ] O repositório no GitHub (os passos abaixo usam `https://github.com/ClaudioEden/jevmdb`; troque se o nome for outro).

Anote o IP da VPS. Nos exemplos ele aparece como `203.0.113.10`.

## 1. DNS: criar jev-filmes.w3pd.com.br

Primeiro descubra onde está o DNS de `w3pd.com.br` com `dig +short NS w3pd.com.br`. Se os servidores forem os da sua hospedagem, a entrada é criada no painel dela, não no Registro.br.

1. Entre no painel da hospedagem (normalmente cPanel) e abra **Domínios → Zone Editor** (ou "Editor de Zona DNS").
2. No domínio `w3pd.com.br`, clique em **+ A Record** (ou "Adicionar registro" e escolha o tipo **A**).
3. Preencha:

   | Campo | Valor |
   | --- | --- |
   | Tipo | `A` |
   | Nome | `jev-filmes` (o painel completa para `jev-filmes.w3pd.com.br.`) |
   | Endereço / Valor | o IPv4 da VPS, ex.: `203.0.113.10` |
   | TTL | `300` (5 minutos; facilita corrigir se errar) |

4. Salve. Se a VPS tiver IPv6, crie também um registro **AAAA** com o mesmo nome e o IPv6. Se não tiver, não crie AAAA.
5. Confira do seu Mac (pode levar de alguns minutos a algumas horas):

   ```bash
   dig +short jev-filmes.w3pd.com.br
   ```

   Tem que responder o IP da VPS. **Só siga para o passo 6 (Caddy) depois disso**, porque o certificado HTTPS só é emitido quando o nome já aponta para a VPS.

> Se um dia você mudar o DNS para a Cloudflare: crie o mesmo registro A e deixe a nuvem **cinza (DNS only)** na primeira vez, para o Caddy emitir o certificado. Depois pode ligar o proxy laranja com SSL em "Full (strict)".

## 2. Preparar a VPS

Entre por SSH (`ssh root@203.0.113.10`) e rode:

```bash
apt update && apt upgrade -y
apt install -y git curl ufw debian-keyring debian-archive-keyring apt-transport-https

# Firewall: só SSH, HTTP e HTTPS
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable

# Usuário próprio do app (sem login)
useradd --system --home /opt/jev-filmes --shell /usr/sbin/nologin jev
```

## 3. Instalar o Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # tem que mostrar v22.x
```

## 4. Baixar o código e montar a pasta de dados

```bash
git clone https://github.com/ClaudioEden/jevmdb.git /opt/jev-filmes

# Os dados ficam fora da pasta do código, para o "git pull" nunca brigar com fichas novas.
mkdir -p /var/lib/jev-filmes
cp -r /opt/jev-filmes/data/filmes /var/lib/jev-filmes/
chown -R jev:jev /var/lib/jev-filmes
```

## 5. Criar o .env com as chaves

```bash
cp /opt/jev-filmes/.env.example /opt/jev-filmes/.env
nano /opt/jev-filmes/.env
```

Preencha as quatro chaves e confira que estão assim:

```
JEV_COTA_ANONIMA=1
JEV_COTA_LIMITE_IP=5
```

Depois proteja o arquivo (só o usuário do app lê):

```bash
chown jev:jev /opt/jev-filmes/.env
chmod 600 /opt/jev-filmes/.env
```

## 6. Rodar como serviço (systemd)

Crie `/etc/systemd/system/jev-filmes.service`:

```bash
cat > /etc/systemd/system/jev-filmes.service <<'EOF'
[Unit]
Description=Jev Filmes
After=network-online.target
Wants=network-online.target

[Service]
User=jev
WorkingDirectory=/opt/jev-filmes
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=JEV_ATRAS_DE_PROXY=1
Environment=JEV_DADOS=/var/lib/jev-filmes
# Descomente para esconder do público o custo e os tokens (a barra do topo):
# Environment=JEV_MOSTRAR_USO=0
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now jev-filmes
systemctl status jev-filmes --no-pager
curl -s localhost:3000/api/catalogo | head -c 120; echo
```

O `curl` tem que mostrar `"modo":"jev"` e `"cota_anonima":true`.

O que cada linha garante:
- `HOST=127.0.0.1`: o Node só aceita conexão vinda da própria VPS (do Caddy), nunca direto da internet.
- `JEV_ATRAS_DE_PROXY=1`: a trava pega o IP real do visitante que o Caddy repassa.
- `JEV_DADOS`: fichas novas, a trava (`cota.json`) e o segredo dos cookies (`.segredo`) ficam em `/var/lib/jev-filmes`.

## 7. HTTPS com o Caddy

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cat > /etc/caddy/Caddyfile <<'EOF'
jev-filmes.w3pd.com.br {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF

systemctl reload caddy
```

Abra **https://jev-filmes.w3pd.com.br**. Se o certificado demorar, veja o log com `journalctl -u caddy -n 50 --no-pager`. Quase sempre é o DNS que ainda não propagou.

## 8. Testar no ar

- [ ] A página abre com o selo "Jev conectado".
- [ ] Uma busca pela aba **Escolher filme** traz pôster, % de similaridade e onde assistir.
- [ ] Uma busca pela aba **Descrever em texto** identifica o filme.
- [ ] A **segunda** busca no mesmo navegador volta "Você já usou sua consulta grátis".
- [ ] No celular (4G, fora do Wi-Fi), a primeira busca funciona.

## 9. Dia a dia

| Para quê | Comando |
| --- | --- |
| Ver o log ao vivo | `journalctl -u jev-filmes -f` |
| Reiniciar | `systemctl restart jev-filmes` |
| Atualizar o código | `cd /opt/jev-filmes && git pull && systemctl restart jev-filmes` |
| Zerar a trava (teste) | `rm /var/lib/jev-filmes/cota.json && systemctl restart jev-filmes` |
| Aumentar o catálogo | `cd /opt/jev-filmes && sudo -u jev env JEV_DADOS=/var/lib/jev-filmes node scripts/semear.js 10 && systemctl restart jev-filmes` |
| Completar notas e onde assistir | `cd /opt/jev-filmes && sudo -u jev env JEV_DADOS=/var/lib/jev-filmes node scripts/completar-fichas.js && systemctl restart jev-filmes` |

O servidor guarda o catálogo em memória, por isso reinicie depois de rodar os scripts.

## 10. Backup diário dos dados

```bash
mkdir -p /var/backups/jev-filmes
cat > /etc/cron.daily/jev-filmes-backup <<'EOF'
#!/bin/sh
tar -czf /var/backups/jev-filmes/dados-$(date +%F).tar.gz -C /var/lib jev-filmes
find /var/backups/jev-filmes -name 'dados-*.tar.gz' -mtime +14 -delete
EOF
chmod +x /etc/cron.daily/jev-filmes-backup
```

Guarda 14 dias. De vez em quando, copie um desses arquivos para fora da VPS.

## 11. Custos para acompanhar

- **TypeSafe (Jev):** cada busca custa entre US$ 0,001 e US$ 0,007. O total desde o último reinício aparece na barra do topo do site ("Total gasto"). Confira o saldo em console.typesafe.ai.
- **Gemini:** só a aba de texto usa, umas centenas de tokens por busca.
- **TMDB e OMDb:** grátis nos limites atuais (o OMDb grátis permite 1.000 consultas por dia; ele só é chamado quando um filme novo entra no catálogo).

## Quando isso deixar de servir

Com o cadastro por WhatsApp e os créditos (ver `docs/PLANO-CADASTRO.md`), a pasta de dados vira um banco **Postgres**, que pode rodar nesta mesma VPS (`apt install postgresql`). Até lá, os arquivos JSON dão conta.
