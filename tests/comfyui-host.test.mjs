import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, readFile, realpath, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { launchComfyHost } from '../testing/comfyui-host.mjs';

async function fixture(t, program) {
    const directory = await mkdtemp(join(tmpdir(), 'pm-host-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const checkout = join(directory, 'host');
    const repository = join(directory, 'plugin');
    await mkdir(checkout);
    await mkdir(repository);
    await writeFile(join(repository, '__init__.py'), '');
    execFileSync('git', ['init', '--quiet', repository]);
    execFileSync('git', ['-C', repository, 'add', '__init__.py']);
    await writeFile(join(repository, 'config.json'), 'private-user-config');
    await writeFile(join(repository, 'prompts.db'), 'private-user-database');
    await writeFile(join(checkout, 'main.py'), program);
    const git = args => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '--quiet']);
    git(['add', 'main.py']);
    git(['-c', 'user.name=PromptManager Tests', '-c', 'user.email=tests@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
    return { checkout, repository, python: process.execPath, port: 8199,
        pins: { revision: git(['rev-parse', 'HEAD']) }, logPath: join(directory, 'host.log'), forwardOutput: false, pluginName: 'promptmanager',
        preparePlugin: async ({ installed, stateDirectory }) => writeFile(join(installed, 'config.json'), JSON.stringify({ database: { default_path: join(stateDirectory, 'prompts.db') } })) };
}

const idle = `console.log('ready'); setInterval(() => {}, 1000);`;

test('managed ComfyUI host uses disposable CPU/offline state and preserves source directories', async t => {
    const options = await fixture(t, idle);
    const host = await launchComfyHost(options);
    t.after(() => host.stop());
    await once(host.child.stdout, 'data');
    const args = host.child.spawnargs;
    for (const flag of ['--cpu', '--offline', '--disable-all-custom-nodes']) assert.ok(args.includes(flag));
    assert.equal(args[args.indexOf('--base-directory') + 1], host.stateDirectory);
    assert.equal(args[args.indexOf('--listen') + 1], '127.0.0.1');
    assert.equal(args[args.indexOf('--whitelist-custom-nodes') + 1], 'promptmanager');
    const installed = join(host.stateDirectory, 'custom_nodes/promptmanager');
    assert.notEqual(await realpath(installed), await realpath(options.repository));
    assert.equal(await readFile(join(installed, '__init__.py'), 'utf8'), '');
    await assert.rejects(access(join(installed, 'prompts.db')), { code: 'ENOENT' });
    assert.equal(JSON.parse(await readFile(join(installed, 'config.json'), 'utf8')).database.default_path, join(host.stateDirectory, 'prompts.db'));
    await writeFile(join(installed, 'prompts.db'), 'test data');
    assert.equal(await readFile(join(options.repository, 'prompts.db'), 'utf8'), 'private-user-database');
    assert.equal(await readFile(join(options.repository, 'config.json'), 'utf8'), 'private-user-config');
    await access(join(host.stateDirectory, 'user'));
    await host.stop();
    await assert.rejects(access(host.stateDirectory), { code: 'ENOENT' });
    await access(join(options.checkout, 'main.py'));
    await access(join(options.repository, '__init__.py'));
});

test('managed ComfyUI host rejects a mismatched or modified upstream checkout', async t => {
    const options = await fixture(t, idle);
    await assert.rejects(launchComfyHost({ ...options, pins: { revision: '0'.repeat(40) } }), /revision/i);
    await writeFile(join(options.checkout, 'main.py'), 'modified');
    await assert.rejects(launchComfyHost(options), /modified|dirty/i);
});

test('managed ComfyUI host preserves crash diagnostics, exit status and cleanup', async t => {
    const options = await fixture(t, `console.error('startup failed'); process.exit(7);`);
    const host = await launchComfyHost(options);
    const result = await host.finished;
    assert.equal(result.code, 7);
    assert.match(await readFile(options.logPath, 'utf8'), /startup failed/);
    await assert.rejects(access(host.stateDirectory), { code: 'ENOENT' });
});

test('managed ComfyUI host reports spawn failures and releases its temporary state', async t => {
    const options = await fixture(t, idle);
    const host = await launchComfyHost({ ...options, python: join(options.checkout, 'missing-python') });
    const result = await host.finished;
    assert.equal(result.code, 1);
    assert.match(result.error.message, /ENOENT/);
    await assert.rejects(access(host.stateDirectory), { code: 'ENOENT' });
});

test('managed ComfyUI host fails before spawning when its log cannot be opened', async t => {
    const options = await fixture(t, `require('node:fs').writeFileSync(process.argv[1] + '.started', 'yes');`);
    await assert.rejects(launchComfyHost({ ...options, logPath: options.checkout }), /EISDIR|directory/i);
    await assert.rejects(access(join(options.checkout, 'main.py.started')), { code: 'ENOENT' });
});

test('the shared host supports an independent KikoTools adapter', async t => {
    const options = await fixture(t, idle);
    const host = await launchComfyHost({ ...options, pluginName: 'kikotools', preparePlugin: undefined });
    t.after(() => host.stop());
    await once(host.child.stdout, 'data');
    assert.equal(host.child.spawnargs[host.child.spawnargs.indexOf('--whitelist-custom-nodes') + 1], 'kikotools');
    await access(join(host.stateDirectory, 'custom_nodes/kikotools/__init__.py'));
    await assert.rejects(access(join(host.stateDirectory, 'custom_nodes/kikotools/config.json')), { code: 'ENOENT' });
    await host.stop();
    await assert.rejects(access(host.stateDirectory), { code: 'ENOENT' });
});

test('the shared host rejects unsafe plugin directory names', async t => {
    const options = await fixture(t, idle);
    await assert.rejects(launchComfyHost({ ...options, pluginName: '../escape' }), /safe custom-node/);
});

test('the shared host rejects invalid checkout, revision and port options before spawning', async t => {
    const options = await fixture(t, idle);
    await assert.rejects(launchComfyHost({ ...options, checkout: undefined }), /checkout/);
    await assert.rejects(launchComfyHost({ ...options, pins: { revision: 'main' } }), /reviewed.*revision/);
    for (const port of [80, 70000, 8189.5]) await assert.rejects(launchComfyHost({ ...options, port }), /unprivileged/);
});

test('adapter failure cleans up its state and never starts a child process', async t => {
    const options = await fixture(t, idle);
    let state;
    await assert.rejects(launchComfyHost({ ...options, preparePlugin: async ({ stateDirectory }) => {
        state = stateDirectory;
        throw new Error('adapter setup failed');
    } }), /adapter setup failed/);
    await assert.rejects(access(state), { code: 'ENOENT' });
});

test('multiple selected packs copy only tracked files, isolate preparation and whitelist both', async t => {
    const options = await fixture(t, idle);
    const sibling = await fixture(t, idle);
    await writeFile(join(sibling.repository, 'tracked.txt'), 'Kiko tracked content');
    execFileSync('git', ['-C', sibling.repository, 'add', 'tracked.txt']);
    const prepared = [];
    const host = await launchComfyHost({ ...options, additionalPlugins: [{
        pluginName: 'kikotools', repository: sibling.repository,
        preparePlugin: async ({ installed, stateDirectory }) => {
            prepared.push({ installed, stateDirectory });
            await writeFile(join(installed, 'config.json'), 'isolated Kiko configuration');
        },
    }] });
    t.after(() => host.stop());
    await once(host.child.stdout, 'data');
    assert.deepEqual(host.child.spawnargs.slice(host.child.spawnargs.indexOf('--whitelist-custom-nodes') + 1), ['promptmanager', 'kikotools']);
    const installed = join(host.stateDirectory, 'custom_nodes/kikotools');
    assert.deepEqual(prepared, [{ installed, stateDirectory: host.stateDirectory }]);
    assert.notEqual(await realpath(installed), await realpath(sibling.repository));
    assert.equal(await readFile(join(installed, 'tracked.txt'), 'utf8'), 'Kiko tracked content');
    assert.equal(await readFile(join(installed, 'config.json'), 'utf8'), 'isolated Kiko configuration');
    await assert.rejects(access(join(installed, 'prompts.db')), { code: 'ENOENT' });
    assert.equal(await readFile(join(sibling.repository, 'config.json'), 'utf8'), 'private-user-config');
    await host.stop();
    await assert.rejects(access(host.stateDirectory), { code: 'ENOENT' });
    await access(join(sibling.repository, '__init__.py'));
});

test('additional packs validate names, uniqueness and repositories before preparing any pack', async t => {
    const options = await fixture(t, idle);
    const sibling = await fixture(t, idle);
    let preparations = 0;
    const primary = { ...options, preparePlugin: async () => { preparations++; } };
    for (const pluginName of ['../escape', 'unsafe/name', 'has space', '', 'PromptManager']) {
        await assert.rejects(launchComfyHost({ ...primary, additionalPlugins: [{ pluginName, repository: sibling.repository }] }), /safe custom-node|unique/i);
    }
    await assert.rejects(launchComfyHost({ ...primary, additionalPlugins: [
        { pluginName: 'kikotools', repository: sibling.repository },
        { pluginName: 'KikoTools', repository: sibling.repository },
    ] }), /unique/i);
    await assert.rejects(launchComfyHost({ ...primary, additionalPlugins: [{ pluginName: 'kikotools', repository: join(sibling.repository, 'missing') }] }), /ENOENT/);
    await assert.rejects(launchComfyHost({ ...primary, additionalPlugins: [{ pluginName: 'kikotools', repository: sibling.checkout }] }), /ENOENT/);
    await assert.rejects(launchComfyHost({ ...primary, additionalPlugins: {} }), /additionalPlugins.*array/i);
    assert.equal(preparations, 0);
});

test('adapter environments merge independent keys and identical shared values', async t => {
    const options = await fixture(t, `console.log(JSON.stringify({ primary: process.env.TEST_PRIMARY, sibling: process.env.TEST_SIBLING, shared: process.env.TEST_SHARED }));`);
    const sibling = await fixture(t, idle);
    const host = await launchComfyHost({ ...options,
        preparePlugin: async () => ({ TEST_PRIMARY: 'primary', TEST_SHARED: 'shared' }),
        additionalPlugins: [{ pluginName: 'kikotools', repository: sibling.repository,
            preparePlugin: async () => ({ TEST_SIBLING: 'sibling', TEST_SHARED: 'shared' }) }],
    });
    assert.equal((await host.finished).code, 0);
    assert.match(await readFile(options.logPath, 'utf8'), /"primary":"primary","sibling":"sibling","shared":"shared"/);
    await assert.rejects(access(host.stateDirectory), { code: 'ENOENT' });
});

test('conflicting adapter environment values reject before spawning and clean all prepared state', async t => {
    const options = await fixture(t, `require('node:fs').writeFileSync(process.argv[1] + '.started', 'yes');`);
    const sibling = await fixture(t, idle);
    const prepared = [];
    await assert.rejects(launchComfyHost({ ...options,
        preparePlugin: async ({ stateDirectory }) => { prepared.push(stateDirectory); return { TEST_SHARED: 'primary' }; },
        additionalPlugins: [{ pluginName: 'kikotools', repository: sibling.repository,
            preparePlugin: async ({ stateDirectory }) => { prepared.push(stateDirectory); return { TEST_SHARED: 'sibling' }; } }],
    }), /conflicting.*TEST_SHARED/i);
    assert.equal(prepared.length, 2);
    assert.equal(prepared[0], prepared[1]);
    await assert.rejects(access(prepared[0]), { code: 'ENOENT' });
    await assert.rejects(access(join(options.checkout, 'main.py.started')), { code: 'ENOENT' });
});

test('additional adapter failure releases every snapshot without changing either source pack', async t => {
    const options = await fixture(t, idle);
    const sibling = await fixture(t, idle);
    let state;
    await assert.rejects(launchComfyHost({ ...options, additionalPlugins: [{
        pluginName: 'kikotools', repository: sibling.repository,
        preparePlugin: async ({ installed, stateDirectory }) => {
            state = stateDirectory;
            await access(join(stateDirectory, 'custom_nodes/promptmanager/config.json'));
            await writeFile(join(installed, 'config.json'), 'temporary adapter state');
            throw new Error('additional adapter failed');
        },
    }] }), /additional adapter failed/);
    await assert.rejects(access(state), { code: 'ENOENT' });
    for (const repository of [options.repository, sibling.repository]) {
        assert.equal(await readFile(join(repository, 'config.json'), 'utf8'), 'private-user-config');
        assert.equal(await readFile(join(repository, 'prompts.db'), 'utf8'), 'private-user-database');
    }
});
