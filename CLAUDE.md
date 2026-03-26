# CLAUDE.md — cogdebt (Cognitive Debt Tracker)

## What This Is

A CLI tool that tracks how well a developer understands their own codebase. Built for "vibe coders" who use LLMs to write most/all of their code and risk losing grasp of the implementation.

**npm package:** `cogdebt` (published)
**Install:** `npm install -g cogdebt`
**CLI command:** `cogdebt`

## How It Works

1. `cogdebt init` — scans codebase, discovers topics, identifies quiz-worthy files
2. `cogdebt quiz` — developer picks topics, answers questions about actual code blocks
3. Correct answers (≥50%) mark the specific ~200 LOC block as "covered" → coverage % goes up
4. `cogdebt decay` — when code changes, only affected blocks lose coverage (instant, no LLM, free)
5. `cogdebt status` — dashboard showing coverage per topic

**Score = covered blocks / total blocks per topic.** Files are split into ~200 LOC blocks. Starts at 0%, not arbitrary. Decay auto-runs before quiz and status, so scores are always up-to-date.

## Tech Stack

- **Node.js + TypeScript**, ESM, built with `tsup`
- **UI:** Ink (React for terminal) — all interactive components are `.tsx`
- **LLM:** Claude Code CLI (`claude -p - --output-format json --dangerously-skip-permissions`) via stdin piping
- **Data:** Local `.cogt/` directory per project (gitignored)

## Development

```bash
npm run build        # Build with tsup → dist/index.js
npm run dev          # Watch mode
npm link             # Link globally for local testing
```

## Architecture

```
src/
├── index.ts                    # CLI entry (commander routes)
├── types.ts                    # All Zod schemas + TypeScript types
├── commands/                   # One file per CLI command
│   ├── init.tsx                # cogdebt init (scan + calibration)
│   ├── scan.ts                 # Topic discovery + quiz file identification
│   ├── status.tsx              # Dashboard (Ink)
│   ├── decay.tsx               # Mark changed blocks as uncovered (no LLM, hunk-level precision)
│   ├── quiz.tsx                # Topic selector → question count → quiz wizard → evaluation
│   ├── history.tsx             # Event log display
│   └── hooks.tsx               # Claude Code status line + git hook setup
├── core/                       # External integrations
│   ├── claude.ts               # Claude CLI wrapper (stdin piping via temp file)
│   ├── store.ts                # Read/write .cogt/ JSON files
│   ├── git.ts                  # Git operations (diff, diffHunks, log, head)
│   └── config.ts               # .gitignore management, project root
├── engine/                     # Pure logic (no I/O)
│   ├── quiz-engine.ts          # Question generation, answer evaluation, block computation, recommended count
│   ├── scoring.ts              # Coverage computation, trends
│   └── topics.ts               # Topic tree operations, file-to-topic mapping
└── ui/
    ├── display.ts              # Pure computation (score helpers, brief status string)
    └── components/             # Ink (React) components
        ├── QuizWizard.tsx      # Main quiz: Tab/number navigation, answer input, submit
        ├── TopicSelector.tsx   # Checkbox topic picker with scores
        ├── QuestionCountPicker.tsx  # LOC-based question count slider
        ├── StatusDashboard.tsx # Topic tree with coverage scores
        ├── DecayOutput.tsx     # Decay results display
        ├── HistoryView.tsx     # Event log
        ├── Confirm.tsx         # Y/N prompt
        ├── Spinner.tsx         # Loading spinner
        └── ProgressBar.tsx     # Score bar + helper components
```

## Data Files (`.cogt/` directory)

| File | Purpose |
|------|---------|
| `config.json` | Project name, settings (quiz count, decay rate) |
| `topics.json` | Hierarchical topic tree with `quizFiles` per leaf topic |
| `scores.json` | Score + trend per topic (score is derived from coverage) |
| `coverage.json` | Per-block coverage tracking (v3: keys are `topicId::filePath::blockIndex`) |
| `history.json` | Event log (decay, quiz, scan, calibration events) |
| `quiz-history.json` | Previously asked questions per topic (prevents repeats) |
| `decay-cursor.json` | Last analyzed git commit hash |

## Key Design Decisions

### Block-Level Coverage
Files are split into ~200 LOC blocks (`BLOCK_SIZE = 200`). Score = covered blocks / total blocks per topic. Each quiz question targets a specific block (line range). A block is "covered" when you answer a question about it with ≥50% score. Only the specific block gets covered, not the whole file.

### Block-Level Decay (No LLM)
Decay parses `git diff -U0` hunk headers to find exactly which lines changed, maps them to block indices, and only uncoveres the affected blocks. A 1-line change in a 3000 LOC file only decays the ~200 LOC block containing that line. Instant, free, auto-runs before quiz and status. Also runs as git post-commit hook.

### Quiz Results UX
Per-question scores show qualitative labels (Got it / Partial / Missed) instead of percentages. The 50% threshold still drives coverage internally, but the developer sees encouraging feedback, not exam grades.

### Quiz File Filtering
During scan, Claude identifies "quiz-worthy" files per topic — excludes barrel exports, type-only files, constants, configs. This is the denominator for coverage.

### Question Generation
Each question targets a specific block (line range). The prompt tells Claude: "Read file X and generate a question focused on lines Y-Z." Claude sees the whole file for context but targets the block. Questions include `blockIndex` so coverage knows which block to mark.

### Question Deduplication
Asked questions are stored in `quiz-history.json`. The generation prompt includes them so Claude asks different questions. When code changes in a topic, that topic's quiz history is cleared (old questions may have new answers).

### Question Count from Blocks
The question count picker shows uncovered block count. Recommended count = 70% of uncovered blocks, capped at 10. Each question maps to one block. No LLM needed for counting.

### Claude CLI Integration
All LLM calls use `cat tempfile | claude -p - --output-format json --dangerously-skip-permissions`. Stdin piping avoids argument length limits. JSON extraction handles preamble text (finds first `{` to last `}`). Init pre-checks Claude CLI availability via `which claude` before creating any `.cogt/` state.

### Robustness: Missing Files
`countFileLines()` returns `null` for deleted/moved files. All call sites (coverage init, migration, decay, quiz) skip null files silently. Scan validates quiz file paths exist on disk before saving. This prevents phantom 1-block coverage entries for files that no longer exist.

### Hooks Directory Safety
`cogdebt hooks` creates parent directories (`~/.claude/`, `.git/hooks/`) with `mkdir(recursive: true)` before writing files, so it works on fresh systems.

## Publishing

```bash
# Bump version in package.json + src/index.ts
npm publish --access public
```

Requires npm token with "bypass 2FA" permission in `.npmrc` or interactive login.

## Known Issues / TODOs

- Ink ghost lines: PaddedContainer workaround adds blank lines to prevent render artifacts
- `--brief` mode uses plain chalk (no Ink) for hook compatibility
- Scan does 2 LLM passes (topics + quiz files) — could potentially merge into one
- Large codebases with 20+ leaf topics: quiz file identification is batched (5 per call)
- When hunk parsing fails, decay falls back to uncovering all blocks in changed files (warns user)
- Topics with 0 quiz files are filtered from quiz selector and status dashboard
