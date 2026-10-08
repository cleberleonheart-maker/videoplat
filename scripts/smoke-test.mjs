#!/usr/bin/env node
/* Smoke test de ponta a ponta: register → upload → transcode → playback. */
import fs from 'node:fs';

const API = process.env.API ?? 'http://localhost:4000/api';
const MEDIA = process.env.MEDIA ?? 'http://localhost:9000/videoplat';
const VIDEO = process.env.VIDEO ?? '/tmp/testvideo.mp4';

const step = (m) => console.log(`\n--- ${m}`);

async function json(res, label) {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 400)}`);
  }
  return body;
}

async function main() {
  const stamp = Date.now();
  const email = `smoke${stamp}@example.com`;

  step('1. register');
  const reg = await json(
    await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'senha-segura-123',
        username: `smoke${stamp}`,
        displayName: 'Smoke Test',
      }),
    }),
    'register',
  );
  const token = reg.accessToken;
  console.log('user:', reg.user.username, '| token:', token.slice(0, 18) + '...');

  step('2. initiate upload');
  const stat = fs.statSync(VIDEO);
  const session = await json(
    await fetch(`${API}/uploads/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        fileName: 'testvideo.mp4',
        contentType: 'video/mp4',
        sizeBytes: stat.size,
        title: 'Vídeo de teste 720p',
      }),
    }),
    'initiate',
  );
  console.log('mode:', session.mode, '| parts:', session.partsCount);

  step('3. upload to S3');
  const buf = fs.readFileSync(VIDEO);
  const done = [];
  for (const part of session.parts) {
    const start = (part.partNumber - 1) * session.partSize;
    const chunk = buf.subarray(start, Math.min(start + session.partSize, buf.length));
    const res = await fetch(part.url, { method: 'PUT', body: chunk });
    if (!res.ok) throw new Error(`PUT part ${part.partNumber}: HTTP ${res.status} ${await res.text()}`);
    const etag = res.headers.get('etag');
    if (!etag) throw new Error('no ETag');
    done.push({ partNumber: part.partNumber, etag });
    console.log(`part ${part.partNumber} ok (${chunk.length} bytes)`);
  }

  step('4. complete');
  const completed = await json(
    await fetch(`${API}/uploads/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        videoId: session.videoId,
        uploadId: session.uploadId,
        parts: done,
        title: 'Vídeo de teste 720p',
        description: 'Gerado por smoke-test.mjs',
        visibility: 'PUBLIC',
      }),
    }),
    'complete',
  );
  console.log('status:', completed.status);

  step('5. wait for transcode');
  let detail;
  // CPUs modestos precisam de vários minutos por vídeo.
  const deadline = Date.now() + (Number(process.env.TIMEOUT_MS) || 900_000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    detail = await json(
      await fetch(`${API}/videos/${session.videoId}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      'video',
    );
    process.stdout.write(`  status=${detail.status} `);
    if (detail.status === 'READY' || detail.status === 'FAILED') break;
  }
  console.log('');
  if (detail.status !== 'READY') {
    throw new Error(`unexpected status: ${detail.status} ${detail.errorReason ?? ''}`);
  }
  console.log('durationSec:', detail.durationSec, '| views:', detail.stats.views);

  step('6. playback');
  const playback = await json(await fetch(`${API}/videos/${session.videoId}/playback`), 'playback');
  for (const s of playback.sources) console.log(`  ${s.label} ${s.width}x${s.height} ${s.bitrateKbps}kbps`);

  step('7. fetch master playlist + a segment');
  const masterUrl = playback.masterUrl;
  const master = await fetch(masterUrl);
  if (!master.ok) throw new Error(`master: HTTP ${master.status}`);
  const masterText = await master.text();
  console.log(masterText.split('\n').slice(0, 6).join('\n'));

  const variantUrl = new URL(masterText.split('\n').find((l) => l.endsWith('.m3u8')), masterUrl).toString();
  const variant = await fetch(variantUrl);
  if (!variant.ok) throw new Error(`variant: HTTP ${variant.status}`);
  const variantText = await variant.text();
  const segLine = variantText.split('\n').find((l) => l.endsWith('.ts'));
  const segUrl = new URL(segLine, variantUrl).toString();
  const seg = await fetch(segUrl);
  if (!seg.ok) throw new Error(`segment: HTTP ${seg.status}`);
  const segBytes = (await seg.arrayBuffer()).byteLength;
  console.log(`segmento OK (${segBytes} bytes) em ${segUrl}`);

  step('8. thumbnail + feed + search');
  const thumbUrl = `${MEDIA}/videos/${session.videoId}/thumbs/hq.jpg`;
  const thumb = await fetch(thumbUrl);
  if (!thumb.ok) throw new Error(`thumbnail: HTTP ${thumb.status}`);
  console.log('thumbnail OK', thumb.headers.get('content-type'));

  const feed = await json(await fetch(`${API}/feed`), 'feed');
  console.log('feed latest:', feed.latest.length);

  const search = await json(await fetch(`${API}/search?q=720p`), 'search');
  console.log('search results:', search.total);

  step('9. view + reaction + comment');
  await json(
    await fetch(`${API}/videos/${session.videoId}/views`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
    'view',
  );
  const detail2 = await json(await fetch(`${API}/videos/${session.videoId}`), 'detail');
  console.log('views:', detail2.stats.views);

  const reaction = await json(
    await fetch(`${API}/videos/${session.videoId}/comments/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: 'LIKE' }),
    }),
    'reaction',
  );
  console.log('reaction:', reaction.reaction);

  const comment = await json(
    await fetch(`${API}/videos/${session.videoId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ body: 'Comentário de teste!' }),
    }),
    'comment',
  );
  console.log('comment id:', comment.id);

  step('10. search by title');
  const search2 = await json(await fetch(`${API}/search?q=teste`), 'search2');
  console.log('results for "teste":', search2.total);

  console.log(`\n✔ PASS — videoId=${session.videoId}`);
}

main().catch((e) => {
  console.error('\n✖ FAIL:', e.message);
  process.exit(1);
});
