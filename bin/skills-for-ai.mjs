#!/usr/bin/env node
// skills-for-ai CLI: install an unlocked Skill/Agent with one command.
//
//   npx @skills-for-ai/cli add <skill> --token <token> [--tool <t>]... [--global|--project] [--lang <l>]
//
// Fetches the files via the deliver edge function (JSON, no ZIP) and drops them tool-natively
// ("native drops"). Tool detection happens locally: like skills.sh: we check which tool config
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
    noToolDetected: "No tool detected, using Claude Code. (Pick one explicitly with --tool.)",
    fetching: (s) => `Fetching '${s}' ...`,
    connFailed: (m) => `Could not reach the delivery endpoint: ${m}`,
    e_invalid_token: "Token invalid, revoked, or not for this skill.",
    e_skill_not_found: (s) => `Skill '${s}' not found.`,
    e_missing_token: "No token submitted.",
    e_missing_skill: "No skill submitted.",
    e_file_not_available: "No file is (yet) available for this skill.",
    e_server: (st, e) => `Server error (${st}): ${e}`,
    e_unknown_action: (a) => `Unknown action '${a}'. Supported: add, add-agent, remove, doctor.`,
    e_no_skill: "No skill given. Example: add website-doctor --token ...",
    e_no_token: "No --token given. You'll find your token under 'My Skills'.",
    e_both_scope: "Specify only one of --global / --project.",
    e_unknown_tools: (bad, all) => `Unknown tool(s): ${bad}. Allowed: ${all}`,
    e_no_files: "Server returned no files.",
    e_unsafe_path: (r) => `unsafe path: ${r}`,
    noGlobalPath: (label) => `${label}: no global path known, installing into the project.`,
    unknownFromServer: (k) => `Unknown tool from server: ${k}, skipped.`,
    unsupported: (l) => `No content for: ${l} (skill doesn't offer this platform).`,
    written: (labels, where, n, base) => `${labels} (${where}): ${n} file(s) -> ${dim(base)}`,
    installedOk: (name, ver, n) => `'${name}' v${ver} installed (${n} file(s)).`,
    claudeHint: "Claude Code loads skills automatically. Agents: call via /<name>.",
    geminiHint: (cmd) => `Enable Gemini: ${cmd}`,
    removing: (s) => `Removing '${s}' ...`,
    removed: (label, dir) => `${label}: removed -> ${dim(dir)}`,
    removedBlock: "AGENTS.md: removed our marked block, your other content was kept.",
    geminiUninstall: (s) => `Gemini keeps its own copy of installed extensions. Also run: gemini extensions uninstall ${s}`,
    nothingFound: (s) => `Nothing found for '${s}', nothing removed. (Try --global or --project, or name the --tool.)`,
    removedOk: (s, n) => `'${s}' removed (${n} location(s)).`,
    e_rate_limited: "Too many requests right now, please wait a moment and try again.",
    e_bad_endpoint: (u) => `Refusing endpoint '${u}': only https://<project>.supabase.co (or http://localhost for development) is allowed, so your token never goes to a foreign host.`,
    overwriteWarn: (n) => `${n} existing file(s) would be overwritten:`,
    overwriteAsk: "Overwrite them? [y/N] ",
    overwriteAbort: "Aborted, nothing was changed.",
    overwriteForceHint: "Non-interactive run, the existing files are being overwritten (update).",
    hashMismatch: (f) => `integrity check failed for ${f}, checksum did not match.`,
    integrityOk: (n) => `Integrity verified (${n} file(s), SHA-256).`,
    help: (tools, ep) => `${bold("skills-for-ai")}: install your unlocked Skills & Agents with one command

${bold("Usage:")}
  npx @skills-for-ai/cli add <skill> --token <token> [options]
  npx @skills-for-ai/cli add-agent <agent> --token <token> [--tool <key>]...
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
  --version           Print the CLI version.
  --help              This help.

${bold("Example:")}
  npx @skills-for-ai/cli add website-doctor --token sfa_live_...`,
  },
  de: {
    where_global: "global", where_project: "Projekt",
    detected: (l) => `Erkannte Tools: ${l}`,
    noToolDetected: "Kein Tool erkannt, verwende Claude Code. (Mit --tool gezielt waehlen.)",
    fetching: (s) => `Hole '${s}' ...`,
    connFailed: (m) => `Verbindung zum Liefer-Endpoint fehlgeschlagen: ${m}`,
    e_invalid_token: "Token ungueltig, widerrufen oder gehoert nicht zu diesem Skill.",
    e_skill_not_found: (s) => `Skill '${s}' nicht gefunden.`,
    e_missing_token: "Kein Token uebermittelt.",
    e_missing_skill: "Kein Skill uebermittelt.",
    e_file_not_available: "Fuer diesen Skill ist (noch) keine Datei hinterlegt.",
    e_server: (st, e) => `Server-Fehler (${st}): ${e}`,
    e_unknown_action: (a) => `Unbekannte Aktion '${a}'. Unterstuetzt: add, add-agent, remove, doctor.`,
    e_no_skill: "Kein Skill angegeben. Beispiel: add website-doctor --token ...",
    e_no_token: "Kein --token angegeben. Den Token findest du unter 'Meine Skills'.",
    e_both_scope: "Nur eines von --global / --project angeben.",
    e_unknown_tools: (bad, all) => `Unbekannte(s) Tool(s): ${bad}. Erlaubt: ${all}`,
    e_no_files: "Server hat keine Dateien geliefert.",
    e_unsafe_path: (r) => `unsicherer Pfad: ${r}`,
    noGlobalPath: (label) => `${label}: kein globaler Pfad bekannt, installiere ins Projekt.`,
    unknownFromServer: (k) => `Unbekanntes Tool vom Server: ${k}, uebersprungen.`,
    unsupported: (l) => `Keine Inhalte fuer: ${l} (Skill bietet diese Plattform nicht).`,
    written: (labels, where, n, base) => `${labels} (${where}): ${n} Datei(en) -> ${dim(base)}`,
    installedOk: (name, ver, n) => `'${name}' v${ver} installiert (${n} Datei(en)).`,
    claudeHint: "Claude Code laedt Skills automatisch. Agents: per /<name> aufrufbar.",
    geminiHint: (cmd) => `Gemini aktivieren: ${cmd}`,
    removing: (s) => `Entferne '${s}' ...`,
    removed: (label, dir) => `${label}: entfernt -> ${dim(dir)}`,
    removedBlock: "AGENTS.md: unseren markierten Block entfernt, dein uebriger Inhalt bleibt.",
    geminiUninstall: (s) => `Gemini behaelt eine eigene Kopie installierter Extensions. Zusaetzlich ausfuehren: gemini extensions uninstall ${s}`,
    nothingFound: (s) => `Nichts gefunden fuer '${s}', nichts entfernt. (Versuche --global oder --project, oder nenne das --tool.)`,
    removedOk: (s, n) => `'${s}' entfernt (${n} Ort(e)).`,
    e_rate_limited: "Zu viele Anfragen gerade, bitte kurz warten und erneut versuchen.",
    e_bad_endpoint: (u) => `Endpoint '${u}' abgelehnt: erlaubt ist nur https://<projekt>.supabase.co (oder http://localhost zum Entwickeln), damit dein Token nie an einen fremden Host geht.`,
    overwriteWarn: (n) => `${n} vorhandene Datei(en) wuerden ueberschrieben:`,
    overwriteAsk: "Ueberschreiben? [j/N] ",
    overwriteAbort: "Abgebrochen, nichts veraendert.",
    overwriteForceHint: "Nicht-interaktiver Lauf, die vorhandenen Dateien werden ueberschrieben (Update).",
    hashMismatch: (f) => `Integritaetspruefung fehlgeschlagen fuer ${f}, Pruefsumme stimmt nicht.`,
    integrityOk: (n) => `Integritaet geprueft (${n} Datei(en), SHA-256).`,
    help: (tools, ep) => `${bold("skills-for-ai")}: freigeschaltete Skills & Agents mit einem Befehl installieren

${bold("Nutzung:")}
  npx @skills-for-ai/cli add <skill> --token <token> [Optionen]
  npx @skills-for-ai/cli add-agent <agent> --token <token> [--tool <key>]...
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
  --version           CLI-Version ausgeben.
  --help              Diese Hilfe.

${bold("Beispiel:")}
  npx @skills-for-ai/cli add website-doctor --token sfa_live_...`,
  },
  fr: {
    where_global: "global", where_project: "projet",
    detected: (l) => `Outils détectés : ${l}`,
    noToolDetected: "Aucun outil détecté, utilisation de Claude Code. (Précisez avec --tool.)",
    fetching: (s) => `Récupération de « ${s} » ...`,
    connFailed: (m) => `Impossible de joindre le point de livraison : ${m}`,
    e_invalid_token: "Jeton invalide, révoqué ou ne correspondant pas à ce skill.",
    e_skill_not_found: (s) => `Skill « ${s} » introuvable.`,
    e_missing_token: "Aucun jeton transmis.",
    e_missing_skill: "Aucun skill transmis.",
    e_file_not_available: "Aucun fichier n'est (encore) disponible pour ce skill.",
    e_server: (st, e) => `Erreur serveur (${st}) : ${e}`,
    e_unknown_action: (a) => `Action « ${a} » inconnue. Pris en charge : add, add-agent, remove, doctor.`,
    e_no_skill: "Aucun skill indiqué. Exemple : add website-doctor --token ...",
    e_no_token: "Aucun --token indiqué. Vous trouverez votre jeton dans « Mes skills ».",
    e_both_scope: "Indiquez un seul de --global / --project.",
    e_unknown_tools: (bad, all) => `Outil(s) inconnu(s) : ${bad}. Autorisés : ${all}`,
    e_no_files: "Le serveur n'a renvoyé aucun fichier.",
    e_unsafe_path: (r) => `chemin non sûr : ${r}`,
    noGlobalPath: (label) => `${label} : aucun chemin global connu, installation dans le projet.`,
    unknownFromServer: (k) => `Outil inconnu du serveur : ${k}, ignoré.`,
    unsupported: (l) => `Aucun contenu pour : ${l} (le skill n'offre pas cette plateforme).`,
    written: (labels, where, n, base) => `${labels} (${where}) : ${n} fichier(s) -> ${dim(base)}`,
    installedOk: (name, ver, n) => `« ${name} » v${ver} installé (${n} fichier(s)).`,
    claudeHint: "Claude Code charge les skills automatiquement. Agents : appel via /<nom>.",
    geminiHint: (cmd) => `Activer Gemini : ${cmd}`,
    removing: (s) => `Suppression de « ${s} » ...`,
    removed: (label, dir) => `${label} : supprimé -> ${dim(dir)}`,
    removedBlock: "AGENTS.md : notre bloc balisé a été supprimé, ton autre contenu est conservé.",
    geminiUninstall: (s) => `Gemini garde sa propre copie des extensions installées. Lance aussi : gemini extensions uninstall ${s}`,
    nothingFound: (s) => `Rien trouvé pour « ${s} », rien supprimé. (Essaie --global ou --project, ou indique le --tool.)`,
    removedOk: (s, n) => `« ${s} » supprimé (${n} emplacement(s)).`,
    e_rate_limited: "Trop de requêtes pour le moment, patiente un instant puis réessaie.",
    e_bad_endpoint: (u) => `Point de livraison « ${u} » refusé : seul https://<projet>.supabase.co (ou http://localhost pour le développement) est autorisé, pour que ton jeton n'aille jamais vers un hôte étranger.`,
    overwriteWarn: (n) => `${n} fichier(s) existant(s) seraient écrasés :`,
    overwriteAsk: "Les écraser ? [o/N] ",
    overwriteAbort: "Annulé, rien n'a été modifié.",
    overwriteForceHint: "Exécution non interactive, les fichiers existants sont écrasés (mise à jour).",
    hashMismatch: (f) => `échec du contrôle d'intégrité pour ${f}, la somme de contrôle ne correspond pas.`,
    integrityOk: (n) => `Intégrité vérifiée (${n} fichier(s), SHA-256).`,
    help: (tools, ep) => `${bold("skills-for-ai")}: installez vos Skills & Agents débloqués en une commande

${bold("Utilisation :")}
  npx @skills-for-ai/cli add <skill> --token <token> [options]
  npx @skills-for-ai/cli add-agent <agent> --token <token> [--tool <key>]...
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
  --version           Afficher la version du CLI.
  --help              Cette aide.

${bold("Exemple :")}
  npx @skills-for-ai/cli add website-doctor --token sfa_live_...`,
  },
  es: {
    where_global: "global", where_project: "proyecto",
    detected: (l) => `Herramientas detectadas: ${l}`,
    noToolDetected: "No se detectó ninguna herramienta, usando Claude Code. (Elige con --tool.)",
    fetching: (s) => `Obteniendo «${s}» ...`,
    connFailed: (m) => `No se pudo contactar el endpoint de entrega: ${m}`,
    e_invalid_token: "Token no válido, revocado o no corresponde a este skill.",
    e_skill_not_found: (s) => `Skill «${s}» no encontrado.`,
    e_missing_token: "No se envió ningún token.",
    e_missing_skill: "No se envió ningún skill.",
    e_file_not_available: "Aún no hay ningún archivo disponible para este skill.",
    e_server: (st, e) => `Error del servidor (${st}): ${e}`,
    e_unknown_action: (a) => `Acción «${a}» desconocida. Compatibles: add, add-agent, remove, doctor.`,
    e_no_skill: "No se indicó ningún skill. Ejemplo: add website-doctor --token ...",
    e_no_token: "No se indicó --token. Encontrarás tu token en «Mis skills».",
    e_both_scope: "Indica solo uno de --global / --project.",
    e_unknown_tools: (bad, all) => `Herramienta(s) desconocida(s): ${bad}. Permitidas: ${all}`,
    e_no_files: "El servidor no devolvió ningún archivo.",
    e_unsafe_path: (r) => `ruta no segura: ${r}`,
    noGlobalPath: (label) => `${label}: no se conoce ruta global, instalando en el proyecto.`,
    unknownFromServer: (k) => `Herramienta desconocida del servidor: ${k}, omitida.`,
    unsupported: (l) => `Sin contenido para: ${l} (el skill no ofrece esta plataforma).`,
    written: (labels, where, n, base) => `${labels} (${where}): ${n} archivo(s) -> ${dim(base)}`,
    installedOk: (name, ver, n) => `«${name}» v${ver} instalado (${n} archivo(s)).`,
    claudeHint: "Claude Code carga los skills automáticamente. Agents: llámalos con /<nombre>.",
    geminiHint: (cmd) => `Activar Gemini: ${cmd}`,
    removing: (s) => `Eliminando «${s}» ...`,
    removed: (label, dir) => `${label}: eliminado -> ${dim(dir)}`,
    removedBlock: "AGENTS.md: se eliminó nuestro bloque marcado, tu otro contenido se mantiene.",
    geminiUninstall: (s) => `Gemini guarda su propia copia de las extensiones instaladas. Ejecuta también: gemini extensions uninstall ${s}`,
    nothingFound: (s) => `No se encontró nada para «${s}», no se eliminó nada. (Prueba --global o --project, o indica el --tool.)`,
    removedOk: (s, n) => `«${s}» eliminado (${n} ubicación(es)).`,
    e_rate_limited: "Demasiadas solicitudes ahora mismo, espera un momento y vuelve a intentarlo.",
    e_bad_endpoint: (u) => `Endpoint «${u}» rechazado: solo se permite https://<proyecto>.supabase.co (o http://localhost para desarrollo), para que tu token nunca vaya a un host ajeno.`,
    overwriteWarn: (n) => `${n} archivo(s) existente(s) se sobrescribirían:`,
    overwriteAsk: "¿Sobrescribir? [s/N] ",
    overwriteAbort: "Cancelado, no se cambió nada.",
    overwriteForceHint: "Ejecución no interactiva, los archivos existentes se sobrescriben (actualización).",
    hashMismatch: (f) => `falló la verificación de integridad de ${f}, la suma de comprobación no coincide.`,
    integrityOk: (n) => `Integridad verificada (${n} archivo(s), SHA-256).`,
    help: (tools, ep) => `${bold("skills-for-ai")}: instala tus Skills & Agents desbloqueados con un comando

${bold("Uso:")}
  npx @skills-for-ai/cli add <skill> --token <token> [opciones]
  npx @skills-for-ai/cli add-agent <agent> --token <token> [--tool <key>]...
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
  --version           Mostrar la versión del CLI.
  --help              Esta ayuda.

${bold("Ejemplo:")}
  npx @skills-for-ai/cli add website-doctor --token sfa_live_...`,
  },
};
const pickLang = (v) => { const x = (v || "").toLowerCase().slice(0, 2); return STR[x] ? x : "en"; };
// Active string table: set in main() once --lang is parsed; English until then.
let T = STR.en;

