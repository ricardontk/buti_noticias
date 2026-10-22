/**
 * scripts/verificar.js — verificação completa antes de publicar.
 *
 * Roda:
 *   1. validador do config.yaml contra o schema do Supervisor (Python)
 *   2. node --check em todos os .js
 *   3. os testes (ponte com o HA, canais, fila web)
 *
 * Uso: node scripts/verificar.js  (ou: npm run verificar)
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
let falhas = 0;

function titulo(t) {
    console.log(`\n=== ${t} ===`);
}

function rodar(comando, args, opcoes = {}) {
    const r = spawnSync(comando, args, {
        cwd: RAIZ,
        encoding: "utf8",
        // shell:false — no Windows, o caminho do Node tem espaço
        // ("C:\Program Files\nodejs\node.exe") e o shell quebraria.
        shell: false,
        ...opcoes,
    });
    const saida = `${r.stdout || ""}${r.stderr || ""}`.trim();
    if (saida) console.log(saida);
    return r.status === 0;
}

// ---------------------------------------------------------------- 1. python
titulo("1. config.yaml contra o schema do Supervisor");
let python = null;
for (const candidato of ["python", "python3", "py"]) {
    const r = spawnSync(candidato, ["--version"], { encoding: "utf8", shell: process.platform === "win32" });
    if (r.status === 0) {
        python = candidato;
        break;
    }
}
if (!python) {
    console.log("⚠️  Python não encontrado — pulando a validação do config.yaml.");
    console.log("    (instale: pip install voluptuous awesomeversion pyyaml)");
} else if (!rodar(python, [path.join("scripts", "validar-addon.py"), "config.yaml"])) {
    console.log("❌ config.yaml inválido");
    falhas += 1;
}

// ------------------------------------------------------------ 2. sintaxe js
titulo("2. Sintaxe dos arquivos JavaScript");
const js = [];
(function varrer(dir) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entrada.name === "node_modules" || entrada.name === ".git" || entrada.name === ".agents") continue;
        const caminho = path.join(dir, entrada.name);
        if (entrada.isDirectory()) varrer(caminho);
        else if (entrada.name.endsWith(".js")) js.push(path.relative(RAIZ, caminho));
    }
})(RAIZ);
let quebrados = 0;
for (const arquivo of js) {
    const r = spawnSync(process.execPath, ["--check", arquivo], { cwd: RAIZ, encoding: "utf8" });
    if (r.status !== 0) {
        console.log(`❌ ${arquivo}\n${(r.stderr || "").trim()}`);
        quebrados += 1;
    }
}
if (quebrados) falhas += quebrados;
else console.log(`✅ ${js.length} arquivo(s) sem erro de sintaxe.`);

// --------------------------------------------------------------- 3. testes
const testes = [
    ["scripts/teste-ha.js", "ponte com o Home Assistant"],
    ["scripts/teste-publicacao.js", "publicação em canais"],
    ["scripts/teste-fila-web.js", "fila de aprovação pela API"],
    ["scripts/teste-resolver.js", "resolução de links do Google News"],
    ["scripts/teste-artigo.js", "texto das matérias (sem navegador)"],
    ["scripts/teste-link.js", "link publicado (nunca quebrado)"],
];
for (const [arquivo, nome] of testes) {
    titulo(`3. Teste: ${nome}`);
    if (!fs.existsSync(path.join(RAIZ, arquivo))) {
        console.log(`⚠️  ${arquivo} não existe — pulando.`);
        continue;
    }
    if (!rodar(process.execPath, [arquivo])) {
        console.log(`❌ falhou: ${nome}`);
        falhas += 1;
    }
}

// --------------------------------------------------------------- resultado
console.log("\n=========================================");
if (falhas) {
    console.log(`❌ FALHOU: ${falhas} problema(s). NÃO PUBLIQUE.`);
    process.exit(1);
}
console.log("✅ TUDO CERTO — pode publicar.");
process.exit(0);
