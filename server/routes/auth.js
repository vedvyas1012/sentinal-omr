const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db');
const { authenticate, requireRole, JWT_SECRET } = require('../auth/middleware');

const router = express.Router();

function catchAsync(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function issueToken(user, expiresIn) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, center_id: user.center_id },
    JWT_SECRET,
    { expiresIn }
  );
}

function setCookie(res, token, maxAgeSec) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: maxAgeSec * 1000,
  });
}

// Direct login for moderator / hub_operator / official
// (invigilators must use the moderator-approval flow below)
router.post(
  '/login',
  [body('username').trim().notEmpty(), body('password').notEmpty()],
  catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { username, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    if (user.role === 'invigilator') {
      return res.status(403).json({
        success: false,
        error: 'Invigilators must use the moderator-approval flow',
      });
    }

    const token = issueToken(user, '8h');
    setCookie(res, token, 8 * 3600);
    res.json({ success: true, data: { role: user.role, username: user.username, center_id: user.center_id } });
  })
);

// Invigilator requests moderator approval; socketId lets the server target this client
router.post(
  '/request-login',
  [body('username').trim().notEmpty(), body('password').notEmpty()],
  catchAsync(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { username, password, socketId } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user || user.role !== 'invigilator') {
      return res.status(401).json({ success: false, error: 'Invalid credentials or not an invigilator' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ success: false, error: 'Invalid credentials' });

    await pool.query(
      `UPDATE login_requests SET status = 'denied', resolved_at = NOW()
       WHERE invigilator_id = $1 AND status = 'pending'`,
      [user.id]
    );

    const { rows: reqRows } = await pool.query(
      `INSERT INTO login_requests (invigilator_id, center_id, socket_id) VALUES ($1, $2, $3) RETURNING id`,
      [user.id, user.center_id, socketId || null]
    );

    const requestId = reqRows[0].id;

    const io = req.app.get('io');

    // One-time grant so only this socket may join user_<id>; prevents another
    // browser from joining that room and intercepting the login_approved event.
    if (socketId && io._pendingSocketRooms) {
      io._pendingSocketRooms.set(socketId, `user_${user.id}`);
    }

    io.to(`center_${user.center_id}`).emit('login_request', {
      requestId,
      invigilatorId: user.id,
      username: user.username,
      centerId: user.center_id,
    });

    res.json({ success: true, data: { requestId, userId: user.id, message: 'Approval request sent to moderator' } });
  })
);

// Moderator resolves an approval request
router.post(
  '/resolve-login/:requestId',
  requireRole('moderator'),
  catchAsync(async (req, res) => {
    const { requestId } = req.params;
    const { action } = req.body;

    if (!['approve', 'deny'].includes(action)) {
      return res.status(400).json({ success: false, error: 'action must be approve or deny' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'denied';

    const result = await pool.query(
      `UPDATE login_requests
       SET status = $1, resolved_at = NOW()
       WHERE id = $2 AND status = 'pending'
       RETURNING invigilator_id, center_id`,
      [newStatus, requestId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'Request not found or already resolved' });
    }

    const { invigilator_id, center_id } = result.rows[0];
    const io = req.app.get('io');

    if (action === 'approve') {
      io.to(`user_${invigilator_id}`).emit('login_approved', { requestId });
    } else {
      io.to(`user_${invigilator_id}`).emit('login_denied', { requestId });
    }

    io.to(`center_${center_id}`).emit('request_resolved', { requestId });

    res.json({ success: true, data: { status: newStatus } });
  })
);

// Invigilator claims their JWT after moderator approval
router.get(
  '/claim-token',
  catchAsync(async (req, res) => {
    const { requestId } = req.query;
    if (!requestId) return res.status(400).json({ success: false, error: 'requestId required' });

    // Atomic approved → claimed flip so two concurrent claims can't both succeed.
    const claimed = await pool.query(
      `UPDATE login_requests SET status = 'claimed'
       WHERE id = $1 AND status = 'approved'
       RETURNING invigilator_id, center_id`,
      [requestId]
    );

    if (!claimed.rows.length) {
      return res.status(403).json({ success: false, error: 'Request not approved or already claimed' });
    }

    const { invigilator_id, center_id } = claimed.rows[0];

    const { rows: userRows } = await pool.query(
      'SELECT id, username, role, center_id FROM users WHERE id = $1',
      [invigilator_id]
    );
    if (!userRows.length) {
      return res.status(500).json({ success: false, error: 'User not found' });
    }
    const user = { user_id: userRows[0].id, ...userRows[0] };

    const scanExpiry = new Date(Date.now() + 20 * 60 * 1000);
    const sessionExpiry = new Date(Date.now() + 30 * 60 * 1000);
    await pool.query(
      `INSERT INTO scan_sessions (invigilator_id, center_id, approved_at, scan_window_expires_at, session_expires_at)
       VALUES ($1, $2, NOW(), $3, $4)`,
      [user.user_id, user.center_id, scanExpiry, sessionExpiry]
    );

    const token = jwt.sign(
      { id: user.user_id, username: user.username, role: user.role, center_id: user.center_id },
      JWT_SECRET,
      { expiresIn: '30m' }
    );

    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 60 * 1000 });

    const responseData = { username: user.username, role: user.role, center_id: user.center_id };
    // Native clients can't receive httpOnly cookies — return the token in the body
    if (req.query.platform === 'native') responseData.token = token;

    res.json({ success: true, data: responseData });
  })
);

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, data: { message: 'Logged out' } });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ success: true, data: req.user });
});

// Pending requests for the moderator's center (loaded on panel mount)
router.get(
  '/pending-requests',
  requireRole('moderator'),
  catchAsync(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT lr.id as "requestId", u.username, lr.center_id as "centerId", u.id as "invigilatorId"
       FROM login_requests lr
       JOIN users u ON u.id = lr.invigilator_id
       WHERE lr.center_id = $1 AND lr.status = 'pending'
       ORDER BY lr.requested_at ASC`,
      [req.user.center_id]
    );
    res.json({ success: true, data: rows });
  })
);

module.exports = router;
