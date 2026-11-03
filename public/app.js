
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[c]));
  const bytes = (n) => {
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
    return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
  };
  const kindOf = (file) => {
    const n = file.name.toLowerCase();
    if (file.type.startsWith('image/')) return 'image';
    if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return 'archive';
    if (/\.(js|ts|tsx|jsx|css|html|json)$/.test(n)) return 'code';
    return 'document';
  };
  const iconFor = {
    image: '◫',
    document: '▤',
    archive: '□',
    link: '↗',
    code: '⌘'
  };

  const state = {
    socket: null,
    role: null,
    code: null,
    connected: false,
    files: [],
    received: [],
    pc: null,
    dc: null,
    peerSocketId: null,
    sending: false,
    chunkSize: 16384,
    incoming: null,
  };

  let toastTimer;

  function toast(msg) {
    const t = $('toast');
    t.textContent = '✓  ' + msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
    }, 2400);
  }

  function renderCode() {
    const senderView = $('senderCodeView');
    const receiverView = $('receiverCodeView');
    const label = $('sideCodeLabel');
    const codeEl = $('code');
    const pillValue = $('codePillValue');
    const pillLabel = $('codePillLabel');

    if (state.role === 'receiver') {
      senderView.hidden = true;
      receiverView.hidden = false;
      label.textContent = 'Room code';

      if (state.code) {
        pillValue.textContent = state.code;
        pillLabel.textContent = 'Room';
      } else {
        pillValue.textContent = '————';
        pillLabel.textContent = 'Code';
      }
      return;
    }

    senderView.hidden = false;
    receiverView.hidden = true;
    label.textContent = 'Room code';

    if (state.code) {
      codeEl.innerHTML = state.code
        .split('')
        .map(n => `<b>${n}</b>`)
        .join('');

      pillValue.textContent = state.code;
      pillLabel.textContent = 'Code';
    } else {
      codeEl.innerHTML = '<b>—</b><b>—</b><b>—</b><b>—</b>';
      pillValue.textContent = '————';
      pillLabel.textContent = 'Code';
    }
  }

  function renderFiles() {
    $('count').textContent =
      `${state.files.length} item${state.files.length === 1 ? '' : 's'}`;

    $('sendBtnCount').textContent =
      state.files.length ? `(${state.files.length})` : '';

    const canSend =
      state.files.length > 0 &&
      state.connected &&
      state.dc?.readyState === 'open';

    $('sendBtn').disabled = !canSend;

    if (!state.files.length) {
      $('items').innerHTML = `
        <div class="empty">
          <b>＋</b>
          <span>No files yet.</span>
        </div>`;
      return;
    }

    $('items').innerHTML = state.files.map((f, i) => {
      const cls = f.kind === 'image' ? 'sage'
        : f.kind === 'archive' ? 'sand'
        : f.kind === 'link' ? 'blue'
        : 'slate';

      return `<div class="item">
        <span class="item-icon ${cls}">
          ${iconFor[f.kind] || '▤'}
        </span>
        <span class="file">
          <b title="${esc(f.name)}">${esc(f.name)}</b>
          <small>${f.size} <span class="ready">· ready</span></small>
        </span>
        <button
          class="remove"
          data-remove="${i}"
          aria-label="Remove ${esc(f.name)}"
        >✕</button>
      </div>`;
    }).join('');

    document.querySelectorAll('[data-remove]').forEach(b => {
      b.onclick = () => {
        state.files.splice(Number(b.dataset.remove), 1);
        renderFiles();
        renderConnection();
      };
    });
  }

  function renderReceived() {
    $('receiveCount').textContent = `${state.received.length} received`;

    $('receiveStatus').textContent = state.received.length
      ? `${state.received.length} item${state.received.length === 1 ? '' : 's'}`
      : (state.connected ? 'waiting…' : '—');

    if (!state.received.length) {
      $('received').innerHTML = `
        <div class="empty">
          <b>↓</b>
          <span>${state.connected ? 'Waiting for incoming…' : 'Connect to receive.'}</span>
        </div>`;
      return;
    }

    $('received').innerHTML = state.received.map((f) => {
      const cls = f.kind === 'link'
        ? 'blue'
        : (f.kind === 'image' ? 'sage' : 'slate');

      const action = f.kind === 'link'
        ? `<a class="download-btn" href="${esc(f.url)}" target="_blank" rel="noopener">Open ↗</a>`
        : `<a class="download-btn" href="${esc(f.url)}" download="${esc(f.name)}">Download ↓</a>`;

      const nameHtml = f.kind === 'link'
        ? `<a class="link-anchor" href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.name)}">${esc(f.name)}</a>`
        : `<b title="${esc(f.name)}">${esc(f.name)}</b>`;

      return `<div class="item">
        <span class="item-icon ${cls}">
          ${iconFor[f.kind] || '▤'}
        </span>
        <span class="file">
          ${nameHtml}
          <small>${f.size} <span class="ready">· received</span></small>
        </span>
        ${action}
      </div>`;
    }).join('');
  }

  function updateProgress(name, pct) {
    const wrap = $('received');
    let row = wrap.querySelector(`[data-progress="${CSS.escape(name)}"]`);

    if (!row) {
      row = document.createElement('div');
      row.className = 'item';
      row.dataset.progress = name;

      row.innerHTML = `
        <span class="item-icon slate">▤</span>
        <span class="file">
          <b>${esc(name)}</b>
          <small class="ready">receiving…</small>
          <div class="progress"><i></i></div>
        </span>`;

      wrap.appendChild(row);
    }

    const bar = row.querySelector('.progress i');
    if (bar) bar.style.width = pct + '%';
  }

  function renderConnection() {
    const c = state.connected;

    $('roomDot').classList.toggle('paired', c);
    $('roomStatus').textContent = c ? 'Connected' : 'Waiting';

    $('sendHintDot').classList.toggle('ready', c);
    $('sendHint').textContent = c
      ? (state.files.length ? 'Ready' : 'Add files')
      : 'Waiting…';

    if (state.role === 'receiver') {
      $('connectedState').hidden = !c;
    }

    renderFiles();
    renderReceived();
  }

  function setRoleUI(role) {
    state.role = role;
    $('roleSection').style.display = 'none';
    $('workspace').classList.add('active');

    if (role === 'sender') {
      $('senderBody').hidden = false;
      $('receiverBody').hidden = true;
    } else {
      $('senderBody').hidden = true;
      $('receiverBody').hidden = false;

      setTimeout(() => $('joinCode').focus(), 120);
    }

    renderCode();
    renderConnection();

    $('workspace').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  function createPeer() {
    if (state.pc) {
      try {
        state.pc.close();
      } catch (e) {}
    }

    const pc = new RTCPeerConnection(rtcConfig);
    state.pc = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate && state.socket) {
        state.socket.emit('signal', {
          to: state.peerSocketId,
          data: {
            type: 'candidate',
            candidate: e.candidate
          }
        });
      }
    };

    pc.ondatachannel = (e) => {
      setupDataChannel(e.channel);
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        handleDisconnect();
      }
    };

    return pc;
  }

  function setupDataChannel(dc) {
    state.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 65536;

    dc.onopen = () => {
      state.connected = true;
      renderConnection();
      toast('Connected');
    };

    dc.onclose = () => {
      handleDisconnect();
    };

    dc.onerror = (e) => {
      console.error('DataChannel', e);
    };

    dc.onmessage = (e) => {
      handleDataMessage(e.data);
    };
  }

  function handleDataMessage(data) {
    if (typeof data === 'string') {
      let msg;

      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.t === 'start') {
        state.incoming = {
          name: msg.name,
          size: msg.size,
          kind: msg.kind,
          mimetype: msg.mimetype || 'application/octet-stream',
          chunks: [],
          received: 0
        };
      } else if (msg.t === 'end') {
        if (!state.incoming) return;

        const inc = state.incoming;

        if (inc.kind === 'link') {
          state.received.push({
            name: inc.name,
            size: 'Web link',
            kind: 'link',
            url: inc.name
          });
        } else {
          const blob = new Blob(inc.chunks, {
            type: inc.mimetype
          });

          state.received.push({
            name: inc.name,
            size: bytes(inc.size),
            kind: inc.kind,
            blob,
            url: URL.createObjectURL(blob)
          });
        }

        state.incoming = null;
        renderReceived();
        toast('Received: ' + inc.name);
      }

      return;
    }

    if (state.incoming && data instanceof ArrayBuffer) {
      state.incoming.chunks.push(data);
      state.incoming.received += data.byteLength;

      const pct = Math.min(
        100,
        Math.round(
          (state.incoming.received / state.incoming.size) * 100
        )
      );

      updateProgress(state.incoming.name, pct);
    }
  }

  async function startSenderNegotiation() {
    const pc = createPeer();

    const dc = pc.createDataChannel('vexuli-transfer', {
      ordered: true
    });

    setupDataChannel(dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    state.socket.emit('signal', {
      to: state.peerSocketId,
      data: {
        type: 'offer',
        sdp: offer
      }
    });
  }

  async function handleSignal({ from, data }) {
    state.peerSocketId = from;

    if (data.type === 'offer') {
      const pc = createPeer();

      await pc.setRemoteDescription(
        new RTCSessionDescription(data.sdp)
      );

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      state.socket.emit('signal', {
        to: from,
        data: {
          type: 'answer',
          sdp: answer
        }
      });
    } else if (data.type === 'answer') {
      if (state.pc) {
        await state.pc.setRemoteDescription(
          new RTCSessionDescription(data.sdp)
        );
      }
    } else if (data.type === 'candidate') {
      if (state.pc && data.candidate) {
        try {
          await state.pc.addIceCandidate(
            new RTCIceCandidate(data.candidate)
          );
        } catch (e) {
          console.warn('ICE', e);
        }
      }
    }
  }

  function handleDisconnect() {
    state.connected = false;
    state.peerSocketId = null;

    if (state.dc) {
      try {
        state.dc.close();
      } catch (e) {}

      state.dc = null;
    }

    if (state.pc) {
      try {
        state.pc.close();
      } catch (e) {}

      state.pc = null;
    }

    for (const r of state.received) {
      if (r.url && r.blob) {
        try {
          URL.revokeObjectURL(r.url);
        } catch (e) {}
      }
    }

    renderCode();
    renderConnection();
  }

  async function sendFiles() {
    if (
      !state.connected ||
      !state.dc ||
      state.dc.readyState !== 'open'
    ) {
      return toast('Wait for connection');
    }

    if (state.sending) return;

    state.sending = true;
    $('sendBtn').disabled = true;

    const queue = [...state.files];

    try {
      for (const item of queue) {
        if (item.kind === 'link') {
          state.dc.send(JSON.stringify({
            t: 'start',
            name: item.name,
            size: 0,
            kind: 'link'
          }));

          state.dc.send(JSON.stringify({
            t: 'end',
            name: item.name
          }));

          continue;
        }

        if (!item.raw) continue;

        const file = item.raw;

        state.dc.send(JSON.stringify({
          t: 'start',
          name: file.name,
          size: file.size,
          kind: item.kind,
          mimetype: file.type || 'application/octet-stream'
        }));

        let offset = 0;

        while (offset < file.size) {
          if (
            state.dc.bufferedAmount >
            state.dc.bufferedAmountLowThreshold * 4
          ) {
            await new Promise(r => setTimeout(r, 30));
            continue;
          }

          const slice = file.slice(
            offset,
            offset + state.chunkSize
          );

          const buf = await slice.arrayBuffer();

          state.dc.send(buf);
          offset += buf.byteLength;
        }

        state.dc.send(JSON.stringify({
          t: 'end',
          name: file.name
        }));
      }

      toast(
        'Sent ' +
        queue.length +
        ' item' +
        (queue.length === 1 ? '' : 's')
      );

      const sent = new Set(queue.map(q => q.name));

      state.files = state.files.filter(
        f => !sent.has(f.name)
      );

      renderFiles();
      renderConnection();
    } catch (err) {
      console.error(err);
      toast('Send failed: ' + err.message);
    } finally {
      state.sending = false;
      renderConnection();
    }
  }

  function addFiles(list) {
    Array.from(list || []).forEach(f => {
      const dup = state.files.some(
        x =>
          x.name === f.name &&
          x.size === bytes(f.size) &&
          x.raw === f
      );

      if (!dup) {
        state.files.push({
          name: f.name,
          size: bytes(f.size),
          kind: kindOf(f),
          raw: f
        });
      }
    });

    renderFiles();
    renderConnection();
  }

  // Render deployment: Vercel frontend + Render Socket.IO backend.
  function connectSocket() {
    const socket = io('https://vexuli.onrender.com', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    state.socket = socket;

    socket.on('connect', () => {
      $('serverStatus').classList.remove('offline');
      $('serverStatusText').textContent = 'Online';

      console.log('Socket.IO connected:', socket.id);
    });

    socket.on('connect_error', (err) => {
      console.error(
        'Socket.IO connection error:',
        err.message
      );

      $('serverStatus').classList.add('offline');
      $('serverStatusText').textContent = 'Connecting…';
    });

    socket.on('disconnect', (reason) => {
      console.warn('Socket.IO disconnected:', reason);

      $('serverStatus').classList.add('offline');
      $('serverStatusText').textContent = 'Offline';

      handleDisconnect();
    });

    socket.on('room-created', ({ code }) => {
      state.code = code;
      state.connected = false;
      state.peerSocketId = null;

      renderCode();
      renderConnection();

      toast('Code ' + code);
    });

    socket.on('room-joined', ({ code }) => {
      state.code = code;

      renderCode();

      toast('Joined ' + code);
    });

    socket.on('peer-joined', ({ id }) => {
      state.peerSocketId = id;
      state.connected = false;

      renderConnection();
      toast('Connecting…');

      if (state.role === 'sender') {
        startSenderNegotiation().catch((err) => {
          console.error(
            'Sender negotiation error:',
            err
          );

          toast('Connection failed');
        });
      }
    });

    socket.on('peer-left', () => {
      handleDisconnect();
      toast('Peer left');
    });

    socket.on('signal', (message) => {
      handleSignal(message).catch((err) => {
        console.error('Signaling error:', err);
      });
    });

    socket.on('error-msg', ({ message }) => {
      toast(message || 'Error');
    });
  }

  $('chooseSender').onclick = () => {
    if (!state.socket || !state.socket.connected) {
      return toast('Connecting…');
    }

    setRoleUI('sender');
    state.socket.emit('create-room');
  };

  $('chooseReceiver').onclick = () => {
    if (!state.socket || !state.socket.connected) {
      return toast('Connecting…');
    }

    setRoleUI('receiver');
    renderConnection();

    setTimeout(() => $('joinCode').focus(), 220);
  };

  $('backBtn').onclick = () => {
    handleDisconnect();

    state.code = null;
    state.role = null;
    state.files = [];

    for (const r of state.received) {
      if (r.url && r.blob) {
        try {
          URL.revokeObjectURL(r.url);
        } catch (e) {}
      }
    }

    state.received = [];

    $('joinCode').value = '';
    $('workspace').classList.remove('active');
    $('roleSection').style.display = '';
    $('roomStatus').textContent = 'Waiting';
    $('senderCodeView').hidden = false;
    $('receiverCodeView').hidden = true;
    $('codePillValue').textContent = '————';
    $('code').innerHTML =
      '<b>—</b><b>—</b><b>—</b><b>—</b>';

    $('roleSection').scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  };

  const drop = $('drop');

  $('browseBtn').onclick = (e) => {
    e.stopPropagation();
    $('fileInput').click();
  };

  drop.onclick = () => {
    $('fileInput').click();
  };

  $('fileInput').onchange = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  };

  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('drag');
  };

  drop.ondragleave = () => {
    drop.classList.remove('drag');
  };

  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('drag');

    addFiles(e.dataTransfer.files);
  };

  $('addLink').onclick = () => {
    let v = $('linkInput').value.trim();

    if (!v) return;

    if (!/^https?:\/\//i.test(v)) {
      v = 'https://' + v;
    }

    state.files.push({
      name: v,
      size: 'Web link',
      kind: 'link'
    });

    $('linkInput').value = '';

    renderFiles();
    renderConnection();
  };

  $('linkInput').onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('addLink').click();
    }
  };

  $('sendBtn').onclick = () => {
    sendFiles();
  };

  $('copyBtn').onclick = async () => {
    if (!state.code) return toast('No code');

    try {
      await navigator.clipboard.writeText(state.code);
      toast('Copied');
    } catch {
      toast('Code ' + state.code);
    }
  };

  $('refreshBtn').onclick = () => {
    if (!state.socket || !state.socket.connected) {
      return toast('Connecting…');
    }

    if (state.role === 'sender') {
      state.socket.emit('create-room');
    } else {
      state.code = null;

      handleDisconnect();
      renderCode();
      renderConnection();

      toast('Cleared');
    }
  };

  $('joinCode').oninput = (e) => {
    e.target.value = e.target.value
      .replace(/\D/g, '')
      .slice(0, 4);
  };

  $('joinBtn').onclick = () => {
    const code = $('joinCode').value.trim();

    if (code.length !== 4) {
      return toast('Enter 4 digits');
    }

    if (!state.socket || !state.socket.connected) {
      return toast('Connecting…');
    }

    state.socket.emit('join-room', { code });
  };

  $('joinCode').onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('joinBtn').click();
    }
  };

  renderCode();
  renderFiles();
  renderReceived();

  connectSocket();
})();
escription(data.sdp));
    } else if (data.type === 'candidate') {
      if (state.pc && data.candidate) {
        try { await state.pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
        catch (e) { console.warn('ICE', e); }
      }
    }
  }

  function handleDisconnect() {
    state.connected = false;
    state.peerSocketId = null;
    if (state.dc) { try { state.dc.close(); } catch (e) {} state.dc = null; }
    if (state.pc) { try { state.pc.close(); } catch (e) {} state.pc = null; }
    for (const r of state.received) {
      if (r.url && r.blob) { try { URL.revokeObjectURL(r.url); } catch (e) {} }
    }
    renderCode();
    renderConnection();
  }

  async function sendFiles() {
    if (!state.connected || !state.dc || state.dc.readyState !== 'open') {
      return toast('Wait for connection');
    }
    if (state.sending) return;
    state.sending = true;
    $('sendBtn').disabled = true;

    const queue = [...state.files];
    try {
      for (const item of queue) {
        if (item.kind === 'link') {
          state.dc.send(JSON.stringify({ t: 'start', name: item.name, size: 0, kind: 'link' }));
          state.dc.send(JSON.stringify({ t: 'end', name: item.name }));
          continue;
        }
        if (!item.raw) continue;
        const file = item.raw;
        state.dc.send(JSON.stringify({
          t: 'start', name: file.name, size: file.size, kind: item.kind,
          mimetype: file.type || 'application/octet-stream'
        }));
        let offset = 0;
        while (offset < file.size) {
          if (state.dc.bufferedAmount > state.dc.bufferedAmountLowThreshold * 4) {
            await new Promise(r => setTimeout(r, 30));
            continue;
          }
          const slice = file.slice(offset, offset + state.chunkSize);
          const buf = await slice.arrayBuffer();
          state.dc.send(buf);
          offset += buf.byteLength;
        }
        state.dc.send(JSON.stringify({ t: 'end', name: file.name }));
      }
      toast('Sent ' + queue.length + ' item' + (queue.length === 1 ? '' : 's'));
      const sent = new Set(queue.map(q => q.name));
      state.files = state.files.filter(f => !sent.has(f.name));
      renderFiles();
      renderConnection();
    } catch (err) {
      console.error(err);
      toast('Send failed: ' + err.message);
    } finally {
      state.sending = false;
      renderConnection();
    }
  }

  function addFiles(list) {
    Array.from(list || []).forEach(f => {
      const dup = state.files.some(x => x.name === f.name && x.size === bytes(f.size) && x.raw === f);
      if (!dup) state.files.push({ name: f.name, size: bytes(f.size), kind: kindOf(f), raw: f });
    });
    renderFiles();
    renderConnection();
  }

  function connectSocket() {
    const socket = io({ transports: ['websocket', 'polling'] });
    state.socket = socket;
    socket.on('connect', () => {
      $('serverStatus').classList.remove('offline');
      $('serverStatusText').textContent = 'Online';
    });
    socket.on('disconnect', () => {
      $('serverStatus').classList.add('offline');
      $('serverStatusText').textContent = 'Offline';
      handleDisconnect();
    });
    socket.on('room-created', ({ code }) => {
      state.code = code;
      state.connected = false;
      state.peerSocketId = null;
      renderCode();
      renderConnection();
      toast('Code ' + code);
    });
    socket.on('room-joined', ({ code }) => {
      state.code = code;
      renderCode();
      toast('Joined ' + code);
    });
    socket.on('peer-joined', ({ id }) => {
      state.peerSocketId = id;
      state.connected = false;
      renderConnection();
      toast('Connecting…');
      if (state.role === 'sender') startSenderNegotiation().catch(e => console.error(e));
    });
    socket.on('peer-left', () => { handleDisconnect(); toast('Peer left'); });
    socket.on('signal', handleSignal);
    socket.on('error-msg', ({ message }) => toast(message || 'Error'));
  }

  $('chooseSender').onclick = () => {
    if (!state.socket || !state.socket.connected) return toast('Connecting…');
    setRoleUI('sender');
    state.socket.emit('create-room');
  };
  $('chooseReceiver').onclick = () => {
    if (!state.socket || !state.socket.connected) return toast('Connecting…');
    setRoleUI('receiver');
    renderConnection();
    setTimeout(() => $('joinCode').focus(), 220);
  };

  $('backBtn').onclick = () => {
    handleDisconnect();
    state.code = null;
    state.role = null;
    state.files = [];
    for (const r of state.received) {
      if (r.url && r.blob) { try { URL.revokeObjectURL(r.url); } catch (e) {} }
    }
    state.received = [];
    $('joinCode').value = '';
    $('workspace').classList.remove('active');
    $('roleSection').style.display = '';
    $('roomStatus').textContent = 'Waiting';
    $('senderCodeView').hidden = false;
    $('receiverCodeView').hidden = true;
    $('codePillValue').textContent = '————';
    $('code').innerHTML = '<b>—</b><b>—</b><b>—</b><b>—</b>';
    $('roleSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const drop = $('drop');
  $('browseBtn').onclick = (e) => { e.stopPropagation(); $('fileInput').click(); };
  drop.onclick = () => $('fileInput').click();
  $('fileInput').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drag'); addFiles(e.dataTransfer.files); };

  $('addLink').onclick = () => {
    let v = $('linkInput').value.trim();
    if (!v) return;
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    state.files.push({ name: v, size: 'Web link', kind: 'link' });
    $('linkInput').value = '';
    renderFiles();
    renderConnection();
  };
  $('linkInput').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('addLink').click(); }
  };

  $('sendBtn').onclick = () => sendFiles();

  $('copyBtn').onclick = async () => {
    if (!state.code) return toast('No code');
    try { await navigator.clipboard.writeText(state.code); toast('Copied'); }
    catch { toast('Code ' + state.code); }
  };
  $('refreshBtn').onclick = () => {
    if (!state.socket || !state.socket.connected) return toast('Connecting…');
    if (state.role === 'sender') state.socket.emit('create-room');
    else {
      state.code = null;
      handleDisconnect();
      renderCode();
      renderConnection();
      toast('Cleared');
    }
  };

  $('joinCode').oninput = (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
  };
  $('joinBtn').onclick = () => {
    const code = $('joinCode').value.trim();
    if (code.length !== 4) return toast('Enter 4 digits');
    if (!state.socket || !state.socket.connected) return toast('Connecting…');
    state.socket.emit('join-room', { code });
  };
  $('joinCode').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); $('joinBtn').click(); }
  };

  renderCode();
  renderFiles();
  renderReceived();
  connectSocket();
})();
