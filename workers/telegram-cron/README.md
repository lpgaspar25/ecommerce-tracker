# telegram-cron

Worker agendado que envia o **lucro do dia** (total e por produto) e **alertas
de variação** pro Telegram **mesmo com o app fechado**. Lê o Supabase (mesmas
tabelas `diary`/`products` que o app sincroniza) e usa o KV compartilhado pra
guardar snapshots intradiários e comparar leituras ("às 08h R$1000/35% → às 10h
R$800/28%, −R$200/−7pp").

> Enquanto o app estiver **aberto**, o próprio `js/telegram.js` já faz isso no
> navegador. Este worker cobre o horário em que o app está fechado.

## Deploy

```bash
cd workers/telegram-cron

# 1) secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN     # token do @BotFather
npx wrangler secret put TELEGRAM_CHAT_ID       # seu chat id
npx wrangler secret put SUPABASE_KEY           # anon OU service_role (ver RLS)

# 2) ajuste o wrangler.toml [vars] (TZ, SUMMARY_HOURS, QUIET_*, USER_ID)

# 3) publique (registra o cron)
npx wrangler deploy
```

## Testar

```bash
# dispara na hora, ignorando janela de resumo/silêncio:
curl "https://telegram-cron.<sua-conta>.workers.dev/?run=1&force=1"
```

## Config

| Var | O que é |
|-----|---------|
| `TZ` | Fuso **do cliente**. Define o corte do dia e os horários. Ex.: `America/Sao_Paulo`. |
| `SUMMARY_HOURS` | Horas (nesse fuso) que disparam o resumo completo. Ex.: `9,12,15,18,21`. |
| `QUIET_START` / `QUIET_END` | Janela de silêncio (horas). Ex.: `23`/`7`. |
| `USER_ID` | Opcional. Filtra `diary`/`products` por `user_id` (o `id` do usuário no Supabase). |

Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SUPABASE_KEY`.

## Sobre RLS

Se as tabelas do Supabase têm Row Level Security (padrão do projeto, por
`user_id`), a **chave publishable/anon não lê** as linhas via REST. Nesse caso
use a **`service_role`** como `SUPABASE_KEY` (é um secret, não vai pro código) e,
se quiser garantir escopo, defina `USER_ID`. Sem uma chave que leia as linhas, o
worker roda mas não encontra dados.

## Custo

Roda 1x/hora (24 execuções/dia), muito abaixo do free tier de Workers.
O cron está em **UTC**; a lógica de "que horas são pro cliente" usa `TZ`.
