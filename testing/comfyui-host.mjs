import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, copyFile, access, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
export async function launchComfyHost({ checkout, repository, pluginName, preparePlugin,
    python = 'python', port = 8189, pins, logPath, forwardOutput = true }) {
    if (!checkout) throw new Error('Provide a pinned ComfyUI checkout');
    if (!/^[a-z][a-z0-9_-]*$/i.test(pluginName || '')) throw new Error('Provide a safe custom-node directory name');
    if (!/^[a-f0-9]{40}$/.test(pins?.revision || '')) throw new Error('Provide a reviewed ComfyUI revision');
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use an unprivileged ComfyUI port');
    checkout = await realpath(checkout);
    repository = await realpath(repository);
    await access(join(checkout, 'main.py'));
    await access(join(repository, '__init__.py'));
    const git = args => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (git(['rev-parse', 'HEAD']) !== pins.revision) throw new Error(`ComfyUI revision must be ${pins.revision}`);
    try { git(['diff', '--quiet', 'HEAD', '--']); }
    catch { throw new Error('ComfyUI checkout has modified tracked files'); }
    const stateDirectory = await mkdtemp(join(tmpdir(), 'comfyassets-host-'));
    let log, child, pluginEnvironment;
    try {
        for (const directory of ['user', 'input', 'output', 'temp', 'custom_nodes']) await mkdir(join(stateDirectory, directory));
        const installed = join(stateDirectory, 'custom_nodes', pluginName);
        const files = execFileSync('git', ['-C', repository, 'ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
        for (const file of files) {
            const target = join(installed, file);
            await mkdir(dirname(target), { recursive: true });
            await copyFile(join(repository, file), target);
        }
        pluginEnvironment = await preparePlugin?.({ installed, stateDirectory });
        await mkdir(dirname(logPath), { recursive: true });
        const handle = await open(logPath, 'w');
        log = handle.createWriteStream();
        child = spawn(python, [join(checkout, 'main.py'), '--cpu', '--offline',
            '--listen', '127.0.0.1', '--port', String(port), '--base-directory', stateDirectory,
            '--user-directory', join(stateDirectory, 'user'), '--database-url', 'sqlite:///:memory:',
            '--disable-all-custom-nodes', '--whitelist-custom-nodes', pluginName], {
            cwd: checkout, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, ...pluginEnvironment, PYTHONUNBUFFERED: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
        });
    } catch (error) {
        log?.end();
        await rm(stateDirectory, { recursive: true, force: true });
        throw error;
    }
    let error, stopping = false;
    for (const [stream, output] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
        stream.on('data', chunk => { log.write(chunk); if (forwardOutput) output.write(chunk); });
    }
    child.on('error', value => { error = value; log.write(`ComfyUI failed to start: ${value.message}\n`); });
    const finished = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
        .then(async result => {
            const code = error ? 1 : result.code ?? (stopping ? 0 : 1);
            log.write(`ComfyUI stopped: exit=${code}, signal=${result.signal || 'none'}\n`);
            await new Promise(resolve => log.end(resolve));
            await rm(stateDirectory, { recursive: true, force: true });
            return { ...result, code, error };
        });
    return { child, stateDirectory, finished, async stop() {
        stopping = true;
        if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
        const deadline = setTimeout(() => child.kill('SIGKILL'), 5000);
        deadline.unref();
        try { return await finished; }
        finally { clearTimeout(deadline); }
    } };
}

