const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./auth/middleware');

const ALLOWED_ROOMS = {
  invigilator:  (p) => [`user_${p.id}`],
  moderator:    (p) => [`center_${p.center_id}`],
  hub_operator: ()  => [],
  official:     ()  => [],
};

function initSocket(io) {
  // socketId → granted room for the pre-auth invigilator login flow; consumed once.
  io._pendingSocketRooms = new Map();

  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on('join_room', ({ room }) => {
      if (!room) return;

      const validPrefixes = ['user_', 'center_'];
      if (!validPrefixes.some(p => room.startsWith(p))) {
        console.warn(`[Socket] ${socket.id} tried to join invalid room: ${room}`);
        return;
      }

      // Native clients send a Bearer JWT in handshake.auth; web clients carry it
      // as an httpOnly cookie. Fall back to the one-time grant for the login flow.
      let tokenToVerify =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token ||
        null;
      if (!tokenToVerify) {
        const match = (socket.handshake.headers.cookie || '').match(/(?:^|;\s*)token=([^;]+)/);
        if (match) tokenToVerify = decodeURIComponent(match[1]);
      }

      if (tokenToVerify) {
        let payload;
        try {
          payload = jwt.verify(tokenToVerify, JWT_SECRET);
        } catch {
          console.warn(`[Socket] ${socket.id} join_room rejected: invalid token`);
          return;
        }
        const allowed = ALLOWED_ROOMS[payload.role]?.(payload) ?? [];
        if (!allowed.includes(room)) {
          console.warn(`[Socket] ${socket.id} (${payload.role}) not permitted to join ${room}`);
          return;
        }
      } else {
        const granted = io._pendingSocketRooms.get(socket.id);
        if (granted !== room) {
          console.warn(`[Socket] ${socket.id} tried to join ${room} without a server grant`);
          return;
        }
        io._pendingSocketRooms.delete(socket.id);
      }

      socket.join(room);
      console.log(`[Socket] ${socket.id} joined room: ${room}`);
    });

    socket.on('disconnect', () => {
      io._pendingSocketRooms.delete(socket.id);
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = { initSocket };
