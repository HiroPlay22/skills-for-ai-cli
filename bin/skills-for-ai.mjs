#!/usr/bin/env node
// skills-for-ai CLI — install a purchased Skill/Agent with one command.
//
//   npx @skills-for-ai/cli add <skill> --token <token> [--tool <t>]... [--global|--project] [--lang <l>]
//
// Fetches the files via the deliver edge function (JSON, no ZIP) and drops them tool-natively
// ("native drops"). Tool detection happens locally — like skills.sh: we check which tool config
// folders exist; the server only delivers files. See docs/npx-cli-delivery-plan.md.
//
// Language: default English. --lang de|fr|es switches the output language. Our website bakes the
// visitor's language into the copied command (--lang ..), so buyers get their language automatically;
// a raw `npx ...` without the flag stays English (dev-tooling convention).

import { parseArgs } from "node:util";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";

const HOME = homedir();
const CWD = process.cwd();
const DEFAULT_ENDPOINT = "https://xoaioslxbjmpczwsnzdl.supabase.co";

// Colors only on TTY (no dependency).
const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c(1, s), dim = (s) => c(2, s), green = (s) => c(32, s), red = (s) => c(31, s), yellow = (s) => c(33, s), cyan = (s) => c(36, s);

// --- i18n -----------------------------------------------------------------
// Default English. Interpolated strings are functions. Unknown lang -> English.
const STR = {
  en: {
    where_global: "global", where_project: "project",
    detected: (l) => `Detected tools: ${l}`,
    noToolDetected: "No tool detected — using Claude Code. (Pick one explicitly with --tool.)",
    fetching: (s) => `Fetching '${s}' ...`,
    connFailed: (m) => `Could not reach the delivery endpoint: ${m}`,
    e_invalid_token: "Token invalid, revoked, or not for this skill.",
    e_skill_not_found: (s) => `Skill '${s}' not found.`,
    e_missing_token: "No token submitted.",
    e_missing_skill: "No skill submitted.",
    e_file_not_available: "No file is (yet) available for this skill.",
    e_server: (st, e) => `Server error (${st}): ${e}`,
    e_unknown_action: (a) => `Unknown action '${a}'. Supported: add, remove, doctor.`,
    e_no_skill: "No skill given. Example: add website-doktor --token ...",
    e_no_token: "No --token given. You'll find your token under 'My Skills'.",
    e_both_scope: "Specify only one of --global / --project.",
    e_unknown_tools: (bad, all) => `Unknown tool(s): ${bad}. Allowed: ${all}`,
    e_no_files: "Server returned no files.",
    e_unsafe_path: (r) => `unsafe path: ${r}`,
    noGlobalPath: (label) => `${label}: no global path known — installing into the project.`,
    unknownFromServer: (k) => `Unknown tool from server: ${k} — skipped.`,
    unsupported: (l) => `No content for: ${l} (skill doesn't offer this platform).`,
    written: (labels, where, n, base) => `${labels} (${where}): ${n} file(s) -> ${dim(base)}`,
    installedOk: (name, ver, n) => `'${name}' v${ver} installed (${n} file(s)).`,
    claudeHint: "Claude Code loads skills automatically. Agents: call via /<name>.",
    geminiHint: (cmd) => `Enable Gemini: ${cmd}`,
    removing: (s) => `Removing '${s}' ...`,
    removed: (label, dir) => `${label}: removed -> ${dim(dir)}`,
    removedBlock: "AGENTS.md: removed our marked block — your other content was kept.",
    nothingFound: (s) => `Nothing found for '${s}' — nothing removed. (Try --global or --project, or name the --tool.)`,
    removedOk: (s, n) => `'${s}' removed (${n} location(s)).`,
    e_rate_limited: "Too many requests right now — please wait a moment and try again.",
    overwriteWarn: (n) => `${n} existing file(s) would be overwritten:`,
    overwriteAsk: "Overwrite them? [y/N] ",
    overwriteAbort: "Aborted — nothing was changed.",
    overwriteForceHint: "Non-interactive run — the existing files are being overwritten (update).",
    hashMismatch: (f) => `integrity check failed for ${f} — checksum did not match.`,
    integrityOk: (n) => `Integrity verified (${n} file(s), SHA-256).`,
    help: (tools, ep) => `${bold("skills-for-ai")} — install purchased Skills & Agents with one command

${bold("Usage:")}
  npx @skills-for-ai/cli add <skill> --token <token> [options]
  npx @skills-for-ai/cli remove <skill> [--tool <key>]... [--global|--project]   (local, no token)
  npx @skills-for-ai/cli doctor

${bold("Options:")}
  --token <token>     Your token from 'My Skills' (required).
  --tool <key>        Target tool (repeatable): ${tools}.
                      Without this, installed tools are auto-detected.
  --tool '*'          All detected tools.
  --global            Install globally (default where the tool supports it).
  --project           Install into the current project.
  --lang <l>          Output language: en, de, fr, es (default: en).
  --endpoint <url>    Override the delivery endpoint (default: ${ep}).
  --yes               No questions asked (also confirms overwrites).
  --force             Overwrite existing files without asking.
  --help              This help.

${bold("Example:")}
  npx @skills-for-ai/cli add website-doktor --token sfa_live_...`,
  },
  de: {
    where_global: "global", where_project: "Projekt",
    detected: (l) => `Erkannte Tools: ${l}`,
    noToolDetected: "Kein Tool erkannt — verwende Claude Code. (Mit --tool gezielt waehlen.)",
    fetching: (s) => `Hole '${s}' ...`,
    connFailed: (m) => `Verbindung zum Liefer-Endpoint fehlgeschlagen: ${m}`,
    e_invalid_token: "Token ungueltig, widerrufen oder gehoert nicht zu diesem Skill.",
    e_skill_not_found: (s) => `Skill '${s}' nicht gefunden.`,
    e_missing_token: "Kein Token uebermittelt.",
    e_missing_skill: "Kein Skill uebermittelt.",
    e_file_not_available: "Fuer diesen Skill ist (noch) keine Datei hinterlegt.",
    e_server: (st, e) => `Server-Fehler (${st}): ${e}`,
    e_unknown_action: (a) => `Unbekannte Aktion '${a}'. Unterstuetzt: add, remove, doctor.`,
    e_no_skill: "Kein Skill angegeben. Beispiel: add website-doktor --token ...",
    e_no_token: "Kein --token angegeben. Den Token findest du unter 'Meine Skills'.",
    e_both_scope: "Nur eines von --global / --project angeben.",
    e_unknown_tools: (bad, all) => `Unbekannte(s) Tool(s): ${bad}. Erlaubt: ${all}`,
    e_no_files: "Server hat keine Dateien geliefert.",
    e_unsafe_path: (r) => `unsicherer Pfad: ${r}`,
    noGlobalPath: (label) => `${label}: kein globaler Pfad bekannt — installiere ins Projekt.`,
    unknownFromServer: (k) => `Unbekanntes Tool vom Server: ${k} — uebersprungen.`,
    unsupported: (l) => `Keine Inhalte fuer: ${l} (Skill bietet diese Plattform nicht).`,
    written: (labels, where, n, base) => `${labels} (${where}): ${n} Datei(en) -> ${dim(base)}`,
    installedOk: (name, ver, n) => `'${name}' v${ver} installiert (${n} Datei(en)).`,
    claudeHint: "Claude Code laedt Skills automatisch. Agents: per /<name> aufrufbar.",
    geminiHint: (cmd) => `Gemini aktivieren: ${cmd}`,
    removing: (s) => `Entferne '${s}' ...`,
    removed: (label, dir) => `${label}: entfernt -> ${dim(dir)}`,
    removedBlock: "AGENTS.md: unseren markierten Block entfernt — dein uebriger Inhalt bleibt.",
    nothingFound: (s) => `Nichts gefunden fuer '${s}' — nichts entfernt. (Versuche --global oder --project, oder nenne das --tool.)`,
    removedOk: (s, n) => `'${s}' entfernt (${n} Ort(e)).`,
    e_rate_limited: "Zu viele Anfragen gerade — bitte kurz warten und erneut versuchen.",
    overwriteWarn: (n) => `${n} vorhandene Datei(en) wuerden ueberschrieben:`,
    overwriteAsk: "Ueberschreiben? [j/N] ",
    overwriteAbort: "Abgebrochen — nichts veraendert.",
    overwriteForceHint: "Nicht-interaktiver Lauf — die vorhandenen Dateien werden ueberschrieben (Update).",
    hashMismatch: (f) => `Integritaetspruefung fehlgeschlagen fuer ${f} — Pruefsumme stimmt nicht.`,
    integrityOk: (n) => `Integritaet geprueft (${n} Datei(en), SHA-256).`,
    help: (tools, ep) => `${bold("skills-for-ai")} — gekaufte Skills & Agents mit einem Befehl installieren

${bold("Nutzung:")}
  npx @skills-for-ai/cli add <skill> --token <token> [Optionen]
  npx @skills-for-ai/cli remove <skill> [--tool <key>]... [--global|--project]   (lokal, kein Token)
  npx @skills-for-ai/cli doctor

${bold("Optionen:")}
  --token <token>     Dein Token aus 'Meine Skills' (Pflicht).
  --tool <key>        Ziel-Tool (mehrfach moeglich): ${tools}.
                      Ohne Angabe werden installierte Tools automatisch erkannt.
  --tool '*'          Alle erkannten Tools.
  --global            Global installieren (Default, wo das Tool es unterstuetzt).
  --project           Ins aktuelle Projekt installieren.
  --lang <l>          Ausgabesprache: en, de, fr, es (Default: en).
  --endpoint <url>    Liefer-Endpoint ueberschreiben (Default: ${ep}).
  --yes               Ohne Rueckfragen (bestaetigt auch Ueberschreiben).
  --force             Bestehende Dateien ohne Rueckfrage ueberschreiben.
  --help              Diese Hilfe.

${bold("Beispiel:")}
  npx @skills-for-ai/cli add website-doktor --token sfa_live_...`,
  },
  fr: {
    where_global: "global", where_project: "projet",
    detected: (l) => `Outils détectés : ${l}`,
    noToolDetected: "Aucun outil détecté — utilisation de Claude Code. (Précisez avec --tool.)",
    fetching: (s) => `Récupération de « ${s} » ...`,
    connFailed: (m) => `Impossible de joindre le point de livraison : ${m}`,
    e_invalid_token: "Jeton invalide, révoqué ou ne correspondant pas à ce skill.",
    e_skill_not_found: (s) => `Skill « ${s} » introuvable.`,
    e_missing_token: "Aucun jeton transmis.",
    e_missing_skill: "Aucun skill transmis.",
    e_file_not_available: "Aucun fichier n'est (encore) disponible pour ce skill.",
    e_server: (st, e) => `Erreur serveur (${st}) : ${e}`,
    e_unknown_action: (a) => `Action « ${a} » inconnue. Pris en charge : add, remove, doctor.`,
    e_no_skill: "Aucun skill indiqué. Exemple : add website-doktor --token ...",
    e_no_token: "Aucun --token indiqué. Vous trouverez votre jeton dans « Mes skills ».",
    e_both_scope: "Indiquez un seul de --global / --project.",
    e_unknown_tools: (bad, all) => `Outil(s) inconnu(s) : ${bad}. Autorisés : ${all}`,
    e_no_files: "Le serveur n'a renvoyé aucun fichier.",
    e_unsafe_path: (r) => `chemin non sûr : ${r}`,
    noGlobalPath: (label) => `${label} : aucun chemin global connu — installation dans le projet.`,
    unknownFromServer: (k) => `Outil inconnu du serveur : ${k} — ignoré.`,
    unsupported: (l) => `Aucun contenu pour : ${l} (le skill n'offre pas cette plateforme).`,
    written: (labels, where, n, base) => `${labels} (${where}) : ${n} fichier(s) -> ${dim(base)}`,
    installedOk: (name, ver, n) => `« ${name} » v${ver} installé (${n} fichier(s)).`,
    claudeHint: "Claude Code charge les skills automatiquement. Agents : appel via /<nom>.",
    geminiHint: (cmd) => `Activer Gemini : ${cmd}`,
    removing: (s) => `Suppression de « ${s} » ...`,
    removed: (label, dir) => `${label} : supprimé -> ${dim(dir)}`,
    removedBlock: "AGENTS.md : notre bloc balisé a été supprimé — ton autre contenu est conservé.",
    nothingFound: (s) => `Rien trouvé pour « ${s} » — rien supprimé. (Essaie --global ou --project, ou indique le --tool.)`,
    removedOk: (s, n) => `« ${s} » supprimé (${n} emplacement(s)).`,
    e_rate_limited: "Trop de requêtes pour le moment — patiente un instant puis réessaie.",
    overwriteWarn: (n) => `${n} fichier(s) existant(s) seraient écrasés :`,
    overwriteAsk: "Les écraser ? [o/N] ",
    overwriteAbort: "Annulé — rien n'a été modifié.",
    overwriteForceHint: "Exécution non interactive — les fichiers existants sont écrasés (mise à jour).",
    hashMismatch: (f) => `échec du contrôle d'intégrité pour ${f} — la somme de contrôle ne correspond pas.`,
    integrityOk: (n) => `Intégrité vérifiée (${n} fichier(s), SHA-256).`,
    help: (tools, ep) => `${bold("skills-for-ai")} — installez vos Skills & Agents achetés en une commande

${bold("Utilisation :")}
  npx @skills-for-ai/cli add <skill> --token <token> [options]
  npx @skills-for-ai/cli remove <skill> [--tool <key>]... [--global|--project]   (local, sans jeton)
  npx @skills-for-ai/cli doctor

${bold("Options :")}
  --token <token>     Votre jeton depuis « Mes skills » (requis).
  --tool <key>        Outil cible (répétable) : ${tools}.
                      Sans cela, les outils installés sont détectés automatiquement.
  --tool '*'          Tous les outils détectés.
  --global            Installer globalement (par défaut là où l'outil le permet).
  --project           Installer dans le projet courant.
  --lang <l>          Langue de sortie : en, de, fr, es (par défaut : en).
  --endpoint <url>    Remplacer le point de livraison (par défaut : ${ep}).
  --yes               Sans confirmation (confirme aussi l'écrasement).
  --force             Écraser les fichiers existants sans confirmation.
  --help              Cette aide.

${bold("Exemple :")}
  npx @skills-for-ai/cli add website-doktor --token sfa_live_...`,
  },
  es: {
    where_global: "global", where_project: "proyecto",
    detected: (l) => `Herramientas detectadas: ${l}`,
    noToolDetected: "No se detectó ninguna herramienta — usando Claude Code. (Elige con --tool.)",
    fetching: (s) => `Obteniendo «${s}» ...`,
    connFailed: (m) => `No se pudo contactar el endpoint de entrega: ${m}`,
    e_invalid_token: "Token no válido, revocado o no corresponde a este skill.",
    e_skill_not_found: (s) => `Skill «${s}» no encontrado.`,
    e_missing_token: "No se envió ningún token.",
    e_missing_skill: "No se envió ningún skill.",
    e_file_not_available: "Aún no hay ningún archivo disponible para este skill.",
    e_server: (st, e) => `Error del servidor (${st}): ${e}`,
    e_unknown_action: (a) => `Acción «${a}» desconocida. Compatibles: add, remove, doctor.`,
    e_no_skill: "No se indicó ningún skill. Ejemplo: add website-doktor --token ...",
    e_no_token: "No se indicó --token. Encontrarás tu token en «Mis skills».",
    e_both_scope: "Indica solo uno de --global / --project.",
    e_unknown_tools: (bad, all) => `Herramienta(s) desconocida(s): ${bad}. Permitidas: ${all}`,
    e_no_files: "El servidor no devolvió ningún archivo.",
    e_unsafe_path: (r) => `ruta no segura: ${r}`,
    noGlobalPath: (label) => `${label}: no se conoce ruta global — instalando en el proyecto.`,
    unknownFromServer: (k) => `Herramienta desconocida del servidor: ${k} — omitida.`,
    unsupported: (l) => `Sin contenido para: ${l} (el skill no ofrece esta plataforma).`,
    written: (labels, where, n, base) => `${labels} (${where}): ${n} archivo(s) -> ${dim(base)}`,
    installedOk: (name, ver, n) => `«${name}» v${ver} instalado (${n} archivo(s)).`,
    claudeHint: "Claude Code carga los skills automáticamente. Agents: llámalos con /<nombre>.",
    geminiHint: (cmd) => `Activar Gemini: ${cmd}`,
    removing: (s) => `Eliminando «${s}» ...`,
    removed: (label, dir) => `${label}: eliminado -> ${dim(dir)}`,
    removedBlock: "AGENTS.md: se eliminó nuestro bloque marcado — tu otro contenido se mantiene.",
    nothingFound: (s) => `No se encontró nada para «${s}» — no se eliminó nada. (Prueba --global o --project, o indica el --tool.)`,
    removedOk: (s, n) => `«${s}» eliminado (${n} ubicación(es)).`,
    e_rate_limited: "Demasiadas solicitudes ahora mismo — espera un momento y vuelve a intentarlo.",
    overwriteWarn: (n) => `${n} archivo(s) existente(s) se sobrescribirían:`,
    overwriteAsk: "¿Sobrescribir? [s/N] ",
    overwriteAbort: "Cancelado — no se cambió nada.",
    overwriteForceHint: "Ejecución no interactiva — los archivos existentes se sobrescriben (actualización).",
    hashMismatch: (f) => `falló la verificación de integridad de ${f} — la suma de comprobación no coincide.`,
    integrityOk: (n) => `Integridad verificada (${n} archivo(s), SHA-256).`,
    help: (tools, ep) => `${bold("skills-for-ai")} — instala los Skills & Agents comprados con un comando

${bold("Uso:")}
  npx @skills-for-ai/cli add <skill> --token <token> [opciones]
  npx @skills-for-ai/cli remove <skill> [--tool <key>]... [--global|--project]   (local, sin token)
  npx @skills-for-ai/cli doctor

${bold("Opciones:")}
  --token <token>     Tu token de «Mis skills» (obligatorio).
  --tool <key>        Herramienta destino (repetible): ${tools}.
                      Sin esto, se detectan automáticamente las herramientas instaladas.
  --tool '*'          Todas las herramientas detectadas.
  --global            Instalar globalmente (por defecto donde la herramienta lo admite).
  --project           Instalar en el proyecto actual.
  --lang <l>          Idioma de salida: en, de, fr, es (por defecto: en).
  --endpoint <url>    Sobrescribir el endpoint de entrega (por defecto: ${ep}).
  --yes               Sin preguntas (también confirma sobrescrituras).
  --force             Sobrescribir archivos existentes sin preguntar.
  --help              Esta ayuda.

${bold("Ejemplo:")}
  npx @skills-for-ai/cli add website-doktor --token sfa_live_...`,
  },
};
const pickLang = (v) => { const x = (v || "").toLowerCase().slice(0, 2); return STR[x] ? x : "en"; };
// Active string table — set in main() once --lang is parsed; English until then.
let T = STR.en;

