import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

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
  console.log("🟢 Connection open:", id);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      const { type, room, payload, target } = msg;

      if (type === "join-room") {
        if (!room) return ws.send(JSON.stringify({ type: "error", message: "Room required" }));

        conn.room = room;
        if (!rooms.has(room)) rooms.set(room, { broadcaster: null, listeners: new Set() });
        const r = rooms.get(room);

        // Assign role dynamically
        if (!r.broadcaster) {
          conn.role = "broadcaster";
          r.broadcaster = id;
          ws.send(JSON.stringify({ role: "broadcaster" }));
          console.log(`Room ${room}: broadcaster assigned (${id})`);
        } else if (r.listeners.size < 3) {
          conn.role = "listener";
          r.listeners.add(id);
          ws.send(JSON.stringify({ role: "listener" }));
          console.log(`Room ${room}: listener joined (${id})`);
          // Notify broadcaster
          if (r.broadcaster && conns.has(r.broadcaster)) {
            conns.get(r.broadcaster).ws.send(JSON.stringify({ type: "listener-joined", id }));
          }
        } else {
          ws.send(JSON.stringify({ type: "error", message: "Room full" }));
        }
        return;
      }

      // Relay WebRTC signaling
      if (type === "offer" || type === "answer" || type === "candidate") {
        if (!target) return;
        const t = conns.get(target);
        if (t) t.ws.send(JSON.stringify({ type, from: id, payload }));
        return;
      }

      // Host controls (play/pause/stop/sync)
      if (type === "control" || type === "sync-time") {
        if (!conn.role || conn.role !== "broadcaster") return;
        const r = rooms.get(conn.room);
        r.listeners.forEach(lid => {
          if (conns.has(lid)) conns.get(lid).ws.send(JSON.stringify(msg));
        });
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
      if (role === "broadcaster") {
        // notify all listeners that host left
        r.listeners.forEach(lid => {
          if (conns.has(lid)) conns.get(lid).ws.send(JSON.stringify({ type: "stop" }));
        });
        rooms.delete(room);
        console.log(`Room ${room} closed, broadcaster left`);
      } else if (role === "listener") {
        r.listeners.delete(id);
        console.log(`Listener left room ${room}`);
      }
    }
    console.log("🔴 Connection closed:", id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
