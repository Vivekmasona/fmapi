// server.js
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.get("/", (req, res) => {
  res.send("FM Room Signaling Server ✅");
});

// Rooms: { roomId: { broadcaster: ws, listeners: [ws,...] } }
const rooms = {};

wss.on("connection", (ws) => {
  ws.roomId = null;
  ws.role = null;

  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch(e){ return; }

    const { type, role, room, target, payload } = data;

    if(type==="join-room"){
      ws.roomId = room;
      ws.role = role;
      if(!rooms[room]) rooms[room] = { broadcaster: null, listeners: [] };

      const r = rooms[room];

      if(role==="broadcaster"){
        if(r.broadcaster){
          ws.send(JSON.stringify({ type:"error", msg:"Room already has broadcaster" }));
          ws.close();
          return;
        }
        r.broadcaster = ws;

        // Notify existing listeners of late join
        r.listeners.forEach(lis => lis.send(JSON.stringify({ type:"offer-request" })));

      } else if(role==="listener"){
        if(r.listeners.length>=3){
          ws.send(JSON.stringify({ type:"error", msg:"Room full" }));
          ws.close();
          return;
        }
        r.listeners.push(ws);

        // If broadcaster already exists, notify to send offer
        if(r.broadcaster){
          r.broadcaster.send(JSON.stringify({ type:"new-listener" }));
        }
      }
      return;
    }

    // Signaling messages
    if(type==="offer" || type==="answer" || type==="candidate"){
      const r = rooms[ws.roomId];
      if(!r) return;
      let dest = null;

      if(ws.role==="broadcaster" && type==="offer"){
        // Send offer to listener
        dest = r.listeners.find(l => l.id===target);
      } else if(ws.role==="listener" && type==="answer"){
        dest = r.broadcaster;
      } else if(type==="candidate"){
        if(ws.role==="broadcaster") dest = r.listeners.find(l => l.id===target);
        else if(ws.role==="listener") dest = r.broadcaster;
      }

      if(dest) dest.send(JSON.stringify({ type, from: ws.id, payload }));
    }
  });

  ws.on("close", () => {
    const r = rooms[ws.roomId];
    if(!r) return;

    if(ws.role==="broadcaster") {
      r.broadcaster = null;
      // Notify listeners
      r.listeners.forEach(lis => lis.send(JSON.stringify({ type:"broadcaster-left" })));
    } else if(ws.role==="listener"){
      r.listeners = r.listeners.filter(l=>l!==ws);
      if(r.broadcaster) r.broadcaster.send(JSON.stringify({ type:"listener-left" }));
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, ()=> console.log(`Server running on ${PORT}`));
