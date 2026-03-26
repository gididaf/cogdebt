# cogdebt

**Cognitive Debt Tracker** — quantify and close the gap between vibe-coding and understanding.

Built for developers who use LLMs to write most of their code and want to make sure they still understand what's in their codebase.

## How It Works

```
cogdebt init     # Scan your codebase, discover topics
cogdebt quiz     # Answer questions about your actual code
cogdebt status   # See your coverage dashboard
```

1. **Scan** — discovers topics in your codebase and identifies quiz-worthy files
2. **Quiz** — asks you implementation questions about specific code blocks (~200 LOC each)
3. **Score** — tracks which blocks you've demonstrated understanding of
4. **Decay** — when code changes, only the affected blocks lose coverage (automatic, instant, no LLM)

Your score = covered blocks / total blocks per topic. Start at 0%, build up by taking quizzes, watch it decay as code changes.

## Install

```bash
npm install -g cogdebt
```

**Requires:** [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated.

## Quick Start

```bash
cd your-project
cogdebt init        # Scans codebase, discovers topics (~30s)
cogdebt quiz        # Pick topics, answer questions
cogdebt status      # See your dashboard
```

## Commands

| Command | Description |
|---------|-------------|
| `cogdebt init` | Initialize cogdebt for the current project |
| `cogdebt quiz` | Interactive quiz on your code |
| `cogdebt status` | Coverage dashboard |
| `cogdebt decay` | Check for code changes and update coverage |
| `cogdebt scan` | Re-scan codebase for topic changes |
| `cogdebt history` | View score change history |
| `cogdebt hooks` | Set up git hooks and Claude Code status line |

## Key Concepts

### Block-Level Coverage

Files are split into ~200 LOC blocks. Each quiz question targets a specific block. Answering correctly covers that block, not the whole file. A 1000 LOC file needs ~5 correct answers to fully cover.

### Smart Decay

When you change code, only the blocks containing the changed lines lose coverage. A 1-line fix in a 3000 LOC file only decays the ~200 LOC block around that line — not the whole file.

Decay runs automatically before `quiz` and `status`, so your scores are always current. It also runs as a git post-commit hook if you set up `cogdebt hooks`.

### No LLM for Decay

Decay is instant and free. It parses `git diff` hunks to find changed lines and maps them to block indices. No API calls needed.

### Scoring

- Questions are scored as **Got it** / **Partial** / **Missed**
- A block is "covered" when you score >= 50% on a question about it
- Coverage = covered blocks / total blocks per topic
- The goal is familiarity, not perfection

## Data Storage

All data is stored locally in a `.cogt/` directory (auto-added to `.gitignore`). Nothing is sent anywhere except the Claude API for question generation and answer evaluation.

## Requirements

- Node.js >= 18
- Git repository
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

## License

MIT
