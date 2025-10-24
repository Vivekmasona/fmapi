import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // roomId => { broadcasterId, listeners: Map<id, ws> }

app.get("/", (req, res) => {
  res.send("🎧 FM Room WS Server running");
});

wss.on("connection", (ws) => {
  const id = crypto.randomUUID();
  let role = null;
  let roomId = null;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);

      // --- Register role + room ---
      if (msg.type === "register") {
        role = msg.role;
        roomId = msg.room || "default";
        if (!rooms.has(roomId)) rooms.set(roomId, { broadcasterId: null, listeners: new Map() });

        const room = rooms.get(roomId);
        if (role === "broadcaster") {
          room.broadcasterId = id;

          // Notify broadcaster about already ready listeners
          for (const [lId, lWs] of room.listeners) {
            if (room.listeners.has(lId)) {
              ws.send(JSON.stringify({ type: "listener-ready", id: lId }));
            }
          }
        } else if (role === "listener") {
          room.listeners.set(id, ws);

          // Notify broadcaster if already online
          if (room.broadcasterId) {
            const bWs = wss.clientsArray?.find(c => c.id === room.broadcasterId) || null;
            if (bWs && bWs.readyState === 1) {
              bWs.send(JSON.stringify({ type: "listener-joined", id }));
            }
          }
        }
        return;
      }

      // --- Forward signaling messages ---
      if (["offer", "answer", "candidate"].includes(msg.type)) {
        const room = rooms.get(roomId);
        if (!room) return;

        let targetWs = null;
        if (msg.target) {
          if (msg.type === "offer" || msg.type === "answer" || msg.type === "candidate") {
            if (room.listeners.has(msg.target)) targetWs = room.listeners.get(msg.target);
            else if (room.broadcasterId === msg.target) targetWs = ws;
          }
        }

        if (targetWs && targetWs.readyState === 1) targetWs.send(JSON.stringify({ ...msg, from: id }));
      }
    } catch (err) {
      console.error(err);
    }
  });

  ws.on("close", () => {
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (role === "listener") room.listeners.delete(id);
    if (role === "broadcaster") room.broadcasterId = null;
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log("✅ Server running on port", PORT));
