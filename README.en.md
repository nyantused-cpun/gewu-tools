# gewu-tools (格物)

[![npm](https://img.shields.io/npm/v/gewu-tools.svg)](https://www.npmjs.com/package/gewu-tools)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**The Gewu Inspection Surface**: let text-only models in DSH complete visual-inspection tasks through vision subagents.

> 格物 (Gewu): from the *Great Learning* — "investigate things to attain knowledge." Look carefully first, then conclude.
> 中文: [README.md](README.md)

## Quick install (npm)

```powershell
npm i gewu-tools
pwsh node_modules\gewu-tools\scripts\install-gewu-plugins.ps1 -Install   # idempotent mount into DSH
# Restart the DSH session; gewu_prep / gewu_locate appear in the tool catalog. -Verify = 3 greens.
```

## Problem

The DSH session brain is usually a **text-only model** — it cannot see rendered pages, so it cannot answer "does this proposal page look good / crowded / misaligned?" Vision subagents (e.g. `subagent_vision`, mimo-v2.5, qwen3.7-plus) can see, but have two weaknesses:

1. **No session context**: they don't know client ground rules or business-marker semantics (e.g. ⭐ = "core capability", not decoration), so intentional design gets reported as defects;
2. **They misread**: OCR-level character errors, and page attribution drifted by screenshot viewport boundaries.

gewu-tools packages a three-step pipeline (validated on a 24-page proposal, 2026-08-16) into two tools:

```
① gewu_prep    screenshot + briefing: renders an HTML document page-by-page and generates a
               complete vision-subagent briefing contract (discipline / artifact / attribution rules)
② vision subagent    dispatch: the main agent calls DSH's native vision subagent with the briefing
③ gewu_locate  truth verification: locates a text/number from the review back into the HTML source
               (page section id + line number); count=0 means OCR misread — do not trust it
```

## Model-agnostic statement

Validated on vision subagents **mimo-v2.5 (conservative)** and **qwen3.7-plus (more insightful, slightly more false positives)**. Finding: **model tier does not determine the trustworthiness of review results** —

- The **briefing contract (context)** eliminates context-free false positives: e.g. reporting business markers like ⭐ (core capability) as decorative emoji — observed systematically in the no-briefing plugin mode during testing;
- The **truth-verification loop (`gewu_locate`)** blocks OCR misreads and page-attribution drift before acceptance: in testing, 2.5 of qwen3.7-plus's 3 core new claims failed source-code verification — all were caught by the verification step.

Tier differences only show up in **review style** (higher-tier = sharper insight, steadier = more conservative conclusions), not in correctness. With any vision model, the pipeline output stays trustworthy and auditable — which is exactly why verification is hard-wired as the third step.

## Install

Prereqs: Windows + Chrome/Edge + Node 24+ (for the verify script only).

```powershell
pwsh gewu\scripts\install-gewu-plugins.ps1 -Install    # idempotent
pwsh gewu\scripts\install-gewu-plugins.ps1 -Verify     # verify only
pwsh gewu\scripts\install-gewu-plugins.ps1 -Uninstall  # remove
```

The script appends a `gewu-tools` mount row to the DSH agent preset (default `pre-sales`, override with env `GEWU_PRESET`), pointing at `<workspace>\.dsh\gewu-tools` (a Junction to this project).

**Restart the DSH session after install** (host plugins have no HMR).

## Usage (main-agent view)

```text
1. gewu_prep(html_path="...", client="<client>", background="<ground rules / marker semantics>")
   → { pages: [...], briefing: "..." }
2. Call a vision subagent with the briefing as its prompt → per-page issue list + conclusions
3. gewu_locate(html_path=..., needle=<text/number from the findings>) for every key finding
```

## How it works

- **Screenshots**: reads `<section>` anchors (prefers `v2-page` class), captures each page via headless Chrome viewport; sticky nav pushed out by iframe offset; falls back to a full-page shot when no anchors exist. Chrome is spawned from the host process, bypassing the restricted sandbox's named-pipe limitation.
- **Briefing contract** (baked into `briefing`):
  - discipline: subagent skips entry protocols, never asks the user, reads images via `read_image` (prevents deadlocks);
  - artifact notice: fixed-viewport screenshots concatenate page boundaries — a next-section header at the bottom is an artifact, not a design flaw; attribution rule: content from the next section belongs to the next page;
  - output spec: per-page "page｜issue｜severity｜fix", visible issues only.
- **Truth verification**: locates each `needle` occurrence in source, returning page section id + line number + tag-stripped snippet.

## Test

```powershell
node gewu\index.js <any HTML with section anchors> [outDir]   # standalone smoke, no DSH needed
```

## Compatibility

- DSH 0.1.0-rc.6 (cordis plugin + defineTool surface)
- Peer dependency: `@deepseek-ai/dsh-tools` only (resolved via the workspace AiBridge junction)
- Browser: auto-detects Chrome/Edge, no config

## License

MIT — see [LICENSE](LICENSE). Version 1.0.0 (2026-08-16).
