import { io } from 'socket.io-client';
import { SOCKET_URL } from './config';
import { getToken } from './storage';

let socket = null;

export async function getSocket() {
  const token = await getToken();
  if (!socket || !socket.connected) {
    if (socket) socket.disconnect();
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: token ? { token } : {},
    });
  }
  return socket;
}

// Used during login, before a token exists
export function getSocketNoAuth() {
  if (!socket || !socket.connected) {
    if (socket) socket.disconnect();
    socket = io(SOCKET_URL, { transports: ['websocket'] });
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
