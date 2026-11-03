import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { normalizeRecords, parseCSV, parseData, parseOptions, fetchAPI, MAX_BYTES } from '../src/app/utils/data.ts';
const record = { id: 'x', title: 'Synthetic point', lat: 0, lng: 0 };
test('JSON preserves equator/prime-meridian coordinates and optional date is absent', () => {
  const [item] = parseData(JSON.stringify([record]), 'json');
  assert.equal(item.lat, 0); assert.equal(item.lng, 0); assert.equal(item.hasTimestamp, false);
  assert.equal(item.recordId, 'x'); assert.equal(item.type, '未分类');
  assert.deepEqual(parseData('[]', 'json'), []);
});
test('CSV parses BOM, CRLF, quotes, commas, multiline fields and numeric coordinates', () => {
  const csv = '\uFEFFtitle,lat,lng,description\r\n"Demo, one",31.2,121.4,"line 1\r\nline ""2"""\r\n';
  assert.equal(parseCSV(csv)[0].description, 'line 1\r\nline "2"');
  assert.equal(parseData(csv, 'csv')[0].title, 'Demo, one');
  assert.throws(() => parseCSV('title,title\na,b'), /重复/);
  assert.throws(() => parseCSV('a,b\n"unfinished,1'), /引号/);
  assert.throws(() => parseCSV('a,b\n1,2,3'), /列数/);
});
test('nested API envelopes and field mappings normalize identically', () => {
  const options = parseOptions('{"dataPath":"data.points","fields":{"lat":"geo.latitude","lng":"geo.longitude","title":"name","category":"kind"}}');
  const [item] = normalizeRecords({data: {points: [{name: 'A', geo: {latitude: 34, longitude: 139}, kind: '自定义分类'}]}}, options);
  assert.equal(item.type, '自定义分类'); assert.equal(item.lat, 34);
  assert.throws(() => parseOptions('{"fields":{"lat":3}}'), /映射格式/);
});
test('validation rejects bad geometry, titles, duplicate IDs and misleading time', () => {
  for (const change of [{lat: 91}, {lng: -181}, {lat: ''}, {lat: null}, {title: ''}, {intensity: 2}, {timestamp: 'yesterday'}, {timestamp: '2026-11-03T12:00:00'}, {url: 'javascript:alert(1)'}]) assert.throws(() => normalizeRecords([{...record, ...change}]));
  assert.throws(() => normalizeRecords([record, record]), /重复/);
  assert.throws(() => normalizeRecords({data: []}), /数组/);
  assert.throws(() => normalizeRecords(Array(10001).fill(record)), /最多/);
  const unix = 1793707200;
  assert.equal(normalizeRecords([{...record, timestamp: unix}])[0].timestamp, unix * 1000);
  assert.equal(normalizeRecords([{...record, timestamp: unix * 1000}])[0].timestamp, unix * 1000);
  assert.equal(normalizeRecords([{...record, timestamp: '2026-11-03T12:00:00Z'}])[0].hasTimestamp, true);
});
test('HTTP API: JSON, CSV, HTTP error, invalid data, cancel and bounded stream', async () => {
  // The browser resolves relative URLs; an absolute fixture URL exercises the actual fetch loader.
  Object.defineProperty(globalThis, 'window', { value: { location: { href: 'http://127.0.0.1/' } }, configurable: true });
  const server = createServer((req, res) => {
    if (req.url === '/bad') { res.writeHead(503); res.end(); }
    else if (req.url === '/invalid') res.end('{"not":"array"}');
    else if (req.url === '/large') { res.writeHead(200); res.end(' '.repeat(MAX_BYTES + 1)); }
    else if (req.url === '/csv') res.end('title,lat,lng\nCSV point,1,2');
    else res.end(JSON.stringify([record]));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const signal = new AbortController().signal;
  try {
    assert.equal((await fetchAPI(url, {}, signal))[0].title, record.title);
    assert.equal((await fetchAPI(`${url}/csv`, {}, signal, 'csv'))[0].title, 'CSV point');
    await assert.rejects(fetchAPI(`${url}/bad`, {}, signal), /503/);
    await assert.rejects(fetchAPI(`${url}/invalid`, {}, signal), /数组/);
    await assert.rejects(fetchAPI(`${url}/large`, {}, signal), /10 MiB/);
    const canceled = new AbortController(); canceled.abort();
    await assert.rejects(fetchAPI(url, {}, canceled.signal));
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
