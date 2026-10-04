# Plano: cadastro por WhatsApp e níveis de acesso

Status: **planejamento** (atualizado em 04/10/2026). Nada disto está implementado ainda. Próximo passo: criar o Postgres no Dokploy (seção 3).

## 1. Os três níveis

| Nível | Como entra | Resultados por busca | Limite de buscas | Observação |
| --- | --- | --- | --- | --- |
| **Visitante** | sem cadastro | **3** | 1 grátis (trava atual: fingerprint, cookie e teto de 5 por IP em 24 h) | Banner: "Destrave até 10 resultados criando sua conta grátis" |
| **Conta grátis** | número de WhatsApp verificado por código | **10** | **2 por semana** e **5 por mês**; o que bater primeiro trava | Mostra quantas buscas restam |
| **Créditos** (depois) | conta grátis + compra | 10 | 1 crédito = 1 busca, sem limite semanal | Pacotes baratinhos por Pix |

Regras que valem para todos:
- **O corte dos resultados é feito no servidor.** O visitante recebe só os 3 primeiros no JSON. Se o corte fosse só na tela, qualquer um veria os 10 no navegador.
- Só conta a busca que trouxe resultado (como já é hoje).
- "Semana" e "mês" no calendário (segunda a domingo; dia 1 ao fim do mês), no fuso de Brasília. É mais fácil de explicar do que "últimos 7 dias". A tela mostra: "Você tem 1 busca nesta semana (3 no mês). Renova na segunda."

## 2. Cadastro por WhatsApp (fluxo)

1. A pessoa digita o celular. A tela formata com +55 e valida o número (DDD + 9 dígitos).
2. O servidor gera um código de 6 dígitos, guarda **só o hash** com validade de 5 minutos e envia pelo WhatsApp.
3. A pessoa digita o código. Até 5 tentativas; depois, o código é invalidado.
4. Código certo: cria a conta (se não existir) e abre uma sessão com cookie `HttpOnly`, `Secure` e `SameSite=Lax`, válida por 30 dias.
5. Sem senha: para entrar em outro aparelho, é só pedir outro código.

### Proteções do envio de código (cada mensagem custa dinheiro)
- No máximo 1 código por número a cada 60 s e 5 por dia.
- No máximo 5 códigos por IP e 3 por fingerprint por dia.
- Uma conta por número.
- Desafio anti-robô invisível (ex.: Cloudflare Turnstile, grátis) antes de enviar o código.

### Quem envia a mensagem: Evolution API

Decidido: o código sai por uma **instância da Evolution API** do próprio Eden. Ela tem dois modos, e o app funciona com os dois:

| Modo da instância | Como o código é enviado | Observação |
| --- | --- | --- |
| **WhatsApp Business oficial (Cloud API da Meta)** | Mensagem de **modelo** (template) da categoria "Autenticação", com o código como variável | Oficial, sem risco de banimento. Exige conta Meta Business, número dedicado e o modelo aprovado pela Meta |
| **Baileys (WhatsApp Web, não oficial)** | Mensagem de texto comum | Rápido de ligar, mas pode banir o número. Usar **só com um número dedicado**, nunca o pessoal |

No código, tudo passa por uma função só, `enviarCodigo(telefone, codigo)`, em `lib/whatsapp.js`. Trocar de modo é mudar uma variável, sem mexer no resto:

```
EVOLUTION_URL=https://evolution.seudominio.com.br   # endereço da sua instância
EVOLUTION_API_KEY=...                                # cabeçalho "apikey"
EVOLUTION_INSTANCE=jevmdb                            # nome da instância
WHATSAPP_MODO=texto                                  # texto (Baileys) | template (Cloud API)
WHATSAPP_TEMPLATE=jevmdb_codigo                      # nome do modelo aprovado (só no modo template)
WHATSAPP_TEMPLATE_IDIOMA=pt_BR
```

