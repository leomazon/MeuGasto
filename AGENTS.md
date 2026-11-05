# Contributing to MeuGasto

Use test-driven development for new features and bug fixes. First add or update automated tests that describe the expected behavior and confirm they fail for the missing behavior. Then implement the smallest change that makes them pass.

Before implementing a feature, check whether a suitable, maintained library already provides it. Prefer a library when it fits the existing stack, local/self-hosted use, accessibility needs, and maintenance goals; avoid adding a framework or disproportionate dependencies for an isolated feature. Record the trade-off when a library is unsuitable.

Whenever a bug is found, add a regression test that reproduces it before fixing it. Choose a unit test, an end-to-end test, or both based on where the failure occurs, and keep the regression test in the repository so the bug does not return.

Use Node's built-in test runner for core logic, Python's `unittest` for the SQLite server, and Playwright for browser end-to-end tests under `tests/e2e/`. Keep all test types in the repository. Before finishing a change, run the complete automated suite with `npm test` and `npm run test:e2e`. Install development dependencies with `npm install` and the E2E browser with `npx playwright install chromium` when needed.

Prefer a testing pyramid: cover calculations, validation rules, formatting, and other isolated logic with unit tests; cover interactions between the UI, persistence, SQLite, and APIs with integration tests; reserve Playwright E2E for critical user workflows or behavior that depends on a real browser. Do not add E2E tests for cosmetic or layout-only adjustments. Choose the smallest test level that gives reliable coverage, and avoid growing the E2E suite when a unit or integration test can verify the behavior.

For visual design and UI styling work, use the project-local `frontend-design` skill in `.agents/skills/frontend-design/SKILL.md` to guide the design decisions and visual review.

## Form layout consistency

- Build new form fields with the shared `.field`, `.field-row`, and `.full-field` styles so labels, input heights, typography, spacing, and responsive behavior match existing forms.
- Keep fields in a `.field-row` aligned at the top. Put conditional fields in their own row after the grid; do not nest an extra field inside one column, because it can stretch and misalign its sibling input.
- Avoid one-off label or input sizing for new fields unless the user specifically requests a different treatment.

## Git workflow

- For each cohesive feature or fix, create a dedicated branch (for example, `feat/contas-carteiras`); group related small visual adjustments with the feature instead of creating a branch for every tiny tweak.
- After the change is complete and the required checks pass, create a descriptive commit and push the branch to GitHub.
- Merge the verified branch into `main` and push `main` after the feature is ready. Do not leave completed, authorized work only in the local working tree.
