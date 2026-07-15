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
