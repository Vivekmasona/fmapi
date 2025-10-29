// server.js — FM group signaling with rooms (max 4 per room)
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();

app.get("/", (req, res) => {
  res.send("🎧 FM Group Signaling (rooms) is live");
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Data structures:
// clients: id -> { ws, role, name, room }
// rooms: roomId -> Set(clientId)
const clients = new Map();
const rooms = new Map();

function safeSend(ws, data) {
  if (ws && ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(data)); } catch (e) { console.error("send err", e.message); }
  }
}

function roomMembers(room) {
  const set = rooms.get(room);
  return set ? Array.from(set) : [];
}

// ping to keep-alive
setInterval(() => {
  for (const [, c] of clients) {
    if (c.ws.readyState === c.ws.OPEN) safeSend(c.ws, { type: "ping" });
  }
}, 25000);

wss.on("connection", (ws, req) => {
  const id = crypto.randomUUID();
  clients.set(id, { ws, role: null, name: null, room: null });
  console.log("Connected:", id);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

    const { type, role, target, payload, room, name } = msg;

    // Register: expects { type: 'register', role: 'broadcaster'|'listener', room: 'room123', name: 'Bob' }
    if (type === "register") {
      clients.get(id).role = role || null;
      clients.get(id).name = name || null;
      clients.get(id).room = room || null;

      if (room) {
        if (!rooms.has(room)) rooms.set(room, new Set());
        const set = rooms.get(room);

        // limit room size
        if (set.size >= 4) {
          safeSend(ws, { type: "room-full", room });
          // still register but do not add to room
          console.log(`Room ${room} full - ${id} rejected`);
          return;
        }
        set.add(id);
      }

      // reply with id and room members count
      safeSend(ws, { type: "registered", id, room, members: roomMembers(room).length });

      // notify others in room about new presence (so UI can update)
      if (room) {
        for (const peerId of roomMembers(room)) {
          if (peerId === id) continue;
          const peer = clients.get(peerId);
          if (peer && peer.ws.readyState === peer.ws.OPEN) {
            safeSend(peer.ws, { type: "peer-joined", id, role, name });
          }
        }
      }
      return;
    }

    // Relay offer / answer / candidate to a target (if target in same room)
    if (["offer", "answer", "candidate"].includes(type) && target) {
      const src = clients.get(id);
      const tgt = clients.get(target);
      if (!src || !tgt) return;
      // ensure same room
      if (src.room && tgt.room && src.room === tgt.room) {
        safeSend(tgt.ws, { type, from: id, payload });
      } else {
        // ignore cross-room signaling
        console.warn("Cross-room signaling blocked", id, target);
      }
      return;
    }

    // Control / metadata messages to everyone in the same room (except sender)
    // Example payloads: { action: 'play', time: 12.34 } or { title: 'Song' }
    if (type === "control" || type === "metadata") {
      const src = clients.get(id);
      if (!src || !src.room) return;
      const set = rooms.get(src.room);
      if (!set) return;
      for (const peerId of set) {
        if (peerId === id) continue;
        const peer = clients.get(peerId);
        if (peer && peer.ws && peer.ws.readyState === peer.ws.OPEN) {
          safeSend(peer.ws, { type, from: id, payload });
        }
      }
      return;
    }

    // Client leaving voluntarily
    if (type === "leave") {
      const info = clients.get(id);
      if (info && info.room) {
        const set = rooms.get(info.room);
        if (set) {
          set.delete(id);
          // notify remaining in room
          for (const pid of set) {
            const p = clients.get(pid);
            if (p && p.ws.readyState === p.ws.OPEN) safeSend(p.ws, { type: "peer-left", id });
          }
          if (set.size === 0) rooms.delete(info.room);
        }
      }
      clients.delete(id);
      return;
    }
  });

  ws.on("close", () => {
    const info = clients.get(id);
    if (!info) return;
    const { room, role } = info;
    clients.delete(id);
    console.log("Disconnected:", id);
    if (room) {
      const set = rooms.get(room);
      if (set) {
        set.delete(id);
        for (const pid of set) {
          const p = clients.get(pid);
          if (p && p.ws.readyState === p.ws.OPEN) safeSend(p.ws, { type: "peer-left", id });
        }
        if (set.size === 0) rooms.delete(room);
      }
    }
  });

  ws.on("error", (err) => console.error("WS error:", err && err.message));
});

server.keepAliveTimeout = 70000;
server.headersTimeout = 75000;

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`FM rooms signaling server on port ${PORT}`));
