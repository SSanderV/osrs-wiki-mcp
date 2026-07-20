# Contributing

Use Node.js 24 or newer. Install exactly the locked dependencies without
running lifecycle scripts:

```powershell
npm.cmd ci --ignore-scripts
```

All behavior changes require a failing test first. Tests must use synthetic
fixtures rather than copied Wiki responses or Wiki-derived hardcoded tables.
Pull-request CI must not call the live Wiki.

Before opening a pull request, run:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node --test --test-concurrency=1 test/integration/eval-stub-contract.test.ts test/integration/release-artifact.test.ts
npm.cmd run smoke:stdio
npm.cmd run pack:check
npm.cmd audit --omit=dev --audit-level=high
```

Use `npm.cmd run test:live` only for a deliberate, low-volume manual check. Do
not expand its two-call request shape without discussing Wiki etiquette first.

Do not add player names, private endpoints, credentials, generated tarballs,
Wiki-derived hardcoded datasets, or Wiki images to the repository.

Keep protocol traffic on stdout and diagnostics on stderr. New or changed
outputs need declared MCP schemas, bounded arrays/text, actionable warnings,
and provenance. Preserve exact public tool names and compatibility defaults.

## Plugin bundle changes

The repository, npm runtime, Codex plugin, Claude plugin, and Gemini extension
use one release version. When the version changes, update `package.json`,
`package-lock.json`, `plugins/osrs-wiki-mcp/.codex-plugin/plugin.json`,
`.claude-plugin/plugin.json`, `gemini-extension.json`, both `.mcp.json` copies,
and every documented exact pin together. Keep the canonical and Codex-mirrored
skill and MCP files byte-identical.

Before submitting a plugin change, run the normal verification commands plus:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" plugins/osrs-wiki-mcp
claude plugin validate --strict .
node --test test/plugin-bundle.test.ts
```

Do not add credentials, environment-variable requests, personal paths, copied
Wiki data, hooks, apps, monitors, mutable npm ranges, or a second server
implementation.