- Modo `texto`: `POST {EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCE}` com a mensagem "Seu código JevMDB é 123456. Ele vale por 5 minutos."
- Modo `template`: `POST {EVOLUTION_URL}/message/sendTemplate/{EVOLUTION_INSTANCE}` com o modelo e o código como parâmetro.
- Os caminhos acima são os da Evolution API v2. Confiro na versão da sua instância antes de implementar.
- Se a Evolution estiver na mesma VPS do Dokploy, o JevMDB fala com ela pela rede interna, sem passar pela internet.

Texto sugerido para o modelo de autenticação (pt-BR): "{{1}} é o seu código de acesso ao JevMDB. Não compartilhe." A Meta pede um modelo por idioma; os de inglês e espanhol entram junto com a versão nesses idiomas.

## 3. Banco de dados (Postgres)

O cadastro exige banco: contas, sessões e contagem de buscas precisam de consulta e escrita confiáveis, e os arquivos JSON não servem para isso. O Postgres pode rodar na mesma VPS. Esquema mínimo:

```sql
create table usuarios (
  id            bigserial primary key,
  telefone      text unique not null,          -- formato E.164: +5511999998888
  plano         text not null default 'gratis', -- 'gratis' | 'creditos'
  creditos      integer not null default 0,
  criado_em     timestamptz not null default now(),
  aceite_termos timestamptz not null            -- LGPD: quando aceitou
);

create table codigos_otp (
  telefone   text not null,
  hash       text not null,
  expira_em  timestamptz not null,
  tentativas integer not null default 0,
  criado_em  timestamptz not null default now()
);

create table sessoes (
  token_hash text primary key,
  usuario_id bigint not null references usuarios(id) on delete cascade,
  expira_em  timestamptz not null
);

create table buscas (
  id          bigserial primary key,
  usuario_id  bigint references usuarios(id) on delete set null, -- nulo = visitante
  sinais      jsonb,                 -- hashes de cookie, fingerprint e IP (visitante)
  filme_ref   text,
  criterios   text[],
  custo_usd   numeric(10,6),
  tokens      integer,
  criado_em   timestamptz not null default now()
);
create index on buscas (usuario_id, criado_em);

create table filmes (               -- substitui data/filmes/*.json
  id    text primary key,
  imdb  text unique,
  ficha jsonb not null
);

create table compras (              -- fase de créditos
  id          bigserial primary key,
  usuario_id  bigint not null references usuarios(id),
  pacote      text not null,
  valor_brl   numeric(10,2) not null,
  creditos    integer not null,
  status      text not null,        -- 'pendente' | 'pago' | 'cancelado'
  pagamento_id text unique,         -- id do pagamento no Mercado Pago
  criado_em   timestamptz not null default now()
);
```

### Criar o Postgres no Dokploy (passo a passo)

1. No Dokploy, abra o **mesmo projeto** do JevMDB → **Create Service** → **Database** → **PostgreSQL**.
2. Preencha:
   | Campo | Valor |
   | --- | --- |
   | Name | `jevmdb-db` |
   | Database Name | `jevmdb` |
   | Database User | `jevmdb` |
   | Database Password | uma senha forte (o botão de gerar serve) |
   | Docker Image | `postgres:17` (o padrão do Dokploy também serve) |
3. Clique em **Create** e depois em **Deploy**. Espere o status ficar verde.
4. Na aba **General** do banco, copie a **Internal Connection URL**. Ela tem o formato `postgresql://jevmdb:SENHA@jevmdb-db-xxxxxx:5432/jevmdb`.
5. **Não** preencha "External Port". O banco fica acessível só pela rede interna do Dokploy, sem porta aberta na internet.
6. No serviço do **JevMDB** → **Environment**, acrescente uma linha (sem aspas): `DATABASE_URL=postgresql://jevmdb:SENHA@jevmdb-db-xxxxxx:5432/jevmdb`. Salve, mas **ainda não precisa fazer Deploy**: enquanto o código não usar o banco, a variável é ignorada.
7. **Backup:** na aba **Backups** do banco, configure um destino S3 (Cloudflare R2 e Backblaze B2 têm plano grátis) e um agendamento diário. Sem destino S3, use pelo menos o **Volume Backups** do Dokploy.
8. Me avise quando terminar. Para os testes no Mac, subo um Postgres local com Docker e ninguém mexe no seu.

