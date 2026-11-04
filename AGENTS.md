# Contributing to MeuGasto

Use test-driven development for new features and bug fixes. First add or update automated tests that describe the expected behavior and confirm they fail for the missing behavior. Then implement the smallest change that makes them pass.

Whenever a bug is found, add a regression test that reproduces it before fixing it. Choose a unit test, an end-to-end test, or both based on where the failure occurs, and keep the regression test in the repository so the bug does not return.

Use Node's built-in test runner for core logic, Python's `unittest` for the SQLite server, and Playwright for browser end-to-end tests under `tests/e2e/`. Keep all test types in the repository. Before finishing a change, run the complete automated suite with `npm test` and `npm run test:e2e`. Install development dependencies with `npm install` and the E2E browser with `npx playwright install chromium` when needed.

For visual design and UI styling work, use the project-local `frontend-design` skill in `.agents/skills/frontend-design/SKILL.md` to guide the design decisions and visual review.

## Form layout consistency

- Build new form fields with the shared `.field`, `.field-row`, and `.full-field` styles so labels, input heights, typography, spacing, and responsive behavior match existing forms.
- Keep fields in a `.field-row` aligned at the top. Put conditional fields in their own row after the grid; do not nest an extra field inside one column, because it can stretch and misalign its sibling input.
- Avoid one-off label or input sizing for new fields unless the user specifically requests a different treatment.