const ok = (s) => console.log(`${green("OK")} ${s}`);
const info = (s) => console.log(`${cyan(">")} ${s}`);
const warn = (s) => console.log(`${yellow("!")} ${s}`);
// No process.exit() — that triggers the libuv assertion (UV_HANDLE_CLOSING) on Windows while the
// fetch handle is still closing. Instead set exitCode + abort cleanly via a marked error.
const die = (s) => { console.error(`${red("x")} ${s}`); process.exitCode = 1; throw Object.assign(new Error(s), { handled: true }); };

// Per-tool config. detect = home-relative markers (existence => tool present).
// globalBase = base for global install; globalRewrite = path-prefix swap only when global.
// Global paths verified against official docs (2026-06): claude ~/.claude, agents standard
// ~/.agents/skills (cursor/copilot/codex), cline ~/.cline, windsurf ~/.codeium/windsurf, gemini ~/.gemini/extensions.
const TOOLS = {
  "claude-code":    { label: "Claude Code",    detect: [".claude"],               scope: "global", globalBase: HOME },
  "gemini":         { label: "Gemini CLI",     detect: [".gemini"],               scope: "project" },  // Extension -> write into project, then `gemini extensions install` (no auto-discovery)
  "cursor":         { label: "Cursor",         detect: [".cursor"],               scope: "global", globalBase: HOME },
  "github-copilot": { label: "GitHub Copilot", detect: [".copilot"],              scope: "global", globalBase: HOME },
  "codex":          { label: "Codex CLI",      detect: [".codex"],                scope: "global", globalBase: HOME },
  "windsurf":       { label: "Windsurf",       detect: [".windsurf", ".codeium"], scope: "global", globalBase: HOME, globalRewrite: [".windsurf/", ".codeium/windsurf/"] },
  "cline":          { label: "Cline",          detect: [".cline"],                scope: "global", globalBase: HOME },
};
const ALIAS = { claude: "claude-code", "claude-code": "claude-code", copilot: "github-copilot" };
const norm = (t) => ALIAS[t] || t;
const toolList = () => Object.keys(TOOLS).join(", ");

