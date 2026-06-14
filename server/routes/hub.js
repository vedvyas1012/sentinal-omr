const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireRole } = require('../auth/middleware');
const { analyzeGridDetailed } = require('../omr/gridAnalyzer');
const { decodeStudentQR } = require('../omr/qrDecode');
const { buildDataString, hashDataString, parseDataString } = require('../omr/dataString');
const { verifyData } = require('../crypto/signing');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// A divergence only counts as tampering when BOTH sides read the bubble
// confidently; below this, the difference is treated as ambiguous (OCR noise).
const CONF_MIN = 0.35;

function catchAsync(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Machine auth for the scan agent: Authorization: Bearer <HUB_API_KEY>
function requireApiKey(req, res, next) {
  const apiKey = process.env.HUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ success: false, error: 'HUB_API_KEY not configured on server' });
  }
  const provided =
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim() ||
    (req.headers['x-api-key'] || '').trim();
  if (!provided || provided !== apiKey) {
    return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
  }
  next();
}

// Classify a hub scan against the signed edge record.
// Outcome is one of: matched | flagged | review
function classify(record, hubAnswers, hubConfidence) {
  // 1. Cryptographic integrity: the stored edge record must carry a valid
  //    signature from the issuing authority. An invalid signature means the
  //    record was altered in the database after the scan.
  const sigValid = record.edge_signature
    ? verifyData(record.raw_data_string, record.edge_signature)
    : null; // null = legacy unsigned record

  if (sigValid === false) {
    return { status: 'flagged', detail: 'Edge record signature invalid — record altered after scan', hardDiffs: [], ambiguousDiffs: [] };
  }

  // 2. Answer-level comparison with confidence gating.
  const { answers: edgeAnswers } = parseDataString(record.raw_data_string);
  let edgeConf = {};
  try { edgeConf = record.edge_confidence ? JSON.parse(record.edge_confidence) : {}; } catch { edgeConf = {}; }

  const hardDiffs = [];
  const ambiguousDiffs = [];
  for (const q of Object.keys(edgeAnswers)) {
    const e = edgeAnswers[q];
    const h = hubAnswers[q];
    if (e === h) continue;
    const ec = edgeConf[q] ?? 1;
    const hc = hubConfidence[q] ?? 1;
    const diff = { q, edge: e, hub: h };
    if (ec >= CONF_MIN && hc >= CONF_MIN) hardDiffs.push(diff);
    else ambiguousDiffs.push(diff);
  }

  const fmt = (list) => list.map(d => `${d.q}(edge ${d.edge}/hub ${d.hub})`).join(', ');
  const legacyNote = sigValid === null ? ' [legacy unsigned record]' : '';

  if (hardDiffs.length) {
    return { status: 'flagged', detail: `Tampering suspected: ${fmt(hardDiffs)}${legacyNote}`, hardDiffs, ambiguousDiffs };
  }
  if (ambiguousDiffs.length) {
    return { status: 'review', detail: `Low-confidence divergence — manual review: ${fmt(ambiguousDiffs)}${legacyNote}`, hardDiffs, ambiguousDiffs };
  }
  return { status: 'matched', detail: `Verified${legacyNote}`, hardDiffs, ambiguousDiffs };
}

// The scan agent uploads the scanned sheet image; the server reads the student
// ID from the QR, runs the SAME grid analysis as the edge scan, verifies the
// edge signature, and compares answers with confidence gating.
router.post(
  '/verify-image',
  requireApiKey,
  upload.single('sheetImage'),
  catchAsync(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'sheetImage file is required' });
    }

    let studentId = (req.body.studentId || '').trim();
    if (!studentId) studentId = await decodeStudentQR(req.file.buffer);
    if (!studentId) {
      return res.status(422).json({
        success: false,
        error: 'Could not read student QR from the image, and no studentId was provided',
      });
    }

    const { answers: hubAnswers, confidence: hubConfidence } = await analyzeGridDetailed(req.file.buffer);
    const hubDataString = buildDataString(studentId, hubAnswers);
    const hubHash = hashDataString(hubDataString);

    const { rows } = await pool.query(
      `SELECT * FROM omr_records WHERE student_id = $1 ORDER BY scanned_at DESC LIMIT 1`,
      [studentId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, error: `No edge record found for student ${studentId}` });
    }
    const record = rows[0];

    const { status, detail, hardDiffs, ambiguousDiffs } = classify(record, hubAnswers, hubConfidence);

    await pool.query(
      `UPDATE omr_records
         SET hub_hash = $1, hub_data_string = $2, hub_processed_at = NOW(),
             match_status = $3, match_detail = $4,
             flagged_reason = $5
       WHERE id = $6`,
      [hubHash, hubDataString, status, detail, status === 'flagged' ? detail : null, record.id]
    );

    if (status === 'flagged') {
      await pool.query(
        `INSERT INTO audit_log (student_id, invigilator_id, center_id, edge_hash, hub_hash, mismatch_detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.student_id, record.invigilator_id, record.center_id, record.edge_hash, hubHash, detail]
      );
      console.log(`[FLAGGED] Student ${studentId} | Center ${record.center_id} | ${detail}`);
    }

    const result = status === 'matched' ? 'MATCHED' : status === 'review' ? 'REVIEW' : 'FLAGGED';
    return res.json({
      success: true,
      data: {
        result,
        studentId,
        edgeHash: record.edge_hash,
        hubHash,
        signatureValid: record.edge_signature ? verifyData(record.raw_data_string, record.edge_signature) : null,
        diffs: [...hardDiffs, ...ambiguousDiffs],
        detail,
        detectedAnswers: hubAnswers,
        message: detail,
      },
    });
  })
);

// Read-only monitoring endpoints for the hub_operator web panel
router.get(
  '/records',
  requireRole('hub_operator'),
  catchAsync(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT student_id, center_id, edge_hash, hub_hash, match_status, match_detail, hub_processed_at
       FROM omr_records WHERE hub_hash IS NOT NULL ORDER BY hub_processed_at DESC`
    );
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/stats',
  requireRole('hub_operator'),
  catchAsync(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE hub_hash IS NOT NULL)     AS processed,
         COUNT(*) FILTER (WHERE match_status = 'matched') AS matched,
         COUNT(*) FILTER (WHERE match_status = 'flagged') AS flagged,
         COUNT(*) FILTER (WHERE match_status = 'review')  AS review,
         COUNT(*) FILTER (WHERE match_status = 'pending') AS pending
       FROM omr_records`
    );
    res.json({ success: true, data: rows[0] });
  })
);

module.exports = router;
