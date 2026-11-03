import type { CyberEvent } from '../../types/index.ts';
export const MAX_RECORDS = 10000;
export const MAX_BYTES = 10 * 1024 * 1024;
export type FieldName = 'id' | 'title' | 'lat' | 'lng' | 'category' | 'timestamp' | 'location' | 'country' | 'intensity' | 'source' | 'description' | 'url';
export interface DataOptions { dataPath?: string; fields?: Partial<Record<FieldName, string>> }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function atPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((item, key) => isRecord(item) && Object.hasOwn(item, key) ? item[key] : undefined, value);
}
/** RFC4180-style comma CSV, including escaped quotes, quoted newlines, CRLF and UTF-8 BOM. */
export function parseCSV(input: string): Record<string, string>[] {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, afterQuote = false;
  const pushCell = () => { row.push(cell); cell = ''; afterQuote = false; };
  const pushRow = () => { pushCell(); if (row.some((value) => value.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; afterQuote = true; }
      else cell += c;
    } else if (c === ',') pushCell();
    else if (c === '\r' || c === '\n') { if (c === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"' && cell === '' && !afterQuote) quoted = true;
    else if (c === '"' || afterQuote) throw new Error('CSV 引号格式错误');
    else cell += c;
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号');
  if (cell !== '' || row.length || afterQuote) pushRow();
  if (!rows.length) return [];
  const headers = rows.shift()!.map((header) => header.trim());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) throw new Error('CSV 表头不能为空或重复');
  return rows.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`CSV 第 ${i + 2} 行列数与表头不一致`);
    return Object.fromEntries(headers.map((header, j) => [header, values[j]]));
  });
}
function numberValue(value: unknown, field: string, row: number): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error(`第 ${row} 条：${field} 必须是数字`);
  return Number(value);
}
export function normalizeRecords(input: unknown, options: DataOptions = {}): CyberEvent[] {
  const data = options.dataPath ? atPath(input, options.dataPath) : input;
  if (!Array.isArray(data)) throw new Error('数据必须是数组；嵌套 API 请设置数组路径，例如 data.items');
  if (data.length > MAX_RECORDS) throw new Error(`最多接入 ${MAX_RECORDS} 条记录，请先筛选数据`);
  const ids = new Set<string>();
  return data.map((item: unknown, index) => {
    const row = index + 1;
    if (!isRecord(item)) throw new Error(`第 ${row} 条必须是对象`);
    const get = (key: FieldName): unknown => atPath(item, options.fields?.[key] ?? key);
    const string = (key: FieldName): string => {
      const value = get(key);
      if (value === undefined || value === null) return '';
      if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`第 ${row} 条：${key} 必须是文本或数字`);
      return String(value).trim();
    };
    const title = string('title');
    if (!title) throw new Error(`第 ${row} 条：缺少 title`);
    const lat = numberValue(get('lat'), 'lat', row), lng = numberValue(get('lng'), 'lng', row);
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error(`第 ${row} 条：经纬度超出范围`);
    const recordId = string('id') || `row-${row}`;
    if (ids.has(recordId)) throw new Error(`第 ${row} 条：id 重复 (${recordId})`);
    ids.add(recordId);
    const time = get('timestamp');
    const hasTimestamp = time !== undefined && time !== null && time !== '';
    let timestamp = 0;
    if (hasTimestamp) {
      if (typeof time === 'number' || (typeof time === 'string' && /^-?\d+(\.\d+)?$/.test(time))) {
        const n = Number(time);
        timestamp = Math.abs(n) < 100000000000 ? n * 1000 : n;
      } else if (typeof time === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(time)) timestamp = Date.parse(time);
      else throw new Error(`第 ${row} 条：timestamp 需要带时区的 ISO 时间或 Unix 秒/毫秒`);
      if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) throw new Error(`第 ${row} 条：timestamp 无效`);
    }
    const intensityInput = get('intensity');
    const intensity = intensityInput === undefined || intensityInput === null || intensityInput === '' ? 0.5 : numberValue(intensityInput, 'intensity', row);
    if (intensity < 0 || intensity > 1) throw new Error(`第 ${row} 条：intensity 范围为 0–1`);
    const rawUrl = string('url');
    let url: string | undefined;
    if (rawUrl) {
      try { const parsed = new URL(rawUrl); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); url = parsed.href; }
      catch { throw new Error(`第 ${row} 条：url 需要 HTTP(S) 链接`); }
    }
    return { id: row, recordId, title, lat, lng, type: string('category') || '未分类', city: string('location'), country: string('country') || undefined,
      timestamp, hasTimestamp, intensity, source: string('source'), description: string('description'), url };
  });
}
export function parseData(text: string, format: 'json' | 'csv', options: DataOptions = {}): CyberEvent[] {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('数据不能超过 10 MiB');
  let raw: unknown;
  if (format === 'csv') raw = parseCSV(text);
  else { try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('JSON 格式无效'); } }
  return normalizeRecords(raw, options);
}
export function parseOptions(text: string): DataOptions {
  if (!text.trim()) return {};
  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new Error('字段映射必须是 JSON 对象'); }
  if (!isRecord(input) || (input.dataPath !== undefined && typeof input.dataPath !== 'string') || (input.fields !== undefined && (!isRecord(input.fields) || Object.values(input.fields).some((value) => typeof value !== 'string')))) throw new Error('映射格式：{"dataPath":"data.items","fields":{"lat":"latitude"}}');
  return input as DataOptions;
}
export async function fetchAPI(url: string, options: DataOptions, signal: AbortSignal, format: 'json' | 'csv' = 'json'): Promise<CyberEvent[]> {
  const target = new URL(url, window.location.href);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('API 仅支持不含账号密码的 HTTP(S) 地址');
  const timeout = AbortSignal.timeout(20000);
  const response = await fetch(target, { signal: AbortSignal.any([signal, timeout]), credentials: 'omit', headers: { Accept: format === 'csv' ? 'text/csv' : 'application/json' } });
  if (!response.ok) throw new Error(`API 返回 HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('API 响应不能超过 10 MiB');
  // Bound streamed bodies too, even when Content-Length is absent or compressed.
  const reader = response.body?.getReader();
  if (!reader) throw new Error('API 返回空响应');
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('API 响应不能超过 10 MiB'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  return parseData(text, format, options);
}
