const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Prevent path traversal
  const safePath = path
    .normalize(urlPath)
    .replace(/^(\.\.[/\\])+/, "")
    .replace(/^[/\\]+/, "");

  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e7,
});

/** @type {Map<string, Set<string>>} code -> Set<socketId> */
const rooms = new Map();

const CODE_TTL_MS = 1000 * 60 * 30; // 30 minutes
/** @type {Map<string, NodeJS.Timeout>} */
const timers = new Map();

function clearRoom(code) {
  const t = timers.get(code);
  if (t) clearTimeout(t);
  timers.delete(code);
  rooms.delete(code);
}

function createCode() {
  let code;
  let attempts = 0;
  do {
    code = String(1000 + Math.floor(Math.random() * 9000));
    attempts++;
    if (attempts > 1000) throw new Error("Unable to allocate room code");
  } while (rooms.has(code));
  return code;
}

io.on("connection", (socket) => {
  socket.data.roomCode = null;

  socket.on("create-room", () => {
    try {
      const code = createCode();
      rooms.set(code, new Set([socket.id]));
      socket.data.roomCode = code;
      socket.join(code);

      const t = setTimeout(() => {
        const peers = rooms.get(code);
        if (peers) {
          for (const id of peers) {
            io.to(id).emit("error-msg", { message: "Room expired" });
            const s = io.sockets.sockets.get(id);
            if (s) {
              s.leave(code);
              s.data.roomCode = null;
            }
          }
          clearRoom(code);
        }
      }, CODE_TTL_MS);
      timers.set(code, t);

      socket.emit("room-created", { code });
    } catch (err) {
      socket.emit("error-msg", { message: "Could not create room" });
    }
  });

  socket.on("join-room", ({ code } = {}) => {
    if (!code || !/^\d{4}$/.test(String(code))) {
      return socket.emit("error-msg", { message: "Invalid room code" });
    }
    const peers = rooms.get(code);
    if (!peers) {
      return socket.emit("error-msg", { message: "That room code is not valid" });
    }
    if (peers.has(socket.id)) {
      return socket.emit("error-msg", { message: "You are already in this room" });
    }
    if (peers.size >= 2) {
      return socket.emit("error-msg", { message: "That room is full" });
    }

    peers.add(socket.id);
    socket.data.roomCode = code;
    socket.join(code);

    socket.emit("room-joined", { code });
    for (const id of peers) {
      if (id !== socket.id) {
        io.to(id).emit("peer-joined", { id: socket.id });
        socket.emit("peer-joined", { id });
      }
    }
  });

  socket.on("signal", ({ to, data } = {}) => {
    if (!to || !data) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const peers = rooms.get(code);
    if (!peers) return;
    peers.delete(socket.id);
    socket.to(code).emit("peer-left", { id: socket.id });
    if (peers.size === 0) clearRoom(code);
  });
});

server.listen(PORT, () => {
  console.log(`Vexuli running at http://localhost:${PORT}`);
});