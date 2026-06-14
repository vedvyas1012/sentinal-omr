require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

const { initDb } = require('./db');
const { initSocket } = require('./socket');

const authRoutes = require('./routes/auth');
const scanRoutes = require('./routes/scan');
const hubRoutes = require('./routes/hub');
const dashboardRoutes = require('./routes/dashboard');
const templateRoutes = require('./routes/template');

const app = express();
const server = http.createServer(app);

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[FATAL] JWT_SECRET env var is not set. Refusing to start in production without it.');
  process.exit(1);
}
if (!process.env.JWT_SECRET) {
  console.warn('[Security] JWT_SECRET not set — using insecure default. Set it before deploying.');
}

const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true,
  },
});

app.set('io', io);
initSocket(io);

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? false
    : (origin, cb) => cb(null, true),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api/auth', authRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/hub', hubRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/omr-sheet', templateRoutes);

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3001;

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`[Server] Listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[DB] Failed to initialize:', err.message);
    process.exit(1);
  });
