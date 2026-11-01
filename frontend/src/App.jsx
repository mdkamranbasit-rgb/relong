import { useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertCircle, ArrowDownRight, ArrowUpRight, BarChart3, CalendarDays,
  CheckCircle2, ChevronDown, Clock3, Cloud, Database, Download, Gauge,
  RefreshCw, Search, Settings2, Wind, Zap,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'

const API = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api` : '/api'
const DEFAULT_DATE = '2026-01-15'
const fmt = (v, digits = 0) => v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits })
const fmtDate = (v) => new Date(`${v}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

function MetricCard({ label, value, unit, note, icon: Icon, tone = 'blue' }) {
  return <div className="metric-card">
    <div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}><Icon size={17} /></span></div>
    <div className="metric-value">{value}<small>{unit}</small></div>
    <div className="metric-note">{note}</div>
  </div>
}

function EmptyState({ onRefresh, loading, status }) {
  return <div className="empty-state">
    <div className="empty-icon"><Database size={26} /></div>
    <h2>January dataset not loaded yet</h2>
    <p>Connect to Elexon BMRS to retrieve January 2026 wind actuals and forecast publication history. This can take a few minutes on the first run.</p>
    <button className="primary-btn" onClick={onRefresh} disabled={loading || status?.state === 'running' || status?.state === 'queued'}>
      <RefreshCw size={16} className={loading || status?.state === 'running' ? 'spin' : ''} />
      {loading || status?.state === 'running' || status?.state === 'queued' ? 'Syncing Elexon data…' : 'Sync January 2026 data'}
    </button>
    {status?.message && status.state !== 'idle' && <div className={`sync-status ${status.state}`}>{status.message}</div>}
    <span className="empty-footnote">Public API · No API key required · Source: Elexon BMRS</span>
  </div>
}