function detectTools() {
  return Object.keys(TOOLS).filter((k) => TOOLS[k].detect.some((m) => existsSync(join(HOME, m))));
}

// Determine target base per tool (global vs. project). Returns {base, where}.
function targetBase(toolKey, forceGlobal, forceProject) {
  const t = TOOLS[toolKey];
  if (forceProject) return { base: CWD, where: T.where_project };
  const wantGlobal = forceGlobal || t.scope === "global";
  if (wantGlobal && t.globalBase) return { base: t.globalBase, where: T.where_global };
  if (forceGlobal && !t.globalBase) warn(T.noGlobalPath(t.label));
  return { base: CWD, where: T.where_project };
}

// Write a file safely (no path escape via ..).
function writeSafe(base, rel, content) {
  const dest = resolve(base, ...rel.split("/"));
  if (dest !== base && !dest.startsWith(base + sep)) throw new Error(T.e_unsafe_path(rel));
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, content, "utf8");
  return dest;
}

// Geteilte Guidance-Dateien (z. B. AGENTS.md von Codex) NIE überschreiben — der Käufer hat dort
// evtl. eigene Team-Regeln. Stattdessen einen idempotenten, markierten Block ein-/aktualisieren.
const MERGE_FILES = new Set(["AGENTS.md"]);
function baseName(rel) { return rel.split("/").pop(); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function installFile(base, rel, content, skill) {
  if (!MERGE_FILES.has(baseName(rel))) return { dest: writeSafe(base, rel, content), merged: false };
  const dest = resolve(base, ...rel.split("/"));
  if (dest !== base && !dest.startsWith(base + sep)) throw new Error(T.e_unsafe_path(rel));
  const START = `<!-- skills-for-ai:${skill}:start -->`;
  const END = `<!-- skills-for-ai:${skill}:end -->`;
  const block = `${START}\n${String(content).trim()}\n${END}`;
  const existing = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  let out, merged = false;
  if (existing.includes(START) && existing.includes(END)) {        // idempotent: nur unseren Block ersetzen
    out = existing.replace(new RegExp(escapeRe(START) + "[\\s\\S]*?" + escapeRe(END)), block);
    merged = true;
  } else if (existing.trim()) {                                    // bestehende Nutzerdatei behalten, Block anhängen
    out = existing.replace(/\s*$/, "") + "\n\n" + block + "\n";
    merged = true;
  } else {
    out = block + "\n";
  }
  mkdirSync(join(dest, ".."), { recursive: true });
  writeFileSync(dest, out, "utf8");
  return { dest, merged };
}

// Read-only Diagnose: wo liegen installierte Skills, ist eine AGENTS.md vorhanden, was greift?
const DOC_SUB = {
  "claude-code": ".claude/skills", "gemini": ".gemini/extensions", "cursor": ".agents/skills",
  "github-copilot": ".agents/skills", "codex": ".agents/skills", "windsurf": ".codeium/windsurf/skills", "cline": ".cline/skills",
};
function runDoctor(o, L) {
  const reqd = [...(o.tool || []), ...(o.agent || [])].flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean).map(norm);
  let tools = reqd.length ? reqd.filter((t) => TOOLS[t]) : detectTools();
  if (!tools.length) tools = Object.keys(TOOLS);
  console.log(bold("skills-for-ai doctor") + "\n");
  for (const tk of tools) {
    const t = TOOLS[tk]; if (!t) continue;
    console.log(bold(t.label));
    for (const where of ["global", "project"]) {
      const wbase = where === "global" ? (t.globalBase || null) : CWD;
      if (!wbase) continue;
      const dir = resolve(wbase, ...(DOC_SUB[tk] || ".agents/skills").split("/"));
      let label;
      try { label = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")).length + " installed" : "—"; }
      catch (e) { label = "?"; }
      console.log(dim(`  ${where}: ${dir} — ${label}`));
    }
  }
  const ag = resolve(CWD, "AGENTS.md");
  if (existsSync(ag)) {
    let blocks = 0;
    try { blocks = (readFileSync(ag, "utf8").match(/skills-for-ai:[^:]+:start/g) || []).length; } catch (e) {}
    console.log("\n" + (({
      en: `AGENTS.md present in project (${blocks} skills-for-ai block(s)). Codex agents merge into a marked block — your content is kept.`,
      de: `AGENTS.md im Projekt vorhanden (${blocks} skills-for-ai-Block/Blöcke). Codex-Agenten ergänzen einen markierten Block — dein Inhalt bleibt.`,
      fr: `AGENTS.md présent dans le projet (${blocks} bloc(s) skills-for-ai). Les agents Codex fusionnent dans un bloc balisé — ton contenu est conservé.`,
      es: `AGENTS.md presente en el proyecto (${blocks} bloque(s) skills-for-ai). Los agentes Codex fusionan en un bloque marcado — tu contenido se mantiene.`,
    })[L] || ""));
  }
}

// Lokale Deinstallation: löscht den Skill-Ordner je Tool/Scope + entfernt unseren AGENTS.md-Block.
// Kein Token/Server nötig — rein lokal, schreibt/löscht NUR in bekannten Skill-Pfaden (Safety-Check).
function runRemove(o, L, skill) {
  const requested = [...(o.tool || []), ...(o.agent || [])].flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  let tools;
  if (requested.includes("*")) { tools = detectTools(); if (!tools.length) tools = Object.keys(TOOLS); }
  else if (requested.length) { tools = requested.map(norm); const bad = tools.filter((t) => !TOOLS[t]); if (bad.length) die(T.e_unknown_tools(bad.join(", "), toolList())); }
  else { tools = detectTools(); if (!tools.length) tools = Object.keys(TOOLS); }

  const scopes = o.global ? ["global"] : o.project ? ["project"] : ["global", "project"];
  info(T.removing(skill));
  let removed = 0;
  const seen = new Set();
  for (const tk of tools) {
    const t = TOOLS[tk]; if (!t) continue;
    for (const where of scopes) {
      const wbase = where === "global" ? (t.globalBase || null) : CWD;
      if (!wbase) continue;
      const dir = resolve(wbase, ...(DOC_SUB[tk] || ".agents/skills").split("/"), skill);
      if (dir === wbase || !dir.startsWith(wbase + sep)) continue;  // Safety: niemals außerhalb der bekannten Basis löschen
      if (seen.has(dir)) continue; seen.add(dir);
      if (!existsSync(dir)) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
        ok(T.removed(bold(`${t.label} (${where === "global" ? T.where_global : T.where_project})`), dir));
        removed++;
      } catch (e) { warn(`${t.label}: ${e.message}`); }
    }
  }
  // AGENTS.md (Codex): NUR unseren markierten Block entfernen, restlichen Nutzer-Inhalt behalten.
  const ag = resolve(CWD, "AGENTS.md");
  if (existsSync(ag)) {
    try {
      const START = `<!-- skills-for-ai:${skill}:start -->`;
      const END = `<!-- skills-for-ai:${skill}:end -->`;
      const cur = readFileSync(ag, "utf8");
      if (cur.includes(START) && cur.includes(END)) {
        const out = cur
          .replace(new RegExp("\\s*" + escapeRe(START) + "[\\s\\S]*?" + escapeRe(END) + "\\s*", "g"), "\n")
          .replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
        writeFileSync(ag, out.trimEnd() + "\n", "utf8");
        info(T.removedBlock);
        removed++;
      }
    } catch (e) {}
  }
  console.log("");
  if (removed) ok(T.removedOk(skill, removed));
  else warn(T.nothingFound(skill));
}

