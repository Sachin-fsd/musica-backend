const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  pingTimeout: 60000,
  pingInterval: 25000,
});

io.on("connection", (socket) => {
  socket.data = { name: "guest" };

  socket.on("join-jam", ({ name }) => {
    socket.data.name = name;
    socket.join("jam");
    socket.join(`host:${socket.id}`);

    const users = Array.from(io.sockets.adapter.rooms.get("jam") || [])
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return { id, name: s?.data?.name || "guest" };
      });
    io.to("jam").emit("users-update", users);
  });

  socket.on("follow-user", ({ to }) => {
    socket.data.listeningTo = to;
    socket.join(`host:${to}`);
    const host = io.sockets.sockets.get(to);
    if (host?.data?.state) {
      socket.emit("sync-state", host.data.state);
    }

    // Update only this host
    const listeners = Array.from(io.sockets.adapter.rooms.get(`host:${to}`) || [])
      .filter(id => id !== to)
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return { id, name: s?.data?.name || "guest" };
      });
    io.to(to).emit("update-listeners", listeners);
  });

  socket.on("leave-host", ({ hostId }) => {
    delete socket.data.listeningTo;
    socket.leave(`host:${hostId}`);
    const listeners = Array.from(io.sockets.adapter.rooms.get(`host:${hostId}`) || [])
      .filter(id => id !== hostId)
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return { id, name: s?.data?.name || "guest" };
      });
    io.to(hostId).emit("update-listeners", listeners);
  });

  socket.on("update-state", ({ state }) => {
    socket.data.state = state;
    socket.to(`host:${socket.id}`).emit("sync-state", state);
  });

  socket.on("chat-message", ({ message, hostId }) => {
    io.to(`host:${hostId}`).emit("chat-message", {
      from: socket.data.name,
      message,
      time: Date.now()
    });
  });

  socket.on("disconnect", () => {
    // 1. Update global user list
    const users = Array.from(io.sockets.adapter.rooms.get("jam") || [])
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return { id, name: s?.data?.name || "guest" };
      });
    io.to("jam").emit("users-update", users);

    // 2. Notify every host this user was following
    if (socket.data.listeningTo) {
      const hostId = socket.data.listeningTo;
      const listeners = Array.from(io.sockets.adapter.rooms.get(`host:${hostId}`) || [])
        .filter(id => id !== hostId)
        .map(id => {
          const s = io.sockets.sockets.get(id);
          return { id, name: s?.data?.name || "guest" };
        });
      io.to(hostId).emit("update-listeners", listeners);
    }

    console.log("🔴 Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🔥 Jam server running on port ${PORT}`);
});