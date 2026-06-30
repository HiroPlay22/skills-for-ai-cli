# Security

`@skills-for-ai/cli` is a small, open-source installer that runs locally on your machine. This document
describes what it does, what it deliberately does not do, and how to report a problem.

## Reporting a vulnerability

Please email **security@skills-for-ai.com** (or hallo@skills-for-ai.com) with details and steps to
reproduce. Do not open a public issue for security-sensitive reports. We aim to acknowledge within a
few days.

## What the CLI does

- Detects locally which AI tools are installed (or you select them with `--tool`).
- Downloads the files you unlocked via an HTTPS endpoint, authorized by your per-skill token.
- Verifies the delivered files against server-side SHA-256 checksums (integrity check).
- Writes them into the tool-native skill paths only.

## What the CLI does NOT do

- It reads no project files, no `.env`, and no API keys.
- It sends no project content anywhere — only the token, the skill name and the detected tool list
  leave your machine.
- It installs no background services and runs no foreign remote scripts.
- It writes only inside known skill paths. A double path-traversal guard (client **and** server) blocks
  writing outside them.
- It changes no global system settings.

## Tokens

- One token per skill, valid only for that skill, usable an unlimited number of times.
- Tokens are passed at runtime via `--token`; the CLI stores **no** token on disk.
- On a refund the token is revoked server-side; after that it downloads nothing more.

## Scope & secrets

- This repository contains only the client CLI. It holds **no** credentials, service keys, or secrets.
- The only embedded URL is the public delivery endpoint; it is token-gated and rate-limited server-side.
- Publishing to npm uses GitHub Actions **Trusted Publishing (OIDC)** with provenance — no long-lived
  npm token is stored anywhere.

## Removing / auditing

- `npx @skills-for-ai/cli remove <skill>` removes installed skills locally (no token needed).
- `npx @skills-for-ai/cli doctor` shows what is installed where.
- Because the CLI is MIT-licensed and published with provenance, you can read this source and verify the
  published package matches this repository and build.