Na primeira subida do código novo, o app cria as tabelas sozinho (migração automática) e um script importa as fichas, a trava, as buscas e as avaliações que hoje estão em arquivos.

O limite da conta grátis sai de uma consulta simples em `buscas` (quantas nesta semana e neste mês). A trava do visitante (hoje `data/cota.json`) passa a usar a mesma tabela.

A migração é localizada: `lib/store.js` (fichas), `lib/cota.js` (trava), `lib/buscas.js` (buscas e avaliações) e os pedidos de "sentiu falta" são os únicos módulos que leem e gravam dados. O resto do app não muda. Dependência nova: só o driver `pg`.

## 4. Créditos (fase seguinte)

Custo real de uma busca hoje: de **US$ 0,001 a 0,007** (R$ 0,01 a R$ 0,04). Qualquer preço "de troco" já paga a conta.

Sugestões de pacote, no espírito do "1,99":

| Pacote | Preço | Buscas | Preço por busca |
| --- | --- | --- | --- |
| Pipoca | R$ 1,99 | 5 | R$ 0,40 |
| Sessão dupla | R$ 4,99 | 15 | R$ 0,33 |
| Maratona | R$ 9,90 | 40 | R$ 0,25 |

- **Mercado Pago, com Pix** como meio principal (decidido). Em valores tão pequenos, a tarifa fixa do cartão come boa parte do valor; no Pix a tarifa é percentual e baixa.
- Fluxo: a pessoa escolhe o pacote → o servidor cria o pagamento Pix na API do Mercado Pago (`POST /v1/payments` com `payment_method_id: "pix"`) → a tela mostra o QR Code e o "copia e cola" → o Mercado Pago avisa no webhook `/api/pagamentos/webhook` → o servidor confere o pagamento na API e só então soma os créditos.
- O crédito só entra quando o **webhook** confirmar e a consulta à API do Mercado Pago bater (nunca pelo retorno da tela). O webhook é idempotente: o mesmo pagamento nunca credita duas vezes (`pagamento_id unique`).
- Variáveis: `MP_ACCESS_TOKEN` (credencial de produção) e `MP_WEBHOOK_SECRET` (assinatura do webhook). Para testar, as credenciais de teste do Mercado Pago.
- Créditos não expiram (ou expiram em 12 meses; decidir).
- Se quiser a referência ao dólar: "US$ 0.99 / R$ 4,99" no pacote do meio funciona como chamariz visual, mas cobrar em reais simplifica nota e Pix.

## 5. LGPD (mínimo necessário)

- O telefone é dado pessoal: página de **Política de Privacidade** e caixa de aceite no cadastro.
- Usar o número só para login (e, se a pessoa marcar à parte, para novidades).
- Botão **"Excluir minha conta"**, que apaga telefone, sessões e o vínculo das buscas.
- Fingerprint e IP continuam guardados só como hash.

## 6. Ordem sugerida

1. **Postgres + migração** de `store.js` e `cota.js` (sem mudar nada na tela). Testar que tudo continua igual.
2. **Corte no servidor**: visitante recebe 3 resultados + banner.
3. **Cadastro por WhatsApp** (Evolution API, modo texto ou template), sessões e tela "Minha conta".
4. **Limites da conta grátis** (2/semana, 5/mês) com contador na tela.
5. **Créditos**: pacotes, Pix pelo Mercado Pago, webhook e extrato.
6. **Correção de digitação com IA** na busca por título (recurso pago, como combinado para a v2).

## Decisões

Já decididas (04/10/2026):
- [x] Envio do código: Evolution API (modo oficial com template ou Baileys; o app aceita os dois).
- [x] Pagamentos: Mercado Pago, com Pix.
- [x] Semana e mês de calendário (segunda a domingo; dia 1 ao fim do mês), fuso de Brasília.
- [x] Quem se cadastra depois da busca grátis ganha a semana inteira (2 buscas).
- [x] Banco: Postgres como serviço no Dokploy.

Em aberto:
- [ ] Modo da Evolution: oficial (template) ou Baileys? Se for Baileys, qual número dedicado.
- [ ] Valores e nomes dos pacotes.
- [ ] Créditos expiram?
