# AGENTS.md — regras para quem mexe neste projeto (agente ou pessoa)

Este projeto é um **App (add-on) do Home Assistant**. Ele é **instalado a partir do
repositório do GitHub**, então qualquer erro aqui aparece na casa do usuário —
e often só depois de um build de vários minutos no Raspberry Pi.

## Regra de ouro

> **NUNCA publique (git push) sem rodar a verificação completa.**
> Ela leva segundos e já pegou bugs que custaram um reinstall do app.

```bash
npm run verificar     # valida o config.yaml + roda todos os testes
```

Se qualquer linha falhar, **corrija antes de dar push**. Se não der para
corrigir, **não publique** — deixe o commit local e explique o motivo.

## O que `npm run verificar` faz

1. `python scripts/validar-addon.py config.yaml` — valida o `config.yaml` contra o
   **schema real do Home Assistant Supervisor** (não é o do Sensei, é o do
   Supervisor). Confere:
   - se os campos do app estão no formato aceito (nomes, tipos);
   - se **cada valor** de `options` é aceito pelo `schema` correspondente;
   - se não há chaves desconhecidas (o Supervisor **rejeita** o app inteiro).
2. `node --check` em todos os arquivos de `src/`, `painel/` e `scripts/`.
3. Os testes:
   - `scripts/teste-ha.js` — ponte com o Home Assistant (sobe um HA falso);
   - `scripts/teste-publicacao.js` — publicação em um ou mais canais;
   - `scripts/teste-fila-web.js` — fila de aprovação pela API (como o painel usa).

Requer Python com `voluptuous`, `awesomeversion` e `pyyaml`
(`pip install voluptuous awesomeversion pyyaml`).

## Armadilhas do Supervisor (já mordem)

| Armadilha | O que fazer |
|---|---|
| `options` e `schema` são coisas diferentes | Em `options` vai o **valor** (`"reserva"`), em `schema` vai o **tipo** (`"list(reserva|todos)"`) |
| `homeassistant: true` é inválido | `homeassistant` espera uma **versão**. Para a API do HA use `homeassistant_api: true` |
| `hassio_api` ≠ `homeassistant_api` | `hassio_api` libera a API do *Supervisor*; `homeassistant_api` libera o proxy `/core/api` do *HA* |
| Chave desconhecida = app invisível | O Supervisor **rejeita** o app inteiro e ele não aparece na loja |
| O `run.sh` precisa de bashio | Shebang obrigatório: `#!/usr/bin/with-contenv bashio` — é ele que lê as opções do app |
| Versão não increased = sem atualização | O Supervisor só oferece *Atualizar* se a versão do `config.yaml` for **maior** que a instalada |
| Erro de validação expõe segredos | O Supervisor imprime as opções em texto puro no erro — nunca com chave real |

## Publicação

```bash
npm run verificar        # obrigatório
git add -A
git commit -m "..."
git push
```

Antes do push, confira:

- [ ] `version` no `config.yaml` **subiu** (ex.: `1.3.2` → `1.3.3`);
- [ ] `CHANGELOG.md` tem a entrada da versão;
- [ ] nenhum dado pessoal no que vai publicar (telefone, ID de canal, chave de API);
- [ ] `npm run verificar` passou inteiro.

## Segredos

O repositório é **público**. Não entram nele: telefone, ID do canal, chave da
Groq, token do painel. Esses valores ficam nas **opções do app** (no banco do
Home Assistant) e no `/share/bot_noticias/config.json` do volume.

## Código

- Português nos comentários e nas mensagens que o usuário vê.
- Sem `console.log` de depuração no caminho quente (o log do app é lido no
  celular).
- Node sem dependências novas: o build roda num Raspberry Pi 4.
- `src/ha.js` nunca deve derrubar o bot: se o HA estiver fora, o bot continua
  funcionando e só o log reclama.
