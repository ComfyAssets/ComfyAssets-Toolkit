import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const raw = root + 'coverage/raw';
function run(args, env = {}) {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
    if (result.status !== 0) throw new Error(`Coverage command failed: ${args.join(' ')}`);
}
rmSync(root + 'coverage', { recursive: true, force: true });
mkdirSync(raw, { recursive: true });
run(['--test', ...readdirSync(root + 'tests').filter(file => file.endsWith('.test.mjs')).map(file => 'tests/' + file)], { NODE_V8_COVERAGE: raw });
run(['node_modules/@playwright/test/cli.js', 'test'], { TOOLKIT_COVERAGE: raw });
run(['node_modules/c8/bin/c8.js', 'report', '--all', '--include=testing/**/*.mjs', '--include=ui/**/*.js',
    '--temp-directory=' + raw, '--reporter=text', '--reporter=html', '--reporter=json-summary',
    '--check-coverage', '--per-file', '--lines=90', '--branches=80', '--functions=90']);
