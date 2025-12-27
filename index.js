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

// Store latest state per host socket
io.on("connection", (socket) => {
  console.log("🟢 Connected:", socket.id);

  // Initialize socket data
  socket.data = {
    name: "guest",
    latestState: {
      songList: [],
      currentSong: null,
      playing: false,
      currentTime: 0
    }
  };

  socket.on("join-jam", ({ name }) => {
    socket.data.name = name;
    socket.join("jam");
    socket.join(`host:${socket.id}`); // host room

    // Broadcast user list
    const users = [...(io.sockets.adapter.rooms.get("jam") || [])].map(id => {
      const s = io.sockets.sockets.get(id);
      return { id, name: s?.data?.name || "guest" };
    });
    socket.emit("users-list", users);
    socket.to("jam").emit("user-joined", { id: socket.id, name });
  });

  socket.on("follow-user", ({ to }) => {
    socket.join(`host:${to}`);
    
    // Send full state to new follower
    const hostSocket = io.sockets.sockets.get(to);
    if (hostSocket?.data?.latestState) {
      socket.emit("sync-state", hostSocket.data.latestState);
    }

    // Notify host
    io.to(to).emit("new-follower", { id: socket.id, name: socket.data.name });
    
    // Update listeners list
    const listeners = [...(io.sockets.adapter.rooms.get(`host:${to}`) || [])]
      .filter(id => id !== to)
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return { id, name: s?.data?.name || "guest" };
      });
    io.to(to).emit("update-listeners", listeners);
  });

  socket.on("leave-host", ({ hostId }) => {
    socket.leave(`host:${hostId}`);
    const listeners = [...(io.sockets.adapter.rooms.get(`host:${hostId}`) || [])]
      .filter(id => id !== hostId)
      .map(id => {
        const s = io.sockets.sockets.get(id);
        return { id, name: s?.data?.name || "guest" };
      });
    io.to(hostId).emit("update-listeners", listeners);
  });

  // Store state updates
  socket.on("state-updated", ({ to, state }) => {
    const target = io.sockets.sockets.get(to);
    if (target) {
      target.data.latestState = {
        ...target.data.latestState,
        ...state
      };
    }
    io.to(to).emit("state-updated", state);
  });

  // Store media state
  socket.on("media-event", ({ to, type, payload }) => {
    const target = io.sockets.sockets.get(to);
    if (target) {
      target.data.latestState = {
        ...target.data.latestState,
        playing: type === "PLAY",
        currentTime: payload.time || 0
      };
    }
    io.to(to).emit("media-event", { type, payload });
  });

  // Chat
  socket.on("chat-message", ({ message, hostId }) => {
    io.to(`host:${hostId}`).emit("chat-message", {
      from: socket.data.name,
      message,
      time: Date.now()
    });
  });

  // Disconnect
  socket.on("disconnect", () => {
    const hostRoom = `host:${socket.id}`;
    io.to(hostRoom).emit("host-left");
    io.in(hostRoom).socketsLeave(hostRoom);
    socket.to("jam").emit("user-left", socket.id);
    console.log("🔴 Disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🔥 Jam server running on port ${PORT}`);
});