const ok = (s) => console.log(`${green("OK")} ${s}`);
const info = (s) => console.log(`${cyan(">")} ${s}`);
const warn = (s) => console.log(`${yellow("!")} ${s}`);
// No process.exit(): that triggers the libuv assertion (UV_HANDLE_CLOSING) on Windows while the
// fetch handle is still closing. Instead set exitCode + abort cleanly via a marked error.
const die = (s) => { console.error(`${red("x")} ${s}`); process.exitCode = 1; throw Object.assign(new Error(s), { handled: true }); };

// Per-tool config. detect = home-relative markers (existence => tool present).
// globalBase = base for global install; globalRewrite = list of [from, to] path-prefix swaps, only when
// global (first match wins).
// Global paths verified against official docs (2026-09): claude ~/.claude, agents standard
// ~/.agents/skills (cursor/copilot/codex/gemini), cline ~/.cline, Devin Desktop (formerly Windsurf)
// ~/.codeium/windsurf. Gemini CLI reads Agent Skills natively (https://geminicli.com/docs/cli/skills/);
// only agent wrappers for Gemini are still extensions (see isGeminiExt below).
// Copilot custom agents (*.agent.md): repo .github/agents/, personal ~/.copilot/agents/ (docs.github.com,
// "Creating and using custom agents for GitHub Copilot CLI"), so the global install swaps that prefix.
const TOOLS = {
  "claude-code":    { label: "Claude Code",    detect: [".claude"],               scope: "global", globalBase: HOME },
  "gemini":         { label: "Gemini CLI",     detect: [".gemini"],               scope: "global", globalBase: HOME },
  "cursor":         { label: "Cursor",         detect: [".cursor"],               scope: "global", globalBase: HOME },
  "github-copilot": { label: "GitHub Copilot", detect: [".copilot"],              scope: "global", globalBase: HOME, globalRewrite: [[".github/agents/", ".copilot/agents/"]] },
  "codex":          { label: "Codex CLI",      detect: [".codex"],                scope: "global", globalBase: HOME },
  "windsurf":       { label: "Devin Desktop (Windsurf)", detect: [".windsurf", ".codeium"], scope: "global", globalBase: HOME, globalRewrite: [[".windsurf/workflows/", ".codeium/windsurf/global_workflows/"], [".windsurf/", ".codeium/windsurf/"]] },
  "cline":          { label: "Cline",          detect: [".cline"],                scope: "global", globalBase: HOME },
};
const ALIAS = { claude: "claude-code", "claude-code": "claude-code", copilot: "github-copilot", "devin-desktop": "windsurf" };
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

