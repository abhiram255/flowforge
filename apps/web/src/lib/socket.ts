import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null

/**
 * One socket per browser session. `auth` is refreshed on reconnect so a rotated
 * access token is always used for the next handshake.
 */
export function connectSocket(token: string): Socket {
  if (socket) {
    socket.auth = { token }
    if (!socket.connected) socket.connect()
    return socket
  }
  socket = io({
    path: '/socket.io',
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
  })
  return socket
}

export function getSocket(): Socket | null {
  return socket
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}
