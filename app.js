(() => {
  const $ = (id) => document.getElementById(id)
  const state = { role: null, code: "", token: "", socket: null, peer: null, channel: null, connected: false, pending: [], received: [], incoming: null, candidateQueue: [] }
  const fileKinds = { image: "sage", archive: "sand", link: "blue", document: "slate" }

  function toast(message) {
    $("toast").textContent = `✓  ${message}`
    $("toast").hidden = false
    window.setTimeout(() => { $("toast").hidden = true }, 2600)
  }
  function bytes(value) {
    if (!value) return "0 B"
    const units = ["B", "KB", "MB", "GB"]
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
    return `${parseFloat((value / Math.pow(1024, index)).toFixed(index ? 1 : 0))} ${units[index]}`
  }
  function kind(file) {
    const name = file.name.toLowerCase()
    if (file.type.startsWith("image/")) return "image"
    if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return "archive"
    return "document"
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])) }
  function socketUrl() { return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/signal` }
  function signal(payload) { if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify(payload)) }

  function show(view) {
    ["roleScreen", "senderSetup", "receiverSetup"].forEach((id) => { $(id).hidden = id !== view })
    $("shareRoom").classList.toggle("visible", view === "shareRoom")
  }
  function renderCode() { $("senderCode").innerHTML = state.code.split("").map((digit) => `<b>${digit}</b>`).join("") }
  function renderPending() {
    $("sendItems").disabled = !state.pending.length || !state.connected
    $("pendingItems").innerHTML = state.pending.length ? state.pending.map((item, index) => `<div class="item"><span class="item-icon ${fileKinds[item.kind]}">${item.kind === "link" ? "↗" : "▤"}</span><span class="file"><b title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</b><small>${item.size} · ready</small></span><button class="remove" data-remove="${index}" aria-label="Remove ${escapeHtml(item.name)}">×</button></div>`).join("") : ""
    document.querySelectorAll("[data-remove]").forEach((button) => button.onclick = () => { state.pending.splice(Number(button.dataset.remove), 1); renderPending() })
  }
  function renderReceived() {
    $("receivedItems").innerHTML = state.received.length ? state.received.map((item) => `<div class="item"><span class="item-icon ${fileKinds[item.kind]}">${item.kind === "link" ? "↗" : "▤"}</span><span class="file"><b title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</b><small>${item.size} · received</small></span>${item.url ? `<a class="download" href="${item.url}" download="${escapeHtml(item.name)}">Save</a>` : ""}</div>`).join("") : `<p class="receive-empty">Files and links from the other device will appear here.</p>`
  }
  function setConnected() { state.connected = true; $("connectionText").textContent = "Two devices connected"; show("shareRoom"); renderPending(); toast("Encrypted devices connected") }

  async function createRoom() {
    $("senderStatus").textContent = "Creating a private room…"
    try {
      const response = await fetch("/api/rooms", { method: "POST" })
      if (!response.ok) throw new Error("Room service unavailable")
      const room = await response.json(); state.code = room.code; state.token = room.token; renderCode(); connectSocket("host")
    } catch (error) { $("senderStatus").textContent = error.message; toast(error.message) }
  }
  function connectSocket(role) {
    state.socket = new WebSocket(socketUrl())
    state.socket.onopen = () => {
      if (role === "host") { signal({ type: "host", code: state.code, token: state.token }); $("senderStatus").textContent = "Waiting for the other device to join…" }
      else signal({ type: "join", code: $("roomInput").value })
    }
    state.socket.onerror = () => { if (!state.connected) toast("Could not reach the room service") }
    state.socket.onclose = () => { if (state.connected) { state.connected = false; toast("Session ended") } }
    state.socket.onmessage = async (event) => {
      const message = JSON.parse(event.data)
      if (message.type === "error") { if (state.role === "receiver") $("joinError").textContent = message.message; else $("senderStatus").textContent = message.message; return }
      if (message.type === "host-ready") { $("senderStatus").textContent = "Waiting for the other device to join…"; return }
      if (message.type === "joined") { $("joinError").textContent = "Connected. Negotiating a private channel…"; return }
      if (message.type === "peer-joined") { $("senderStatus").textContent = "Device found. Securing the connection…"; await makePeer(true); return }
      if (message.type === "signal") { await handleSignal(message.data); return }
      if (message.type === "peer-left" || message.type === "room-closed") { endSession(false); toast(message.message || "The other device left") }
    }
  }
  async function makePeer(isHost) {
    state.peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] })
    state.peer.onicecandidate = (event) => { if (event.candidate) signal({ type: "signal", data: { candidate: event.candidate } }) }
    state.peer.onconnectionstatechange = () => { if (["failed", "disconnected", "closed"].includes(state.peer.connectionState)) endSession(false) }
    if (isHost) wireChannel(state.peer.createDataChannel("vexuli-transfer"))
    else state.peer.ondatachannel = (event) => wireChannel(event.channel)
    if (isHost) { const offer = await state.peer.createOffer(); await state.peer.setLocalDescription(offer); signal({ type: "signal", data: { offer } }) }
  }
  function wireChannel(channel) {
    state.channel = channel; channel.binaryType = "arraybuffer"; channel.onopen = setConnected; channel.onclose = () => endSession(false); channel.onmessage = receiveMessage
  }
  async function handleSignal(data) {
    if (!state.peer && data.candidate) { state.candidateQueue.push(data.candidate); return }
    if (!state.peer && data.offer) await makePeer(false)
    if (!state.peer) return
    if (data.offer) { await state.peer.setRemoteDescription(data.offer); for (const candidate of state.candidateQueue) await state.peer.addIceCandidate(candidate); state.candidateQueue = []; const answer = await state.peer.createAnswer(); await state.peer.setLocalDescription(answer); signal({ type: "signal", data: { answer } }) }
    else if (data.answer) await state.peer.setRemoteDescription(data.answer)
    else if (data.candidate) { if (state.peer.remoteDescription) await state.peer.addIceCandidate(data.candidate); else state.candidateQueue.push(data.candidate) }
  }
  async function receiveMessage(event) {
    if (typeof event.data === "string") {
      const message = JSON.parse(event.data)
      if (message.type === "link") { state.received.push({ kind: "link", name: message.url, size: "Web link", url: message.url }); renderReceived() }
      if (message.type === "file-start") state.incoming = { ...message, chunks: [], received: 0 }
      if (message.type === "file-end" && state.incoming) { const file = state.incoming; const blob = new Blob(file.chunks, { type: file.mime || "application/octet-stream" }); state.received.push({ kind: kind({ name: file.name, type: file.mime || "" }), name: file.name, size: bytes(file.size), url: URL.createObjectURL(blob) }); state.incoming = null; renderReceived(); toast(`${file.name} received`) }
      return
    }
    if (state.incoming) { const chunk = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data; state.incoming.chunks.push(chunk); state.incoming.received += chunk.byteLength }
  }
  async function waitForBuffer() { while (state.channel.bufferedAmount > 1024 * 1024) await new Promise((resolve) => setTimeout(resolve, 25)) }
  async function sendFile(item) { const file = item.file; const id = crypto.randomUUID(); state.channel.send(JSON.stringify({ type: "file-start", id, name: file.name, size: file.size, mime: file.type })); for (let offset = 0; offset < file.size; offset += 16 * 1024) { await waitForBuffer(); state.channel.send(await file.slice(offset, offset + 16 * 1024).arrayBuffer()) } state.channel.send(JSON.stringify({ type: "file-end", id })) }
  async function sendSelected() {
    if (!state.channel || state.channel.readyState !== "open") return toast("The encrypted channel is not ready")
    const items = [...state.pending]; state.pending = []
    for (const item of items) { if (item.kind === "link") state.channel.send(JSON.stringify({ type: "link", url: item.name })); else await sendFile(item) }
    renderPending(); toast("Transfer sent")
  }
  function endSession(notify = true) { if (notify) signal({ type: "leave" }); state.channel?.close(); state.peer?.close(); state.socket?.close(); state.channel = null; state.peer = null; state.socket = null; state.connected = false; state.pending = []; state.received = []; state.incoming = null; state.candidateQueue = []; show("roleScreen"); renderPending(); renderReceived() }
  function addFiles(files) { Array.from(files || []).forEach((file) => state.pending.push({ kind: kind(file), name: file.name, size: bytes(file.size), file })); renderPending() }

  $("senderRole").onclick = () => { state.role = "sender"; show("senderSetup"); createRoom() }
  $("receiverRole").onclick = () => { state.role = "receiver"; show("receiverSetup"); $("roomInput").focus() }
  document.querySelectorAll("[data-back]").forEach((button) => button.onclick = () => endSession(false))
  $("copyCode").onclick = async () => { await navigator.clipboard.writeText(state.code); toast("Room code copied") }
  $("newRoom").onclick = () => { state.socket?.close(); state.code = ""; createRoom() }
  $("roomInput").oninput = (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4); $("joinError").textContent = "" }
  $("joinRoom").onclick = () => { const code = $("roomInput").value; if (code.length !== 4) { $("joinError").textContent = "Enter all four digits."; return } $("joinError").textContent = "Connecting to room…"; connectSocket("receiver") }
  $("joinRoom").onkeydown = (event) => { if (event.key === "Enter") $("joinRoom").click() }
  $("sendItems").onclick = sendSelected
  $("addLink").onclick = () => { let url = $("linkInput").value.trim(); if (!url) return; if (!/^https?:\/\//i.test(url)) url = `https://${url}`; state.pending.push({ kind: "link", name: url, size: "Web link" }); $("linkInput").value = ""; renderPending() }
  $("linkInput").onkeydown = (event) => { if (event.key === "Enter") $("addLink").click() }
  $("drop").onclick = () => $("fileInput").click(); $("fileInput").onchange = (event) => { addFiles(event.target.files); event.target.value = "" }; $("drop").ondragover = (event) => { event.preventDefault(); $("drop").classList.add("drag") }; $("drop").ondragleave = () => $("drop").classList.remove("drag"); $("drop").ondrop = (event) => { event.preventDefault(); $("drop").classList.remove("drag"); addFiles(event.dataTransfer.files) }
  $("endSession").onclick = () => endSession(true)
  renderPending(); renderReceived()
})()
