import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // roomId => { hostId, listeners: Set, hostWS }

app.get("/", (req,res)=>{
  res.send("🎧 Room-based FM signaling server");
});

wss.on("connection",(ws)=>{
  const id = crypto.randomUUID();
  let roomId = null;
  let role = null;

  ws.on("message",(msg)=>{
    try {
      const data = JSON.parse(msg);

      // --- Register ---
      if(data.type==="register"){
        role = data.role;
        roomId = data.room || "default";
        if(!rooms.has(roomId)) rooms.set(roomId,{ hostId:null, listeners:new Set(), hostWS:null });

        const room = rooms.get(roomId);

        if(role==="host"){
          if(room.hostId){
            ws.send(JSON.stringify({ type:"reject", reason:"Host already exists" }));
            ws.close();
            return;
          }
          room.hostId = id;
          room.hostWS = ws;
          ws.send(JSON.stringify({ type:"registered", role:"host", room:roomId }));
          // Late listeners: send track sync request
          room.listeners.forEach(listenerId=>{
            const conn = Array.from(wss.clients).find(c=>c.id===listenerId);
            if(conn && conn.readyState===WebSocket.OPEN){
              ws.send(JSON.stringify({ type:"request-track-sync", target:listenerId }));
            }
          });
        }

        if(role==="listener"){
          if(room.listeners.size>=3){
            ws.send(JSON.stringify({ type:"reject", reason:"Room full" }));
            ws.close();
            return;
          }
          room.listeners.add(id);
          ws.send(JSON.stringify({ type:"registered", role:"listener", room:roomId }));
          // Notify host if exists
          if(room.hostWS && room.hostWS.readyState===WebSocket.OPEN){
            room.hostWS.send(JSON.stringify({ type:"listener-joined", id }));
          } else {
            // waiting for host
            ws.send(JSON.stringify({ type:"waiting-host" }));
          }
        }

        ws.id = id;
        ws.roomId = roomId;
      }

      // --- Offer/Answer/Candidate Relay ---
      if(["offer","answer","candidate"].includes(data.type)){
        const room = rooms.get(roomId);
        let targetWS = null;
        if(data.target){
          if(room.hostId===data.target) targetWS = room.hostWS;
          else if(room.listeners.has(data.target)){
            targetWS = Array.from(wss.clients).find(c=>c.id===data.target);
          }
        }
        if(targetWS && targetWS.readyState===WebSocket.OPEN){
          targetWS.send(JSON.stringify({ ...data, from:id }));
        }
      }

      // --- Broadcast control ---
      if(data.type==="broadcast-control"){
        const room = rooms.get(roomId);
        room.listeners.forEach(listenerId=>{
          const conn = Array.from(wss.clients).find(c=>c.id===listenerId);
          if(conn && conn.readyState===WebSocket.OPEN){
            conn.send(JSON.stringify({ type:"control", payload:data.payload }));
          }
        });
      }

    } catch(e){
      console.warn("Invalid WS message", e);
    }
  });

  ws.on("close",()=>{
    const room = rooms.get(roomId);
    if(!room) return;

    if(role==="host"){
      room.hostId = null;
      room.hostWS = null;
      // Notify all listeners
      room.listeners.forEach(listenerId=>{
        const conn = Array.from(wss.clients).find(c=>c.id===listenerId);
        if(conn && conn.readyState===WebSocket.OPEN){
          conn.send(JSON.stringify({ type:"host-left" }));
        }
      });
    }
    if(role==="listener"){
      room.listeners.delete(id);
      if(room.hostWS && room.hostWS.readyState===WebSocket.OPEN){
        room.hostWS.send(JSON.stringify({ type:"peer-left", id }));
      }
    }
  });

});
const PORT = process.env.PORT || 8080;
server.listen(PORT,()=>console.log("✅ Server running on port",PORT));
