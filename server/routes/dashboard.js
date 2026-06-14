const express = require('express');
const { pool } = require('../db');
const { requireRole } = require('../auth/middleware');
const { getPublicKey } = require('../crypto/signing');

const router = express.Router();

function catchAsync(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// Public signing key so an official can verify edge-record signatures
// independently, without trusting the database.
router.get('/public-key', requireRole('official'), (req, res) => {
  res.json({ success: true, data: { algorithm: 'ed25519', publicKey: getPublicKey() } });
});

router.get(
  '/flagged',
  requireRole('official'),
  catchAsync(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT al.*, u.username AS invigilator_name
       FROM audit_log al
       LEFT JOIN users u ON al.invigilator_id = u.id
       ORDER BY al.flagged_at DESC`
    );
    res.json({ success: true, data: { records: rows, total: rows.length } });
  })
);

router.get(
  '/stats',
  requireRole('official'),
  catchAsync(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT
         COUNT(*)                                          AS total,
         COUNT(*) FILTER (WHERE match_status = 'flagged') AS flagged,
         COUNT(*) FILTER (WHERE match_status = 'matched') AS matched,
         COUNT(*) FILTER (WHERE match_status = 'review')  AS review,
         COUNT(*) FILTER (WHERE match_status = 'pending') AS pending
       FROM omr_records`
    );
    const r = rows[0];
    res.json({
      success: true,
      data: {
        total:   parseInt(r.total),
        flagged: parseInt(r.flagged),
        matched: parseInt(r.matched),
        review:  parseInt(r.review),
        pending: parseInt(r.pending),
      },
    });
  })
);

module.exports = router;
