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
Every shipped toolkit JS/MJS source file must meet 90% lines, 80% branches and 90%
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

### Suggestion popups

Import `createSuggestionView` from `@comfyassets/toolkit/ui/suggestions`.
Pass a scope, host theme settings and optional `{ label }`; call
`render(items, onSelect, onInsert)`, `select(index)`, `position(fieldRect)` and
`hide()`. Items require `name`; optional `type` and `fullPath` add resource badges
and embedding directories. The consumer owns keyboard navigation, input ARIA
state, matching and insertion. Disposing the scope removes the popup and listeners.

## Same-origin prompt bridge

`@comfyassets/toolkit/ui/prompt-bridge` exports `createBridgeHost`,
`createBridgeClient` and `validateRoles`. This transport has no ComfyUI imports:
consumer adapters own target discovery, widget policy, conflict detection and edits.

```js
const host = createBridgeHost({
    namespace: '/my-comfy-proxy/', origin: location.origin, label: 'My workflow',
    adapter: {
        listTargets: () => [{ id: 'node-12', label: 'Prompt node' }],
        preview: (targetId, roles) => ({
            preview: { targetId, changes: roles },
            snapshot: captureValidatedEdit(targetId, roles),
        }),
        apply: snapshot => applyIfUnchanged(snapshot),
    },
});
const client = createBridgeClient({ namespace: '/my-comfy-proxy/', origin: location.origin });
const hosts = await client.discover({ waitMs: 150, signal });
const preview = await client.preview(hosts[0].hostId, 'node-12', { positive: 'mountains' }, { signal });
// Render preview and require the user's explicit Apply action before this call.
const acknowledgement = await client.apply(hosts[0].hostId, preview.ticket, { signal });
client.dispose();
host.dispose();
```

All adapter methods are synchronous. `preview` returns `{ preview, snapshot }`;
the client receives `{ ...preview, ticket }`, never the private snapshot.
`apply` must revalidate the captured destination/workflow and return a serializable
acknowledgement. A positive and/or negative role must be an own string property;
empty strings intentionally clear a role, while nulls, unknown keys and combined
UTF-8 payloads over 1 MiB are rejected.

Use the same normalized HTTP(S) `origin` and installation-specific `namespace`
on both ends. The namespace must distinguish independently proxied ComfyUI
installations. BroadcastChannel is same-origin communication, not authentication
against other scripts on that origin. Unsupported browsers throw explicitly;
consumers should explain how to open a supported host instead of claiming success.
Optional `channelFactory(name)` enables isolated tests; its channel implements
`postMessage`, `addEventListener`, `removeEventListener` and `close` with browser
MessageEvent origins.

Optional `hostId`/`clientId` are useful for tests; production defaults are UUIDs.
Client `timeoutMs` defaults to 3000 (alias `requestTimeoutMs`); individual preview
and apply calls may override it. Discovery waits `waitMs` and returns all replying
hosts. Host `previewTtlMs` defaults to 30000, `maxTickets` to 100 and `maxReplay`
to 200. Tickets expire, bind to one client and allow one application. Duplicate
request IDs replay the cached acknowledgement without applying twice; conflicting
reuse is ignored. Disposal and transport errors close channels, cancel waits and
release listeners. Abort signals cancel client waits, and expired or stale edits
require a fresh preview. Protocol major 1 validates origin, namespace, destination
and request identity; independently installed consumers can communicate without
sharing module instances.

Consumers can run the identical protocol contracts against their pinned artifact:

```js
import * as bridge from './vendored/ui/prompt-bridge.js';
import { registerPromptBridgeContracts } from '@comfyassets/toolkit/testing/prompt-bridge-contracts';
registerPromptBridgeContracts(bridge, () => import('./vendored/ui/prompt-bridge.js?independent-copy'));
```

This Node.js test helper registers the full transport suite, including independent
module instances; supply the actual installed module rather than a rewritten copy.
