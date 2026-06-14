require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://vedvyas@localhost:5432/neet_omr',
});

const migrations = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL,
    center_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS login_requests (
    id SERIAL PRIMARY KEY,
    invigilator_id INTEGER REFERENCES users(id),
    center_id VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending',
    socket_id TEXT,
    requested_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS scan_sessions (
    id SERIAL PRIMARY KEY,
    invigilator_id INTEGER REFERENCES users(id),
    center_id VARCHAR(50),
    session_token TEXT,
    approved_at TIMESTAMP,
    scan_window_expires_at TIMESTAMP,
    session_expires_at TIMESTAMP,
    is_locked BOOLEAN DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS omr_records (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(100) NOT NULL,
    center_id VARCHAR(50),
    invigilator_id INTEGER REFERENCES users(id),
    edge_hash TEXT NOT NULL,
    raw_data_string TEXT NOT NULL,
    scanned_at TIMESTAMP DEFAULT NOW(),
    hub_hash TEXT,
    hub_processed_at TIMESTAMP,
    match_status VARCHAR(20) DEFAULT 'pending',
    flagged_reason TEXT
  );

  ALTER TABLE omr_records ADD COLUMN IF NOT EXISTS edge_signature TEXT;
  ALTER TABLE omr_records ADD COLUMN IF NOT EXISTS edge_confidence TEXT;
  ALTER TABLE omr_records ADD COLUMN IF NOT EXISTS hub_data_string TEXT;
  ALTER TABLE omr_records ADD COLUMN IF NOT EXISTS match_detail TEXT;

  CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    student_id VARCHAR(100),
    invigilator_id INTEGER REFERENCES users(id),
    center_id VARCHAR(50),
    edge_hash TEXT,
    hub_hash TEXT,
    mismatch_detail TEXT,
    flagged_at TIMESTAMP DEFAULT NOW()
  );
`;

async function seed() {
  const seedUsers = [
    { username: 'mod1',       password: 'mod123',  role: 'moderator',     center_id: 'CENTER-001' },
    { username: 'inv1',       password: 'inv123',  role: 'invigilator',   center_id: 'CENTER-001' },
    { username: 'inv2',       password: 'inv456',  role: 'invigilator',   center_id: 'CENTER-001' },
    { username: 'hub1',       password: 'hub123',  role: 'hub_operator',  center_id: null },
    { username: 'official1',  password: 'off123',  role: 'official',      center_id: null },
  ];

  for (const u of seedUsers) {
    const hash = await bcrypt.hash(u.password, 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, role, center_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING`,
      [u.username, hash, u.role, u.center_id]
    );
  }
  console.log('[DB] Seed complete');
}

async function initDb() {
  await pool.query(migrations);
  console.log('[DB] Migrations applied');
  await seed();
}

module.exports = { pool, initDb };
