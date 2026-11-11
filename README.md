# Vexuli

Vexuli is a real-time browser-to-browser file and text transfer app. It is not a static-only site. The Node server serves the built page, creates unique four-digit rooms, verifies approval, and forwards WebRTC connection descriptions. **File bytes and text never go through the signaling WebSocket or get stored on the server.** Browsers exchange them over a WebRTC data channel encrypted with DTLS.

## Run locally

```bash
npm ci
npm run dev
```

Open `http://localhost:5173` in two tabs. In one tab, create a room. In the second, join with the code. Compare the pairing phrase, approve the request in the first tab, then send text or accept a file. The standard `dev` command builds the app and serves the real signaling server on the **same origin**, so the live transfer also works in a single-port preview. Restart it after code changes. For Vite hot reload during development, use `npm run dev:all` instead: Vite runs on 5173 and the signaling server on 3001.

For a production-like local run:

```bash
npm run build
npm start
```

Visit `http://localhost:3001`. Set `PORT` to change the server port. Production deployments **must use HTTPS**, which also provides WSS and secure browser APIs. `npm run typecheck` and `npm test` are available for verification.

## Deploy

Use a persistent Node web service that supports WebSocket upgrades, such as Render, Fly.io, Railway, or a VPS. **Do not publish only the `dist/` directory to a static host:** the live rooms and signaling endpoint would not exist.

For Render, import `render.yaml` as a Blueprint or create a Node web service with:

- Build: `npm ci && npm run build`
- Start: `npm start`
- Health check: `/health`
- Environment: `NODE_ENV=production`, `TRUST_PROXY=1`
- Instances: **one** (rooms are intentionally kept in process memory, not in Redis)
- Plan: always-on. Sleeping/free instances terminate active rooms and transfers.

The frontend, `/api/config`, and `/signal` WebSocket are served on the same domain and port. The service uses Render's `PORT` automatically. Set `ALLOWED_ORIGINS=https://your-domain.example` if you use a custom domain; the server also accepts its own origin by default. Terminate TLS at the platform or a reverse proxy. If you serve the frontend on a separate origin, configure `VITE_APP_SERVER_ORIGIN=https://your-server.example` **when building** and allow the frontend origin in `ALLOWED_ORIGINS`; same-origin deployment is simpler and safer.

### TURN for reliable cross-network transfers

WebRTC often connects directly using the included public STUN services. But some mobile networks, corporate firewalls, and symmetric NATs need a TURN server. **Configure TURN before promising it works from anywhere.** The app explicitly warns when TURN is missing. A TURN server forwards encrypted packets in transit; it does not save your file.

Run [coturn](https://github.com/coturn/coturn) on a reachable VPS or use a compatible managed TURN service. A minimal coturn configuration for time-limited credentials is:

```text
realm=turn.your-domain.example
fingerprint
use-auth-secret
static-auth-secret=YOUR_LONG_RANDOM_SECRET
listening-port=3478
tls-listening-port=5349
```

Set these variables on the Vexuli web service:

```text
TURN_URLS=turn:turn.your-domain.example:3478?transport=udp,turns:turn.your-domain.example:5349?transport=tcp
TURN_SHARED_SECRET=YOUR_LONG_RANDOM_SECRET
```

The same secret must be configured in coturn. Supply a real TLS certificate (`cert` and `pkey`) for `turns:`, and open TURN's listening and relay UDP ports in your firewall. If you do not configure TLS for TURN, omit the `turns:` URL. Vexuli issues one-hour coturn REST credentials only to participants in a room using `HMAC-SHA1(secret, "expiry:random-id")`. The secret stays on the server; it is not built into the frontend. Set allocation and bandwidth limits on your TURN service because TURN traffic costs bandwidth. `STUN_URLS` can be overridden with comma-separated `stun:` URLs if you run your own STUN service.

## Security and limits

- Four digits identify a temporary room; they are **not** an encryption password. The sender must approve the join, and people should compare the pairing phrase over a separate channel before accepting. Room codes expire after five minutes unless paired, and join attempts are limited to five per IP per minute with a five-minute lockout. The server permits three concurrent rooms per IP.
- The signaling server holds room codes, browser labels, SDP/ICE connection details and short-lived IP rate limits in memory. It does not persist messages or file bytes. TURN can see IP addresses and traffic metadata, but WebRTC's DTLS encrypts content in transit. **This is not an anonymity service.**
- Files are offered one at a time, require recipient acceptance, and are sent in 16 KiB chunks with application-level acknowledgements and bounded buffers. Up to 20 files may be queued; each file is limited to 100 MB.
- Chromium-based browsers can stream incoming files directly to a location chosen with the File System Access API. Safari/Firefox fall back to a local browser download, so the recipient must click **Save** after completion. Local download URLs are discarded on reload or when starting another room. Keep the tab open until downloading.
- Text messages are limited to 4,000 characters. Use a `.txt` file for longer text. No content is retained on the server; both sides lose the live session when either disconnects. A transfer does not resume after a session ends.
- Active rooms live only in a single Node process. For multiple web-service instances, introduce a shared room registry and a message broker before scaling out. This repository deliberately deploys as one instance.

## Quick real-world test

1. Deploy the web service over HTTPS and configure TURN.
2. On a phone using mobile data, create a room. On a laptop using a different network, join the code.
3. Read the pairing phrase from the laptop to the phone, approve on the phone, and wait for **Secure channel open**.
4. Send a text in each direction. Then offer a file, accept it on the other device, and save or download it. Verify its contents locally.
5. Close one tab and confirm the other tab reports the ended session. Try joining the same code again; it must be unavailable.