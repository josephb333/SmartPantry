# SmartPantry — working conventions

Build-in-public project. Public repo. Live at josephb333.github.io/SmartPantry.

- Stack: vanilla JS, Tesseract.js OCR, GitHub Pages, localStorage. No backend 
  yet — intentionally serverless until a feature demands otherwise.
- Commit per milestone. Commit messages: anchor-based descriptions of behavior 
  change, never line numbers.
- Claims gate: any claim destined for DEVLOG/video needs console evidence — 
  when completing a milestone, show the verifying console output.
- DEVLOG.md is newest-first.
- 🔒 SECURITY GATE: anything touching API keys, auth, user data, or public 
  endpoints — flag it, name the risk in one line, and stop for independent 
  verification before implementing. Never commit secrets; env/secret store only.
- PRIVATE material (roadmap tiers, monetization, database reveal sequencing) 
  must never appear in this repo, its commits, or DEVLOG entries.
- Do not add frameworks/dependencies without asking.