// Geteilte Guidance-Dateien (z. B. AGENTS.md von Codex) NIE überschreiben: der Käufer hat dort
// evtl. eigene Team-Regeln. Stattdessen einen idempotenten, markierten Block ein-/aktualisieren.
// Nur die AGENTS.md an der WURZEL (Codex-Persona) wird gemerged; eine gleichnamige Datei INNERHALB eines
// Skill-Ordners (z. B. .agents/skills/<id>/AGENTS.md) ist normaler Skill-Inhalt und wird 1:1 geschrieben.
const MERGE_FILES = new Set(["AGENTS.md"]);
function baseName(rel) { return rel.split("/").pop(); }
const isMergeTarget = (rel) => MERGE_FILES.has(rel);
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function installFile(base, rel, content, skill) {
  if (!isMergeTarget(rel)) return { dest: writeSafe(base, rel, content), merged: false };
  const dest = resolve(base, ...rel.split("/"));
  if (dest !== base && !dest.startsWith(base + sep)) throw new Error(T.e_unsafe_path(rel));
  const START = `<!-- skills-for-ai:${skill}:start -->`;
  const END = `<!-- skills-for-ai:${skill}:end -->`;
  const block = `${START}\n${String(content).trim()}\n${END}`;
  const existing = existsSync(dest) ? readFileSync(dest, "utf8") : "";
  let out, merged = false;
  if (existing.includes(START) && existing.includes(END)) {        // idempotent: nur unseren Block ersetzen
    // Ersatz als Funktion: $&, $', $` oder $$ im ausgelieferten Inhalt bleiben wörtlich erhalten.
    out = existing.replace(new RegExp(escapeRe(START) + "[\\s\\S]*?" + escapeRe(END)), () => block);
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

// Gemini extension folders in a delivered file set (top-level dir that holds gemini-extension.json).
function geminiExtDirs(fset) {
  return Object.keys(fset || {}).map((rel) => rel.split("/")).filter((p) => p.length === 2 && p[1] === "gemini-extension.json").map((p) => p[0]);
}
const isGeminiExt = (fset) => geminiExtDirs(fset).length > 0;

// Read-only Diagnose: wo liegen installierte Skills, ist eine AGENTS.md vorhanden, was greift?
const DOC_SUB = {
  "claude-code": ".claude/skills", "gemini": ".agents/skills", "cursor": ".agents/skills",
  "github-copilot": ".agents/skills", "codex": ".agents/skills", "windsurf": ".codeium/windsurf/skills", "cline": ".cline/skills",
};
// Devin Desktop (Windsurf): Projekt-Installationen liegen unter .windsurf/skills, globale unter ~/.codeium/windsurf/skills.
const docSub = (tk, where) => (tk === "windsurf" && where === "project") ? ".windsurf/skills" : (DOC_SUB[tk] || ".agents/skills");
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
      const dir = resolve(wbase, ...docSub(tk, where).split("/"));
      let label;
      try { label = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith(".")).length + " installed" : "none"; }
      catch (e) { label = "?"; }
      console.log(dim(`  ${where}: ${dir} (${label})`));
    }
  }
  const ag = resolve(CWD, "AGENTS.md");
  if (existsSync(ag)) {
    let blocks = 0;
    try { blocks = (readFileSync(ag, "utf8").match(/skills-for-ai:[^:]+:start/g) || []).length; } catch (e) {}
    console.log("\n" + (({
      en: `AGENTS.md present in project (${blocks} skills-for-ai block(s)). Codex agents merge into a marked block, your content is kept.`,
      de: `AGENTS.md im Projekt vorhanden (${blocks} skills-for-ai-Block/Blöcke). Codex-Agenten ergänzen einen markierten Block, dein Inhalt bleibt.`,
      fr: `AGENTS.md présent dans le projet (${blocks} bloc(s) skills-for-ai). Les agents Codex fusionnent dans un bloc balisé, ton contenu est conservé.`,
      es: `AGENTS.md presente en el proyecto (${blocks} bloque(s) skills-for-ai). Los agentes Codex fusionan en un bloque marcado, tu contenido se mantiene.`,
    })[L] || ""));
  }
}

