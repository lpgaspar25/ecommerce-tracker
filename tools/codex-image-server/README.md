# Codex Image Server

Ponte local que deixa o app **gerar imagens usando a sua conta ChatGPT** (via
Codex), em vez de gastar API key. O navegador manda o prompt + as fotos de
referência pra este servidor; ele gera a imagem, **salva em `saidas/`** e
devolve pro app, que mostra na tela.

## Passo a passo

**1. Faça login no Codex com a conta ChatGPT** (uma vez):

```bash
codex login
```

Isso grava os tokens em `~/.codex/auth.json` (`auth_mode: "chatgpt"`). Se você
já usa o app do Codex logado, esse arquivo já existe — não precisa refazer.

**2. Suba o servidor** (não precisa instalar nada — só Node 18+):

```bash
node server.js
```

Deve aparecer `Codex Image Server em http://localhost:8791` e a linha de `auth:`
dizendo `conta ChatGPT ✓`.

**3. No app** → aba **Modelos** (ou Estúdio) → em **"Gerar com"** escolha
**"Codex (local · ChatGPT)"** → clique em Gerar. Pronto.

## Testar rápido

```bash
curl http://localhost:8791/status
```

Modo de teste sem gastar nada (gera um PNG cinza de mentira):

```bash
MOCK=1 node server.js
```

## Como funciona (e o aviso honesto)

O servidor tenta **dois caminhos**, nesta ordem:

1. **Conta ChatGPT (assinatura)** — usa o `access_token` do `~/.codex/auth.json`
   contra o endpoint interno do Codex. É o que **não custa** por imagem.
   ⚠️ **Endpoint interno / não-oficial**: pode parar de funcionar quando a
   OpenAI mudar, e usar a assinatura assim é zona cinza de ToS da sua conta.
2. **API key (fallback)** — se o caminho acima falhar e você tiver uma
   `OPENAI_API_KEY`, ele usa o endpoint oficial. **Esse cobra por imagem.**

Se o caminho 1 der `401`/`403`/"sem imagem", é sinal de que a sua conta não
libera geração de imagem por esse endpoint — aí a saída é usar API key:

```bash
OPENAI_API_KEY=sk-... node server.js
```

## Ajustes (variáveis de ambiente)

| Variável | Padrão | Pra quê |
|---|---|---|
| `PORT` | `8791` | Porta. Se mudar, ajuste no app: `localStorage.setItem('codex_img_server','http://localhost:NOVA')` |
| `OUT_DIR` | `./saidas` | Onde salva as imagens |
| `OPENAI_API_KEY` | — | Fallback oficial (cobra) |
| `CHATGPT_URL` | endpoint interno do Codex | Se a sua versão usar outra base |
| `CHATGPT_MODEL` | `gpt-5.6-terra` | Modelo no caminho da assinatura |
| `API_MODEL` | `gpt-5` | Modelo no caminho da API key |
| `MOCK` | — | `MOCK=1` gera um PNG falso (teste) |

## Limitações

- É **local**: só funciona na sua máquina, com o servidor rodando. Não vale pra
  outras pessoas nem no celular.
- O caminho da assinatura é experimental (ver aviso acima).
