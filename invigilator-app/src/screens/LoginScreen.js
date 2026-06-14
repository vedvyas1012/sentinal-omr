import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, SafeAreaView, KeyboardAvoidingView,
  Platform, ScrollView,
} from 'react-native';
import { API_URL } from '../config';
import { saveToken } from '../storage';
import { getSocketNoAuth, disconnectSocket } from '../socket';

export default function LoginScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => disconnectSocket();
  }, []);

  async function handleRequest() {
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setError('');
    setLoading(true);

    const socket = getSocketNoAuth();

    // Wait for the socket to connect before requesting login (5s timeout)
    try {
      await new Promise((resolve, reject) => {
        if (socket.connected) return resolve();
        let timer;
        function onConn() { clearTimeout(timer); socket.off('connect_error', onErr); resolve(); }
        function onErr(err) { clearTimeout(timer); socket.off('connect', onConn); reject(err); }
        socket.once('connect', onConn);
        socket.once('connect_error', onErr);
        timer = setTimeout(() => {
          socket.off('connect', onConn);
          socket.off('connect_error', onErr);
          reject(new Error('timeout'));
        }, 5000);
      });
    } catch {
      setError('Cannot reach server. Check your Wi-Fi and try again.');
      setLoading(false);
      disconnectSocket();
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/request-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, socketId: socket.id }),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || 'Request failed. Check your credentials.');
        setLoading(false);
        return;
      }

      const { requestId, userId } = data.data;

      socket.emit('join_room', { room: `user_${userId}` });

      setLoading(false);
      setWaiting(true);

      socket.once('login_approved', async ({ requestId: approvedId }) => {
        socket.off('login_denied');

        try {
          const claimRes = await fetch(
            `${API_URL}/api/auth/claim-token?requestId=${approvedId}&platform=native`
          );
          const claimData = await claimRes.json();

          if (claimData.success && claimData.data.token) {
            await saveToken(claimData.data.token);
            navigation.replace('Scan', { user: claimData.data });
          } else {
            setError('Approval failed. Please try again.');
            setWaiting(false);
          }
        } catch {
          setError('Network error during claim. Please try again.');
          setWaiting(false);
        }
      });

      socket.once('login_denied', () => {
        socket.off('login_approved');
        setError('Your login was denied by the moderator.');
        setWaiting(false);
      });
    } catch {
      setError('Network error. Is the server running?');
      setLoading(false);
    }
  }

  function handleRetry() {
    setWaiting(false);
    setError('');
    disconnectSocket();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.emoji}>🔐</Text>
            <Text style={styles.title}>NEET Secure OMR</Text>
            <Text style={styles.subtitle}>Invigilator App</Text>

            {!waiting ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Username  (e.g. inv1)"
                  placeholderTextColor="#9ca3af"
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor="#9ca3af"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  editable={!loading}
                />

                {!!error && <Text style={styles.error}>{error}</Text>}

                <TouchableOpacity
                  style={[styles.btn, loading && styles.btnDisabled]}
                  onPress={handleRequest}
                  disabled={loading}
                  activeOpacity={0.8}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.btnText}>Request Login Approval</Text>}
                </TouchableOpacity>

                <Text style={styles.hint}>
                  Requires real-time approval from your center moderator.
                </Text>

                <View style={styles.demoBox}>
                  <Text style={styles.demoTitle}>Demo credentials</Text>
                  <Text style={styles.demoLine}>inv1 / inv123   ·   inv2 / inv456</Text>
                </View>
              </>
            ) : (
              <View style={styles.waitBox}>
                <ActivityIndicator size="large" color="#1d4ed8" style={{ marginBottom: 20 }} />
                <Text style={styles.waitTitle}>Waiting for moderator…</Text>
                <Text style={styles.waitSub}>
                  Keep this screen open. You will be redirected automatically once approved.
                </Text>

                {!!error && (
                  <>
                    <Text style={[styles.error, { marginTop: 20 }]}>{error}</Text>
                    <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                      <Text style={styles.retryText}>Try Again</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1e3a8a' },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: '#fff', borderRadius: 24, padding: 28,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, elevation: 12,
  },
  emoji: { fontSize: 48, textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center', color: '#111827' },
  subtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 28 },
  input: {
    borderWidth: 1.5, borderColor: '#e5e7eb', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12,
    fontSize: 16, color: '#111827',
  },
  error: { color: '#dc2626', fontSize: 13, textAlign: 'center', marginBottom: 10 },
  btn: {
    backgroundColor: '#1d4ed8', borderRadius: 12,
    paddingVertical: 15, alignItems: 'center', marginTop: 4,
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  hint: { fontSize: 12, color: '#9ca3af', textAlign: 'center', marginTop: 14 },
  demoBox: {
    marginTop: 20, backgroundColor: '#f9fafb', borderRadius: 10,
    padding: 12, borderWidth: 1, borderColor: '#f3f4f6',
  },
  demoTitle: { fontSize: 11, fontWeight: '700', color: '#6b7280', marginBottom: 4 },
  demoLine: { fontSize: 12, color: '#9ca3af', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  waitBox: { alignItems: 'center', paddingVertical: 20 },
  waitTitle: { fontSize: 18, fontWeight: '700', color: '#1d4ed8', textAlign: 'center' },
  waitSub: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginTop: 10, lineHeight: 20 },
  retryBtn: { marginTop: 12, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, backgroundColor: '#eff6ff' },
  retryText: { color: '#1d4ed8', fontWeight: '600', fontSize: 15 },
});
