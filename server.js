import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const conns = new Map(); // id -> {id, ws, role, room, ready}

// CORS for testing
app.get("/", (req, res) => {
  res.send("🎧 Bihar FM WebSocket signaling server");
});

wss.on("connection", (ws) => {
  const id = crypto.randomUUID();
  const conn = { id, ws, role: null, room: null, ready: false };
  conns.set(id, conn);
  console.log("🟢 Connection:", id);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);
      const { type, role, room, target, payload } = msg;

      // --- Register / Join room ---
      if(type === "join-room") {
        conn.role = role;
        conn.room = room;
        if(role === "listener") conn.ready = true;

        // notify broadcaster in same room that listener is ready
        for(const c of conns.values()){
          if(c.role==="broadcaster" && c.room===room){
            c.ws.send(JSON.stringify({ type:"listener-ready", id:conn.id }));
          }
        }
        return;
      }

      // --- WebRTC signaling ---
      if(["offer","answer","candidate"].includes(type)){
        const t = conns.get(target);
        if(t) t.ws.send(JSON.stringify({...msg, from:id}));
        return;
      }

    } catch(e){ console.error("❌ Message parse error", e); }
  });

  ws.on("close", () => {
    conns.delete(id);
    console.log("🔴 Connection closed:", id);
    // notify broadcaster if listener left
    for(const c of conns.values()){
      if(c.role==="broadcaster" && c.room === conn.room){
        c.ws.send(JSON.stringify({ type:"peer-left", id }));
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, ()=>console.log(`✅ Server running on port ${PORT}`));
