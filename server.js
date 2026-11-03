import http from "node:http"
import { randomBytes, randomInt } from "node:crypto"
import { createReadStream, existsSync, statSync } from "node:fs"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"

const root = fileURLToPath(new URL(".", import.meta.url))
const port = Number(process.env.PORT || 3000)
const rooms = new Map()

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

function createRoom() {
  let code
  do code = String(randomInt(1000, 10000))
  while (rooms.has(code))
  const room = { code, token: randomBytes(24).toString("hex"), host: null, guest: null, createdAt: Date.now() }
  rooms.set(code, room)
  return room
}

function send(socket, payload) {
  if (socket?.readyState === 1) socket.send(JSON.stringify(payload))
}

function closeRoom(room) {
  if (!room) return
  room.host = null
  if (room.guest) send(room.guest, { type: "room-closed", message: "The sender ended this room." })
  room.guest?.close()
  rooms.delete(room.code)
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`)
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    response.end(JSON.stringify({ ok: true, service: "vexuli", rooms: rooms.size }))
    return
  }
  if (url.pathname === "/api/rooms" && request.method === "POST") {
    const room = createRoom()
    response.writeHead(201, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
    response.end(JSON.stringify({ code: room.code, token: room.token }))
    return
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405)
    response.end("Method not allowed")
    return
  }
  const requested = url.pathname === "/" ? "/index.html" : url.pathname
  const filePath = normalize(join(root, requested))
  if (!filePath.startsWith(root) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404)
    response.end("Not found")
    return
  }
  response.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  })
  if (request.method === "HEAD") response.end()
  else createReadStream(filePath).pipe(response)
})

const websocketServer = new WebSocketServer({ noServer: true })
server.on("upgrade", (request, socket, head) => {
  if (new URL(request.url || "/", `http://${request.headers.host}`).pathname !== "/signal") {
    socket.destroy()
    return
  }
  websocketServer.handleUpgrade(request, socket, head, (client) => websocketServer.emit("connection", client))
})

websocketServer.on("connection", (socket) => {
  let role = null
  let room = null

  socket.on("message", (raw) => {
    let message
    try { message = JSON.parse(raw.toString()) } catch { return send(socket, { type: "error", message: "Invalid signaling message." }) }

    if (message.type === "host") {
      const candidate = rooms.get(String(message.code))
      if (!candidate || candidate.token !== message.token) return send(socket, { type: "error", message: "This room has expired. Create a new room." })
      if (candidate.host) return send(socket, { type: "error", message: "This room is already active." })
      role = "host"; room = candidate; room.host = socket
      send(socket, { type: "host-ready", code: room.code })
      return
    }

    if (message.type === "join") {
      const candidate = rooms.get(String(message.code))
      if (!candidate) return send(socket, { type: "error", message: "Invalid or expired room code." })
      if (!candidate.host) return send(socket, { type: "error", message: "The sender is not ready yet." })
      if (candidate.guest) return send(socket, { type: "error", message: "This room already has two devices." })
      role = "guest"; room = candidate; room.guest = socket
      send(socket, { type: "joined" }); send(room.host, { type: "peer-joined" })
      return
    }

    if (message.type === "signal" && room) {
      const peer = role === "host" ? room.guest : room.host
      if (peer) send(peer, { type: "signal", data: message.data })
      return
    }

    if (message.type === "leave") socket.close()
  })

  socket.on("close", () => {
    if (!room) return
    const peer = role === "host" ? room.guest : room.host
    if (peer) send(peer, { type: "peer-left" })
    if (role === "host") closeRoom(room)
    else if (room.guest === socket) room.guest = null
  })
})

setInterval(() => {
  for (const room of rooms.values()) if (Date.now() - room.createdAt > 30 * 60 * 1000) closeRoom(room)
}, 60 * 1000).unref()

server.listen(port, () => console.log(`Vexuli listening on http://localhost:${port}`))
