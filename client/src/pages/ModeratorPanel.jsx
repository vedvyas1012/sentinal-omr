import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../App.jsx';

export default function ModeratorPanel() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [resolving, setResolving] = useState({});
  const socketRef = useRef(null);

  useEffect(() => {
    // Catch requests that arrived before mount or during a reconnect
    fetch('/api/auth/pending-requests', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.success && d.data.length) {
          setRequests(prev => {
            const existingIds = new Set(prev.map(r => r.requestId));
            const fresh = d.data.filter(r => !existingIds.has(r.requestId));
            return [...fresh.map(r => ({ ...r, status: 'pending' })), ...prev];
          });
        }
      })
      .catch(() => {});

    const room = `center_${user.center_id}`;
    const socket = io('/', { withCredentials: true });
    socketRef.current = socket;

    function joinRoom() {
      socket.emit('join_room', { room });
    }

    socket.on('connect', joinRoom);

    socket.on('login_request', (req) => {
      setRequests(prev => {
        const exists = prev.find(r => r.requestId === req.requestId);
        return exists ? prev : [{ ...req, status: 'pending' }, ...prev];
      });
    });

    socket.on('request_resolved', ({ requestId }) => {
      setRequests(prev => prev.filter(r => r.requestId !== requestId));
    });

    return () => socket.disconnect();
  }, []);

  async function resolve(requestId, action) {
    setResolving(prev => ({ ...prev, [requestId]: action }));
    try {
      const res = await fetch(`/api/auth/resolve-login/${requestId}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!data.success) console.error('[Moderator] resolve failed:', data.error);
    } catch (err) {
      console.error('[Moderator] resolve error:', err);
    } finally {
      setResolving(prev => { const n = { ...prev }; delete n[requestId]; return n; });
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    navigate('/login', { replace: true });
  }

  const pending = requests.filter(r => r.status === 'pending');
  const resolved = requests.filter(r => r.status !== 'pending');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-purple-800 text-white px-6 py-4 flex items-center justify-between shadow">
        <div>
          <h1 className="text-lg font-bold">Moderator Panel</h1>
          <p className="text-purple-200 text-sm">{user?.username} — {user?.center_id}</p>
        </div>
        <div className="flex items-center gap-4">
          {pending.length > 0 && (
            <span className="bg-yellow-400 text-yellow-900 text-xs font-bold px-2 py-1 rounded-full animate-pulse">
              {pending.length} pending
            </span>
          )}
          <button onClick={handleLogout} className="text-sm bg-purple-700 hover:bg-purple-600 px-3 py-1.5 rounded-lg">
            Logout
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-semibold text-gray-800 mb-1">Real-time Login Approvals</h2>
          <p className="text-sm text-gray-500 mb-4">New requests from invigilators at {user?.center_id} appear instantly.</p>

          {requests.length === 0 && (
            <div className="text-center py-12 text-gray-400">
              <div className="text-4xl mb-3">📋</div>
              <p>No approval requests yet. Waiting for invigilators to log in...</p>
            </div>
          )}

          {pending.length > 0 && (
            <div className="space-y-3 mb-6">
              <h3 className="text-sm font-semibold text-yellow-700 uppercase tracking-wide">Pending</h3>
              {pending.map(r => (
                <div key={r.requestId} className="flex items-center justify-between bg-yellow-50 border border-yellow-200 rounded-xl p-4">
                  <div>
                    <p className="font-semibold text-gray-800">{r.username}</p>
                    <p className="text-sm text-gray-500">Center: {r.centerId} &nbsp;·&nbsp; Request #{r.requestId}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => resolve(r.requestId, 'approve')}
                      disabled={!!resolving[r.requestId]}
                      className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
                    >
                      {resolving[r.requestId] === 'approve' ? '...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => resolve(r.requestId, 'deny')}
                      disabled={!!resolving[r.requestId]}
                      className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg"
                    >
                      {resolving[r.requestId] === 'deny' ? '...' : 'Deny'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {resolved.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Resolved</h3>
              {resolved.map(r => (
                <div key={r.requestId} className={`flex items-center justify-between rounded-xl p-3 border ${r.status === 'approved' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div>
                    <span className="font-medium text-gray-700">{r.username}</span>
                    <span className="text-sm text-gray-400 ml-2">#{r.requestId}</span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-1 rounded-full ${r.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {r.status.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
