import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { randomUUID } from 'node:crypto';

// ------------ Config ------------
const PORT = parseInt(process.env.PORT || '8080', 10);
const HEARTBEAT_INTERVAL_MS = parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10);

// ------------ Utilities ------------
function safeParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: 'Invalid JSON' };
  }
}

function sendJson(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (_) {
    // ignore
  }
}

function broadcastExcept(sender, clients, messageBuffer) {
  for (const client of clients) {
    if (client.readyState === 1 && client !== sender) {
      client.send(messageBuffer);
    }
  }
}

// ------------ Heartbeat ------------
function setupHeartbeat(wss) {
  function noop() {}

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping(noop);
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(interval));
}

// ------------ Server ------------
function start() {
  const httpServer = createServer((req, res) => {
    // Простой health-check
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    ws.id = randomUUID();

    // Приветствие/handshake
    sendJson(ws, {
      type: 'welcome',
      clientId: ws.id,
      clients: wss.clients.size
    });

    // Сообщим остальным, что кто-то подключился (без спама себе)
    const joinMsg = JSON.stringify({ type: 'join', clientId: ws.id, clients: wss.clients.size });
    broadcastExcept(ws, wss.clients, joinMsg);

    ws.on('message', (data, isBinary) => {
      // Теперь поддерживаем только бинарные сообщения и просто ретранслируем байты
      if (!isBinary && !(data instanceof Buffer)) {
        return sendJson(ws, { type: 'error', error: 'Only binary messages are supported' });
      }

      const buffer = data instanceof Buffer ? data : Buffer.from(data);

      // Рассылка всем кроме отправителя без какого‑либо изменения полезной нагрузки
      broadcastExcept(ws, wss.clients, buffer);
    });

    ws.on('close', () => {
      const leaveMsg = JSON.stringify({ type: 'leave', clientId: ws.id, clients: wss.clients.size });
      for (const client of wss.clients) {
        if (client.readyState === 1) client.send(leaveMsg);
      }
    });
  });

  setupHeartbeat(wss);

  httpServer.listen(PORT, () => {
    console.log(`WS broker listening on :${PORT}`);
    console.log(`Health: http://0.0.0.0:${PORT}/healthz`);
  });
}

start();

