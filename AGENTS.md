# Instruções para agentes de IA (Codex, Claude, etc.)

## Regra #1 — esta é A pasta

Este repositório (`/Users/lucas/Documents/Claude/Projects/ecommerce-tracker`) é
o **único lugar canônico** de trabalho. Nunca crie ou trabalhe numa cópia dele
em outro caminho. Se você foi aberto em qualquer outra pasta com um nome
parecido (ex.: "APP CALCULADORA - cópia", "Downloads/..."), **pare e avise o
usuário** — provavelmente é uma cópia antiga/errada.

Existem cópias secundárias (não editar diretamente):
- `~/Documents/Claude/Projects/ecommerce-tracker` ← **esta, a canônica**
- `~/Downloads/_Duplicatas-Para-Revisar/APP CALCULADORA - cópia` — espelho de
  teste (serve `localhost:8090`), sincronizado a partir daqui via `deploy.sh`.
  Nunca edite lá primeiro.

## Regra #2 — sincronize ANTES de editar

No início de toda sessão, antes de tocar em qualquer arquivo:

```bash
git fetch origin
git status
git log --oneline HEAD..origin/main   # tem commit novo que você não tem?
```

Se `origin/main` estiver à frente, rode `git pull origin main` (ou
`git rebase origin/main` se você já tiver commits locais) **antes** de
começar a editar. Nunca comece a trabalhar sobre uma base desatualizada —
foi exatamente isso que causou duas rodadas de mesclagem manual dolorosa
neste projeto.

## Regra #3 — commit + push ao terminar (não deixe nada solto)

Ao concluir uma mudança (mesmo pequena, mesmo "só um teste"):

```bash
git add -A
git commit -m "mensagem clara do que mudou e por quê"
git push origin main
```

**Nunca** encerre uma sessão com mudanças não commitadas ou commitadas-mas-não-
enviadas. Trabalho que fica só local (sem `push`) é invisível pra qualquer
outro agente (incluindo você mesmo, numa sessão futura) e para o usuário —
ele já se perdeu de vista uma vez por causa disso.

Se o trabalho está genuinamente incompleto no fim da sessão, ainda assim
commit (mesmo que seja um WIP) e push — não deixe só no disco.

## Regra #4 — cuidado ao rodar junto com outro agente

Se `git status` mostrar mudanças que você não fez, ou arquivos novos que não
reconhece, **não sobrescreva nem descarte** — outro agente (você mesmo em
outra janela, ou outra ferramenta como Claude Code) pode estar trabalhando
na mesma pasta ao mesmo tempo. Nesse caso:
1. Não rode `git add -A` cegamente — confira `git status`/`git diff` primeiro.
2. Se o trabalho alheio parecer relacionado ao que você está fazendo, avise
   o usuário em vez de decidir sozinho o que fazer com ele.
3. Prefira commits pequenos e frequentes a um commit gigante no fim — reduz
   a chance de um `git add -A` varrer trabalho de outro agente pra dentro
   do seu commit por acidente.

## Deploy

Depois de um `git push` bem-sucedido, o deploy pra produção
(`app-calculadora-lucas.pages.dev`, Cloudflare Pages) é feito via
`./deploy.sh` (ou o processo equivalente que o usuário/outro agente já
configurou). Não é automático no push — precisa rodar explicitamente.

## Convenções do projeto (resumo)

- 100% português brasileiro na UI.
- Vanilla HTML/CSS/JS — sem framework, sem bundler.
- Módulos são objetos-literal globais (`const NomeModulo = {...}`). A maioria
  **não** vira propriedade de `window` automaticamente — só os que têm
  `window.NomeModulo = NomeModulo;` explícito no final do arquivo. Não
  assuma; confira com `grep` antes de escrever `window.X`.
- Nunca emoji na UI — sempre ícone lucide.
- Nunca `localStorage` para dados que crescem (fotos, listas grandes) — usar
  IndexedDB (`MediaStore`/`KVStore`), que já existe no projeto.
