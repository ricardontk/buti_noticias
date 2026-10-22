"""Valida o config.yaml do app contra o schema real do Home Assistant Supervisor.

Replica as regras de supervisor/apps/validate.py (SCHEMA_APP_CONFIG) para os
campos que o app usa. Uso:
    python validar-addon.py <caminho-do-config.yaml>
"""
import re
import sys

import voluptuous as vol
import yaml
from awesomeversion import AwesomeVersion

ARCH_ALL_COMPAT = ["aarch64", "amd64", "armhf", "armv7", "i386"]
RE_SLUG = r"[-_.A-Za-z0-9]+"
RE_VOLUME = re.compile(
    r"^(data|config|ssl|local_apps|addons|backup|share|media|homeassistant_config"
    r"|all_app_configs|all_addon_configs|app_config|addon_config)(?::(rw|ro))?$"
)
RE_SCHEMA_ELEMENT = re.compile(
    r"^(?:"
    r"|bool"
    r"|email"
    r"|url"
    r"|port"
    r"|device(?:\((?P<filter>subsystem=[a-z]+)\))?"
    r"|str(?:\((?P<s_min>\d+)?,(?P<s_max>\d+)?\))?"
    r"|password(?:\((?P<p_min>\d+)?,(?P<p_max>\d+)?\))?"
    r"|int(?:\((?P<i_min>-?\d+)?,(?P<i_max>-?\d+)?\))?"
    r"|float(?:\((?P<f_min>-?\d*\.?\d+)?,(?P<f_max>-?\d*\.?\d+)?\))?"
    r"|match\((?P<match>.*)\)"
    r"|list\((?P<list>.+)\)"
    r")\??$"
)


def version_tag(value):
    if value is None:
        return None
    if isinstance(value, str):
        return AwesomeVersion(value)
    if isinstance(value, float):
        return AwesomeVersion(str(value))
    raise vol.Invalid(f"Version {value} is not a valid tag")


def docker_ports(value):
    """'8090/tcp': 8090 -> ok. So aceita '8090' (string) ou 8090 (int)."""
    out = {}
    for chave, porta in value.items():
        if porta is None:
            out[chave] = None
        elif isinstance(porta, int):
            out[chave] = porta
        else:
            out[chave] = porta
    return out


def mapa(value):
    """Aceita a forma antiga ('share:rw') e a nova ({type: share})."""
    for item in value:
        if isinstance(item, str):
            if not RE_VOLUME.match(item):
                raise vol.Invalid(f"mapa invalido: {item!r}")
        else:
            if "type" not in item:
                raise vol.Invalid(f"mapa invalido: {item!r}")
    return value


def elemento(valor):
    return vol.Any(
        vol.Match(RE_SCHEMA_ELEMENT),
        [vol.Any(vol.Match(RE_SCHEMA_ELEMENT), {str: vol.Self})],
        {str: vol.Self},
    )(valor)


def validar_valor(tipo, valor):
    """Confere o valor da opção contra o tipo declarado no schema.

    É o mesmo check que o Supervisor faz: `list(a|b|c)` exige que o valor seja
    um dos itens da lista, `int(1,20)` exige inteiro no intervalo, etc.
    """
    tipo = str(tipo).strip()
    if tipo.endswith("?"):
        tipo = tipo[:-1].strip()

    if tipo.startswith("list(") and tipo.endswith(")"):
        opcoes = [o.strip() for o in tipo[5:-1].split("|")]
        if str(valor) not in opcoes:
            return False, f"o valor precisa ser um destes: {', '.join(opcoes)}"
        return True, ""

    if tipo.startswith("match(") and tipo.endswith(")"):
        padrao = tipo[6:-1]
        if not re.match(padrao, str(valor)):
            return False, f"o valor não casa com /{padrao}/"
        return True, ""

    if tipo == "bool":
        if isinstance(valor, bool):
            return True, ""
        if str(valor).lower() in ("true", "false"):
            return True, ""
        return False, "o valor precisa ser verdadeiro ou falso"

    if tipo == "port":
        try:
            porta = int(valor)
        except (TypeError, ValueError):
            return False, "o valor precisa ser um número de porta"
        if not 1 <= porta <= 65535:
            return False, "a porta precisa estar entre 1 e 65535"
        return True, ""

    if tipo.startswith("int(") and tipo.endswith(")"):
        limites = tipo[4:-1].split(",")
        minimo = int(limites[0]) if limites[0].strip() else None
        maximo = int(limites[1]) if len(limites) > 1 and limites[1].strip() else None
        if isinstance(valor, bool) or not isinstance(valor, (int, str)):
            return False, "o valor precisa ser um número inteiro"
        try:
            numero = int(valor)
        except (TypeError, ValueError):
            return False, "o valor precisa ser um número inteiro"
        if minimo is not None and numero < minimo:
            return False, f"o valor precisa ser >= {minimo}"
        if maximo is not None and numero > maximo:
            return False, f"o valor precisa ser <= {maximo}"
        return True, ""

    if tipo.startswith("float(") and tipo.endswith(")"):
        try:
            float(valor)
        except (TypeError, ValueError):
            return False, "o valor precisa ser um número"
        return True, ""

    if tipo in ("str", "password", "email", "url"):
        if not isinstance(valor, str):
            return False, "o valor precisa ser texto"
        if tipo == "email" and "@" not in valor:
            return False, "o valor precisa ser um e-mail"
        return True, ""

    return True, ""