export default function App() {
  const [tab, setTab] = useState('overview')
  const [overview, setOverview] = useState(null)
  const [series, setSeries] = useState(null)
  const [selectedDate, setSelectedDate] = useState(DEFAULT_DATE)
  const [status, setStatus] = useState({ state: 'idle', message: 'Ready' })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const refreshOverview = async () => {
    try {
      const r = await fetch(`${API}/overview`)
      if (!r.ok) throw new Error('Could not load overview')
      const data = await r.json()
      setOverview(data)
    } catch (e) { setError(e.message) }
  }
  const refreshSeries = async (date) => {
    try {
      const r = await fetch(`${API}/series?date=${date}`)
      if (!r.ok) { setSeries(null); return }
      setSeries(await r.json())
    } catch { setSeries(null) }
  }
  const refreshStatus = async () => {
    try { const r = await fetch(`${API}/status`); if (r.ok) setStatus(await r.json()) } catch { /* API may still be starting */ }
  }

  useEffect(() => {
    let mounted = true
    const init = async () => {
      await Promise.all([refreshOverview(), refreshStatus()])
      if (mounted) setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (overview?.hasData) refreshSeries(selectedDate)
  }, [overview, selectedDate])


  
const startRefresh = async () => {
  if (refreshing || status.state === 'running' || status.state === 'queued') {
    return
  }

  setRefreshing(true)
  setError('')

  try {
    const response = await fetch(`${API}/refresh`, {
      method: 'POST'
    })

    if (!response.ok) {
      throw new Error('Could not start data refresh')
    }

    const result = await response.json()
    setStatus(result)

  } catch (error) {
    setRefreshing(false)
    setError(`${error.message}. Is the Python API running on port 8000?`)
  }
}


  const metrics = overview?.metrics || {}
  const hasData = overview?.hasData
  const selectedMetrics = series?.metrics || {}
  const dailyChart = useMemo(() => (overview?.daily || []).map(d => ({ ...d, dateLabel: new Date(`${d.date}T12:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) })), [overview])
  const csvDownload = () => {
    if (!series?.rows?.length) return
    const header = ['time','forecastMW','actualMW','errorMW','publishTime']
    const rows = series.rows.map(r => header.map(h => r[h] ?? '').join(','))
    const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `windcast-${selectedDate}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Wind size={21} /></div><div><strong>windcast</strong><span>ENERGY INTELLIGENCE</span></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="nav-menu">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><Activity size={17} />Overview</button>
        <button className={tab === 'accuracy' ? 'active' : ''} onClick={() => setTab('accuracy')}><Gauge size={17} />Forecast accuracy</button>
        <button className={tab === 'explorer' ? 'active' : ''} onClick={() => setTab('explorer')}><BarChart3 size={17} />Forecast explorer</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="source-card"><div className="source-card-top"><span className="live-dot" /> DATA SOURCE</div><strong>Elexon BMRS</strong><span>FUELHH · WINDFOR</span><a href="https://bmrs.elexon.co.uk/api-documentation" target="_blank" rel="noreferrer">API documentation ↗</a></div>
        <div className="user-row"><div className="avatar">WC</div><div><strong>WindCast Pilot</strong><span>UK National · GB</span></div><Settings2 size={16} className="user-settings" /></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="breadcrumb">Energy analytics <span>/</span> <strong>{tab === 'overview' ? 'Overview' : tab === 'accuracy' ? 'Forecast accuracy' : 'Forecast explorer'}</strong></div>
        <div className="topbar-right"><span className="period-pill"><CalendarDays size={14} /> January 2026</span><span className="status-pill"><span className="live-dot" /> Historical analysis</span></div>
      </header>

      <div className="page-wrap">
        <div className="page-heading">
          <div><div className="eyebrow">UK WIND GENERATION · DAY-AHEAD INTELLIGENCE</div><h1>{tab === 'overview' ? 'Forecast overview' : tab === 'accuracy' ? 'Forecast accuracy' : 'Forecast explorer'}</h1><p>{tab === 'overview' ? 'Understand the wind generation outlook and how well day-ahead forecasts performed.' : tab === 'accuracy' ? 'Quantify forecast error across the January 2026 delivery period.' : 'Inspect hourly forecast vintages alongside metered generation actuals.'}</p></div>
          {/* <button className="secondary-btn" onClick={startRefresh} disabled={refreshing || status.state === 'running'}><RefreshCw size={15} className={refreshing || status.state === 'running' ? 'spin' : ''} /> Refresh data</button> */}
        </div>

        {error && <div className="alert"><AlertCircle size={17} />{error}</div>}
        {loading ? <div className="loading-state"><div className="loader"/><span>Loading WindCast analytics…</span></div> : !hasData ? <EmptyState onRefresh={startRefresh} loading={refreshing} status={status} /> : <>
          <div className="decision-banner"><div className="decision-icon"><Clock3 size={18}/></div><div><strong>Day-ahead decision snapshot</strong><span>Latest forecast published by 10:00 UK time on the day before delivery · January is GMT (UTC+0)</span></div><div className="banner-right"><span>DECISION CUTOFF</span><strong> D−1 · 10:00 GMT</strong></div></div>

          {tab === 'overview' && <>
            <div className="section-title-row"><div><h2>Performance at a glance</h2><p>National wind generation · Hourly delivery intervals</p></div><span className="muted-badge"><span className="green-dot"/> Elexon data</span></div>
            <div className="metrics-grid">
              <MetricCard label="Mean absolute error" value={fmt(metrics.mae)} unit="MW" note="Average absolute forecast miss" icon={Activity} tone="blue" />
              <MetricCard label="Weighted absolute % error" value={fmt(metrics.wape, 2)} unit="%" note="Error relative to actual generation" icon={Gauge} tone="violet" />
              <MetricCard label="Forecast bias" value={metrics.bias == null ? '—' : `${metrics.bias > 0 ? '+' : ''}${fmt(metrics.bias)}`} unit="MW" note={metrics.bias > 0 ? 'Tended to over-forecast' : 'Tended to under-forecast'} icon={metrics.bias > 0 ? ArrowUpRight : ArrowDownRight} tone="amber" />
              <MetricCard label="Matched intervals" value={fmt(metrics.intervals)} unit={`/ ${fmt(overview.dataInfo.actualIntervals)}`} note={`${fmt(metrics.coverage, 1)}% data coverage`} icon={CheckCircle2} tone="green" />
            </div>
            <div className="content-grid">
              <section className="panel chart-panel"><div className="panel-heading"><div><h3>Forecast vs actual generation</h3><p>Daily average MW · January 2026</p></div><div className="legend-inline"><span><i className="legend forecast"/> Forecast</span><span><i className="legend actual"/> Actual</span></div></div>
                <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={dailyChart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" vertical={false}/><XAxis dataKey="dateLabel" tick={{ fill: '#8190a3', fontSize: 11 }} axisLine={false} tickLine={false} interval={4}/><YAxis tick={{ fill: '#8190a3', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`}/><Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5eaf0', boxShadow: '0 8px 24px #1c2f4614' }} formatter={(v) => [`${fmt(v)} MW`, '']} labelStyle={{ color: '#25364b', fontWeight: 700 }}/><Line type="monotone" dataKey="forecastMW" name="Forecast" stroke="#526de5" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }}/><Line type="monotone" dataKey="actualMW" name="Actual" stroke="#1cab82" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }}/></LineChart></ResponsiveContainer></div>
                <div className="chart-foot"><span><strong>{fmt(overview.dataInfo.averageForecastMW)} MW</strong> avg forecast</span><span><strong>{fmt(overview.dataInfo.averageActualMW)} MW</strong> avg actual</span><span><strong>{fmt(overview.dataInfo.matchedIntervals)}</strong> intervals compared</span></div>
              </section>
              <section className="panel side-panel"><div className="panel-heading"><div><h3>Forecast quality</h3><p>Across matched delivery intervals</p></div><span className="quality-icon"><Zap size={17}/></span></div>
                <div className="quality-big"><strong>{metrics.wape == null ? '—' : `${fmt(Math.max(0, 100 - metrics.wape), 1)}%`}</strong><span>complement of WAPE</span></div>
                <div className="quality-meter"><span style={{ width: `${Math.max(0, Math.min(100, 100 - (metrics.wape || 0)))}%` }}/></div>
                <div className="quality-stats"><div><span>RMSE</span><strong>{fmt(metrics.rmse)} MW</strong></div><div><span>MAE</span><strong>{fmt(metrics.mae)} MW</strong></div><div><span>Bias direction</span><strong>{metrics.bias > 0 ? 'Over-forecast' : metrics.bias < 0 ? 'Under-forecast' : 'Neutral'}</strong></div></div>
                <div className="side-note"><AlertCircle size={15}/> Lower error means a closer forecast. These metrics describe wind forecast quality, not total procurement requirements.</div>
              </section>
            </div>
            <section className="panel table-panel"><div className="panel-heading"><div><h3>Daily performance</h3><p>Click a date to inspect its 24 hourly periods</p></div><button className="text-btn" onClick={() => setTab('explorer')}>Open explorer <span>→</span></button></div>
              <div className="table-scroll"><table><thead><tr><th>Delivery date</th><th>Avg. forecast</th><th>Avg. actual</th><th>Daily MAE</th><th>Intervals</th><th></th></tr></thead><tbody>{dailyChart.slice(0, 8).map(d => <tr key={d.date} onClick={() => { setSelectedDate(d.date); setTab('explorer') }}><td><strong>{fmtDate(d.date)}</strong></td><td>{fmt(d.forecastMW)} MW</td><td>{fmt(d.actualMW)} MW</td><td><span className="error-pill">{fmt(d.maeMW)} MW</span></td><td>{d.intervals}/24</td><td><span className="row-arrow">↗</span></td></tr>)}</tbody></table></div>
            </section>
          </>}

          {tab === 'accuracy' && <>
            <div className="section-title-row"><div><h2>Accuracy scorecard</h2><p>All statistics are calculated from forecast/actual pairs only.</p></div><span className="muted-badge">Jan 01 — Jan 31, 2026</span></div>
            <div className="metrics-grid accuracy-grid">
              <MetricCard label="MAE" value={fmt(metrics.mae)} unit="MW" note="Mean absolute error" icon={Activity} tone="blue" />
              <MetricCard label="RMSE" value={fmt(metrics.rmse)} unit="MW" note="Root mean squared error" icon={Gauge} tone="violet" />
              <MetricCard label="Mean bias error" value={metrics.bias == null ? '—' : `${metrics.bias > 0 ? '+' : ''}${fmt(metrics.bias)}`} unit="MW" note="Positive = over-forecast" icon={ArrowUpRight} tone="amber" />
              <MetricCard label="WAPE" value={fmt(metrics.wape, 2)} unit="%" note="Σ absolute error / Σ actual" icon={BarChart3} tone="green" />
            </div>
            <div className="content-grid accuracy-content">
              <section className="panel chart-panel"><div className="panel-heading"><div><h3>Daily absolute error</h3><p>Average absolute error per delivery day (MW)</p></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={dailyChart} margin={{ top: 10, right: 8, left: -15, bottom: 0 }}><defs><linearGradient id="maeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e5a23a" stopOpacity={0.28}/><stop offset="100%" stopColor="#e5a23a" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" vertical={false}/><XAxis dataKey="dateLabel" tick={{ fill: '#8190a3', fontSize: 11 }} axisLine={false} tickLine={false} interval={4}/><YAxis tick={{ fill: '#8190a3', fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip formatter={v => [`${fmt(v)} MW`, 'Daily MAE']}/><Area type="monotone" dataKey="maeMW" stroke="#dfa13d" fill="url(#maeFill)" strokeWidth={2.3}/></AreaChart></ResponsiveContainer></div></section>
              <section className="panel definition-panel"><h3>How to read the metrics</h3><div className="definition"><strong>MAE</strong><p>Average size of the forecast error. Easy to interpret in MW.</p></div><div className="definition"><strong>RMSE</strong><p>Penalises large misses more heavily than MAE.</p></div><div className="definition"><strong>Bias</strong><p>Positive values mean forecasts were higher than actual generation.</p></div><div className="definition"><strong>WAPE</strong><p>Total absolute error divided by total actual generation.</p></div><div className="formula-box">Error = Forecast − Actual<br/>WAPE = Σ|Error| ÷ Σ|Actual| × 100</div></section>
            </div>
            <div className="method-note"><AlertCircle size={17}/><div><strong>Evaluation methodology</strong><p>For each delivery interval, WindCast chooses the latest WINDFOR publication no later than 10:00 UK time on D−1. The cutoff is an explicit pilot assumption and is configurable. Accuracy is measured only where both a selected forecast and FUELHH actual are available; unmatched intervals are excluded from error metrics and shown in the coverage figure.</p></div></div>
          </>}

          {tab === 'explorer' && <>
            <div className="explorer-toolbar"><div><h2>Hourly delivery profile</h2><p>Inspect forecast vintages and actual generation for one delivery date.</p></div><div className="toolbar-actions"><label className="date-select"><CalendarDays size={15}/><input type="date" min="2026-01-01" max="2026-01-31" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}/><ChevronDown size={14}/></label><button className="secondary-btn" onClick={csvDownload}><Download size={15}/> Export CSV</button></div></div>
            <div className="metrics-grid explorer-metrics"><MetricCard label="Day MAE" value={fmt(selectedMetrics.mae)} unit="MW" note="Selected delivery date" icon={Activity} tone="blue"/><MetricCard label="Day RMSE" value={fmt(selectedMetrics.rmse)} unit="MW" note="Selected delivery date" icon={Gauge} tone="violet"/><MetricCard label="Forecast bias" value={selectedMetrics.bias == null ? '—' : `${selectedMetrics.bias > 0 ? '+' : ''}${fmt(selectedMetrics.bias)}`} unit="MW" note="Positive = over-forecast" icon={ArrowUpRight} tone="amber"/><MetricCard label="Matched hours" value={fmt(selectedMetrics.intervals)} unit="/ 24" note="Hourly periods" icon={CheckCircle2} tone="green"/></div>
            <section className="panel chart-panel explorer-chart"><div className="panel-heading"><div><h3>{fmtDate(selectedDate)} · Wind generation</h3><p>Selected day-ahead forecast vs metered outturn</p></div><div className="legend-inline"><span><i className="legend forecast"/> Forecast</span><span><i className="legend actual"/> Actual</span></div></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={series?.rows || []} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" vertical={false}/><XAxis dataKey="time" tick={{ fill: '#8190a3', fontSize: 11 }} axisLine={false} tickLine={false} interval={5}/><YAxis tick={{ fill: '#8190a3', fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e5eaf0' }} formatter={(v, name) => [`${fmt(v)} MW`, name]}/><Line type="monotone" dataKey="forecastMW" name="Forecast" stroke="#526de5" strokeWidth={2.5} dot={false} connectNulls={false}/><Line type="monotone" dataKey="actualMW" name="Actual" stroke="#1cab82" strokeWidth={2.5} dot={false} connectNulls={false}/></LineChart></ResponsiveContainer></div></section>
            <section className="panel table-panel"><div className="panel-heading"><div><h3>Hourly interval detail</h3><p>{series?.rows?.length || 0} hourly intervals · all timestamps shown in UK local time</p></div><span className="muted-badge">D−1 cutoff: 10:00 GMT</span></div><div className="table-scroll"><table><thead><tr><th>Delivery time</th><th>Forecast</th><th>Actual</th><th>Error</th><th>Forecast published</th></tr></thead><tbody>{(series?.rows || []).map((r, i) => <tr key={`${r.startTime}-${i}`}><td><strong>{r.time}</strong></td><td>{r.forecastMW == null ? '—' : `${fmt(r.forecastMW)} MW`}</td><td>{r.actualMW == null ? '—' : `${fmt(r.actualMW)} MW`}</td><td>{r.errorMW == null ? '—' : <span className={r.errorMW > 0 ? 'error-pill' : 'success-pill'}>{r.errorMW > 0 ? '+' : ''}{fmt(r.errorMW)} MW</span>}</td><td className="publish-time">{r.publishTime ? new Date(r.publishTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : 'No eligible vintage'}</td></tr>)}</tbody></table></div></section>
          </>}
        </>}

        <footer className="footer"><span>WINDCAST PILOT <i/> UK NATIONAL WIND GENERATION</span><span>Source: Elexon BMRS · FUELHH & WINDFOR</span><span>January 2026 · v1.0</span></footer>
      </div>
    </main>
  </div>
}
