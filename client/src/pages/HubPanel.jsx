import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';

const REFRESH_MS = 30_000;

export default function HubPanel() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [recRes, statRes] = await Promise.all([
        fetch('/api/hub/records', { credentials: 'include' }),
        fetch('/api/hub/stats',   { credentials: 'include' }),
      ]);
      const [recData, statData] = await Promise.all([recRes.json(), statRes.json()]);
      if (recData.success)  setRecords(recData.data);
      if (statData.success) setStats(statData.data);
      setLastRefresh(new Date());
      setError('');
    } catch {
      setError('Failed to load data. Retrying...');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    navigate('/login', { replace: true });
  }

  const statCards = stats
    ? [
        { label: 'Hub-Processed', value: stats.processed, cls: 'text-teal-700' },
        { label: 'Matched',       value: stats.matched,   cls: 'text-green-700' },
        { label: 'Flagged',       value: stats.flagged,   cls: 'text-red-700' },
        { label: 'Review',        value: stats.review,    cls: 'text-amber-600' },
      ]
    : [];

  function statusBadge(status) {
    if (status === 'matched') return <span className="bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5 rounded-full">MATCHED</span>;
    if (status === 'review')  return <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">REVIEW</span>;
    return <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">FLAGGED</span>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-teal-800 text-white px-6 py-4 flex items-center justify-between shadow">
        <div>
          <h1 className="text-lg font-bold">Hub Monitoring</h1>
          <p className="text-teal-200 text-sm">{user?.username} — submissions automated by OCR agent</p>
        </div>
        <div className="flex items-center gap-4">
          {lastRefresh && (
            <span className="text-teal-300 text-xs">
              Last refresh {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button onClick={handleLogout} className="text-sm bg-teal-700 hover:bg-teal-600 px-3 py-1.5 rounded-lg">
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-teal-50 border border-teal-200 rounded-2xl px-5 py-4 flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse shrink-0" />
          <p className="text-sm text-teal-800">
            The hub scan agent runs on the document scanner's PC and submits sheets automatically.
            Scanned images (<code className="bg-teal-100 px-1 rounded font-mono text-xs">.jpg</code> /{' '}
            <code className="bg-teal-100 px-1 rounded font-mono text-xs">.png</code>) dropped into the agent's{' '}
            <code className="bg-teal-100 px-1 rounded font-mono text-xs">watch/</code> folder are read with the
            same grid analysis as the edge scan — no manual data entry.
          </p>
        </div>

        {statCards.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {statCards.map(s => (
              <div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-center">
                <div className={`text-3xl font-bold ${s.cls}`}>{Number(s.value).toLocaleString()}</div>
                <div className="text-sm text-gray-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">
              Hub-Verified Records
              {records.length > 0 && (
                <span className="ml-2 bg-gray-100 text-gray-600 text-xs font-bold px-2 py-0.5 rounded-full">
                  {records.length}
                </span>
              )}
            </h2>
            <button
              onClick={fetchData}
              className="text-xs text-teal-700 hover:text-teal-900 font-medium border border-teal-200 px-3 py-1 rounded-lg"
            >
              Refresh
            </button>
          </div>

          {loading && (
            <div className="text-center py-12 text-gray-400">Loading...</div>
          )}

          {!loading && error && (
            <div className="text-center py-12 text-red-600">{error}</div>
          )}

          {!loading && !error && records.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-3">📭</p>
              <p>No records submitted yet. The agent will populate this as sheets are processed.</p>
            </div>
          )}

          {!loading && records.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3">Student ID</th>
                    <th className="px-4 py-3">Center</th>
                    <th className="px-4 py-3">Edge Hash</th>
                    <th className="px-4 py-3">Hub Hash</th>
                    <th className="px-4 py-3">Processed At</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition">
                      <td className="px-4 py-3 font-mono text-sm">{r.student_id}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.center_id || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{(r.edge_hash || '').slice(0, 10)}…</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">{(r.hub_hash  || '').slice(0, 10)}…</td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {r.hub_processed_at ? new Date(r.hub_processed_at).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3">{statusBadge(r.match_status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
