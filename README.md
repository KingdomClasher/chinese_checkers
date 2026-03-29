# Chinese Checkers Web App

Realtime Chinese Checkers for desktop and mobile browsers with 2-player multiplayer rooms.

![preview.png]

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in two browser tabs/devices and join the same room code.

## Deploy frontend on Netlify

This app uses Socket.IO, so Netlify should host the frontend only (`public/`) while the Node server (`server.js`) runs on a Node host (Render/Railway/Fly.io/etc).

1. Deploy this repo to a Node host for the backend with:
   - Start command: `npm start`
   - Environment variable (recommended): `CLIENT_ORIGIN=https://<your-netlify-site>.netlify.app`
2. In Netlify, create a new site from this repo.
3. Set environment variable `SOCKET_SERVER_URL` to your backend URL (example: `https://your-backend.example.com`).
4. Deploy; `netlify.toml` will publish `public/` and generate `public/config.js` with that backend URL.

After deploy, users open the Netlify URL and the browser connects to your external Socket.IO server.

If "Join Room" appears unresponsive on Netlify, verify:
- `SOCKET_SERVER_URL` is set to your Railway backend URL in Netlify.
- `CLIENT_ORIGIN` on Railway includes your Netlify site URL.

## Contributing online

Repository: `https://github.com/KingdomClasher/chinese_checkers`

If someone should contribute without being added as a direct collaborator, they can:

1. Fork this repository on GitHub.
2. Clone their fork locally and create a feature branch.
3. Commit and push to their fork.
4. Open a Pull Request to `KingdomClasher/chinese_checkers`.

You can then review and merge their PR so changes land in the repo on your account.
