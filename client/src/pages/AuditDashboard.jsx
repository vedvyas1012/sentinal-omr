import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import FlaggedRecord from '../components/FlaggedRecord.jsx';

export default function AuditDashboard() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/dashboard/flagged', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/dashboard/stats', { credentials: 'include' }).then(r => r.json()),
    ]).then(([flagData, statsData]) => {
      if (flagData.success) setRecords(flagData.data.records);
      if (statsData.success) setStats(statsData.data);
    }).catch(() => {
      setFetchError('Failed to load audit data. Please refresh.');
    }).finally(() => setLoading(false));
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-red-900 text-white px-6 py-4 flex items-center justify-between shadow">
        <div>
          <h1 className="text-lg font-bold">Audit Dashboard</h1>
          <p className="text-red-200 text-sm">{user?.username} — Officials Only</p>
        </div>
        <button onClick={handleLogout} className="text-sm bg-red-800 hover:bg-red-700 px-3 py-1.5 rounded-lg">
          Logout
        </button>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Total Records', value: stats.total,   cls: 'text-blue-700' },
              { label: 'Matched',       value: stats.matched, cls: 'text-green-700' },
              { label: 'Flagged',       value: stats.flagged, cls: 'text-red-700' },
              { label: 'Review',        value: stats.review,  cls: 'text-amber-600' },
              { label: 'Pending',       value: stats.pending, cls: 'text-yellow-700' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-center">
                <div className={`text-3xl font-bold ${s.cls}`}>{s.value}</div>
                <div className="text-sm text-gray-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">
              Flagged Records
              {records.length > 0 && (
                <span className="ml-2 bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                  {records.length}
                </span>
              )}
            </h2>
          </div>

          {loading && (
            <div className="text-center py-12 text-gray-400">Loading audit records...</div>
          )}

          {!loading && fetchError && (
            <div className="text-center py-12 text-red-600">{fetchError}</div>
          )}

          {!loading && records.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-3">✅</div>
              <p>No flagged records. All sheets verified clean.</p>
            </div>
          )}

          {!loading && records.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3">Student ID</th>
                    <th className="px-4 py-3">Center</th>
                    <th className="px-4 py-3">Invigilator</th>
                    <th className="px-4 py-3">Edge Hash</th>
                    <th className="px-4 py-3">Hub Hash</th>
                    <th className="px-4 py-3">Mismatch Detail</th>
                    <th className="px-4 py-3">Flagged At</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map(r => <FlaggedRecord key={r.id} record={r} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
