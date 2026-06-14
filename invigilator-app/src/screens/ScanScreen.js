import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, SafeAreaView, ActivityIndicator, Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { API_URL } from '../config';
import { getToken, deleteToken } from '../storage';
import { disconnectSocket } from '../socket';

const QUESTIONS = Array.from({ length: 10 }, (_, i) => `Q${i + 1}`);
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const COUNTDOWN_SECS = 3;

function CountdownTimer({ expiresAt, onExpire }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    function tick() {
      const diff = Math.max(0, Math.floor((new Date(expiresAt) - Date.now()) / 1000));
      setRemaining(diff);
      if (diff === 0) { clearInterval(id); if (onExpire) onExpire(); }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');
  const isDone = remaining === 0;
  const isLow = !isDone && remaining <= 120;
  return (
    <View style={[styles.timerBox, isDone ? styles.timerDone : isLow ? styles.timerLow : styles.timerOk]}>
      <Text style={[styles.timerLabel, isDone ? styles.timerTxtDone : isLow ? styles.timerTxtLow : styles.timerTxtOk]}>
        Scanning Window
      </Text>
      <Text style={[styles.timerVal, isDone ? styles.timerTxtDone : isLow ? styles.timerTxtLow : styles.timerTxtOk]}>
        {mins}:{secs}
      </Text>
    </View>
  );
}

function AnswersGrid({ answers }) {
  return (
    <View style={styles.answersGrid}>
      {QUESTIONS.map(q => (
        <View key={q} style={styles.answerChip}>
          <Text style={styles.answerChipQ}>{q}</Text>
          <Text style={styles.answerChipVal}>{answers[q] || '?'}</Text>
        </View>
      ))}
    </View>
  );
}

// Automatic flow: camera → QR detected → countdown → capture → submit → reset
export default function ScanScreen({ navigation, route }) {
  const { user } = route.params;
  const [permission, requestPermission] = useCameraPermissions();

  const [scanExpiry, setScanExpiry]     = useState(null);
  const [windowLocked, setWindowLocked] = useState(false);

  // phases: 'camera' | 'countdown' | 'capturing' | 'submitting' | 'success' | 'error'
  const [phase, setPhase]               = useState('camera');
  const [studentId, setStudentId]       = useState('');
  const [countdownVal, setCountdownVal] = useState(COUNTDOWN_SECS);
  const [detectedAnswers, setDetectedAnswers] = useState(null);
  const [errorMsg, setErrorMsg]         = useState('');
  const [scans, setScans]               = useState([]);

  const cameraRef      = useRef(null);
  const lastQrTime     = useRef(0);
  const countdownTimer = useRef(null);
  const phaseRef       = useRef('camera');

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    loadSessionInfo();
    loadScans();
    return () => {
      disconnectSocket();
      clearInterval(countdownTimer.current);
    };
  }, []);

  async function authHeader() {
    const token = await getToken();
    return { Authorization: `Bearer ${token}` };
  }

  async function loadSessionInfo() {
    try {
      const res  = await fetch(`${API_URL}/api/scan/session-info`, { headers: await authHeader() });
      const data = await res.json();
      if (data.success) {
        setScanExpiry(data.data.scan_window_expires_at);
        if (data.data.is_locked || new Date(data.data.scan_window_expires_at) <= new Date()) {
          setWindowLocked(true);
        }
      }
    } catch { /* non-fatal */ }
  }

  async function loadScans() {
    try {
      const res  = await fetch(`${API_URL}/api/scan/my-scans`, { headers: await authHeader() });
      const data = await res.json();
      if (data.success) setScans(data.data);
    } catch { /* non-fatal */ }
  }

  const handleBarcode = useCallback(({ data }) => {
    if (phaseRef.current !== 'camera') return;
    if (windowLocked) return;
    const now = Date.now();
    if (now - lastQrTime.current < 1500) return; // debounce
    lastQrTime.current = now;
    if (!data || !data.trim()) return;
    beginCountdown(data.trim());
  }, [windowLocked]);

  function beginCountdown(id) {
    clearInterval(countdownTimer.current);
    setStudentId(id);
    setErrorMsg('');
    setPhase('countdown');
    let count = COUNTDOWN_SECS;
    setCountdownVal(count);
    countdownTimer.current = setInterval(() => {
      count -= 1;
      setCountdownVal(count);
      if (count <= 0) {
        clearInterval(countdownTimer.current);
        doCapture(id);
      }
    }, 1000);
  }

  // Center-crop to 4:5 and resize to 800×1000 so the upload matches the
  // template's pixel dimensions the server analyzes against.
  async function preprocessImage(uri, width, height) {
    const TARGET_W = 800, TARGET_H = 1000;
    const targetRatio = TARGET_W / TARGET_H; // 0.8
    const srcRatio = width / height;
    let cropX, cropY, cropW, cropH;
    if (srcRatio > targetRatio) {
      cropH = height;
      cropW = Math.round(height * targetRatio);
      cropX = Math.round((width - cropW) / 2);
      cropY = 0;
    } else {
      cropW = width;
      cropH = Math.round(width / targetRatio);
      cropX = 0;
      cropY = Math.round((height - cropH) / 2);
    }
    const result = await ImageManipulator.manipulateAsync(
      uri,
      [
        { crop: { originX: cropX, originY: cropY, width: cropW, height: cropH } },
        { resize: { width: TARGET_W, height: TARGET_H } },
      ],
      { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
    );
    return result.uri;
  }

  async function doCapture(id) {
    if (!cameraRef.current) { resetToCamera('Camera not ready'); return; }
    setPhase('capturing');
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      const processedUri = await preprocessImage(photo.uri, photo.width, photo.height);
      setPhase('submitting');
      await submitScan(processedUri, id);
    } catch (e) {
      resetToCamera('Camera error: ' + e.message);
    }
  }

  async function submitScan(uri, id) {
    try {
      const form = new FormData();
      form.append('omrImage', { uri, type: 'image/jpeg', name: 'omr.jpg' });
      form.append('studentId', id);

      const res = await fetch(`${API_URL}/api/scan/submit`, {
        method: 'POST',
        headers: await authHeader(),
        body: form,
      });

      if (res.status === 401) { await handleLogout(); return; }

      const data = await res.json();
      if (!data.success) {
        resetToCamera(data.error || 'Submission failed');
        return;
      }

      setDetectedAnswers(data.data.answers || {});
      setScans(prev => [{
        student_id: data.data.studentId,
        raw_data_string: data.data.dataString,
        edge_hash: data.data.edgeHash,
        scanned_at: new Date().toISOString(),
      }, ...prev]);

      setPhase('success');
      setTimeout(resetToCamera, 2500);
    } catch {
      resetToCamera('Network error — please retry');
    }
  }

  function resetToCamera(errMsg) {
    clearInterval(countdownTimer.current);
    setStudentId('');
    setDetectedAnswers(null);
    setCountdownVal(COUNTDOWN_SECS);
    lastQrTime.current = 0;
    if (errMsg) {
      setErrorMsg(errMsg);
      setPhase('error');
      setTimeout(() => {
        setErrorMsg('');
        setPhase('camera');
      }, 2500);
    } else {
      setErrorMsg('');
      setPhase('camera');
    }
  }

  async function handleLogout() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', headers: await authHeader() });
    } catch { /* ignore */ }
    await deleteToken();
    disconnectSocket();
    navigation.replace('Login');
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centred}>
          <ActivityIndicator size="large" color="#1d4ed8" />
          <Text style={styles.gateText}>Checking camera permission…</Text>
        </View>
      </SafeAreaView>
    );
  }
  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centred}>
          <Text style={styles.gateEmoji}>📷</Text>
          <Text style={styles.gateTitle}>Camera Permission Required</Text>
          <Text style={styles.gateText}>
            The camera is needed to scan OMR sheets and read student QR codes.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={requestPermission}>
            <Text style={styles.btnText}>Grant Camera Access</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const activeCorner = phase === 'countdown';
  const isProcessing = phase === 'capturing' || phase === 'submitting';

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>OMR Scanner</Text>
          <Text style={styles.headerSub}>{user?.username}  ·  {user?.center_id}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} activeOpacity={0.8}>
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {scanExpiry && (
          <CountdownTimer expiresAt={scanExpiry} onExpire={() => setWindowLocked(true)} />
        )}
        {windowLocked && (
          <View style={styles.lockedBanner}>
            <Text style={styles.lockedText}>Scanning window expired — no further submissions allowed.</Text>
          </View>
        )}

        {phase !== 'success' && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              {phase === 'camera'     ? 'Scan OMR Sheet'          :
               phase === 'countdown'  ? 'QR Detected — Hold Still' :
               phase === 'capturing'  ? 'Capturing…'              :
               phase === 'submitting' ? 'Submitting…'             :
                                        'Error'}
            </Text>
            {phase === 'camera' && (
              <Text style={styles.cardHint}>
                Fill the viewfinder with the OMR sheet so the QR code is visible. Detection is fully automatic.
              </Text>
            )}

            <View style={styles.cameraWrap}>
              <CameraView
                ref={cameraRef}
                style={StyleSheet.absoluteFill}
                facing="back"
                onBarcodeScanned={phase === 'camera' ? handleBarcode : undefined}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              />

              <View style={styles.guideOuter} pointerEvents="none">
                <View style={styles.guideBox}>
                  <View style={[styles.corner, styles.cornerTL, activeCorner && styles.cornerGreen]} />
                  <View style={[styles.corner, styles.cornerTR, activeCorner && styles.cornerGreen]} />
                  <View style={[styles.corner, styles.cornerBL, activeCorner && styles.cornerGreen]} />
                  <View style={[styles.corner, styles.cornerBR, activeCorner && styles.cornerGreen]} />
                </View>
              </View>

              <View style={styles.overlayBar} pointerEvents="none">
                {phase === 'camera' && (
                  <Text style={styles.overlayWaiting}>Searching for QR code…</Text>
                )}
                {phase === 'countdown' && (
                  <Text style={styles.overlayCountdown}>
                    Capturing in {countdownVal}s  ·  {studentId}
                  </Text>
                )}
                {isProcessing && (
                  <View style={styles.overlayProcessingRow}>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.overlayProcessingText}>
                      {phase === 'capturing' ? 'Capturing image…' : 'Submitting scan…'}
                    </Text>
                  </View>
                )}
                {phase === 'error' && (
                  <Text style={styles.overlayError}>{errorMsg}</Text>
                )}
              </View>
            </View>
          </View>
        )}

        {phase === 'success' && (
          <View style={[styles.card, styles.successCard]}>
            <Text style={styles.successCheck}>✓</Text>
            <Text style={styles.successTitle}>Submitted</Text>
            <Text style={styles.successStudent}>{studentId}</Text>
            {detectedAnswers && Object.keys(detectedAnswers).length > 0 && (
              <AnswersGrid answers={detectedAnswers} />
            )}
            <Text style={styles.successHint}>Ready for next student…</Text>
          </View>
        )}

        {scans.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Scans This Session  ({scans.length})</Text>
            {scans.map((s, i) => (
              <View key={i} style={styles.scanItem}>
                <View style={styles.scanRow}>
                  <Text style={styles.scanStudent}>Student: {s.student_id}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Verified</Text>
                  </View>
                </View>
                <Text style={styles.scanMono} numberOfLines={1}>{s.raw_data_string}</Text>
                <Text style={styles.scanMono}>Hash: {s.edge_hash?.slice(0, 14)}…</Text>
                {s.scanned_at && (
                  <Text style={styles.scanTime}>{new Date(s.scanned_at).toLocaleTimeString()}</Text>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f4f6' },

  header: {
    backgroundColor: '#1e40af', flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  headerSub:   { color: '#bfdbfe', fontSize: 12, marginTop: 2 },
  logoutBtn:   { backgroundColor: '#1d4ed8', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  logoutText:  { color: '#fff', fontSize: 13, fontWeight: '600' },

  scroll: { padding: 16, paddingBottom: 48 },

  timerBox:     { borderRadius: 16, padding: 14, alignItems: 'center', marginBottom: 12 },
  timerOk:      { backgroundColor: '#dcfce7' },
  timerLow:     { backgroundColor: '#ffedd5' },
  timerDone:    { backgroundColor: '#fee2e2' },
  timerLabel:   { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  timerVal:     { fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timerTxtOk:   { color: '#166534' },
  timerTxtLow:  { color: '#9a3412' },
  timerTxtDone: { color: '#991b1b' },

  lockedBanner: { backgroundColor: '#fee2e2', borderRadius: 12, padding: 14, marginBottom: 12 },
  lockedText:   { color: '#991b1b', fontWeight: '600', textAlign: 'center', fontSize: 13 },

  card: {
    backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 10, elevation: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  cardHint:  { fontSize: 12, color: '#6b7280', lineHeight: 18, marginBottom: 14 },

  cameraWrap: { height: 440, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000' },

  guideOuter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  guideBox:   { width: '85%', height: '88%', position: 'relative' },

  corner:      { position: 'absolute', width: 22, height: 22, borderColor: '#60a5fa', borderWidth: 3 },
  cornerGreen: { borderColor: '#4ade80' },
  cornerTL:    { top: 0,    left:  0, borderRightWidth: 0,  borderBottomWidth: 0 },
  cornerTR:    { top: 0,    right: 0, borderLeftWidth:  0,  borderBottomWidth: 0 },
  cornerBL:    { bottom: 0, left:  0, borderRightWidth: 0,  borderTopWidth:    0 },
  cornerBR:    { bottom: 0, right: 0, borderLeftWidth:  0,  borderTopWidth:    0 },

  overlayBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 10, alignItems: 'center',
  },
  overlayWaiting:       { color: '#fbbf24', fontSize: 13, fontWeight: '600' },
  overlayCountdown:     { color: '#4ade80', fontSize: 15, fontWeight: '800' },
  overlayProcessingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  overlayProcessingText:{ color: '#fff', fontSize: 13, fontWeight: '600' },
  overlayError:         { color: '#f87171', fontSize: 13, fontWeight: '600' },

  successCard:    { alignItems: 'center', paddingVertical: 32, backgroundColor: '#f0fdf4' },
  successCheck:   { fontSize: 56, color: '#16a34a', marginBottom: 6 },
  successTitle:   { fontSize: 26, fontWeight: '800', color: '#15803d', marginBottom: 4 },
  successStudent: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 16 },
  successHint:    { fontSize: 13, color: '#6b7280', marginTop: 12 },

  answersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 },
  answerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#dcfce7', borderWidth: 1, borderColor: '#86efac',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  answerChipQ:   { fontSize: 11, fontWeight: '700', color: '#6b7280' },
  answerChipVal: { fontSize: 15, fontWeight: '800', color: '#065f46' },

  scanItem: {
    borderWidth: 1, borderColor: '#d1fae5', borderRadius: 12,
    padding: 12, marginBottom: 10, backgroundColor: '#f0fdf4',
  },
  scanRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  scanStudent: { fontWeight: '600', color: '#111827', fontSize: 14 },
  badge:       { backgroundColor: '#d1fae5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText:   { color: '#065f46', fontSize: 11, fontWeight: '700' },
  scanMono:    { fontSize: 11, fontFamily: MONO, color: '#6b7280', marginTop: 2 },
  scanTime:    { fontSize: 11, color: '#9ca3af', marginTop: 4 },

  centred:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  gateEmoji:  { fontSize: 52, marginBottom: 16 },
  gateTitle:  { fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center', marginBottom: 8 },
  gateText:   { fontSize: 14, color: '#6b7280', textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  btn:        { backgroundColor: '#1d4ed8', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32 },
  btnText:    { color: '#fff', fontWeight: '700', fontSize: 16 },
});
