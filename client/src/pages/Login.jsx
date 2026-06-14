import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../App.jsx';

const ROLE_REDIRECT = {
  invigilator: '/invigilator',
  moderator: '/moderator',
  hub_operator: '/hub',
  official: '/audit',
};

export default function Login() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState('invigilator');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (user) navigate(ROLE_REDIRECT[user.role] || '/login', { replace: true });
  }, [user]);

  useEffect(() => {
    return () => { if (socketRef.current) socketRef.current.disconnect(); };
  }, []);

  function resetState() {
    setError('');
    setInfo('');
    setWaitingApproval(false);
    if (socketRef.current) { socketRef.current.disconnect(); socketRef.current = null; }
  }

  async function handleDirectLogin(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Login failed'); return; }
      setUser(data.data);
      navigate(ROLE_REDIRECT[data.data.role] || '/login', { replace: true });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleInvigilatorLogin(e) {
    e.preventDefault();
    resetState();
    setLoading(true);

    const socket = io('/', { withCredentials: true });
    socketRef.current = socket;

    try {
      await new Promise((resolve, reject) => {
        let timer;
        function onConnect() { clearTimeout(timer); socket.off('connect_error', onErr); resolve(); }
        function onErr(err) { clearTimeout(timer); socket.off('connect', onConnect); reject(err); }
        socket.once('connect', onConnect);
        socket.once('connect_error', onErr);
        timer = setTimeout(() => { socket.off('connect', onConnect); socket.off('connect_error', onErr); reject(new Error('timeout')); }, 5000);
      });
    } catch {
      setError('Could not connect to server. Please try again.');
      socket.disconnect();
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/request-login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, socketId: socket.id }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Request failed');
        socket.disconnect();
        setLoading(false);
        return;
      }

      const { requestId, userId } = data.data;

      socket.emit('join_room', { room: `user_${userId}` });

      setInfo('Request sent. Waiting for moderator approval...');
      setWaitingApproval(true);
      setLoading(false);

      socket.once('login_approved', async ({ requestId: approvedId }) => {
        const claimRes = await fetch(`/api/auth/claim-token?requestId=${approvedId}`, {
          credentials: 'include',
        });
        const claimData = await claimRes.json();
        if (claimData.success) {
          setUser(claimData.data);
          navigate('/invigilator', { replace: true });
        } else {
          setError('Approval failed. Please try again.');
          setWaitingApproval(false);
          setInfo('');
        }
      });

      socket.once('login_denied', () => {
        setError('Your login was denied by the moderator.');
        setWaitingApproval(false);
        setInfo('');
        socket.disconnect();
      });
    } catch {
      setError('Network error. Please try again.');
      socket.disconnect();
      setLoading(false);
    }
  }

  const isInvigilator = role === 'invigilator';
  const handleSubmit = isInvigilator ? handleInvigilatorLogin : handleDirectLogin;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-900 to-indigo-900">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🔐</div>
          <h1 className="text-2xl font-bold text-gray-900">NEET Secure OMR System</h1>
          <p className="text-gray-500 text-sm mt-1">Examination Integrity Platform</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={role}
              onChange={e => { setRole(e.target.value); resetState(); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="invigilator">Invigilator</option>
              <option value="moderator">Moderator</option>
              <option value="hub_operator">Hub Operator</option>
              <option value="official">Official</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder={
                isInvigilator ? 'inv1' :
                role === 'moderator' ? 'mod1' :
                role === 'hub_operator' ? 'hub1' : 'official1'
              }
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 border border-red-200 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {info && (
            <div className="bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
              <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || waitingApproval}
            className="w-full bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition"
          >
            {loading ? 'Please wait...'
              : waitingApproval ? 'Awaiting Moderator Approval...'
              : isInvigilator ? 'Request Login Approval'
              : 'Login'}
          </button>
        </form>

        {isInvigilator && (
          <p className="text-xs text-gray-400 text-center mt-4">
            Invigilator logins require real-time approval from the center moderator.
          </p>
        )}

        <div className="mt-6 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <p className="text-xs text-gray-500 font-semibold mb-1">Demo credentials</p>
          <div className="text-xs text-gray-400 space-y-0.5">
            <div>Invigilator: <code>inv1 / inv123</code> &nbsp;|&nbsp; <code>inv2 / inv456</code></div>
            <div>Moderator: <code>mod1 / mod123</code></div>
            <div>Hub Operator: <code>hub1 / hub123</code></div>
            <div>Official: <code>official1 / off123</code></div>
          </div>
        </div>
      </div>
    </div>
  );
}
