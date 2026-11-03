# Vexuli

Vexuli is a real-time, one-to-one file and link transfer app. The sender creates a short-lived room, the receiver joins with the server-issued four-digit code, and both devices can then send files or links to each other.

## Run locally

Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000> in two browser windows or on two devices connected to the same reachable server.

## How it works

- The room code is created by the server, so it works across devices instead of being generated independently in each browser.
- The server keeps only room membership and signaling data in memory.
- WebRTC negotiates a peer-to-peer data channel between the two devices.
- Files are chunked and sent directly over the encrypted data channel; file bytes are not uploaded to Vexuli.
- A room expires after 30 minutes and closes as soon as the host leaves.
- Only one receiver can join each room.

## Deploy on Render, Railway, Fly.io, or any Node host

Use these settings:

```text
Build command: npm install
Start command: npm start
Health check: /health
```

The app must be served over HTTPS in production so browsers allow WebRTC and secure WebSockets. Set the public app URL as the deployment URL and open that same URL on both devices.

Do not deploy this version to GitHub Pages or a static-only host: the room API and WebSocket signaling server need a persistent Node process. The signaling service forwards connection metadata only; it does not store file bytes.

## Security boundary

WebRTC data channels are encrypted in transit by the browser. The four-digit code is a room locator and pairing secret, not a standalone cryptographic identity; production deployments should add HTTPS, rate limiting, monitoring, and a stronger optional room secret if the threat model requires protection against code guessing.
