# ComfyAssets Toolkit

Original shared controls and test infrastructure for ComfyUI custom nodes.
KikoTools is the proven reference; PromptManager is the first package consumer.
KikoTools package adoption follows after PromptManager validates the boundaries.
Other custom nodes can consume the same explicit interfaces.

## Contents

- `ui/core.js` and `ui/controls.css`: scoped controls, blue primary actions,
  strong red errors, ComfyUI-following dark/light colors and disposable scopes.
- `testing/comfyui-host.mjs`: verified upstream revision, isolated tracked-file
  installation, CPU/offline startup, retained diagnostics and bounded shutdown.
- `testing/coverage.mjs`: recursive JS/MJS discovery, per-module coverage gates
  and configurable browser-to-source mapping.

Node packs keep their routes, schemas, controllers, data setup and feature tests.
Host preparation uses `preparePlugin({ installed, stateDirectory })`, which can
return environment overrides. The host never installs packages or fetches models.
Its checkout and Python runtime must be prepared separately with reviewed pins.

## Consumption

Maintainer tools install an exact Git commit archive through their npm lockfile:

```js
import { launchComfyHost } from '@comfyassets/toolkit/testing/host';
import { discoverSources, checkCoverage } from '@comfyassets/toolkit/testing/coverage';
```

The first PromptManager integration consumes testing helpers. Browser controls
are exported as `@comfyassets/toolkit/ui/core` and `./ui/controls.css` for the next
bounded dialog migration. Browser consumers must ship checked-in, reproducible
artifacts from an exact pin: installed custom nodes must work without npm, this
repository, or a sibling node pack. No code reaches into KikoTools at runtime.

The toolkit does not claim complete cross-pack or mixed-version compatibility.
Before shipping its first UI consumer, verify scoped styling, isolated settings,
independent cleanup, standalone-page theme propagation and mixed-version loads.
Later abstractions should follow demonstrated consumer needs.

## Development

Use Node.js 24, then:

```sh
npm ci --ignore-scripts
npx playwright install --with-deps chromium
npm test
npm run test:coverage
```

Coverage combines Node V8 contracts and real Chromium desktop/touch controls.
Every toolkit JS/MJS source file must meet 90% lines, 80% branches and 90%
functions. Reports and failure traces are retained in CI. Tests use temporary
Git fixtures, files and fake processes; consumer suites verify real ComfyUI.
Packaging tests prove byte-reproducible archives and independent installation.

Use TDD and record failing-before/passing-after evidence. Preserve consumer gates
and public node interfaces. Use disposable CPU hosts, never the user's running
ComfyUI or personal configuration/database.

## Attribution

The control primitives were extracted from ComfyAssets' original KikoTools
implementation; see [source provenance](SOURCE.md). Their organization was
inspired by [Pixaroma](https://github.com/pixaroma/ComfyUI-Pixaroma). His code,
styles and assets are not vendored. MIT licensed.
