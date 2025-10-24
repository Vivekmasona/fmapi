// server.js
const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static("public")); // serve HTML from public/

// Rooms: { roomId: { host: ws, listeners: [ws, ...] } }
const rooms = {};

wss.on("connection", (ws) => {
  ws.id = crypto.randomUUID();
  ws.roomId = null;
  ws.role = null;

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      handleMessage(ws, data);
    } catch (e) { console.warn("Invalid JSON", e); }
  });

  ws.on("close", () => {
    if (!ws.roomId) return;
    const room = rooms[ws.roomId];
    if (!room) return;
    if (ws.role === "host") {
      // Close room
      room.listeners.forEach(l => l.send(JSON.stringify({ type:"host-left" })));
      delete rooms[ws.roomId];
    } else if (ws.role === "listener") {
      room.listeners = room.listeners.filter(l => l.id !== ws.id);
      if (room.host) room.host.send(JSON.stringify({ type:"listener-left", id: ws.id }));
    }
  });
});

function handleMessage(ws, msg) {
  if (msg.type === "register") {
    const { role, room } = msg;
    ws.role = role;
    ws.roomId = room;

    if (!rooms[room]) rooms[room] = { host: null, listeners: [] };
    const roomObj = rooms[room];

    if (role === "host") {
      if (roomObj.host) return ws.send(JSON.stringify({ type:"error", message:"Room already has host" }));
      roomObj.host = ws;
      ws.send(JSON.stringify({ type:"registered", role:"host" }));
    } else if (role === "listener") {
      if (!roomObj.host) return ws.send(JSON.stringify({ type:"error", message:"No host in room yet" }));
      if (roomObj.listeners.length >= 3) return ws.send(JSON.stringify({ type:"error", message:"Room full" }));
      roomObj.listeners.push(ws);
      ws.send(JSON.stringify({ type:"registered", role:"listener" }));
      // Notify host
      roomObj.host.send(JSON.stringify({ type:"listener-joined", id: ws.id }));
    }
  }

  // Forward SDP/candidates
  if (["offer","answer","candidate","metadata"].includes(msg.type)) {
    const roomObj = rooms[ws.roomId];
    if (!roomObj) return;
    if (ws.role === "host") {
      // send to specific listener
      const target = roomObj.listeners.find(l => l.id === msg.target);
      if (target) target.send(JSON.stringify(msg));
    } else if (ws.role === "listener") {
      if (roomObj.host) roomObj.host.send(JSON.stringify({ ...msg, from: ws.id }));
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
