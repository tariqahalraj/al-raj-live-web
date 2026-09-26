import ws from 'ws';

if (!globalThis.WebSocket) {
  globalThis.WebSocket = ws;
}
