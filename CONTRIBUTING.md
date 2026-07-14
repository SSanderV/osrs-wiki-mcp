# Contributing

Use Node.js 24 or newer and install dependencies with
`npm ci --ignore-scripts`.

All behavior changes require a failing test first. Tests must use synthetic
fixtures rather than copied Wiki responses. Run typechecking, all offline
tests, the build, and the package inspection before opening a pull request.

Do not add player names, private endpoints, credentials, generated tarballs,
Wiki-derived hardcoded datasets, or Wiki images to the repository.
