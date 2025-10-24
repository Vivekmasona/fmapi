import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Rooms: roomId -> { hostId: string|null, listeners: Set<id>, currentTrackIndex: number, currentTime: number }
const rooms = new Map();
const conns = new Map();

app.get("/", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send("🎧 Room-based FM signaling server");
});

wss.on("connection", (ws) => {
  const id = crypto.randomUUID();
  const conn = { id, ws, role: null, room: null };
  conns.set(id, conn);
  console.log("🟢 Connection open", id);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === "register") {
        const { role, room } = msg;
        conn.role = role;
        conn.room = room;

        if (!rooms.has(room)) rooms.set(room, { hostId: null, listeners: new Set(), currentTrackIndex: 0, currentTime: 0 });
        const roomData = rooms.get(room);

        if (role === "broadcaster") {
          if (roomData.hostId) {
            ws.send(JSON.stringify({ type: "reject", reason: "Host already exists" }));
            ws.close();
            return;
          }
          roomData.hostId = id;
          ws.send(JSON.stringify({ type: "registered", role, room }));
          console.log(`Host ${id} registered in room ${room}`);
        } else if (role === "listener") {
          if (!roomData.hostId) {
            ws.send(JSON.stringify({ type: "reject", reason: "No host in room" }));
            ws.close();
            return;
          }
          if (roomData.listeners.size >= 3) {
            ws.send(JSON.stringify({ type: "reject", reason: "Room full (3 listeners max)" }));
            ws.close();
            return;
          }
          roomData.listeners.add(id);
          ws.send(JSON.stringify({ type: "registered", role, room }));
          console.log(`Listener ${id} joined room ${room}`);

          // Notify host
          const hostConn = conns.get(roomData.hostId);
          if (hostConn && hostConn.ws.readyState === WebSocket.OPEN) {
            hostConn.ws.send(JSON.stringify({ type: "listener-joined", id }));
            // Late join sync: send current track info
            hostConn.ws.send(JSON.stringify({ type:"request-track-sync", target: id }));
          }
        }
        return;
      }

      // Forward signaling messages
      const { type, target, payload } = msg;
      if (type === "offer" || type === "answer" || type === "candidate") {
        const t = conns.get(target);
        if (t && t.ws.readyState === WebSocket.OPEN) {
          t.ws.send(JSON.stringify({ type, from: id, payload }));
        }
      }

      // Broadcast track info from host
      if (msg.type === "track-update") {
        const roomData = rooms.get(conn.room);
        if(roomData){
          roomData.currentTrackIndex = msg.trackIndex || 0;
          roomData.currentTime = msg.currentTime || 0;
        }
      }

      // Send track sync to late listener
      if(msg.type === "track-sync" && msg.target){
        const t = conns.get(msg.target);
        if(t && t.ws.readyState === WebSocket.OPEN){
          t.ws.send(JSON.stringify({ type:"track-sync", payload: msg.payload }));
        }
      }

    } catch (err) {
      console.error("❌ Message parse error", err);
    }
  });

  ws.on("close", () => {
    console.log("🔴 Connection closed", id);
    conns.delete(id);
    if(conn.room && rooms.has(conn.room)){
      const roomData = rooms.get(conn.room);
      if(conn.role==="broadcaster"){
        roomData.hostId = null;
        // Disconnect all listeners
        roomData.listeners.forEach(lid=>{
          const lconn = conns.get(lid);
          if(lconn && lconn.ws.readyState===WebSocket.OPEN){
            lconn.ws.send(JSON.stringify({ type:"host-left" }));
            lconn.ws.close();
          }
        });
        roomData.listeners.clear();
      } else if(conn.role==="listener"){
        roomData.listeners.delete(id);
        if(roomData.hostId){
          const hostConn = conns.get(roomData.hostId);
          if(hostConn && hostConn.ws.readyState===WebSocket.OPEN){
            hostConn.ws.send(JSON.stringify({ type:"peer-left", id }));
          }
        }
      }
      if(!roomData.hostId && roomData.listeners.size===0) rooms.delete(conn.room);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, ()=> console.log(`✅ Server running on port ${PORT}`));
