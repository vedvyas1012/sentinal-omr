const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireRole } = require('../auth/middleware');
const { buildEdgeRecord } = require('../omr/pipeline');
const { analyzeGridDetailed } = require('../omr/gridAnalyzer');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// A question read below this confidence is treated as unreliable.
const CONF_MIN = 0.35;
// Reject an auto-detected sheet if more than this many reads are unreliable.
const MAX_LOW_CONF = 3;

function catchAsync(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Detect answers from an image without persisting (preview step)
router.post(
  '/analyze-omr',
  [
    ...requireRole('invigilator'),
    upload.single('omrImage'),
  ],
  catchAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'omrImage is required' });
    const { answers, confidence } = await analyzeGridDetailed(req.file.buffer);
    res.json({ success: true, data: { answers, confidence } });
  })
);

// Submit a scan; answers are auto-detected from the image if not provided
router.post(
  '/submit',
  [
    ...requireRole('invigilator'),
    upload.single('omrImage'),
  ],
  catchAsync(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: 'OMR image file required' });

    const { studentId, answers: answersRaw } = req.body;
    if (!studentId) return res.status(400).json({ success: false, error: 'studentId is required' });

    let provided;
    try {
      provided = answersRaw ? (typeof answersRaw === 'string' ? JSON.parse(answersRaw) : answersRaw) : null;
    } catch {
      provided = null;
    }

    // Always analyze to capture per-question confidence (stored for hub comparison).
    const { answers: detected, confidence } = await analyzeGridDetailed(req.file.buffer);
    const answers = (provided && typeof provided === 'object' && Object.keys(provided).length)
      ? provided
      : detected;

    // Quality gate: reject an auto-detected sheet that is too unreadable to trust.
    if (!provided) {
      const lowCount = Object.values(confidence).filter(c => c < CONF_MIN).length;
      if (lowCount > MAX_LOW_CONF) {
        return res.status(422).json({
          success: false,
          error: `Sheet is too unclear to read reliably (${lowCount} ambiguous answers). Please rescan.`,
        });
      }
    }

    const { rows: sessions } = await pool.query(
      `SELECT * FROM scan_sessions
       WHERE invigilator_id = $1 AND is_locked = FALSE
       ORDER BY approved_at DESC LIMIT 1`,
      [req.user.id]
    );

    if (!sessions.length) {
      return res.status(403).json({ success: false, error: 'No active scan session found' });
    }

    const session = sessions[0];
    if (new Date() > new Date(session.scan_window_expires_at)) {
      await pool.query(`UPDATE scan_sessions SET is_locked = TRUE WHERE id = $1`, [session.id]);
      return res.status(403).json({ success: false, error: 'Scan window has expired' });
    }

    const { dataString, edgeHash, signature } = buildEdgeRecord(studentId, answers);

    await pool.query(
      `INSERT INTO omr_records
         (student_id, center_id, invigilator_id, edge_hash, raw_data_string, edge_signature, edge_confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [studentId, req.user.center_id, req.user.id, edgeHash, dataString, signature, JSON.stringify(confidence)]
    );

    res.json({
      success: true,
      data: { studentId, dataString, edgeHash, answers, message: 'OMR scan recorded successfully' },
    });
  })
);

router.get(
  '/session-info',
  requireRole('invigilator'),
  catchAsync(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT scan_window_expires_at, session_expires_at, is_locked
       FROM scan_sessions WHERE invigilator_id = $1 ORDER BY approved_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'No active session' });
    res.json({ success: true, data: rows[0] });
  })
);

router.get(
  '/my-scans',
  requireRole('invigilator'),
  catchAsync(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT student_id, edge_hash, raw_data_string, scanned_at, match_status
       FROM omr_records WHERE invigilator_id = $1 ORDER BY scanned_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  })
);

module.exports = router;
