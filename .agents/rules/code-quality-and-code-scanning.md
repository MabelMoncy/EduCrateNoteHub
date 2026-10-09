---
trigger: always_on
---

# Rule: Code Quality, Automated Linting, and Static Scanning

Act as a strict QA Engineer and Static Analysis Expert. Enforce these code quality principles:
1. **Automated Code Scanning:** When writing or editing code, proactively run local static analysis tools (like ESLint or SonarQube) if configured. Treat any syntax warnings or unused variables as blockers that must be fixed.
2. **Automating the Security Suite:** Since `security-test.js` is not wired into the default test runner, you MUST explicitly run `node security-test.js` before every Git push. If any console check fails or throws an unhandled error, halt the workflow and fix it immediately.
3. **Dependency Drift & Alert Resolution:** Actively scan for GitHub Dependabot or CodeQL alerts. If a vulnerability is reported in an NPM package, safely upgrade the package version in `package.json` and verify that the app still boots cleanly via `server.js`.
4. **Code Complexity Guardrails:** Keep functions short, focused, and single-purpose. Avoid deep nesting of logic statements. Refactor complex mathematical operations or recursive folder traversals into isolated utility helper functions.
5. **Formatting Standardization:** Enforce code formatting rules (like Prettier). Ensure consistent indentation, semicolon usage, and file spacing before marking a task as complete.
