import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));

test('the package is reproducible and installs independently without runtime dependencies or scripts', t => {
    const directory = mkdtempSync(join(tmpdir(), 'comfyassets-package-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const npm = args => execFileSync('npm', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const pack = () => JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', directory]))[0];
    const first = pack();
    const contents = readFileSync(join(directory, first.filename));
    const second = pack();
    assert.deepEqual(readFileSync(join(directory, second.filename)), contents);
    for (const path of ['ui/core.js', 'ui/controls.css', 'testing/comfyui-host.mjs', 'testing/coverage.mjs', 'LICENSE']) assert.ok(first.files.some(file => file.path === path));
    assert.ok(first.files.every(file => !/^(tests|tools|coverage|node_modules)\//.test(file.path)));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    npm(['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', '--prefix', directory, join(directory, first.filename)]);
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
        import { launchComfyHost } from '@comfyassets/toolkit/testing/host';
        import { discoverSources } from '@comfyassets/toolkit/testing/coverage';
        import { createScope, themeFromColor } from '@comfyassets/toolkit/ui/core';
        const scope = createScope(); scope.dispose();
        console.log(JSON.stringify([typeof launchComfyHost, typeof discoverSources, scope.signal.aborted, themeFromColor('#fff')]));
    `], { cwd: directory, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), ['function', 'function', true, 'light']);
});