// SHA-256 (hex) für den Integritätscheck der ausgelieferten Dateien.
function sha256(s) { return createHash("sha256").update(String(s), "utf8").digest("hex"); }
// Ja/Nein-Rückfrage (nur im interaktiven Terminal genutzt).
function ask(q) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); res(/^(y|yes|j|ja|o|oui|s|si|sí)$/i.test(String(a).trim())); });
  });
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        token: { type: "string" },
        tool: { type: "string", multiple: true },
        agent: { type: "string", multiple: true }, // alias (skills.sh habit)
        global: { type: "boolean" },
        project: { type: "boolean" },
        lang: { type: "string" },
        endpoint: { type: "string" },
        yes: { type: "boolean" },
        force: { type: "boolean" },
        help: { type: "boolean" },
      },
    });
  } catch (e) {
    // Parse error happens before --lang is known -> default English help.
    die(`${e.message}\n\n${T.help(toolList(), DEFAULT_ENDPOINT)}`);
  }
  const { values: o, positionals: pos } = parsed;
  // Pick output language: explicit --lang wins, else env locale, else English.
  const L = pickLang(o.lang || process.env.SFA_LANG || process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG);
  T = STR[L];

  if (o.help || pos[0] === "help" || pos.length === 0) {
    console.log(T.help(toolList(), DEFAULT_ENDPOINT));
    if (!(o.help || pos[0] === "help")) process.exitCode = 1;
    return;
  }

  const action = pos[0];
  if (action === "doctor") { runDoctor(o, L); return; }
  if (action === "remove" || action === "rm" || action === "uninstall") {
    const target = pos[1];
    if (!target) die(T.e_no_skill);
    runRemove(o, L, target);
    return;
  }
  if (action !== "add" && action !== "add-agent") die(`${T.e_unknown_action(action)}\n\n${T.help(toolList(), DEFAULT_ENDPOINT)}`);
  const isAgent = action === "add-agent"; // Builder-Agent (Bündel aus mehreren Skills) statt Einzel-Skill
  const skill = pos[1]; // bei add-agent: die Agent-ID
  if (!skill) die(T.e_no_skill);
  if (!o.token) die(T.e_no_token);
  if (o.global && o.project) die(T.e_both_scope);

  // Determine tools.
  const requested = [...(o.tool || []), ...(o.agent || [])].flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  let tools;
  if (requested.includes("*")) {
    tools = detectTools();
    if (!tools.length) tools = ["claude-code"];
  } else if (requested.length) {
    tools = requested.map(norm);
    const bad = tools.filter((t) => !TOOLS[t]);
    if (bad.length) die(T.e_unknown_tools(bad.join(", "), toolList()));
  } else {
    tools = detectTools();
    if (!tools.length) { tools = ["claude-code"]; info(T.noToolDetected); }
    else info(T.detected(tools.map((t) => TOOLS[t].label).join(", ")));
  }

  // Fetch files.
  const endpoint = (o.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const url = `${endpoint}/functions/v1/${isAgent ? "deliver-agent" : "deliver"}`;
  info(T.fetching(skill));
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isAgent ? { token: o.token, agent: skill, tools } : { token: o.token, skill, tools }),
    });
  } catch (e) {
    die(T.connFailed(e.message));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const map = {
      invalid_token: T.e_invalid_token,
      skill_not_found: T.e_skill_not_found(skill),
      agent_not_found: T.e_skill_not_found(skill),
      agent_empty: T.e_no_files,
      missing_token: T.e_missing_token,
      missing_skill: T.e_missing_skill,
      missing_agent: T.e_missing_skill,
      file_not_available: T.e_file_not_available,
      rate_limited: T.e_rate_limited,
    };
    die(map[data?.error] || T.e_server(res.status, data?.error || "?"));
  }

  // Write.
  const fileSet = data.files || {};
  const deliveredTools = Object.keys(fileSet);
  if (!deliveredTools.length) die(T.e_no_files);
  // Tools pointing at EXACTLY the same target files (e.g. a plain skill -> .agents/skills for
  // Cursor/Codex/Copilot) get grouped: write once, report once.
  let total = 0;
  const groups = [];
  const sigIndex = {};
  for (const toolKey of deliveredTools) {
    const t = TOOLS[toolKey];
    if (!t) { warn(T.unknownFromServer(toolKey)); continue; }
    let { base, where } = targetBase(toolKey, o.global, o.project);
    const fset = fileSet[toolKey];
    // Codex-Agent (Persona als AGENTS.md) gehört projekt-lokal, nicht global (würde sonst ~/AGENTS.md treffen).
    const isAgentWrapper = Object.keys(fset).some((rel) => baseName(rel) === "AGENTS.md");
    if (toolKey === "codex" && isAgentWrapper && !o.global) { base = CWD; where = T.where_project; }
    // Global only: tool-specific path-prefix swap (e.g. Windsurf .windsurf/ -> .codeium/windsurf/).
    const rw = (where === T.where_global) ? t.globalRewrite : null;
    const entries = Object.keys(fset).map((rel) => ({
      target: rw && rel.startsWith(rw[0]) ? rw[1] + rel.slice(rw[0].length) : rel,
      content: fset[rel],
      hash: (data.hashes && data.hashes[toolKey] && data.hashes[toolKey][rel]) || null,
    }));
    const sig = base + "||" + entries.map((e) => e.target).sort().join("|");
    if (sigIndex[sig] !== undefined) { groups[sigIndex[sig]].labels.push(t.label); continue; }
    sigIndex[sig] = groups.length;
    groups.push({ labels: [t.label], where, base, entries });
  }
  // Überschreib-Schutz: bestehende Dateien, die überschrieben würden, VOR dem Schreiben ermitteln.
  // AGENTS.md zählt nicht (wird gemerged, nicht überschrieben). Interaktiv -> nachfragen; nicht-
  // interaktiv -> hinweisen und fortfahren (Re-Install = Update). --force/--yes überspringt das.
  if (!(o.yes || o.force)) {
    const clashes = [];
    for (const g of groups) for (const e of g.entries) {
      if (MERGE_FILES.has(baseName(e.target))) continue;
      const dest = resolve(g.base, ...e.target.split("/"));
      if (existsSync(dest)) clashes.push(dest);
    }
    if (clashes.length) {
      warn(T.overwriteWarn(clashes.length));
      clashes.slice(0, 6).forEach((d) => console.log(dim("    " + d)));
      if (clashes.length > 6) console.log(dim(`    … (+${clashes.length - 6})`));
      if (tty) { if (!(await ask(T.overwriteAsk))) { info(T.overwriteAbort); return; } }
      else info(T.overwriteForceHint);
    }
  }

  let verified = 0;
  for (const g of groups) {
    let mergedAny = false;
    for (const e of g.entries) {
      // Integritätscheck gegen die serverseitige SHA-256-Prüfsumme (falls geliefert).
      if (e.hash) { if (sha256(e.content) === e.hash) verified++; else warn(T.hashMismatch(e.target)); }
      const r = installFile(g.base, e.target, e.content, skill); if (r.merged) mergedAny = true; total++;
    }
    ok(T.written(bold(g.labels.join(", ")), g.where, g.entries.length, g.base));
    if (mergedAny) info(({
      en: "AGENTS.md: updated only our marked block — your existing content was kept.",
      de: "AGENTS.md: nur unseren markierten Block aktualisiert — dein Inhalt bleibt erhalten.",
      fr: "AGENTS.md : seul notre bloc balisé a été mis à jour — ton contenu est conservé.",
      es: "AGENTS.md: solo se actualizó nuestro bloque marcado — tu contenido se mantiene.",
    })[L] || "AGENTS.md: updated only our marked block — your existing content was kept.");
  }
  if (verified) info(T.integrityOk(verified));
  if (Array.isArray(data.unsupported) && data.unsupported.length) {
    warn(T.unsupported(data.unsupported.join(", ")));
  }
  if (Array.isArray(data.missing) && data.missing.length) {
    warn(({ en: "Not yet owned (skipped): ", de: "Noch nicht freigeschaltet (übersprungen): ", fr: "Pas encore débloqué (ignoré) : ", es: "Aún no desbloqueado (omitido): " })[L] + data.missing.join(", "));
  }

  console.log("");
  ok(T.installedOk(data.name || skill, data.version || "?", total));
  if (deliveredTools.includes("claude-code")) {
    console.log(dim("  " + T.claudeHint));
  }
  if (deliveredTools.includes("gemini")) {
    // Gemini does NOT auto-discover extensions from the folder — registering is mandatory.
    console.log(`${cyan(">")} ${T.geminiHint(bold("gemini extensions install ./" + skill))}`);
  }
}

main().catch((e) => { if (!(e && e.handled)) console.error(`${red("x")} ${e && e.message ? e.message : e}`); process.exitCode = 1; });
