// ✅ Bihar FM WebRTC Signaling + Room Manager
// Compatible with Node.js v20+ and CommonJS (no ESM import issues)

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();

// Root route (to test Render deployment)
app.get("/", (req, res) => {
  res.send("🎧 Bihar FM WebRTC Signaling Server is Live and Ready!");
});

// HTTP + WS server setup
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// All connected clients { id -> { ws, role, room } }
const clients = new Map();

function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch (err) {
      console.error("❌ Send error:", err.message);
    }
  }
}

// 💓 Keep connection alive (for Render/Railway)
setInterval(() => {
  for (const [, c] of clients)
    if (c.ws.readyState === c.ws.OPEN)
      safeSend(c.ws, { type: "ping" });
}, 25000);

// 🛰 WebSocket Events
wss.on("connection", (ws, req) => {
  const id = crypto.randomUUID();
  clients.set(id, { ws, role: null, room: null });
  console.log("🔗 New connection:", id);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const { type, role, room, target, payload } = msg;

    // 🧭 Registration
    if (type === "register") {
      clients.get(id).role = role;
      clients.get(id).room = room;
      console.log(`🧩 ${id} joined room ${room} as ${role}`);

      // Notify others in room
      broadcastToRoom(room, {
        type: "user-joined",
        id,
        role,
        users: listRoomUsers(room),
      });
      return;
    }

    // 💬 Signaling: Offer/Answer/Candidate
    if (["offer", "answer", "candidate"].includes(type) && target) {
      const t = clients.get(target);
      if (t) safeSend(t.ws, { type, from: id, payload });
      return;
    }

    // 🎵 Metadata updates (title, time sync, etc.)
    if (type === "metadata") {
      const roomUsers = getRoomClients(clients.get(id).room);
      for (const u of roomUsers)
        if (u.role === "listener")
          safeSend(u.ws, { type: "metadata", payload });
      return;
    }
  });

  ws.on("close", () => {
    const c = clients.get(id);
    if (!c) return;
    const { room, role } = c;
    clients.delete(id);
    console.log(`❌ ${role || "client"} left room ${room || "none"} (${id})`);

    // Notify others in room
    broadcastToRoom(room, {
      type: "user-left",
      id,
      users: listRoomUsers(room),
    });
  });

  ws.on("error", (err) => console.error("⚠️ WS Error:", err.message));
});

// 🔄 Utility functions
function broadcastToRoom(room, data) {
  if (!room) return;
  for (const [, c] of clients)
    if (c.room === room && c.ws.readyState === c.ws.OPEN)
      safeSend(c.ws, data);
}

function listRoomUsers(room) {
  const arr = [];
  for (const [id, c] of clients)
    if (c.room === room)
      arr.push({ id, role: c.role });
  return arr;
}

function getRoomClients(room) {
  const arr = [];
  for (const [, c] of clients)
    if (c.room === room)
      arr.push(c);
  return arr;
}

// 🔧 Keep alive timeout config
server.keepAliveTimeout = 70000;
server.headersTimeout = 75000;

// 🚀 Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`✅ Bihar FM Server running on port ${PORT}`)
);
