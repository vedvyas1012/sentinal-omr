import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import Timer from '../components/Timer.jsx';
import ScanResult from '../components/ScanResult.jsx';

const QUESTIONS = Array.from({ length: 10 }, (_, i) => `Q${i + 1}`);
const OPTIONS = ['A', 'B', 'C', 'D', 'E'];

function defaultAnswers() {
  return Object.fromEntries(QUESTIONS.map(q => [q, 'A']));
}

export default function InvigilatorPanel() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [scanExpiry, setScanExpiry] = useState(null);
  const [windowLocked, setWindowLocked] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [answers, setAnswers] = useState(defaultAnswers());
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [scans, setScans] = useState([]);
  const fileRef = useRef();

  useEffect(() => {
    fetch('/api/scan/session-info', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setScanExpiry(d.data.scan_window_expires_at);
          setWindowLocked(d.data.is_locked || new Date(d.data.scan_window_expires_at) <= new Date());
        }
      })
      .catch(() => {});

    fetch('/api/scan/my-scans', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.success) setScans(d.data); })
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (windowLocked) return;
    if (!file) { setError('Please upload an OMR sheet image'); return; }
    setError('');
    setSubmitting(true);

    const form = new FormData();
    form.append('omrImage', file);
    form.append('studentId', studentId);
    form.append('answers', JSON.stringify(answers));

    try {
      const res = await fetch('/api/scan/submit', {
        method: 'POST',
        credentials: 'include',
        body: form,
      });

      if (res.status === 401) {
        setUser(null);
        navigate('/login', { replace: true, state: { message: 'Session expired' } });
        return;
      }

      const data = await res.json();
      if (!data.success) { setError(data.error || 'Submission failed'); return; }

      setScans(prev => [{ student_id: data.data.studentId, raw_data_string: data.data.dataString, edge_hash: data.data.edgeHash, scanned_at: new Date().toISOString() }, ...prev]);
      setStudentId('');
      setAnswers(defaultAnswers());
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-blue-800 text-white px-6 py-4 flex items-center justify-between shadow">
        <div>
          <h1 className="text-lg font-bold">Invigilator Panel</h1>
          <p className="text-blue-200 text-sm">{user?.username} — {user?.center_id}</p>
        </div>
        <button onClick={handleLogout} className="text-sm bg-blue-700 hover:bg-blue-600 px-3 py-1.5 rounded-lg">
          Logout
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-700">Scanning Window</h2>
            {scanExpiry && <Timer expiresAt={scanExpiry} onExpire={() => setWindowLocked(true)} />}
          </div>
          {windowLocked && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 font-semibold text-sm">
              Scanning window expired. No further submissions are allowed.
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-4">Submit OMR Scan</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Upload OMR Sheet Image</label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={e => setFile(e.target.files[0])}
                disabled={windowLocked}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-50 file:text-blue-700 file:font-semibold hover:file:bg-blue-100 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student ID</label>
              <input
                type="text"
                value={studentId}
                onChange={e => setStudentId(e.target.value)}
                placeholder="e.g. 492"
                disabled={windowLocked}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Answers</label>
              <div className="grid grid-cols-5 gap-2">
                {QUESTIONS.map(q => (
                  <div key={q}>
                    <label className="block text-xs text-gray-500 mb-1 text-center">{q}</label>
                    <select
                      value={answers[q]}
                      onChange={e => setAnswers(prev => ({ ...prev, [q]: e.target.value }))}
                      disabled={windowLocked}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                      {OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={windowLocked || submitting}
              className="w-full bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
            >
              {submitting ? 'Processing...' : 'Submit Scan'}
            </button>
          </form>
        </div>

        {scans.length > 0 && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h2 className="font-semibold text-gray-800 mb-4">Scans This Session ({scans.length})</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {scans.map((s, i) => <ScanResult key={i} record={s} />)}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
