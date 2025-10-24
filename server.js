import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Rooms structure
// rooms = {
//   roomId1: { broadcaster: connId, listeners: Set(connId) },
//   roomId2: ...
// }
const rooms = new Map();
const conns = new Map();

app.get("/", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send("🎧 FM Room Server Active");
});

wss.on("connection", (ws) => {
  const id = crypto.randomUUID();
  const conn = { id, ws, role: null, room: null };
  conns.set(id, conn);
  console.log("🟢 Conn open", id);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      const { type, role, room, target, payload } = msg;

      if (type === "join-room") {
        if (!room) return ws.send(JSON.stringify({ type: "error", message: "Room required" }));
        
        conn.room = room;
        conn.role = role;

        if (!rooms.has(room)) rooms.set(room, { broadcaster: null, listeners: new Set() });
        const r = rooms.get(room);

        // Assign broadcaster
        if (role === "broadcaster") {
          if (r.broadcaster) return ws.send(JSON.stringify({ type: "error", message: "Broadcaster exists" }));
          r.broadcaster = id;
          ws.send(JSON.stringify({ type: "joined", room, role }));
          console.log(`Room ${room}: broadcaster joined (${id})`);
          return;
        }

        // Assign listener (max 3)
        if (role === "listener") {
          if (r.listeners.size >= 3) return ws.send(JSON.stringify({ type: "error", message: "Room full" }));
          r.listeners.add(id);
          ws.send(JSON.stringify({ type: "joined", room, role }));
          console.log(`Room ${room}: listener joined (${id})`);

          // Notify broadcaster
          if (r.broadcaster && conns.has(r.broadcaster)) {
            conns.get(r.broadcaster).ws.send(JSON.stringify({ type: "listener-joined", id }));
          }
          return;
        }
      }

      // WebRTC signaling (offer/answer/candidate)
      if (type === "offer" || type === "answer" || type === "candidate") {
        const t = conns.get(target);
        if (t) t.ws.send(JSON.stringify({ type, from: id, payload }));
        return;
      }

    } catch (err) {
      console.error("❌ Message parse error", err);
    }
  });

  ws.on("close", () => {
    const { room, role } = conn;
    conns.delete(id);
    if (room && rooms.has(room)) {
      const r = rooms.get(room);
      if (role === "broadcaster") r.broadcaster = null;
      if (role === "listener") r.listeners.delete(id);
    }
    console.log("🔴 Conn closed", id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
