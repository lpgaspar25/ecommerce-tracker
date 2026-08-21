# Integração Telegram

Manda pro seu Telegram, em **português** e no **horário do seu dispositivo**:

- **Lucro do dia** (total) em horários fixos que você escolhe.
- **Lucro por produto** (R$ e % de margem).
- **Variação intradiária**: compara a leitura de agora com a anterior e com a
  abertura do dia — _"Óculos Ferrari GTC: às 08h R$ 1.000 (35%) → agora R$ 800
  (28%), −R$ 200 / −7 p.p."_
- **Alertas** por regra: virou prejuízo, queda forte de lucro/margem, margem
  abaixo do mínimo, gasto sem venda.
- **Resultado de testes** (validado ✅ / reprovado ❌).
- **Atualizações/análises** (espelha os alertas do app).

Tudo é opcional e desligável. Sem configurar, o app funciona igual a antes.

## 1. Criar o bot (2 min)

1. No Telegram, abra **@BotFather** → `/newbot` → copie o **token**
   (`123456789:AAH...`).
2. Abra **@userinfobot** e mande qualquer coisa → copie seu **Chat ID**.
3. Mande uma mensagem qualquer pro **seu** bot (destrava o 1º envio).

## 2. Conectar no app

Menu do perfil (canto inferior) → **Telegram**. Cole o **Chat ID**, escolha o
modo, clique **Enviar teste**. Depois ligue **Ativar notificações** e ajuste
horários/categorias.

### Modos de envio

| Modo | Como funciona | Quando usar |
|------|----------------|-------------|
| **Automático** | Tenta o servidor (`/api/telegram`); se não estiver configurado, usa o token local. | Recomendado. |
| **Só servidor** | O token fica como *secret* no Cloudflare; o navegador nunca o vê. | Mais seguro. Exige o passo 3. |
| **Direto** | O token fica no navegador e fala direto com o Telegram. Funciona na hora, sem deploy. | Teste rápido. |

## 3. (Opcional) Token no servidor — modo seguro

A Pages Function `/api/telegram` guarda o token. Ela só roda no deploy do
Cloudflare Pages (via `deploy.sh`), **não** no GitHub Pages.

```bash
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name app-calculadora-lucas
# opcional: um chat id padrão
npx wrangler pages secret put TELEGRAM_CHAT_ID --project-name app-calculadora-lucas
./deploy.sh "telegram: proxy no servidor"
```

## 4. (Opcional) Receber com o app FECHADO — Worker cron

Enquanto a aba do app estiver aberta, o resumo/alertas saem do próprio
navegador. Para receber também com tudo fechado, publique o worker agendado em
[`workers/telegram-cron`](workers/telegram-cron/README.md) — ele lê o Supabase e
envia de hora em hora no seu fuso.

## Como o lucro é calculado

Usa exatamente a fórmula do diário (`DiaryModule.getEntryProfit`), somando por
produto os lançamentos do dia (dedup por dia+produto, ignora sub-entradas de
campanha), em USD e convertido pra BRL com a mesma taxa do app:

```
lucro = receita − custo×vendas − receita×imposto% − receita×custosVariáveis% − gasto
```

## Arquivos

- `js/telegram.js` — módulo do app (config, UI, agendador local, snapshots, alertas).
- `functions/api/telegram.js` — proxy same-origin (guarda o token no servidor).
- `workers/telegram-cron/` — worker agendado para o app fechado.
