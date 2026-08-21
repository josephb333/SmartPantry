# SmartPantry — working conventions

Build-in-public project. **This repo is public — everything in this file is
world-readable.** Live at josephb333.github.io/SmartPantry.

- Stack: vanilla JS, Tesseract.js OCR, GitHub Pages, localStorage. No backend
  yet — intentionally serverless until a feature demands otherwise.

## Git
- Commit per milestone. Message format: `type: description` — types are
  `feat`, `fix`, `docs`, `chore`, `refactor`. Describe the behavior change
  anchored to function/feature names, never line numbers.
- Keep the `Co-Authored-By: Claude` trailer on every commit — consistency
  over per-commit judgment.
- Push directly to `main`. Never open PRs — solo repo, Pages deploys from main.
- Commit messages stay boring and technical. No episode, content, or roadmap
  language, ever.

## Workflow
- Claims gate: any claim destined for Devlog/video needs console evidence —
  when completing a milestone, show the verifying console output.
- When asked for code or diffs, print them in full in chat — a summary is not
  a substitute.
- Before running a before/after that would be worth screen-recording, say so
  and pause — capture moments only happen once.
- Devlog.md is newest-first. Devlog entries describe shipped behavior only —
  same no-roadmap rule as commits.

## Gates
- 🔒 SECURITY GATE: anything touching API keys, auth, user data, or public
  endpoints — flag it, name the risk in one line, and stop for independent
  verification before implementing. Never commit secrets; env/secret store only.
- PRIVATE material (roadmap tiers, monetization, feature sequencing) must
  never appear in this repo, its commits, or Devlog entries.
- Do not add frameworks or dependencies without asking.
