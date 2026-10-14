import fs from 'node:fs/promises';
import { readSecret } from './secret-input.mjs';

const report = { verifiedAt: new Date().toISOString(), baseUrl: 'https://hackathon.api.qloo.com', calls: [] };
try {
  const key = await readSecret();
  const request = async (path, params) => {
    const url = new URL(path, report.baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const start = Date.now();
    let res;
    try { res = await fetch(url, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { report.calls.push({ endpoint: path, parameters: params, status: null, elapsedMs: Date.now() - start, error: 'Network request failed or timed out.' }); return null; }
    let body;
    try { body = await res.json(); } catch { body = null; }
    const rows = [body?.results?.entities, body?.entities, body?.results, body?.data?.entities].find(Array.isArray);
    report.calls.push({ endpoint: path, parameters: params, status: res.status, elapsedMs: Date.now() - start, success: body?.success, topLevelKeys: Object.keys(body ?? {}), resultsKeys: body?.results && !Array.isArray(body.results) ? Object.keys(body.results) : null, entityCount: rows?.length ?? null, examples: rows?.slice(0, 3).map(r => ({ id: r.entity_id ?? r.id, name: r.name ?? r.properties?.name, types: r.types, propertiesKeys: Object.keys(r.properties ?? {}) })) ?? [], errors: !res.ok ? body?.error ?? body?.message ?? body?.errors : undefined });
    return res.ok ? rows : null;
  };
  const rows = await request('/search', { query: 'Arrival', types: 'urn:entity:movie', take: '3' });
  const seed = rows?.find(r => r.name?.toLowerCase() === 'arrival') ?? rows?.[0];
  if (seed) await request('/v2/insights', { 'filter.type': 'urn:entity:movie', 'signal.interests.entities': seed.entity_id ?? seed.id, take: '5' });
  const serialized = JSON.stringify(report, null, 2);
  if (serialized.includes(key)) throw new Error('Credential appeared in response metadata; output suppressed.');
  await fs.mkdir('verification', { recursive: true });
  await fs.writeFile('verification/qloo-probe.json', serialized + '\n');
  console.log(serialized);
  process.exitCode = report.calls.length === 2 && report.calls.every(c => c.status === 200 && c.entityCount > 0) ? 0 : 1;
} catch (error) {
  console.error(['QLOO_API_KEY is required.', 'Secret input is invalid.', 'Credential appeared in response metadata; output suppressed.'].includes(error.message) ? error.message : 'Live probe failed. No secret was printed.');
  process.exitCode = 1;
}
