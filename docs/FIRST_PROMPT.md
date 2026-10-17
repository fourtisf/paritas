# What to paste into Claude Code

Unzip the package, open the `paritas/` folder in Claude Code, and paste:

---

Read CLAUDE.md fully, then docs/BRIEF.md, docs/DEMO_TO_PRODUCTION.md and docs/DESIGN_SYSTEM.md.

First, prove the repo works:
1. Run `forge test` in contracts/ and `npm install && npm test` at the root.
2. Start anvil with `--timestamp 1792504800`, run DeployLocal, then run `npm run smoke:local -w @paritas/shared`.
3. Report the results before changing anything.

Then port prototypes/paritas-platform.html into apps/web, page by page, starting with /app/trade:
- Use real data from the API and wagmi, never the prototype's demo arrays.
- Keep the look identical to docs/screenshots/platform-*.png at 1440px and 390px.
- Use useQuote and useSwap for the trade flow.
- After each page, run typecheck and compare against the screenshot.

Do not change contracts, config/protocol.json or the shared math unless I ask. Never invent addresses.

---