// Lokale Deinstallation: löscht den Skill-Ordner je Tool/Scope + entfernt unseren AGENTS.md-Block.
// Kein Token/Server nötig: rein lokal, schreibt/löscht NUR in bekannten Skill-Pfaden (Safety-Check).
// Agent products install sub-skills (<skill>-audit, ...) plus tool files (persona, command, rule, workflow).
// Safety: a sub-skill folder is removed only if its SKILL.md carries our license id. Tool files with our
// exact names are removed only in a base where one of our sub-skills was found, never a same-named foreign file.
const OUR_MARK = "LicenseRef-skills-for-ai";
const AGENT_SUB = {
  "claude-code": [".claude/skills"], "gemini": [".agents/skills"], "cursor": [".cursor/skills", ".agents/skills"],
  "github-copilot": [".agents/skills", ".github/skills"], "codex": [".agents/skills"],
  "windsurf": [".codeium/windsurf/skills", ".windsurf/skills"], "cline": [".cline/skills"],
};
const AGENT_FILES = {
  "claude-code": [".claude/agents/{id}.md", ".claude/commands/{id}.md"],
  "github-copilot": [".copilot/agents/{id}.agent.md", ".github/agents/{id}.agent.md", ".github/agents/{id}.md"],
  "cursor": [".cursor/rules/{id}.mdc", ".cursor/commands/{id}.md"],
  "windsurf": [".codeium/windsurf/global_workflows/{id}.md", ".codeium/windsurf/workflows/{id}.md", ".windsurf/workflows/{id}.md"],
  "cline": [".clinerules/{id}.md", ".clinerules/workflows/{id}.md"],
};
function isOurSkillDir(dir) {
  try { return readFileSync(join(dir, "SKILL.md"), "utf8").includes(OUR_MARK); } catch { return false; }
}
function removeAgentParts(tk, label, wbase, skill, seen, ourDirs) {
  const inBase = (p) => p !== wbase && p.startsWith(wbase + sep);
  let n = 0, ours = false;
  for (const sub of AGENT_SUB[tk] || []) {
    const root = resolve(wbase, ...sub.split("/"));
    if (!inBase(root) || !existsSync(root)) continue;
    let names = [];
    try { names = readdirSync(root); } catch { names = []; }
    for (const name of names) {
      if (!name.startsWith(skill + "-")) continue;
      const d = resolve(root, name);
      if (ourDirs.has(d)) { ours = true; continue; }
      if (seen.has(d) || !isOurSkillDir(d)) continue;
      seen.add(d); ourDirs.add(d); ours = true;
      try { rmSync(d, { recursive: true, force: true }); ok(T.removed(label, d)); n++; } catch (e) { warn(`${label}: ${e.message}`); }
    }
  }
  if (!ours) return n;
  for (const rel of AGENT_FILES[tk] || []) {
    const file = resolve(wbase, ...rel.replace("{id}", skill).split("/"));
    if (!inBase(file) || seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    try { rmSync(file, { force: true }); ok(T.removed(label, file)); n++; } catch (e) { warn(`${label}: ${e.message}`); }
  }
  return n;
}
// Gemini agent = extension folder <skill>/ in the project (gemini-extension.json with our name + our skills).
function removeGeminiExt(skill, seen) {
  const dir = resolve(CWD, skill);
  if (dir === CWD || !dir.startsWith(CWD + sep) || seen.has(dir)) return 0;
  try {
    const ext = JSON.parse(readFileSync(join(dir, "gemini-extension.json"), "utf8"));
    if (!ext || ext.name !== skill) return 0;
    const sk = join(dir, "skills");
    const ours = existsSync(sk) && readdirSync(sk).some((n) => isOurSkillDir(join(sk, n)));
    if (!ours) return 0;
    seen.add(dir);
    rmSync(dir, { recursive: true, force: true });
    ok(T.removed(bold(`${TOOLS.gemini.label} (${T.where_project})`), dir));
    info(T.geminiUninstall(skill));
    return 1;
  } catch { return 0; }
}

function runRemove(o, L, skill) {
  const requested = [...(o.tool || []), ...(o.agent || [])].flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  let tools;
  if (requested.includes("*")) { tools = detectTools(); if (!tools.length) tools = Object.keys(TOOLS); }
  else if (requested.length) { tools = requested.map(norm); const bad = tools.filter((t) => !TOOLS[t]); if (bad.length) die(T.e_unknown_tools(bad.join(", "), toolList())); }
  else { tools = detectTools(); if (!tools.length) tools = Object.keys(TOOLS); }

  const scopes = o.global ? ["global"] : o.project ? ["project"] : ["global", "project"];
  info(T.removing(skill));
  let removed = 0;
  const seen = new Set(), ourDirs = new Set();
  for (const tk of tools) {
    const t = TOOLS[tk]; if (!t) continue;
    for (const where of scopes) {
      const wbase = where === "global" ? (t.globalBase || null) : CWD;
      if (!wbase) continue;
      const dir = resolve(wbase, ...docSub(tk, where).split("/"), skill);
      if (dir === wbase || !dir.startsWith(wbase + sep)) continue;  // Safety: niemals außerhalb der bekannten Basis löschen
      const label = bold(`${t.label} (${where === "global" ? T.where_global : T.where_project})`);
      if (!seen.has(dir)) {
        seen.add(dir);
        if (existsSync(dir)) {
          try {
            rmSync(dir, { recursive: true, force: true });
            ok(T.removed(label, dir));
            removed++;
          } catch (e) { warn(`${t.label}: ${e.message}`); }
        }
      }
      removed += removeAgentParts(tk, label, wbase, skill, seen, ourDirs);
    }
  }
  if (tools.includes("gemini") && scopes.includes("project")) removed += removeGeminiExt(skill, seen);
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
        // Only our block was in it (we created the file): remove the now empty file instead of leaving it.
        if (out.trim()) writeFileSync(ag, out.trimEnd() + "\n", "utf8");
        else rmSync(ag, { force: true });
        info(T.removedBlock);
        removed++;
      }
    } catch (e) {}
  }
  console.log("");
  if (removed) ok(T.removedOk(skill, removed));
  else warn(T.nothingFound(skill));
}

