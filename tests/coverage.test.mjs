import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { discoverSources, checkCoverage } from '../testing/coverage.mjs';

test('coverage discovers nested source and refuses unmeasured or unreviewed files', t => {
    const root = mkdtempSync(join(tmpdir(), 'ca-coverage-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'nested'));
    for (const name of ['root.js', 'nested/control.mjs', 'nested/style.css']) writeFileSync(join(root, name), '');
    assert.deepEqual(discoverSources(root), ['nested/control.mjs', 'root.js']);
    assert.match(checkCoverage({}, {}, root, discoverSources(root)).join('\n'), /baseline.*nested\/control.mjs/);
    const floor = { lines: 80, branches: 80, statements: 80, functions: 80 };
    assert.match(checkCoverage({}, { 'root.js': floor }, root, ['root.js']).join('\n'), /Missing coverage/);
    const measured = Object.fromEntries(Object.keys(floor).map(key => [key, { pct: 90 }]));
    assert.deepEqual(checkCoverage({ [join(root, 'root.js')]: measured }, { 'root.js': floor }, root, ['root.js']), []);
});

test('browser coverage maps configured nested source paths without accepting unrelated files', async () => {
    const { mapBrowserCoverage } = await import('../testing/coverage.mjs');
    const root = join(tmpdir(), 'consumer/web/js');
    const urls = ['/prompt_manager/js/gallery.js', '/prompt_manager/js/shared/core.mjs?v=1', '/scripts/app.js', '/prompt_manager/js/../private.js', '/prompt_manager/js/shared/theme.css'];
    const result = mapBrowserCoverage(urls.map(path => ({ url: `http://127.0.0.1:8765${path}`, functions: [] })), { urlPrefix: '/prompt_manager/js/', sourceRoot: root });
    assert.deepEqual(result.map(entry => entry.url), [pathToFileURL(join(root, 'gallery.js')).href, pathToFileURL(join(root, 'shared/core.mjs')).href]);
    const other = mapBrowserCoverage([{ url: 'http://localhost:8771/extensions/other/ui/core.js', functions: [] }], { urlPrefix: '/extensions/other/', sourceRoot: root });
    assert.equal(other[0].url, pathToFileURL(join(root, 'ui/core.js')).href);
});
