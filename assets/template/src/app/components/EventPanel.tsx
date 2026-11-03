import { useCallback, useEffect, useRef, useState } from 'react';
import { useGlobeStore } from '../store';
import { categoryHex } from '../utils/constants';
import { fetchAPI, MAX_BYTES, parseData, parseOptions } from '../utils/data';
import type { CyberEvent } from '../../types';
import { globeConfig } from '../../globe.config';
const dateLabel = (event: CyberEvent) => event.hasTimestamp ? new Date(event.timestamp).toLocaleString() : '未提供时间';

export default function EventPanel() {
  const { events, filters, timeline, setEvents, setFilters, setTimeline, setActiveEventId, setSelectedEventId } = useGlobeStore();
  const [apiUrl, setApiUrl] = useState('');
  const [format, setFormat] = useState<'json' | 'csv'>('json');
  const [mapping, setMapping] = useState('');
  const [interval, setIntervalValue] = useState(0);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('尚未载入数据');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState('—');
  const [sourceLabel, setSourceLabel] = useState('EMPTY');
  const [collapsed, setCollapsed] = useState(false);
  const [limit, setLimit] = useState(30);
  const request = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const categories = [...new Set(events.map((event) => event.type))];
  const times = events.filter((event) => event.hasTimestamp).map((event) => event.timestamp);
  const minTime = times.length ? Math.min(...times) : 0;
  const maxTime = times.length ? Math.max(...times) : 0;
  const cutoff = minTime + (maxTime - minTime) * timeline / 100;
  const visible = events.filter((event) => filters.types.includes(event.type) && (!event.hasTimestamp || timeline >= 100 || event.timestamp <= cutoff));
  const locations = new Set(visible.map((event) => `${event.lat.toFixed(4)},${event.lng.toFixed(4)}`)).size;
  const counts = new Map(categories.map((category) => [category, events.filter((event) => event.type === category).length]));
  const topLocations = [...visible.reduce((map, event) => {
    const label = event.city || event.country || `${event.lat.toFixed(2)}, ${event.lng.toFixed(2)}`;
    map.set(label, (map.get(label) ?? 0) + 1); return map;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const disconnect = () => { ++revision.current; request.current?.abort(); setConnected(false); setBusy(false); };
  const begin = () => { request.current?.abort(); const controller = new AbortController(); request.current = controller; const id = ++revision.current; setBusy(true); setError(''); return { controller, id }; };
  const accept = (data: CyberEvent[], label: string) => {
    setEvents(data); setStatus(data.length ? `已载入 ${data.length} 条记录` : '连接成功，返回空数据');
    setSourceLabel(label); setUpdated(new Date().toLocaleTimeString()); setLimit(30);
  };
  const failure = (reason: unknown) => {
    setError(reason instanceof Error ? reason.message : '读取失败');
    setStatus('读取失败；保留上次成功数据');
  };
  const loadAPI = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const id = ++revision.current; setBusy(true); setError('');
    try {
      const data = await fetchAPI(apiUrl, parseOptions(mapping), controller.signal, format);
      if (id !== revision.current) return;
      setEvents(data); setStatus(`API 成功返回 ${data.length} 条记录`); setSourceLabel('API');
      setUpdated(new Date().toLocaleTimeString()); setConnected(true); setLimit(30);
    } catch (reason) {
      if (id !== revision.current || controller.signal.aborted) return;
      failure(reason); setConnected(false);
    } finally { if (id === revision.current) setBusy(false); }
  }, [apiUrl, mapping, format, setEvents]);
  useEffect(() => {
    if (interval === 0 || !connected) return;
    const timer = window.setInterval(() => { void loadAPI(); }, interval * 1000);
    return () => window.clearInterval(timer);
  }, [connected, interval, loadAPI]);
  useEffect(() => () => { ++revision.current; request.current?.abort(); }, []);
  const importFile = async (file?: File) => {
    if (!file) return;
    setConnected(false); const { id } = begin();
    try {
      if (!/\.(json|csv)$/i.test(file.name)) throw new Error('请选择 .json 或 .csv 文件');
      if (file.size > MAX_BYTES) throw new Error('文件不能超过 10 MiB');
      const data = parseData(await file.text(), file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json', parseOptions(mapping));
      if (id === revision.current) { setTimeline(100); accept(data, file.name); }
    } catch (reason) { if (id === revision.current) failure(reason); }
    finally { if (id === revision.current) setBusy(false); }
  };
  const clear = () => {
    ++revision.current; request.current?.abort(); setConnected(false); setBusy(false); setEvents([]); setTimeline(100);
    setStatus('尚未载入数据'); setError(''); setSourceLabel('EMPTY'); setUpdated('—');
  };
  if (collapsed) return <button className="collapsed-chip" onClick={() => setCollapsed(false)}>显示面板</button>;
  return <div className="intel-overlay" data-ui-overlay="true">
    <header className="intel-header">
      <div className="brand-lockup"><div className="brand-orb"><div className="brand-orb-core"/><div className="brand-orb-ring"/></div><div className="brand-copy"><div className="brand-title">{globeConfig.title}</div><div className="brand-subtitle">{globeConfig.subtitle}</div></div></div>
      <div className="intel-feed-bar">{categories.length ? categories.map((category) => <div className="intel-feed-chip" key={category}><span className="intel-feed-dot" style={{background: categoryHex(category)}}/><span className="intel-feed-label">{category}</span><span className="intel-feed-count">{String(counts.get(category)).padStart(2, '0')}</span></div>) : <span className="intel-feed-label">YOUR DATA · YOUR WORLD</span>}</div>
      <button className="subtle-button" onClick={() => setCollapsed(true)}>隐藏面板</button>
    </header>
    <section className="intel-panel intel-panel-left">
      <div className="panel-header-block"><div className="panel-title">DATA CONNECTION</div><div className="panel-kicker">JSON · CSV · HTTP API</div></div>
      <div className="dashboard-layout">
        <div className="metric-grid"><div className="metric-card"><div className="metric-label">记录总数</div><div className="metric-value">{events.length}</div></div><div className="metric-card"><div className="metric-label">当前地点</div><div className="metric-value is-green">{locations}</div></div></div>
        <div className="meta-row"><span>最近成功载入</span><span>{updated}</span></div>
        <div className="panel-divider"/>
        <label className="upload-button">导入 JSON / CSV<input type="file" accept=".json,.csv,application/json,text/csv" aria-label="导入 JSON 或 CSV" onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ''; }}/></label>
        <div className="data-help">必填字段：title、lat、lng。分类和时间可选。</div>
        <details><summary>字段映射 / 数组路径</summary><label className="field-label" htmlFor="mapping">映射配置（JSON）</label><textarea id="mapping" value={mapping} onChange={(event) => { disconnect(); setMapping(event.target.value); }} placeholder={'{"dataPath":"data.items","fields":{"lat":"latitude","lng":"longitude"}}'} rows={4}/></details>
        <form onSubmit={(event) => { event.preventDefault(); void loadAPI(); }}>
          <label className="field-label" htmlFor="api-url">HTTP API 地址</label><input id="api-url" type="text" value={apiUrl} onChange={(event) => { disconnect(); setApiUrl(event.target.value); }} placeholder="https://example.com/locations" required/>
          <div className="form-row"><label>响应格式<select aria-label="API 响应格式" value={format} onChange={(event) => { disconnect(); setFormat(event.target.value as 'json' | 'csv'); }}><option value="json">JSON</option><option value="csv">CSV</option></select></label><label>刷新<select aria-label="刷新频率" value={interval} onChange={(event) => setIntervalValue(Number(event.target.value))}><option value={0}>手动</option><option value={30}>30 秒</option><option value={60}>60 秒</option><option value={300}>5 分钟</option></select></label></div>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? '读取中…' : '连接 / 刷新 API'}</button>
        </form>
        <div className="data-status" role="status">{busy ? '读取中…' : status}{connected && interval > 0 ? ` · 每 ${interval} 秒刷新` : ''}</div>
        {error && <div className="data-error" role="alert">{error}<br/>跨域 API 需要允许 CORS；含密钥的 API 请通过服务端代理接入。</div>}
        <div className="form-row"><button className="subtle-button" onClick={clear}>清空数据</button><a href="/examples/locations.json" download>JSON 示例</a><a href="/examples/locations.csv" download>CSV 示例</a></div>
        <div className="data-help">默认不连接任何信息源。示例为虚构地点记录，需手动导入。</div>
        <div className="panel-divider"/>
        <div className="section-title">TOP LOCATIONS</div><div className="stack-list compact">{topLocations.map(([label, count], i) => <div className="trend-row" key={label}><span className="trend-rank">0{i + 1}</span><span className="trend-label">{label}</span><span className="trend-count">{count}</span></div>)}</div>
      </div>
    </section>
    <section className="intel-panel intel-panel-right">
      <div className="panel-header-block live"><div><div className="panel-title">DATA EXPLORER</div><div className="live-subtitle"><span>{visible.length} RECORDS</span><span className="live-dot"/><span>{locations} LOCATIONS</span></div></div></div>
      <div className="filter-grid"><button className={`filter-pill ${filters.types.length === categories.length ? 'is-active' : ''}`} onClick={() => setFilters({types: [...categories]})}>全部</button>{categories.map((category) => <button key={category} className={`filter-pill ${filters.types.includes(category) ? 'is-active' : ''}`} style={{color: categoryHex(category)}} onClick={() => setFilters({types: filters.types.includes(category) ? filters.types.filter((type) => type !== category) : [...filters.types, category]})}>{category}</button>)}</div>
      <div className="events-list">{!visible.length ? <div className="events-empty">{events.length ? '当前筛选下没有记录' : '地球已就绪。导入文件或连接 API，开始探索。'}</div> : visible.slice(0, limit).map((event) => <button key={event.id} className="event-card" onMouseEnter={() => setActiveEventId(event.id)} onMouseLeave={() => setActiveEventId(null)} onFocus={() => setActiveEventId(event.id)} onBlur={() => setActiveEventId(null)} onClick={() => setSelectedEventId(event.id)}><span className="event-card-accent" style={{background: categoryHex(event.type)}}/><div className="event-card-topline"><span className="event-tag" style={{color: categoryHex(event.type)}}>{event.type}</span><span className="event-time">{dateLabel(event)}</span></div><div className="event-card-title">{event.title}</div><div className="event-card-meta"><span className="event-location">◉ {event.city || event.country || `${event.lat.toFixed(2)}, ${event.lng.toFixed(2)}`}</span><span className="event-source">{event.source}</span></div></button>)}{visible.length > limit && <button className="subtle-button" onClick={() => setLimit(limit + 30)}>显示更多（{visible.length - limit}）</button>}</div>
      <div className="data-help">地球最多绘制 180 条记录；可用分类和时间缩小范围。</div>
    </section>
    <div className="timeline-dock"><div className="timeline-label-row"><span className="timeline-caption">TIMELINE</span><span className="timeline-now-pill">{times.length ? (timeline === 100 ? '全部时间' : new Date(cutoff).toLocaleDateString()) : '无时间字段'}</span></div><input aria-label="时间范围" type="range" min="0" max="100" value={timeline} disabled={minTime === maxTime} onChange={(event) => setTimeline(Number(event.target.value))} className="timeline-slider"/><div className="timeline-scale"><span>最早</span><span>最晚 · 无日期记录始终显示</span></div></div>
    <div className="status-footer-left"><span className="status-chip"><span className="status-chip-dot" style={{background: error ? '#ff567d' : events.length ? '#55ff9f' : '#72c9ff'}}/>{error ? 'ERROR' : sourceLabel}</span></div>
    <div className="status-footer-right">{visible.length} / {events.length} RECORDS</div>
  </div>;
}

