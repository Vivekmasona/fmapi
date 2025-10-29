// server.js — Bihar FM WebRTC Signaling + Metadata Relay (Render Compatible)
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();

// Root route check
app.get("/", (req, res) => {
  res.send("🎧 Bihar FM WebRTC Signaling Server is Live and Ready!");
});

// HTTP + WS server
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Connected clients
const clients = new Map(); // id -> { ws, role }

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
  for (const [, c] of clients)
    if (c.ws.readyState === c.ws.OPEN)
      safeSend(c.ws, { type: "ping" });
}, 25000);

// WebSocket handling
wss.on("connection", (ws) => {
  const id = crypto.randomUUID();
  clients.set(id, { ws, role: null });
  console.log("🔗 Connected:", id);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const { type, role, target, payload } = msg;

    // Register role
    if (type === "register") {
      clients.get(id).role = role;
      console.log(`🧩 ${id} registered as ${role}`);

      if (role === "listener") {
        for (const [, c] of clients)
          if (c.role === "broadcaster")
            safeSend(c.ws, { type: "listener-joined", id });
      }
      return;
    }

    // Relay signaling
    if (["offer", "answer", "candidate"].includes(type) && target) {
      const t = clients.get(target);
      if (t) safeSend(t.ws, { type, from: id, payload });
      return;
    }

    // Broadcast metadata
    if (type === "metadata") {
      console.log(`🎵 Metadata update: ${payload?.title || "Unknown title"}`);
      for (const [, c] of clients)
        if (c.role === "listener")
          safeSend(c.ws, {
            type: "metadata",
            title: payload.title,
            artist: payload.artist,
            cover: payload.cover,
          });
      return;
    }
  });

  ws.on("close", () => {
    const role = clients.get(id)?.role;
    clients.delete(id);
    console.log(`❌ ${role || "client"} disconnected: ${id}`);

    if (role === "listener") {
      for (const [, c] of clients)
        if (c.role === "broadcaster")
          safeSend(c.ws, { type: "peer-left", id });
    }
  });

  ws.on("error", (err) => console.error("WebSocket error:", err.message));
});

// Keep-alive and headers timeout
server.keepAliveTimeout = 70000;
server.headersTimeout = 75000;

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`✅ Bihar FM Server running on port ${PORT}`)
);
