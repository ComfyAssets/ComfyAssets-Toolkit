import test from 'node:test';
import assert from 'node:assert/strict';

// Register the same transport contract against a consumer's actual pinned module.
export function registerPromptBridgeContracts(bridge, loadIndependent) {
    const { createBridgeHost, createBridgeClient, validateRoles } = bridge;
    function bus() {
        const channels = new Set();
        const factory = name => {
            const listeners = new Map();
            const channel = { name, closed: false, addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type) { listeners.delete(type); }, close() { this.closed = true; channels.delete(this); }, postMessage(data) { for (const peer of channels) if (peer !== this && peer.name === name) queueMicrotask(() => peer.receive(structuredClone(data))); }, receive(data, origin = 'https://example.test') { listeners.get('message')?.({ data, origin }); }, fail() { listeners.get('messageerror')?.({}); } };
            channels.add(channel); return channel;
        };
        return { factory, channels };
    }
    function setup(options = {}) {
        const network = bus(); let applied = 0;
        const common = { namespace: '/comfy/', origin: 'https://example.test:443/path', channelFactory: network.factory, timeoutMs: 30 };
        const adapter = { listTargets: () => [{ id: 'one', label: 'Node' }], preview: (target, roles) => ({ preview: { target, roles }, snapshot: { secret: true, roles } }), apply: snapshot => { applied++; return { applied: snapshot.roles }; } };
        const host = createBridgeHost({ ...common, adapter, hostId: 'host', label: 'Test', ...options });
        const client = createBridgeClient({ ...common, clientId: 'client' });
        return { ...network, common, host, client, get applied() { return applied; }, dispose() { host.dispose(); client.dispose(); } };
    }
    test('validates strict bounded own prompt roles', () => {
        assert.deepEqual(validateRoles({ positive: '', negative: 'bad' }), { positive: '', negative: 'bad' });
        for (const value of [null, {}, [], { positive: null }, { extra: '' }, Object.create({ positive: 'x' }), { positive: 'x'.repeat(1048577) }]) assert.throws(() => validateRoles(value));
        assert.throws(() => validateRoles(Object.defineProperty({}, 'positive', { get: assert.fail })));
    });
    test('independent consumers discover, preview private snapshot and acknowledge once', async () => {
        const s = setup(); try {
            assert.deepEqual(await s.client.discover({ waitMs: 5 }), [{ hostId: 'host', label: 'Test', targets: [{ id: 'one', label: 'Node' }] }]);
            const preview = await s.client.preview('host', 'one', { positive: 'hello' });
            assert.equal(preview.secret, undefined); assert.equal(preview.target, 'one');
            assert.deepEqual(await s.client.apply('host', preview.ticket), { applied: { positive: 'hello' } });
            await assert.rejects(s.client.apply('host', preview.ticket)); assert.equal(s.applied, 1);
        } finally { s.dispose(); } assert.equal(s.channels.size, 0);
    });
    test('namespace, origin, protocol and destination isolation', async () => {
        const s = setup(); const other = createBridgeClient({ ...s.common, namespace: '/other' });
        try { assert.deepEqual(await other.discover({ waitMs: 3 }), []); const pending = s.client.preview('missing', 'one', { positive: 'x' });
            for (const channel of s.channels) channel.receive({ version: 999, kind: 'response', to: 'client', result: {} });
            await assert.rejects(pending, /timed out/i);
        } finally { other.dispose(); s.dispose(); }
    });
    test('tickets are bound to clients, expiring and bounded', async () => {
        const s = setup({ previewTtlMs: 5, maxTickets: 1 }); const other = createBridgeClient({ ...s.common, clientId: 'other' });
        try {
            const first = await s.client.preview('host', 'one', { negative: '' });
            await assert.rejects(other.apply('host', first.ticket));
            const second = await s.client.preview('host', 'one', { positive: '2' });
            await assert.rejects(s.client.apply('host', first.ticket));
            await new Promise(resolve => setTimeout(resolve, 10)); await assert.rejects(s.client.apply('host', second.ticket));
            assert.equal(s.applied, 0);
        } finally { other.dispose(); s.dispose(); }
    });
    test('abort, disposal and transport failures release pending work', async () => {
        const s = setup(); const controller = new AbortController();
        const pending = s.client.preview('missing', 'one', { positive: '' }, { signal: controller.signal }); controller.abort(); await assert.rejects(pending, /abort/i);
        const pending2 = s.client.preview('missing', 'one', { positive: '' }); s.client.dispose(); await assert.rejects(pending2, /disposed/i);
        await assert.rejects(s.client.discover(), /disposed/i); s.host.dispose(); assert.equal(s.channels.size, 0);
        const broken = setup(); const pending3 = broken.client.preview('missing', 'one', { positive: '' });
        [...broken.channels].at(-1).fail(); await assert.rejects(pending3, /transport/i); broken.dispose();
    });
    test('invalid origins, unsupported channel and malformed adapters fail safely', async () => {
        for (const origin of ['null', 'data:text/plain,x', 'ftp://example.test']) assert.throws(() => createBridgeClient({ namespace: 'x', origin }));
        assert.throws(() => createBridgeClient({ namespace: '', origin: 'https://example.test' }));
        const s = setup({ adapter: { listTargets: () => { throw Error('no targets'); }, preview: () => { throw Error('not available'); }, apply: assert.fail } });
        try { assert.deepEqual(await s.client.discover({ waitMs: 3 }), []); await assert.rejects(s.client.preview('host', 'one', { positive: '' }), /not available/); } finally { s.dispose(); }
    });
    test('duplicate apply is replayed once and conflicting request IDs are ignored', async () => {
        const s = setup(); const spy = s.factory([...s.channels][0].name); const seen = [];
        spy.addEventListener('message', event => seen.push(event.data));
        try {
            const preview = await s.client.preview('host', 'one', { positive: 'x' });
            await s.client.apply('host', preview.ticket);
            const apply = seen.find(message => message.kind === 'request' && message.op === 'apply');
            const hostChannel = [...s.channels][0]; hostChannel.receive(apply); hostChannel.receive({ ...apply, ticket: 'other' });
            await new Promise(resolve => setTimeout(resolve, 0));
            assert.equal(s.applied, 1); assert.equal(seen.filter(message => message.kind === 'response' && message.op === 'apply').length, 2);
        } finally { spy.close(); s.dispose(); }
    });
    test('ignores forged envelopes and responses until genuine acknowledgement', async () => {
        const s = setup(); const spy = s.factory([...s.channels][0].name); const seen = [];
        spy.addEventListener('message', event => seen.push(event.data));
        try {
            const promise = s.client.preview('missing', 'one', { positive: 'x' });
            await new Promise(resolve => setTimeout(resolve, 0));
            const request = seen.find(message => message.kind === 'request'); const channel = [...s.channels][1];
            const valid = { ...request, kind: 'response', result: { ticket: 'ok' } };
            for (const patch of [{ version: 2 }, { namespace: '/other' }, { origin: 'https://evil.test' }, { clientId: 'other' }, { requestId: 'other' }, { hostId: 'other' }, { op: 'apply' }, { kind: 'request' }]) channel.receive({ ...valid, ...patch });
            channel.receive(valid, 'https://example.test.evil.test'); channel.receive(null); channel.receive(valid);
            assert.deepEqual(await promise, { ticket: 'ok' });
        } finally { spy.close(); s.dispose(); }
    });
    test('host rejects invalid target, roles, ticket and preview shape', async () => {
        const s = setup(); const spy = s.factory([...s.channels][0].name); const replies = [];
        spy.addEventListener('message', event => { if (event.data.kind === 'response') replies.push(event.data); });
        const base = { version: 1, origin: 'https://example.test', namespace: '/comfy/', kind: 'request', clientId: 'raw', hostId: 'host' };
        try {
            for (const [index, payload] of [{ op: 'preview', targetId: '' }, { op: 'preview', targetId: 'one', roles: {} }, { op: 'apply', ticket: 3 }].entries()) spy.postMessage({ ...base, requestId: String(index), ...payload });
            await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(replies.length, 3); assert.ok(replies.every(message => typeof message.error === 'string'));
        } finally { spy.close(); s.dispose(); }
        const malformed = setup({ adapter: { listTargets: () => [], preview: () => Promise.resolve({}), apply: assert.fail } });
        try { assert.equal((await malformed.client.discover({ waitMs: 3 })).length, 1); await assert.rejects(malformed.client.preview('host', 'one', { positive: '' }), /Invalid preview/); } finally { malformed.dispose(); }
    });
    test('client validates destinations and closes on send errors; pre-aborted requests send nothing', async () => {
        const s = setup(); const aborted = AbortSignal.abort();
        try {
            await assert.rejects(s.client.discover({ signal: aborted }), /aborted/);
            await assert.rejects(s.client.preview('', 'one', { positive: '' }), /destination/);
            await assert.rejects(s.client.preview('host', 'one', {}), /role/);
            await assert.rejects(s.client.apply('', 'ticket'), /destination/);
            [...s.channels][1].postMessage = () => { throw Error('send failed'); };
            await assert.rejects(s.client.discover(), /send failed/); assert.equal(s.channels.size, 1);
        } finally { s.dispose(); }
    });
    test('default BroadcastChannel path, invalid IDs and unsupported browser are explicit', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel'); const network = bus();
        try {
            globalThis.BroadcastChannel = class { constructor(name) { return network.factory(name); } };
            const client = createBridgeClient({ namespace: 'x', origin: 'https://example.test' }); client.dispose();
            globalThis.BroadcastChannel = undefined;
            assert.throws(() => createBridgeClient({ namespace: 'x', origin: 'https://example.test' }), /unavailable/);
            assert.throws(() => createBridgeClient({ namespace: 'x', origin: 'https://example.test', clientId: '' }), /client ID/);
            assert.throws(() => createBridgeHost({ namespace: 'x', origin: 'https://example.test', adapter: {} }), /adapter/);
        } finally { Object.defineProperty(globalThis, 'BroadcastChannel', descriptor); }
    });
    test('feature detected Origin API rejects opaque and handles strict normalized origins', async () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Origin');
        globalThis.Origin = { from(value) { const url = new URL(value); return { opaque: url.origin === 'null', isSameOrigin: other => url.origin === other.origin, origin: url.origin }; } };
        const s = setup();
        try { assert.equal((await s.client.discover({ waitMs: 3 })).length, 1); [...s.channels][0].receive({}, 'data:text/plain,x'); }
        finally { s.dispose(); if (descriptor) Object.defineProperty(globalThis, 'Origin', descriptor); else delete globalThis.Origin; }
    });
    test('HTTP LAN contexts without randomUUID still get distinct consumer identities', () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: descriptor.get.call(globalThis).getRandomValues.bind(descriptor.get.call(globalThis)) } });
        const network = bus(); const options = { namespace: 'lan', origin: 'http://192.168.1.10:8188', channelFactory: network.factory };
        try {
            const first = createBridgeClient(options); const second = createBridgeClient(options);
            assert.notEqual(first.clientId, second.clientId); first.dispose(); second.dispose();
        } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
    });
    test('independent bundle instances interoperate while other protocol majors cannot mutate', async () => {
        const bundle = await loadIndependent();
        const s = setup(); const second = bundle.createBridgeHost({ ...s.common, hostId: 'host2', label: 'Second workflow', adapter: { listTargets: () => [], preview: () => ({ preview: {}, snapshot: {} }), apply: () => ({ ok: true }) } });
        const client = bundle.createBridgeClient({ ...s.common, clientId: 'independent' });
        const foreign = s.factory([...s.channels][0].name); const replies = [];
        foreign.addEventListener('message', event => { if (event.data.clientId === 'future') replies.push(event.data); });
        try {
            assert.deepEqual((await client.discover({ waitMs: 5 })).map(value => value.hostId).sort(), ['host', 'host2']);
            const secondPreview = await client.preview('host2', 'other', { positive: 'second destination' });
            assert.deepEqual(await client.apply('host2', secondPreview.ticket), { ok: true });
            const preview = await client.preview('host', 'one', { negative: 'blur' });
            assert.deepEqual(await client.apply('host', preview.ticket), { applied: { negative: 'blur' } });
            foreign.postMessage({ version: 2, origin: 'https://example.test', namespace: '/comfy/', kind: 'request', op: 'apply', hostId: 'host', clientId: 'future', requestId: 'future', ticket: preview.ticket });
            await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(s.applied, 1); assert.deepEqual(replies, []);
        } finally { foreign.close(); client.dispose(); second.dispose(); s.dispose(); }
    });
    test('host transport failure discards snapshots and closes, and replay cache is bounded', async () => {
        const s = setup({ maxReplay: 1 }); const preview = await s.client.preview('host', 'one', { positive: 'x' });
        await s.client.apply('host', preview.ticket);
        await s.client.discover({ waitMs: 3 });
        [...s.channels][0].fail(); assert.equal(s.host.disposed, true); assert.equal(s.channels.size, 1);
        await assert.rejects(s.client.apply('host', preview.ticket), /timed out/); s.dispose();
    });
    test('malformed successful preview replies cannot be mistaken for a usable ticket', async () => {
        const s = setup(); const spy = s.factory([...s.channels][0].name); let request;
        spy.addEventListener('message', event => { request = event.data; });
        try {
            const pending = s.client.preview('missing', 'one', { positive: 'x' });
            await new Promise(resolve => setTimeout(resolve, 0));
            [...s.channels][1].receive({ ...request, kind: 'response', result: {} });
            await assert.rejects(pending, /timed out/);
        } finally { spy.close(); s.dispose(); }
    });
}
