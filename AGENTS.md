# Repository Guidelines

## Purpose and Boundaries

This toolkit provides reusable browser controls and test infrastructure for
ComfyAssets custom nodes. KikoTools is the proven reference; PromptManager is
the first package consumer. Keep HTTP routes, node schemas, controllers, data
setup and legacy adapters in their node packs. Backport package adoption to
KikoTools after PromptManager validates the boundaries.

## Structure and Commands

`ui/` contains browser modules and scoped CSS. `testing/` contains Node.js test
helpers; `tests/` contains their contracts. Use Node.js 24. Install development
dependencies with `npm ci --ignore-scripts`; run `npm test` for contracts and
`npm run test:coverage` for the shared tooling coverage gate. Browser controls
are exercised by consumer browser suites before adoption.

## Development Rules

Use TDD: record a failing regression test before changing behavior. Preserve
consumer coverage floors, public node interfaces and workflow persistence.
Use explicit host interfaces rather than importing ComfyUI or sibling repos.
Dispose owned timers, listeners, observers and DOM; preserve existing hooks.
Keep the approved blue accent and strong red errors consistent across packs.
Installed node packs must run without npm or a sibling installation. Ship exact
version pins and reproducible artifacts; test independent and combined consumers
before claiming cross-pack compatibility. Attribute Pixaroma as inspiration;
never copy his implementation or assets.

## Pull Requests

Use tracked issues and Conventional Commits. Describe observable behavior,
validation and remaining boundaries. Include screenshots for appearance changes.
Do not lower gates to pass checks. Never include secrets or personal runtime
state. Test against disposable CPU hosts, never the user's running ComfyUI.
