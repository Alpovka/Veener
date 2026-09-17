#!/usr/bin/env node
// Tiny Node server for the reference cloud. Env:
//   VENEER_SIGNING_KEY  pkcs8 base64url Ed25519 private key (generate with `node bin/keygen.mjs`)
//   VENEER_KEYS         "vn_live_abc:pro:10000,vn_live_def:starter"
//   PORT                default 8787
import http from 'node:http';
import { createCloudApp } from '../src/index.js';

const app = createCloudApp({ signingKey: process.env.VENEER_SIGNING_KEY, keysEnv: process.env.VENEER_KEYS, onError: (e, ctx) => console.error('[veneer-cloud]', e && e.message ? e.message : e, ctx) });
const port = Number(process.env.PORT || 8787);
http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const response = await app(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  })
  .listen(port, () => console.log(`veneer-cloud listening on :${port}`));
