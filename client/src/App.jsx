import React, { createContext, useContext, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import InvigilatorPanel from './pages/InvigilatorPanel.jsx';
import ModeratorPanel from './pages/ModeratorPanel.jsx';
import HubPanel from './pages/HubPanel.jsx';
import AuditDashboard from './pages/AuditDashboard.jsx';

export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setUser(d.success ? d.data : null))
      .catch(() => setUser(null));
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ allowedRole, children }) {
  const { user } = useAuth();

  if (user === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500 text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (user.role !== allowedRole) {
    const redirectMap = {
      invigilator: '/invigilator',
      moderator: '/moderator',
      hub_operator: '/hub',
      official: '/audit',
    };
    return <Navigate to={redirectMap[user.role] || '/login'} replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/invigilator"
            element={
              <ProtectedRoute allowedRole="invigilator">
                <InvigilatorPanel />
              </ProtectedRoute>
            }
          />
          <Route
            path="/moderator"
            element={
              <ProtectedRoute allowedRole="moderator">
                <ModeratorPanel />
              </ProtectedRoute>
            }
          />
          <Route
            path="/hub"
            element={
              <ProtectedRoute allowedRole="hub_operator">
                <HubPanel />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit"
            element={
              <ProtectedRoute allowedRole="official">
                <AuditDashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
