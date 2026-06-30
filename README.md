# @skills-for-ai/cli

Install your unlocked **Skills & Agents** from [skills-for-ai.com](https://skills-for-ai.com)
with a single command — no ZIP, no manual copying.

```bash
npx --yes @skills-for-ai/cli add <skill> --token <your-token>
```

You'll find your token, logged in, under **"My Skills"** (one token per skill).

This is the **open-source** (MIT) client. It runs entirely on your machine — so you can read exactly
what it does before running it. The source you see here is the source that gets published to npm.

## Requirement: Node.js

`npx` ships with **Node.js LTS** — install once, then it works everywhere.

Windows (winget), then reopen your terminal once:

```powershell
winget install OpenJS.NodeJS.LTS
```

No Windows, or winget blocked on a corporate network? Get Node.js LTS from <https://nodejs.org/en/download>.

## What it does

1. Detects locally which AI tools are installed (or you pick them with `--tool`).
2. Downloads the files via a secured endpoint (token check).
3. Verifies the delivered files against server-side **SHA-256 checksums** (integrity check).
4. Drops them **tool-natively** — e.g. Claude Code: `~/.claude/skills/…`, `~/.claude/agents/…`.

Existing files are never replaced silently: in a terminal the CLI asks before overwriting; on automated
runs it prints a notice. `--force` skips the prompt.

## What it does NOT do

- Reads no project files, no `.env`, no API keys.
- Sends no project content — only the token, skill name and detected tools leave your machine.
- Installs no background services and runs no foreign remote scripts.
- Writes only into the known skill paths (a double path guard, client and server, blocks writing outside).

See [SECURITY.md](SECURITY.md) for the full security model and how to report issues.

## Remove a skill again

Local and **without a token** — deletes the skill folder for each tool and, for Codex, removes only
our marked block from your `AGENTS.md` (your other content stays untouched):

```bash
npx --yes @skills-for-ai/cli remove <skill>
```

Without `--tool` / `--global` / `--project` all detected tools are checked in both scopes. Deletion
happens only inside the known skill paths (safety check). See what is installed: `npx @skills-for-ai/cli doctor`.

## Options

| Option | Meaning |
|---|---|
| `--token <token>` | Token from "My Skills" (required for `add`). |
| `--tool <key>` | Target tool (repeatable). `*` = all detected. |
| `--global` | Install globally (default where supported). |
| `--project` | Install into the current project. |
| `--lang <l>` | Output language: `en`, `de`, `fr`, `es` (default: `en`). |
| `--force` | Overwrite existing files without asking. |
| `--help` | Help. |

Supported tools: `claude-code`, `gemini`, `cursor`, `github-copilot`, `codex`, `windsurf`, `cline`.

## License

[MIT](LICENSE). The CLI tool is open source. Note that the **Skills & Agents** you download with it are
separate content governed by their own terms at <https://skills-for-ai.com/agb/>.

---

## Release (maintainers)

Published **automatically via GitHub Actions (npm Trusted Publishing / OIDC)** — no npm token, no secret.
Trigger: a git tag `v<version>`. Published **with provenance** (a signed link from the package back to
this public repo + build). Workflow: `.github/workflows/publish.yml`.

```bash
npm version patch          # bumps package.json, creates the v<version> tag
git push --follow-tags     # tag push -> CI publishes via OIDC + provenance
```

The workflow checks that the tag version matches `package.json`. End users install with
`npx @skills-for-ai/cli …`, which always fetches the latest version.
