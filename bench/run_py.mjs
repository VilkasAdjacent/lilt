// Runs a python script with the analysis venv interpreter (cross-platform; npm on Windows uses cmd.exe).
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const cands = [join(HERE, "../analysis/.venv/Scripts/python.exe"), join(HERE, "../analysis/.venv/bin/python")];
const py = process.env.BENCH_PYTHON || cands.find(existsSync);
if (!py) { console.error("analysis venv python not found; set BENCH_PYTHON"); process.exit(1); }
const r = spawnSync(py, ["-u", ...process.argv.slice(2)], { stdio: "inherit", cwd: HERE });
process.exit(r.status ?? 1);
