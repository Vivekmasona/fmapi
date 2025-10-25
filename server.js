import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();

// Root check
app.get("/", (req, res) => {
  res.send("🎧 Bihar FM Multi-Room Signaling Server (1 host + 3 listeners max)");
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Structure: { roomId: { host: ws, listeners: Map<id, ws> } }
const rooms = new Map();

// Helper to safely send data
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
    if (room.host?.readyState === room.host.OPEN) safeSend(room.host, { type: "ping" });
    for (const [, l] of room.listeners) {
      if (l.readyState === l.OPEN) safeSend(l, { type: "ping" });
    }
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
    } catch {
      return;
    }

    const { type, role, room: roomId, target, payload } = msg;

    // --- Register ---
    if (type === "register") {
      ws.role = role;
      ws.roomId = roomId;

      if (!rooms.has(roomId))
        rooms.set(roomId, { host: null, listeners: new Map() });

      const room = rooms.get(roomId);

      // --- Host registration ---
      if (role === "host") {
        if (room.host) {
          return safeSend(ws, {
            type: "error",
            message: "Room already has a host.",
          });
        }

        room.host = ws;
        safeSend(ws, { type: "registered", role: "host", room: roomId });

        // 🔁 Auto re-offer for already waiting listeners
        for (const [id, lws] of room.listeners) {
          safeSend(ws, { type: "listener-joined", id });
          safeSend(lws, {
            type: "reoffer",
            message: "Host joined, please reconnect stream",
          });
        }

        console.log(`🎙️ Host joined room: ${roomId}`);
      }

      // --- Listener registration ---
      else if (role === "listener") {
        if (room.listeners.size >= 3) {
          return safeSend(ws, {
            type: "error",
            message: "Room full (max 3 listeners).",
          });
        }

        room.listeners.set(ws.id, ws);
        safeSend(ws, { type: "registered", role: "listener", room: roomId });

        if (room.host) {
          // Notify host
          safeSend(room.host, { type: "listener-joined", id: ws.id });
          console.log(`👂 Listener joined room ${roomId} (connected to host)`);
        } else {
          safeSend(ws, { type: "waiting", message: "Waiting for host..." });
          console.log(`⏳ Listener waiting in room: ${roomId}`);
        }
      }
      return;
    }

    // --- Signaling (offer/answer/candidate) ---
    if (["offer", "answer", "candidate"].includes(type)) {
      const room = rooms.get(ws.roomId);
      if (!room) return;

      if (ws.role === "host" && target && room.listeners.has(target)) {
        safeSend(room.listeners.get(target), { type, from: ws.id, payload });
      } else if (ws.role === "listener" && room.host) {
        safeSend(room.host, { type, from: ws.id, payload });
      }
      return;
    }

    // --- Metadata (song info) ---
    if (type === "metadata" && ws.role === "host") {
      const room = rooms.get(ws.roomId);
      if (!room) return;

      for (const [, l] of room.listeners) {
        safeSend(l, {
          type: "metadata",
          title: payload.title,
          artist: payload.artist,
          cover: payload.cover,
        });
      }
    }
  });

  // --- Handle close ---
  ws.on("close", () => {
    const { roomId, role } = ws;
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);

    if (role === "host") {
      for (const [, l] of room.listeners) {
        safeSend(l, { type: "host-left" });
      }
      rooms.delete(roomId);
      console.log(`❌ Host disconnected, room deleted: ${roomId}`);
    } else if (role === "listener") {
      room.listeners.delete(ws.id);
      if (room.host) {
        safeSend(room.host, { type: "listener-left", id: ws.id });
      }
      console.log(`👋 Listener left: ${ws.id}`);
    }
  });

  ws.on("error", (err) => console.error("WebSocket error:", err.message));
});

// --- Server timeouts ---
server.keepAliveTimeout = 70000;
server.headersTimeout = 75000;

// --- Start ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`✅ Bihar FM Room Server running on port ${PORT}`)
);
