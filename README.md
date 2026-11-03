# Vexuli

Private, focused file and link transfer UI for a two-device room.

## Run locally

```bash
python -m http.server 8765
```

Open <http://localhost:8765>.

## Deploy the interface

This is a zero-build static page. It can be deployed to GitHub Pages, Vercel, Netlify, or any static host. For Vercel:

```bash
npx vercel --prod
```

## Important transport note

The page is a complete front-end prototype and demonstrates the room, pairing, file selection, link selection, and transfer states locally in one browser. Actual cross-device transfer requires a WebRTC data channel plus a small signaling service to exchange offers, answers, and ICE candidates. A four-digit room code alone is not a cryptographic identity, so a production service should also use short-lived room tokens, rate limiting, room expiry, and server-side validation. WebRTC data channels provide encrypted transport after the peers connect.

Keep the signaling service separate from file storage: it should forward connection metadata only and never persist file bytes.