// Der Token darf nur an ein Supabase-Projekt (https) gehen; http nur lokal zum Entwickeln.
function allowedEndpoint(u) {
  let x;
  try { x = new URL(u); } catch { return false; }
  if (x.username || x.password) return false;
  if (x.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/i.test(x.hostname)) return true;
  return (x.protocol === "http:" || x.protocol === "https:") && ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
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
        version: { type: "boolean", short: "v" },
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

  if (o.version || pos[0] === "version") {
    console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
    return;
  }
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
  if (!allowedEndpoint(endpoint)) die(T.e_bad_endpoint(endpoint));
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
    const isAgentWrapper = Object.keys(fset).some((rel) => isMergeTarget(rel));
    if (toolKey === "codex" && isAgentWrapper && !o.global) { base = CWD; where = T.where_project; }
    // Cursor and Cline read agent rules/workflows only inside a project (Cursor user rules are not files;
    // Cline: .clinerules/ and .clinerules/workflows/), so their agent wrappers always go project-local.
    const isProjectWrapper = Object.keys(fset).some((rel) => rel.startsWith(".cursor/rules/") || rel.startsWith(".clinerules/"));
    if ((toolKey === "cursor" || toolKey === "cline") && isProjectWrapper) {
      if (o.global) warn(T.noGlobalPath(t.label));
      base = CWD; where = T.where_project;
    }
    // Gemini agent wrapper = extension folder (<slug>/gemini-extension.json): lands in the project and
    // gets registered via `gemini extensions install` (hint at the end). Plain skills go to .agents/skills.
    if (toolKey === "gemini" && isGeminiExt(fset)) {
      if (o.global) warn(T.noGlobalPath(t.label));
      base = CWD; where = T.where_project;
    }
    // Global only: tool-specific path-prefix swap (e.g. Windsurf .windsurf/ -> .codeium/windsurf/).
    const rw = (where === T.where_global) ? (t.globalRewrite || []) : [];
    const entries = Object.keys(fset).map((rel) => ({
      target: (() => { const r = rw.find(([from]) => rel.startsWith(from)); return r ? r[1] + rel.slice(r[0].length) : rel; })(),
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
      if (isMergeTarget(e.target)) continue;
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

  // Erst ALLES prüfen (sichere Zielpfade + SHA-256 gegen die Server-Prüfsumme), dann schreiben: ein einziger
  // Fehler bricht ab, bevor irgendeine Datei angelegt wurde (keine halbe Installation).
  let verified = 0;
  for (const g of groups) for (const e of g.entries) {
    const dest = resolve(g.base, ...e.target.split("/"));
    if (dest === g.base || !dest.startsWith(g.base + sep)) die(T.e_unsafe_path(e.target));
    if (e.hash) { if (sha256(e.content) === e.hash) verified++; else die(T.hashMismatch(e.target)); }
  }
  for (const g of groups) {
    let mergedAny = false;
    for (const e of g.entries) {
      const r = installFile(g.base, e.target, e.content, skill); if (r.merged) mergedAny = true; total++;
    }
    ok(T.written(bold(g.labels.join(", ")), g.where, g.entries.length, g.base));
    if (mergedAny) info(({
      en: "AGENTS.md: updated only our marked block, your existing content was kept.",
      de: "AGENTS.md: nur unseren markierten Block aktualisiert, dein Inhalt bleibt erhalten.",
      fr: "AGENTS.md : seul notre bloc balisé a été mis à jour, ton contenu est conservé.",
      es: "AGENTS.md: solo se actualizó nuestro bloque marcado, tu contenido se mantiene.",
    })[L] || "AGENTS.md: updated only our marked block, your existing content was kept.");
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
  // Only for extension folders (Gemini agent wrappers): Gemini does not auto-discover them, registering
  // is mandatory. Plain skills in .agents/skills are picked up natively, no hint needed.
  for (const dir of geminiExtDirs(fileSet.gemini)) {
    console.log(`${cyan(">")} ${T.geminiHint(bold("gemini extensions install ./" + dir))}`);
  }
}

main().catch((e) => { if (!(e && e.handled)) console.error(`${red("x")} ${e && e.message ? e.message : e}`); process.exitCode = 1; });
