const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  // JOIN JAM (presence + self-host room)
  socket.on("join-jam", ({ name }) => {
    socket.data.name = name;

    socket.join("jam");
    socket.join(`host:${socket.id}`); // 🔑 CRITICAL FIX

    const users = [...(io.sockets.adapter.rooms.get("jam") || [])].map(id => {
      const s = io.sockets.sockets.get(id);
      return { id, name: s?.data?.name };
    });

    socket.emit("users-list", users);
    socket.to("jam").emit("user-joined", {
      id: socket.id,
      name
    });
  });

  // FOLLOW HOST
  socket.on("follow-user", ({ to }) => {
    socket.join(`host:${to}`);
    io.to(to).emit("new-follower", socket.id);
  });

  socket.on("leave-host", ({ hostId }) => {
    socket.leave(`host:${hostId}`);
  });

  // STATE SYNC
  socket.on("sync-state", ({ to, state }) => {
    io.to(to).emit("sync-state", state);
  });

  socket.on("state-updated", ({ to, state }) => {
    io.to(to).emit("state-updated", state);
  });

  // PLAY / PAUSE
  socket.on("media-event", ({ to, type, payload }) => {
    io.to(to).emit("media-event", { type, payload });
  });

  // CHAT (host + followers, including host)
  socket.on("chat-message", ({ message, hostId }) => {
    io.to(`host:${hostId}`).emit("chat-message", {
      from: socket.data.name,
      message,
      time: Date.now()
    });
  });

  socket.on("disconnect", () => {
    const hostRoom = `host:${socket.id}`;

    // notify followers that host is gone
    io.to(hostRoom).emit("host-left");

    // force followers to leave room
    io.in(hostRoom).socketsLeave(hostRoom);

    // notify global jam
    socket.to("jam").emit("user-left", socket.id);

    console.log("🔴 Host disconnected, room disbanded:", socket.id);
  });

});

server.listen(8080, () => {
  console.log("🔥 Jam running on http://localhost:8080");
});