SCHEMA = vol.Schema(
    {
        vol.Required("name"): str,
        vol.Required("version"): version_tag,
        vol.Required("slug"): vol.Match(RE_SLUG),
        vol.Required("description"): str,
        vol.Required("arch"): [vol.In(ARCH_ALL_COMPAT)],
        vol.Optional("startup", default="application"): str,
        vol.Optional("boot", default="auto"): str,
        vol.Optional("init", default=True): vol.Boolean(),
        vol.Optional("ingress", default=False): vol.Boolean(),
        vol.Optional("ingress_port", default=8099): vol.Any(int, vol.Equal(0)),
        vol.Optional("panel_icon", default="mdi:puzzle"): str,
        vol.Optional("panel_title"): str,
        vol.Optional("panel_admin", default=True): vol.Boolean(),
        vol.Optional("homeassistant"): version_tag,
        vol.Optional("homeassistant_api", default=False): vol.Boolean(),
        vol.Optional("hassio_api", default=False): vol.Boolean(),
        vol.Optional("hassio_role", default="default"): str,
        vol.Optional("ports"): docker_ports,
        vol.Optional("map", default=list): mapa,
        vol.Optional("options", default={}): dict,
        vol.Optional("schema", default={}): {str: elemento},
    }
)


def main():
    caminho = sys.argv[1] if len(sys.argv) > 1 else "config.yaml"
    # o console do Windows é cp1252 e não aguenta emoji (ex.: "💬")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    with open(caminho, encoding="utf-8") as arquivo:
        bruto = yaml.safe_load(arquivo)

    print(f"Validando {caminho}\n")

    # valores validos minimos, para isolar o erro no campo testado
    base = {
        "name": "x",
        "version": "1.0.0",
        "slug": "x",
        "description": "x",
        "arch": ["aarch64"],
        "options": {},
        "schema": {},
    }

    erros = 0
    for chave, valor in bruto.items():
        try:
            SCHEMA({**base, chave: valor})
            print(f"  ok    {chave}")
        except vol.Invalid as erro:
            onde = ".".join(str(p) for p in erro.path)
            if not onde or onde == chave:
                erros += 1
                print(f"  ERRO  {chave}: {erro.msg}")
            else:
                print(f"  ok    {chave}   (erro em '{onde}': {erro.msg})")

    # --- valores das opções contra o schema (o mesmo check do Supervisor) ---
    print("\n  valores das opções:")
    opcoes = bruto.get("options") or {}
    tipos = bruto.get("schema") or {}
    for chave, valor in opcoes.items():
        if chave not in tipos:
            erros += 1
            print(f"  ERRO  {chave}: não tem entrada no schema")
            continue
        ok, motivo = validar_valor(tipos[chave], valor)
        if ok:
            print(f"  ok    {chave} = {valor!r}  (schema: {tipos[chave]})")
        else:
            erros += 1
            print(f"  ERRO  {chave} = {valor!r}  (schema: {tipos[chave]}) — {motivo}")

    # opções declaradas no schema mas ausentes em options
    for chave in tipos:
        if chave not in opcoes:
            print(f"  --    {chave}: no schema, mas sem valor padrão em options")

    print()
    try:
        SCHEMA(bruto)
        if erros:
            print(f"RESULTADO: config.yaml tem {erros} problema(s) — veja acima.")
        else:
            print("RESULTADO: config.yaml valido.")
    except vol.Invalid as erro:
        erros += 1
        print(f"RESULTADO: config.yaml INVALIDO -> {erro.msg}")

    sys.exit(1 if erros else 0)


if __name__ == "__main__":
    main()
