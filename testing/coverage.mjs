import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
const metrics = ['lines', 'branches', 'functions', 'statements'];

export function discoverSources(root) {
    return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile() && /\.(?:js|mjs)$/.test(entry.name))
        .map(entry => relative(root, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
        .sort();
}

export function checkCoverage(summary, baseline, sourceRoot, files) {
    const failures = [];
    for (const file of files) {
        const floor = baseline[file];
        if (!floor) { failures.push(`Missing baseline for ${file}`); continue; }
        const measured = summary[join(sourceRoot, file)];
        if (!measured) { failures.push(`Missing coverage for ${file}`); continue; }
        for (const metric of metrics) {
            if (!Number.isFinite(floor[metric]) || floor[metric] < 0 || floor[metric] > 100) {
                throw new Error(`Invalid baseline for ${file}: ${metric}`);
            }
            if (!Number.isFinite(measured[metric]?.pct) || measured[metric].pct < floor[metric]) {
                failures.push(`${file} ${metric}: ${measured[metric]?.pct ?? 'missing'} < ${floor[metric]}`);
            }
        }
    }
    return failures;
}


export function mapBrowserCoverage(entries, { urlPrefix, sourceRoot }) {
    return entries.flatMap(entry => {
        let url;
        try { url = new URL(entry.url); } catch { return []; }
        if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.startsWith(urlPrefix)) return [];
        const path = url.pathname.slice(urlPrefix.length);
        if (!/^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:js|mjs)$/i.test(path)) return [];
        return [{ ...entry, url: pathToFileURL(join(sourceRoot, path)).href }];
    });
}
