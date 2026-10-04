# Plano: cadastro por WhatsApp e níveis de acesso

Status: **planejamento**. Nada disto está implementado ainda.

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

### Quem envia a mensagem

| Opção | Prós | Contras |
| --- | --- | --- |
| **WhatsApp Cloud API (Meta), modelo "autenticação"** (recomendado) | Oficial, tem botão "copiar código" na mensagem, cobra por mensagem entregue | Exige conta Meta Business, número dedicado e aprovação do modelo (alguns dias). Preço por mensagem na tabela da Meta para o Brasil (centavos) |
| Twilio Verify (WhatsApp + SMS de reserva) | Pronto em uma tarde, já cuida de tentativas e expiração | Mais caro por verificação |
| APIs não oficiais (Z-API, Evolution e similares) | Baratas e rápidas | Risco de banimento do número e de violar os termos do WhatsApp. **Não recomendo.** |

Sugestão: começar com o Twilio Verify para validar a ideia e migrar para a Cloud API quando o volume justificar.

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
  pagamento_id text unique,         -- id no Mercado Pago/Stripe
  criado_em   timestamptz not null default now()
);
```

O limite da conta grátis sai de uma consulta simples em `buscas` (quantas nesta semana e neste mês). A trava do visitante (hoje `data/cota.json`) passa a usar a mesma tabela.

A migração é localizada: `lib/store.js` (fichas) e `lib/cota.js` (trava) são os únicos módulos que leem e gravam dados. O resto do app não muda.

## 4. Créditos (fase seguinte)

Custo real de uma busca hoje: de **US$ 0,001 a 0,007** (R$ 0,01 a R$ 0,04). Qualquer preço "de troco" já paga a conta.

Sugestões de pacote, no espírito do "1,99":

| Pacote | Preço | Buscas | Preço por busca |
| --- | --- | --- | --- |
| Pipoca | R$ 1,99 | 5 | R$ 0,40 |
| Sessão dupla | R$ 4,99 | 15 | R$ 0,33 |
| Maratona | R$ 9,90 | 40 | R$ 0,25 |

- **Pix** como meio principal (Mercado Pago ou Stripe com Pix). Em valores tão pequenos, a tarifa fixa do cartão come boa parte do valor; no Pix a tarifa é percentual e baixa.
- O crédito só entra quando o **webhook** de pagamento confirmar (nunca pelo retorno da tela).
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
3. **Cadastro por WhatsApp** (Twilio Verify para começar), sessões e tela "Minha conta".
4. **Limites da conta grátis** (2/semana, 5/mês) com contador na tela.
5. **Créditos**: pacotes, Pix, webhook e extrato.
6. **Correção de digitação com IA** na busca por título (recurso pago, como combinado para a v2).

## Decisões em aberto

- [ ] Twilio Verify para começar, ou ir direto para a Cloud API da Meta?
- [ ] Semana e mês de calendário, ou janelas móveis (7 e 30 dias)?
- [ ] Valores e nomes dos pacotes.
- [ ] Créditos expiram?
- [ ] O visitante que se cadastra depois da busca grátis ganha a semana inteira (2 buscas) ou desconta a que já fez?
