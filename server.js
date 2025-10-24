import express from "express";
import { WebSocketServer } from "ws";
import http from "http";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = {}; // { roomID: { members: Set<WebSocket>, broadcaster: WebSocket | null } }

app.get("/", (_, res) => res.send("🎧 BiharFM Mini Room Signaling Server Active"));

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const { type, roomID, payload } = data;

      if (type === "join-room") {
        if (!rooms[roomID]) rooms[roomID] = { members: new Set(), broadcaster: null };

        if (rooms[roomID].members.size >= 4) {
          ws.send(JSON.stringify({ type: "room-full" }));
          return;
        }

        ws.roomID = roomID;
        rooms[roomID].members.add(ws);
        console.log(`✅ ${roomID} joined (${rooms[roomID].members.size}/4)`);

        broadcast(roomID, {
          type: "update-count",
          count: rooms[roomID].members.size,
        });
      }

      // Set broadcaster
      if (type === "set-broadcaster") {
        if (rooms[roomID]) rooms[roomID].broadcaster = ws;
        console.log(`🎙️ Broadcaster set for room ${roomID}`);
      }

      // Broadcast play/pause commands
      if (["play", "pause"].includes(type)) {
        broadcast(roomID, { type }, ws);
      }

      // Forward signaling offers/answers
      if (["offer", "answer", "candidate"].includes(type)) {
        broadcast(roomID, { type, payload }, ws);
      }
    } catch (e) {
      console.error("Bad WS message", e);
    }
  });

  ws.on("close", () => {
    const roomID = ws.roomID;
    if (roomID && rooms[roomID]) {
      rooms[roomID].members.delete(ws);
      if (rooms[roomID].members.size === 0) delete rooms[roomID];
      else {
        broadcast(roomID, {
          type: "update-count",
          count: rooms[roomID].members.size,
        });
      }
    }
  });
});

function broadcast(roomID, msg, exclude = null) {
  if (!rooms[roomID]) return;
  const str = JSON.stringify(msg);
  for (const c of rooms[roomID].members) {
    if (c.readyState === 1 && c !== exclude) c.send(str);
  }
}

server.listen(3000, () => console.log("🚀 Server running on port 3000"));
