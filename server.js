const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();

// Root route check
app.get("/", (req, res) => {
  res.send("🎧 Bihar FM Room-based WebRTC Signaling Server is Live!");
});

// HTTP + WS server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Rooms: { roomId: { host: ws, listeners: Map<id, ws> } }
const rooms = new Map();

// Safe send helper
function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {
      console.error("Send error:", e.message);
    }
  }
}

// Keep connections alive
setInterval(() => {
  for (const [, room] of rooms) {
    if (room.host && room.host.readyState === room.host.OPEN) safeSend(room.host, { type: "ping" });
    for (const [, l] of room.listeners) if (l.readyState === l.OPEN) safeSend(l, { type: "ping" });
  }
}, 25000);

// Handle WS connections
wss.on("connection", (ws) => {
  ws.id = crypto.randomUUID();
  ws.roomId = null;
  ws.role = null;
  console.log("🔗 Connected:", ws.id);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch { return; }

    const { type, role, room: roomId, target, payload } = msg;

    // --- Register host/listener ---
    if (type === "register") {
      ws.role = role;
      ws.roomId = roomId;

      if (!rooms.has(roomId)) rooms.set(roomId, { host: null, listeners: new Map() });
      const room = rooms.get(roomId);

      if (role === "host") {
        if (room.host) return safeSend(ws, { type:"error", message:"Room already has a host" });
        room.host = ws;
        safeSend(ws, { type:"registered", role:"host", room: roomId });
      } else if (role === "listener") {
        if (!room.host) return safeSend(ws, { type:"error", message:"No host in room yet" });
        if (room.listeners.size >= 3) return safeSend(ws, { type:"error", message:"Room full" });
        room.listeners.set(ws.id, ws);
        safeSend(ws, { type:"registered", role:"listener", room: roomId });
        // Notify host that listener joined
        safeSend(room.host, { type:"listener-joined", id: ws.id });
      }
      return;
    }

    // --- Signaling relay (offer/answer/candidate) ---
    if (["offer","answer","candidate"].includes(type)) {
      const room = rooms.get(ws.roomId);
      if (!room) return;

      if (ws.role === "host" && target && room.listeners.has(target)) {
        safeSend(room.listeners.get(target), { type, from: ws.id, payload });
      } else if (ws.role === "listener" && room.host) {
        safeSend(room.host, { type, from: ws.id, payload });
      }
      return;
    }

    // --- Metadata relay ---
    if (type === "metadata") {
      const room = rooms.get(ws.roomId);
      if (!room) return;
      // Only host sends metadata to listeners
      if (ws.role === "host") {
        for (const [, l] of room.listeners) {
          safeSend(l, { type:"metadata", title: payload.title, artist: payload.artist, cover: payload.cover });
        }
      }
      return;
    }
  });

  ws.on("close", () => {
    const { roomId, role } = ws;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    if (role === "host") {
      // Notify all listeners
      for (const [, l] of room.listeners) safeSend(l, { type:"host-left" });
      rooms.delete(roomId);
      console.log(`❌ Host disconnected, room deleted: ${roomId}`);
    } else if (role === "listener") {
      room.listeners.delete(ws.id);
      if (room.host) safeSend(room.host, { type:"listener-left", id: ws.id });
      console.log(`❌ Listener disconnected: ${ws.id}`);
    }
  });

  ws.on("error", (err) => console.error("WebSocket error:", err.message));
});

// Keep-alive & headers timeout
server.keepAliveTimeout = 70000;
server.headersTimeout = 75000;

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Bihar FM Room Server running on port ${PORT}`));