export function EventDetailModal() {
  const { events, selectedEventId, setSelectedEventId } = useGlobeStore();
  const closeRef = useRef<HTMLButtonElement>(null);
  const event = events.find((item) => item.id === selectedEventId);
  useEffect(() => {
    if (selectedEventId === null) return;
    const previous = document.activeElement;
    closeRef.current?.focus();
    const handler = (key: KeyboardEvent) => {
      if (key.key === 'Escape') setSelectedEventId(null);
      if (key.key === 'Tab') {
        const nodes = Array.from(document.querySelectorAll<HTMLElement>('.event-modal button, .event-modal a'));
        const current = nodes.indexOf(document.activeElement as HTMLElement);
        key.preventDefault(); nodes[(current + (key.shiftKey ? -1 : 1) + nodes.length) % nodes.length]?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); if (previous instanceof HTMLElement) previous.focus(); };
  }, [selectedEventId, setSelectedEventId]);
  if (!event) return null;
  return <div className="event-modal-backdrop" onClick={() => setSelectedEventId(null)}><div className="event-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={(e) => e.stopPropagation()}><button ref={closeRef} aria-label="关闭详情" className="event-modal-close" onClick={() => setSelectedEventId(null)}>✕</button><div className="event-modal-type" style={{color: categoryHex(event.type)}}>{event.type}</div><div className="event-modal-title" id="detail-title">{event.title}</div><div className="event-modal-description">{event.description || '未提供描述'}</div><div className="event-modal-meta">{event.city} {event.country} · {event.lat}, {event.lng}<br/>{dateLabel(event)}{event.source && <><br/>来源：{event.source}</>}</div><div className="event-modal-intensity"><div className="event-modal-intensity-label"><span>显示权重</span><span>{Math.round(event.intensity * 100)}%</span></div><div className="event-modal-intensity-bar"><div className="event-modal-intensity-fill" style={{width: `${event.intensity * 100}%`, background: categoryHex(event.type)}}/></div></div>{event.url && <a className="primary-button" href={event.url} target="_blank" rel="noopener noreferrer">打开关联链接 ↗</a>}</div></div>;
}
