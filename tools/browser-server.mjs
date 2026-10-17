import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {
        response.setHeader('content-type', 'text/html');
        return response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>ComfyAssets controls</title></head><body><button id="unrelated">Outside toolkit</button><main class="ca-tools" id="controls"></main></body></html>');
    }
    if (!/^\/ui\/[a-z-]+\.(js|css)$/.test(path)) { response.writeHead(404); return response.end(); }
    try {
        response.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : 'text/css');
        response.end(await readFile(root + path));
    } catch { response.writeHead(404); response.end(); }
});
server.listen(Number(process.env.TOOLKIT_TEST_PORT || 8772), '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close());
