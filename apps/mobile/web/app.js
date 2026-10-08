'use strict';

/* farol de diagnóstico: texto verde no canto superior esquerdo,
 * visível na tela do aparelho (permite confirmar build/WebView/frames). */
(function () {
  var m = /Chrome\/([0-9]+)/.exec(navigator.userAgent);
  var wv = m ? m[1] : '?';
  var build = '1.0-1830';
  function pinta() {
    var el = document.getElementById('prova');
    if (!el) return;
    var video = document.getElementById('source');
    var f = -2;
    if (video) {
      try { f = totalVideoFramesOf(video); } catch (e) { f = -3; }
    }
    var fe = f < 0 ? 'f=-' + (f < -2 ? 'erro' : 'sem') : 'f=' + f;
    var readyP = typeof state !== 'undefined' ? state.ready : '-';
    var probeP = typeof state !== 'undefined' && state._probeState ? state._probeState : '-';
    el.textContent = build + ' webview' + wv + '\n' + fe + ' p=' + probeP + ' ready=' + readyP;
  }
  try { pinta(); } catch (e) {}
  setInterval(function () { try { pinta(); } catch (e) {} }, 1000);
})();

/* ============================================================
 * Câmera VideoPlat — app autônomo (foto + vídeo) para Android
 * WebView (Capacitor). Sem dependências externas.
 * ============================================================ */

const FILTERS = [
  { id: 'original', label: 'Original', css: '' },
  { id: 'mondo', label: 'P&B', css: 'grayscale(1)' },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.25) brightness(0.92)' },
  { id: 'sepia', label: 'Rétro', css: 'sepia(0.85) saturate(1.3)' },
  { id: 'vivido', label: 'Vívido', css: 'saturate(1.6) contrast(1.05)' },
  { id: 'frio', label: 'Frio', css: 'saturate(1.15) brightness(1.05) hue-rotate(-6deg)' },
  { id: 'quente', label: 'Quente', css: 'sepia(0.3) saturate(1.4) hue-rotate(-18deg) brightness(1.05)' },
  { id: 'claro', label: 'Claro', css: 'brightness(1.18) saturate(1.25)' },
  { id: 'noite', label: 'Noite', css: 'contrast(1.15) brightness(0.85) saturate(1.5)' },
  { id: 'ciano', label: 'Ciano', css: 'hue-rotate(160deg) saturate(1.5)' },
];

const ASPECTS = [
  { id: 'free', label: 'Livre', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

const RESOLUTIONS = [
  { id: 'source', label: 'Padrão', width: null, height: null },
  { id: '4k', label: '4K', width: 3840, height: 2160 },
  { id: '1080', label: '1080p', width: 1920, height: 1080 },
  { id: '720', label: '720p', width: 1280, height: 720 },
];

const TIMER_OPTIONS = [
  { id: 0, label: '0s' },
  { id: 3, label: '3s' },
  { id: 5, label: '5s' },
  { id: 10, label: '10s' },
];

const isNative = typeof window.Capacitor !== 'undefined' && window.Capacitor.getPlatform() !== 'web';
const core = () => window.Capacitor.Plugins;
const camPrev = () => {
  try {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CameraPreview
      ? window.Capacitor.Plugins.CameraPreview
      : null;
  } catch (_) {
    return null;
  }
};

/* ---------------- estado ---------------- */

const state = {
  mode: 'photo', // photo | video
  rec: 'inactive', // inactive | recording | paused
  elapsed: 0,
  facing: 'environment',
  deviceId: '',
  devices: [],
  aspectId: 'free',
  resolutionId: 'source',
  filterId: 'original',
  timer: 0,
  mirror: false,
  grid: false,
  audioOn: true,
  torch: false,
  torchSupported: false,
  zoom: 1,
  zoomCap: null, // {min,max,step}
  ready: false,
  starting: true,
  error: null,
  flash: false,
  countdown: 0,
  stream: null,
  streamInfo: null,
  freeRatio: null,
  gallery: [],
  preview: null,
  panel: null, // timer | aspect | filter | resolution | cameras | settings
  toast: null,
  _lastFrames: 0,
  _recovering: false,
  _recoveries: 0,
  _probeState: '', // ok | black | dim | erro (preview via canvas)
  nativeMode: false, // preview nativo (CameraPreview) no lugar do WebView
};

const v = {
  app: null,
  video: null,
  canvas: null,
  ctx: null,
  stage: null,
  overlay: null,
  cameraHud: null,
  recHud: null,
  countdownEl: null,
  infoHud: null,
  preview: null, // canvas visível (#preview)
  pctx: null,
};

const refs = {
  recorder: null,
  chunks: [],
  raf: 0,
  praf: 0,
  audioCtx: null,
  timerInt: 0,
  recordStart: 0,
  recordNative: 0,
  elapsedBase: 0,
};

/* ---------------- helpers ---------------- */

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

function fmtTime(totalSec) {
  totalSec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}

function extFor(mime) {
  if (mime.startsWith('video/mp4')) return 'mp4';
  if (mime.startsWith('video/webm')) return 'webm';
  if (mime.startsWith('video/quicktime')) return 'mov';
  return 'bin';
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function bitrateFor(resId) {
  switch (resId) {
    case '4k':
      return 30000000;
    case '1080':
      return 12000000;
    case '720':
      return 6000000;
    default:
      return 12000000;
  }
}

function pickMime() {
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const c of candidates) if (MediaRecorder.isTypeSupported(c)) return c;
  return '';
}

function fallbackExtFor(mime) {
  return extFor(mime);
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function beep(freq = 880, dur = 0.06, gain = 0.12) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!refs.audioCtx) refs.audioCtx = new Ctx();
    const ctx = refs.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch (_) {
    /* sem áudio: ok */
  }
}

function activeFilter() {
  return FILTERS.find((f) => f.id === state.filterId) || FILTERS[0];
}

function activeAspect() {
  return ASPECTS.find((a) => a.id === state.aspectId) || ASPECTS[0];
}

/* ---------------- thread da câmera ---------------- */

/* Alguns WebViews (ex.: Android 16 / WebView 156 em certos SoCs)
 * abrem a câmera mas nunca renderizam um frame no <video>. A solução
 * é tentar configurações explícitas e validar se há frames de verdade
 * através do VideoPlaybackQuality, além de manter uma animação leve
 * na página (workaround conhecido do Chromium #1401352).
 */
const CAM_PRESETS = [
  { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24 } },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function totalVideoFramesOf(video) {
  if (video && video.getVideoPlaybackQuality) {
    try {
      return video.getVideoPlaybackQuality().totalVideoFrames || 0;
    } catch (_) {
      return 0;
    }
  }
  return -1;
}

async function acquireStream(videoCv) {
  const gum = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: videoCv,
  });
  let timer = 0;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('A câmera não respondeu a tempo')), 20000);
  });
  try {
    return await Promise.race([gum, timeout]);
  } catch (e) {
    gum.then(
      (s) => s.getTracks().forEach((t) => t.stop()),
      () => undefined,
    );
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* Anexa o stream e espera um frame real chegar ao <video>.
 * Retorna true se decodificou pelo menos um frame. */
async function attachAndCheck(stream, timeoutMs, baseline) {
  const video = v.video;
  video.srcObject = stream;
  video.muted = true;
  await video.play().catch(() => undefined);
  let firstFrameCb = false;
  try {
    if (video.requestVideoFrameCallback) {
      video.requestVideoFrameCallback(() => {
        firstFrameCb = true;
      });
    }
  } catch (_) {
    /* sem callback: usa o fallback abaixo */
  }
  const t0 = Date.now();
  for (;;) {
    const frames = totalVideoFramesOf(video);
    const hasFrames = frames > baseline || (frames < 0 && video.videoWidth > 0);
    if (hasFrames || firstFrameCb) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(120);
  }
}

async function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  cancelAnimationFrame(refs.raf);
  refs.raf = 0;
  cancelAnimationFrame(refs.praf);
  refs.praf = 0;
}

async function enumerateDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    state.devices = list
      .filter((d) => d.kind === 'videoinput')
      .map((d) => ({ id: d.deviceId, label: d.label || `Câmera ${d.deviceId.slice(0, 4)}` }));
  } catch (_) {
    state.devices = [];
  }
  render();
}

async function startCamera(opts = {}) {
  if (state.nativeMode) {
    state.starting = false;
    return;
  }
  state.starting = true;
  state.error = null;
  await stopStream();
  render();

  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('getUserMedia indisponível');

    const res = RESOLUTIONS.find((r) => r.id === (opts.resolutionId || state.resolutionId)) || RESOLUTIONS[0];

    const base = {};
    if (opts.deviceId) base.deviceId = { exact: opts.deviceId };
    else if (opts.facing) base.facingMode = opts.facing;
    else if (state.deviceId) base.deviceId = { exact: state.deviceId };
    else base.facingMode = state.facing;

    const ladders = [];
    if (res.width) ladders.push({ width: { ideal: res.width }, height: { ideal: res.height } });
    if (!res.width) for (const p of CAM_PRESETS) ladders.push(p);

    let stream = null;
    let lastErr = null;
    let baseline = state._lastFrames || 0;
    for (const p of ladders) {
      const videoCv = {};
      for (const k in base) videoCv[k] = base[k];
      for (const k in p) videoCv[k] = p[k];
      try {
        stream = await acquireStream(videoCv);
      } catch (e) {
        lastErr = e;
        stream = null;
        continue;
      }
      const ok = await attachAndCheck(stream, 6000, baseline);
      baseline = Math.max(baseline, totalVideoFramesOf(v.video));
      if (ok) break;
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      state.stream = null;
      await sleep(400);
    }
    if (!stream) {
      if (camPrev()) {
        const okNative = await startNativePreview();
        if (okNative) return;
      }
      if (lastErr) throw lastErr;
      throw new Error(
        'A câmera abriu mas nenhuma imagem chegou ao app no seu WebView. ' +
          'Tente: 1) atualizar o "Android System WebView" na Play Store; ' +
          '2) tocar no botão "Tentar novamente" abaixo.',
      );
    }
    state.stream = stream;

    const video = v.video;
    const track = stream.getVideoTracks()[0];
    const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
    state.streamInfo = { width: settings.width || 0, height: settings.height || 0 };
    if (settings.width && settings.height) state.freeRatio = settings.width / settings.height;

    const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
    state.zoomCap =
      caps.zoom && caps.zoom.min !== undefined
        ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0 }
        : null;
    state.zoom = state.zoomCap ? 1 : 1;
    state.torchSupported = !!caps.torch;

    await enumerateDevices();
    state.ready = true;
    state.starting = false;
    if (!refs.praf) refs.praf = requestAnimationFrame(loopPreview);
    if (camPrev() && totalVideoFramesOf(v.video) === 0) {
      /* WebView não entregou frame nenhum (bug MediaTek/Chromium):
       * muda para o preview nativo (CameraPreview). */
      await sleep(1600);
      if (totalVideoFramesOf(v.video) === 0) {
        const okNative = await startNativePreview();
        if (okNative) return;
      }
    }
  } catch (err) {
    state.error = err && err.message ? err.message : 'Não foi possível acessar a câmera';
    state.ready = false;
    state.starting = false;
  }
  render();
}

/* monitor de frames: se o preview congelar (WebView bugado),
 * tenta recuperar recarregando a câmera automaticamente (no máx. 3x). */
setInterval(() => {
  if (!state.ready || state.rec !== 'inactive' || state.starting || state.nativeMode || !v.video) return;
  const frames = totalVideoFramesOf(v.video);
  if (frames < 0) return;
  if (state._lastFrames !== undefined && frames === state._lastFrames) {
    if (state._recoveries >= 3) {
      state._recoveries = 0;
      state.error =
        'O preview da câmera travou no WebView deste aparelho. Atualize o "Android System WebView" na Play Store e toque em "Tentar novamente".';
      state.ready = false;
      state.starting = false;
      render();
      return;
    }
    if (!state._recovering) {
      state._recovering = true;
      state._recoveries += 1;
      setTimeout(() => {
        state._recovering = false;
      }, 15000);
      startCamera();
    }
  }
  state._lastFrames = frames;
}, 5000);

async function applyZoom(value) {
  const track = state.stream ? state.stream.getVideoTracks()[0] : null;
  if (!track || !state.zoomCap) return;
  const clamped = Math.min(Math.max(value, state.zoomCap.min), state.zoomCap.max);
  state.zoom = clamped;
  render();
  try {
    await track.applyConstraints({ advanced: [{ zoom: clamped }] });
  } catch (_) {
    /* zoom não suportado */
  }
}

async function toggleTorch() {
  if (state.nativeMode) {
    nativeTorch();
    return;
  }
  const track = state.stream ? state.stream.getVideoTracks()[0] : null;
  if (!track) return;
  const next = !state.torch;
  try {
    await track.applyConstraints({ advanced: [{ torch: next }] });
    state.torch = next;
    render();
  } catch (_) {
    state.toast = { ok: false, msg: 'Lanterna não suportada neste dispositivo' };
    render();
  }
}

function cropRect(vw, vh) {
  const a = activeAspect();
  const ratio = a.ratio != null ? a.ratio : state.freeRatio != null ? state.freeRatio : vw / vh;
  let cw = vw;
  let ch = vh;
  if (vw / vh > ratio) cw = Math.round(vh * ratio);
  else if (vw / vh < ratio) ch = Math.round(vw / ratio);
  return { x: Math.round((vw - cw) / 2), y: Math.round((vh - ch) / 2), w: cw, h: ch };
}

function paint() {
  const video = v.video;
  const canvas = v.canvas;
  if (!video || !canvas || !video.videoWidth) return;
  const { x, y, w, h } = cropRect(video.videoWidth, video.videoHeight);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = v.ctx;
  ctx.save();
  if (state.mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.clearRect(0, 0, w, h);
  const f = activeFilter();
  if (f.css) ctx.filter = f.css;
  ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
  ctx.restore();
  ctx.filter = 'none';
}

/* Preview visível via canvas (contorna WebViews onde o <video> não
 * compõe na tela — ex.: MediaTek). O <video> continua oculto, só decodificando. */
function paintPreview() {
  const video = v.video;
  const pv = v.preview;
  const pc = v.pctx;
  if (!video || !pv || !pc || !video.videoWidth) return;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (pv.width !== w || pv.height !== h) {
    pv.width = w;
    pv.height = h;
  }
  pc.save();
  if (state.mirror) {
    pc.translate(w, 0);
    pc.scale(-1, 1);
  }
  const f = activeFilter();
  if (f.css) pc.filter = f.css;
  pc.clearRect(0, 0, w, h);
  pc.drawImage(video, 0, 0, w, h);
  pc.restore();
  pc.filter = 'none';
  if (state._probeTicks !== undefined && state._probeTicks % 2 === 0) probePixels(pc, w, h);
  state._probeTicks = (state._probeTicks || 0) + 1;
}

function probePixels(ctx, w, h) {
  try {
    const step = Math.max(1, Math.floor(Math.min(w, h) / 8));
    const data = ctx.getImageData(0, 0, w, h).data;
    let sum = 0;
    let lit = 0;
    let n = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += lum;
        n++;
        if (lum > 24) lit++;
      }
    }
    const avg = sum / n;
    const litp = lit / n;
    state._probeState = litp > 0.05 ? 'ok' : avg < 4 ? 'black' : 'dim';
  } catch (_) {
    state._probeState = 'erro';
  }
}

function loopPreview() {
  if (!state.ready || !v.preview) {
    refs.praf = requestAnimationFrame(loopPreview);
    return;
  }
  paintPreview();
  refs.praf = requestAnimationFrame(loopPreview);
}

/* ---------------- preview/captura NATIVA (CameraPreview) ---------------- */

function stageRect() {
  const st = v.stage || document.getElementById('app');
  if (!st) return { x: 0, y: 0, width: 1, height: 1 };
  const r = st.getBoundingClientRect();
  /* O plugin Android converte x/y/width/height de DIP para px
   * (TypedValue.applyDimension(COMPLEX_UNIT_DIP,...)); por isso enviamos os
   * valores em DIP (CSS px), sem multiplicar pelo devicePixelRatio. */
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
}

const nativeDir = () => (state.facing === 'user' ? 'CAMERA_FACING_FRONT' : 'CAMERA_FACING_BACK');

async function startNativePreview() {
  const p = camPrev();
  if (!p) return false;
  try {
    await stopStream();
    const r = stageRect();
    await p.start({
      position: state.facing === 'user' ? 'front' : 'rear',
      cameraDirection: nativeDir(),
      x: r.x,
      y: r.y,
      width: Math.max(1, r.width),
      height: Math.max(1, r.height),
      toBack: true,
      enableZoom: true,
      disableAudio: true,
    });
    state.nativeMode = true;
    state.ready = true;
    state.starting = false;
    state.error = null;
    try {
      cancelAnimationFrame(refs.praf);
      refs.praf = 0;
    } catch (_) {}
    render();
    return true;
  } catch (e) {
    state.nativeMode = false;
    state.error = 'Preview nativo falhou: ' + (e && e.message ? e.message : e);
    state.starting = false;
    render();
    return false;
  }
}

async function stopNativePreview() {
  const p = camPrev();
  if (!p || state.rec === 'recording' || state.rec === 'paused') return;
  try {
    await p.stop();
  } catch (_) {}
  state.nativeMode = false;
}

async function captureNativePhoto() {
  const p = camPrev();
  if (!p) return false;
  beep(1600, 0.2, 0.3);
  beep(2400, 0.25, 0.16);
  try {
    const res = await p.capture({ quality: 90 });
    const b64 = res && res.value ? String(res.value) : '';
    if (!b64) throw new Error('captura vazia');
    const dataUrl = b64.indexOf('data:') === 0 ? b64 : 'data:image/jpeg;base64,' + b64;
    const blob = await (await fetch(dataUrl)).blob();
    addToGallery({
      id: uid(),
      kind: 'photo',
      url: URL.createObjectURL(blob),
      blob,
      width: 0,
      height: 0,
      size: blob.size,
      createdAt: Date.now(),
      mime: 'image/jpeg',
    });
    return true;
  } catch (e) {
    state.toast = { ok: false, msg: 'Falha na foto: ' + (e && e.message ? e.message : e) };
    render();
    return false;
  }
}

async function startNativeRecord() {
  const p = camPrev();
  if (!p) return false;
  try {
    await p.startRecordVideo({ cameraDirection: nativeDir() });
    state.rec = 'recording';
    refs.recordNative = Date.now();
    render();
    return true;
  } catch (e) {
    state.toast = { ok: false, msg: 'Falha ao gravar: ' + (e && e.message ? e.message : e) };
    render();
    return false;
  }
}

async function stopNativeRecord() {
  const p = camPrev();
  if (!p) return false;
  let fp = '';
  try {
    const res = await p.stopRecordVideo();
    fp = res && res.videoFilePath ? res.videoFilePath : '';
    state.elapsed = Math.max(0, Math.floor((Date.now() - refs.recordNative) / 1000));
  } catch (_) {}
  state.rec = 'inactive';
  refs.recordNative = 0;
  render();
  if (!fp) {
    state.toast = { ok: false, msg: 'Gravação interrompida' };
    render();
    return false;
  }
  const name = 'captura-' + stamp() + '.mp4';
  try {
    const res = await core().NativeMedia.saveToGallery({ fileName: name, mimeType: 'video/mp4', filePath: fp });
    const uri = res && res.uri ? res.uri : fp;
    addToGallery({
      id: uid(),
      kind: 'video',
      url: uri,
      blob: null,
      width: 0,
      height: 0,
      size: 0,
      createdAt: Date.now(),
      mime: 'video/mp4',
    });
    state.toast = { ok: true, msg: 'Vídeo salvo na galeria' };
  } catch (e) {
    state.toast = { ok: false, msg: 'Erro ao salvar vídeo: ' + (e && e.message ? e.message : e) };
  }
  render();
  return true;
}

async function nativeFlip() {
  const p = camPrev();
  if (!p) return;
  try {
    await p.flip();
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    render();
  } catch (_) {}
}

async function nativeTorch() {
  const p = camPrev();
  if (!p) return;
  try {
    const modes = await p.getSupportedFlashModes();
    if (!modes || !modes.value) throw new Error('flash indisponível');
    const has = modes.value.indexOf('torch') >= 0;
    if (!has) throw new Error('lanterna indisponível');
    await p.setFlashMode(state.torch ? 'off' : 'torch');
    state.torch = !state.torch;
    render();
  } catch (e) {
    state.toast = { ok: false, msg: 'Lanterna: ' + (e && e.message ? e.message : e) };
    render();
  }
}

/* ---------------- captura ---------------- */

function addToGallery(item) {
  state.gallery = [item, ...state.gallery];
  render();
}

function doCapture() {
  const video = v.video;
  if (!video || !video.videoWidth) return;
  paint();
  state.flash = true;
  setTimeout(() => {
    state.flash = false;
    render();
  }, 400);
  beep(1600, 0.2, 0.3);
  beep(2400, 0.25, 0.16);

  v.canvas.toBlob(
    (blob) => {
      if (!blob) return;
      addToGallery({
        id: uid(),
        kind: 'photo',
        url: URL.createObjectURL(blob),
        blob,
        width: v.canvas.width,
        height: v.canvas.height,
        size: blob.size,
        createdAt: Date.now(),
        mime: blob.type || 'image/jpeg',
      });
    },
    'image/jpeg',
    0.95,
  );
}

function runCountdown(secs, onDone) {
  state.countdown = secs;
  render();
  beep(660, 0.08, 0.14);
  clearInterval(refs.timerInt);
  refs.timerInt = setInterval(() => {
    secs -= 1;
    beep(secs === 0 ? 1200 : 660, secs === 0 ? 0.18 : 0.08, 0.14);
    state.countdown = secs;
    render();
    if (secs <= 0) {
      clearInterval(refs.timerInt);
      state.countdown = 0;
      render();
      onDone();
    }
  }, 1000);
}

/* ---------------- vídeo ---------------- */

function startRecording() {
  const canvas = v.canvas;
  if (!canvas || !state.stream) return;
  const mime = pickMime();
  if (!mime) {
    state.toast = { ok: false, msg: 'Gravação não suportada neste WebView' };
    return;
  }

  paint();
  const capture = canvas.captureStream(30);
  const audioTrack = state.stream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = state.audioOn;
    capture.addTrack(audioTrack);
  }

  let recorder;
  try {
    recorder = new MediaRecorder(capture, { mimeType: mime, videoBitsPerSecond: bitrateFor(state.resolutionId) });
  } catch (_) {
    state.toast = { ok: false, msg: 'Falha ao criar gravador' };
    render();
    return;
  }
  refs.recorder = recorder;
  refs.chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) refs.chunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(refs.chunks, { type: recorder.mimeType });
    addToGallery({
      id: uid(),
      kind: 'video',
      url: URL.createObjectURL(blob),
      blob,
      width: canvas.width,
      height: canvas.height,
      size: blob.size,
      createdAt: Date.now(),
      mime: recorder.mimeType,
    });
    state.rec = 'inactive';
    refs.recordStart = 0;
    refs.elapsedBase = 0;
    state.elapsed = 0;
    render();
  };

  try {
    recorder.start(500);
    state.rec = 'recording';
    refs.recordStart = Date.now();
  } catch (_) {
    state.toast = { ok: false, msg: 'Falha ao iniciar gravação' };
    refs.recorder = null;
    render();
    return;
  }

  const draw = () => {
    if (v.video && v.video.videoWidth) {
      paint();
      if (refs.recorder && refs.recorder.state === 'inactive') {
        cancelAnimationFrame(refs.raf);
        return;
      }
    }
    refs.raf = requestAnimationFrame(draw);
  };
  draw();
  render();
}

function stopRecording() {
  const r = refs.recorder;
  if (!r || r.state === 'inactive') return;
  beep(880, 0.1, 0.18);
  r.stop();
}

function togglePause() {
  const r = refs.recorder;
  if (!r) return;
  if (r.state === 'recording') {
    r.pause();
    state.rec = 'paused';
    refs.elapsedBase = state.elapsed;
  } else if (r.state === 'paused') {
    r.resume();
    state.rec = 'recording';
    refs.recordStart = Date.now() - refs.elapsedBase * 1000;
  }
  render();
}

/* ---------------- timeline de gravação ---------------- */

setInterval(() => {
  const recordingNow = refs.recordNative > 0 || (refs.recorder && refs.recorder.state === 'recording');
  const pausedNow = !refs.recordNative && refs.recorder && refs.recorder.state === 'paused';
  const t0 = refs.recordNative || refs.recordStart;
  if (recordingNow) {
    state.elapsed = Math.floor((Date.now() - t0) / 1000);
    const hud = document.getElementById('rec-hud');
    const hint = document.getElementById('hint');
    if (hud) hud.firstChild.textContent = fmtTime(state.elapsed);
    if (hint) hint.textContent = fmtTime(state.elapsed);
  } else if (pausedNow) {
    const hud = document.getElementById('rec-hud');
    const hint = document.getElementById('hint');
    if (hud) hud.firstChild.textContent = `Pausado ${fmtTime(state.elapsed)}`;
    if (hint) hint.textContent = `Pausado ${fmtTime(state.elapsed)}`;
  }
}, 250);

/* ---------------- ações principais ---------------- */

function onShutter() {
  if (state.starting || !state.ready) return;
  if (state.nativeMode) {
    if (state.mode === 'photo') {
      if (state.timer > 0) runCountdown(state.timer, () => captureNativePhoto());
      else captureNativePhoto();
    } else if (state.rec === 'inactive') {
      beep(440, 0.08, 0.15);
      setTimeout(startNativeRecord, 120);
    } else {
      stopNativeRecord();
    }
    return;
  }
  if (state.mode === 'photo') {
    if (state.timer > 0) runCountdown(state.timer, doCapture);
    else doCapture();
  } else if (state.rec === 'inactive') {
    beep(440, 0.08, 0.15);
    setTimeout(startRecording, 120);
  } else {
    stopRecording();
  }
}

function toggleMode(mode) {
  if (state.rec !== 'inactive') return;
  state.mode = mode;
  state.panel = null;
  render();
}

function switchCamera() {
  if (state.rec !== 'inactive') return;
  if (state.nativeMode) {
    nativeFlip();
    return;
  }
  const next = state.facing === 'user' ? 'environment' : 'user';
  state.facing = next;
  state.deviceId = '';
  state.mirror = next === 'user';
  startCamera({ facing: next });
}

function selectDevice(id) {
  state.deviceId = id;
  startCamera({ deviceId: id });
}

function setPanel(p) {
  state.panel = state.panel === p ? null : p;
  render();
}

/* ---------------- galeria: nativo vs fallback ---------------- */

async function persistToCache(item, fileName) {
  const fs = core().Filesystem;
  const base64 = await toBase64(item.blob);
  await fs.writeFile({ path: `capturas/${fileName}`, data: base64, directory: 'CACHE', recursive: true });
  return fileName;
}

async function saveToGallery(item) {
  if (!isNative) {
    download(item);
    return;
  }
  const name = `captura-${stamp()}.${item.kind === 'photo' ? 'jpg' : fallbackExtFor(item.mime)}`;
  try {
    await persistToCache(item, name);
    state.toast = { ok: true, msg: 'Salvando para a galeria…' };
    render();
    await core().NativeMedia.saveToGallery({ fileName: name, mimeType: item.mime, filePath: `capturas/${name}` });
    state.toast = { ok: true, msg: 'Salvo na galeria' };
  } catch (e) {
    state.toast = { ok: false, msg: 'Erro ao salvar: ' + (e && e.message ? e.message : e) };
  }
  render();
}

async function shareItem(item) {
  if (!isNative) {
    if (navigator.share) {
      try {
        await navigator.share({ files: [new File([item.blob], 'captura')] });
        return;
      } catch (_) {
        /* cancelado */
      }
    }
    download(item);
    return;
  }
  const name = `captura-${stamp()}.${item.kind === 'photo' ? 'jpg' : fallbackExtFor(item.mime)}`;
  try {
    await persistToCache(item, name);
    state.toast = { ok: true, msg: 'Preparando…' };
    render();
    const res = await core().Filesystem.getUri({ path: `capturas/${name}`, directory: 'CACHE' });
    await core().Share.share({ title: 'Captura', files: [res.uri] });
    state.toast = null;
  } catch (e) {
    state.toast = { ok: false, msg: 'Não foi possível compartilhar: ' + (e && e.message ? e.message : e) };
  }
  render();
}

function download(item) {
  const a = document.createElement('a');
  const name = `captura-${stamp()}.${item.kind === 'photo' ? 'jpg' : fallbackExtFor(item.mime)}`;
  a.href = item.url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function removeItem(item) {
  const i = state.gallery.indexOf(item);
  if (i >= 0) {
    state.gallery.splice(i, 1);
    URL.revokeObjectURL(item.url);
  }
  if (state.preview === item) state.preview = null;
  render();
}

/* ============================================================
 * RENDER — monta a interface inteira
 * ============================================================ */

function buildApp() {
  const app = document.getElementById('app');

  // topo
  const topbar = el('div', 'topbar');
  const title = el('div', 'title', 'Câmera <span>VideoPlat</span>');
  const tools = el('div', 'toolrow');
  tools.appendChild(pillBtn('⚙ Configurações', () => setPanel('settings'), () => state.panel === 'settings', () => false));
  topbar.appendChild(title);
  topbar.appendChild(tools);
  app.appendChild(topbar);

  // palco
  const stage = el('div', 'stage');
  stage.style.setProperty('--aspect', String(stageRatio()));
  const video = el('video');
  video.id = 'source';
  video.setAttribute('autoplay', '');
  video.setAttribute('playsinline', '');
  video.muted = true;
  if (state.mirror) video.classList.add('mirror');
  video.style.filter = activeFilter().css || 'none';
  video.style.opacity = '0'; // o preview será exibido via canvas #preview
  stage.appendChild(video);
  const pv = document.createElement('canvas');
  pv.id = 'preview';
  pv.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;' +
    (state.mirror ? 'transform:scaleX(-1);' : '') +
    (activeFilter().css ? 'filter:' + activeFilter().css + ';' : '');
  stage.appendChild(pv);
  v.preview = pv;
  v.pctx = pv.getContext('2d');
  const kp = el('div', 'keepalive');
  stage.appendChild(kp);
  if (state.nativeMode) {
    video.style.display = 'none';
    pv.style.display = 'none';
    kp.style.display = 'none';
  }
  v.video = video;

  // grade
  if (state.grid) {
    stage.appendChild(gridLine('v', '33.33%'));
    stage.appendChild(gridLine('v', '66.66%'));
    stage.appendChild(gridLine('h', '33.33%'));
    stage.appendChild(gridLine('h', '66.66%'));
  }

  // hud superior (rec / pausar)
  if (state.rec !== 'inactive') {
    const hud = el('div', 'hud top');
    hud.id = 'rec-hud';
    const badge = el('span', 'rec-badge', `<span class="rec-dot"></span>${state.rec === 'paused' ? 'Pausado' : fmtTime(state.elapsed)}`);
    const pause = pillBtn(state.rec === 'paused' ? '▶ Retomar' : '⏸ Pausar', togglePause, () => false, () => false);
    pause.style.border = '1px solid var(--border)';
    pause.style.background = 'var(--surface)';
    pause.style.color = 'var(--text)';
    pause.style.padding = '4px 10px';
    hud.appendChild(badge);
    hud.appendChild(pause);
    stage.appendChild(hud);
  }

  // hud inferior (resolução/zoom/filtro)
  if (state.ready && state.streamInfo) {
    const info = el(
      'div',
      'hud bottom',
      `${state.streamInfo.width}×${state.streamInfo.height}` +
        `${state.zoomCap && state.zoom !== 1 ? ` · ${state.zoom.toFixed(1)}×` : ''}` +
        `${activeFilter().id !== 'original' ? ` · ${activeFilter().label}` : ''}`,
    );
    stage.appendChild(info);
  }

  // contagem regressiva
  if (state.countdown > 0) {
    stage.appendChild(el('div', 'center-overlay', `<div class="countdown">${state.countdown}</div>`));
  }

  // overlay init/erro
  if (!state.ready || state.starting) {
    const ov = el('div', 'center-overlay');
    if (state.starting) ov.textContent = 'Iniciando câmera…';
    else if (state.error)
      ov.innerHTML =
        `<p style="color:#ff6b6b;font-size:14px;margin:0">A câmera não iniciou.</p>` +
        `<p style="color:#aaa;font-size:13px;margin:0">${String(state.error).replace(/</g, '&lt;')}</p>` +
        `<button class="pill" onclick="retry()">Tentar novamente</button>`;
    stage.appendChild(ov);
  }

  if (state.flash) stage.appendChild(el('div', 'flash'));

  // canvas de renderização
  const canvas = el('canvas');
  canvas.id = 'render';
  canvas.style.display = 'none';
  stage.appendChild(canvas);
  v.canvas = canvas;
  v.ctx = canvas.getContext('2d');
  v.stage = stage;
  app.appendChild(stage);

  // zoom
  if (state.zoomCap && state.ready) {
    const zb = el('div', 'zoombar');
    const zmin = el('span', '', '1×');
    const range = el('input');
    range.type = 'range';
    range.min = state.zoomCap.min;
    range.max = state.zoomCap.max;
    range.step = state.zoomCap.step || 0.1;
    range.value = state.zoom;
    range.addEventListener('input', () => applyZoom(Number(range.value)));
    const zmax = el('span', '', `${Math.round(state.zoomCap.max)}×`);
    zb.appendChild(zmin);
    zb.appendChild(range);
    zb.appendChild(zmax);
    app.appendChild(zb);
  }

  // controles
  const controls = el('div', 'controls');
  const gthumb = el('button', 'gallery-thumb');
  if (state.gallery.length > 0) {
    gthumb.appendChild(el('img')).src = state.gallery[0].url;
    const badge = el('span', 'count', String(state.gallery.length));
    gthumb.appendChild(badge);
    gthumb.addEventListener('click', () => openPreview(state.gallery[0]));
  } else {
    gthumb.appendChild(el('img')).style.visibility = 'hidden';
    gthumb.addEventListener('click', () => setPanel('cameras'));
  }
  controls.appendChild(gthumb);

  const center = el('div', 'center-col');
  const tabs = el('div', 'mode-tabs');
  const tabPhoto = pillBtn('FOTO', () => toggleMode('photo'), () => state.mode === 'photo', () => state.rec !== 'inactive');
  const tabVideo = pillBtn('VÍDEO', () => toggleMode('video'), () => state.mode === 'video', () => state.rec !== 'inactive');
  tabs.appendChild(tabPhoto);
  tabs.appendChild(tabVideo);
  center.appendChild(tabs);

  const shutter = el('button', 'shutter' + (state.rec !== 'inactive' ? ' recording' : ''));
  shutter.appendChild(el('span', 'inner'));
  shutter.addEventListener('click', onShutter);
  center.appendChild(shutter);

  const hint = el('div', 'hint');
  hint.id = 'hint';
  hint.textContent =
    state.mode === 'photo'
      ? 'TOCAR PARA FOTOGRAFAR'
      : state.rec === 'inactive'
        ? 'TOQUE PARA GRAVAR'
        : state.rec === 'recording'
          ? fmtTime(state.elapsed)
          : `Pausado · ${fmtTime(state.elapsed)}`;
  center.appendChild(hint);
  controls.appendChild(center);

  const sw = el('button', 'switch-cam', '⇄');
  sw.addEventListener('click', switchCamera);
  sw.disabled = state.rec !== 'inactive';
  controls.appendChild(sw);
  app.appendChild(controls);

  // painel aberto
  if (state.panel) app.appendChild(buildPanel());

  // toasts do painel
  if (state.toast) {
    const t = el('div', 'panel');
    const b = el('div', 'toast ' + (state.toast.ok ? 'ok' : 'err'), state.toast.msg);
    t.appendChild(b);
    app.appendChild(t);
  }

  // galeria
  if (state.gallery.length > 1) {
    const strip = el('div', 'gallery-strip');
    state.gallery.forEach((item) => {
      const b = el('button', 't');
      b.appendChild(el('img')).src = item.url;
      if (item.kind === 'video') b.appendChild(el('span', 'play', '▶'));
      b.addEventListener('click', () => openPreview(item));
      strip.appendChild(b);
    });
    app.appendChild(strip);
  }

  // modal de prévia
  if (state.preview) app.appendChild(buildPreviewModal(state.preview));
}

function gridLine(axis, pos) {
  const d = el('div', 'grid-line ' + axis);
  d.style[axis === 'v' ? 'left' : 'top'] = pos;
  return d;
}

function pillBtn(label, onClick, isActive, isDisabled) {
  const b = el('button', 'pill' + (isActive() ? ' active' : ''));
  b.textContent = label;
  b.disabled = isDisabled();
  b.addEventListener('click', onClick);
  return b;
}

function setGroup(label) {
  return el('div', 'set-group', label);
}

function setToggle(label, on, onClick, isDisabled) {
  const b = el('button', 'set-toggle' + (on ? ' on' : ''));
  b.appendChild(el('span', 'set-label', label));
  const track = el('span', 'set-track');
  track.appendChild(el('span', 'set-knob'));
  b.appendChild(track);
  b.disabled = isDisabled();
  b.addEventListener('click', onClick);
  return b;
}

function setNav(label, value, onClick, isDisabled) {
  const b = el('button', 'set-nav');
  if (label) b.appendChild(el('span', 'set-label', label));
  const v = el('span', 'set-value');
  if (value) v.textContent = value;
  b.appendChild(v);
  b.appendChild(el('span', 'set-arrow', '›'));
  b.disabled = isDisabled();
  b.addEventListener('click', onClick);
  return b;
}

function stageRatio() {
  const a = activeAspect();
  if (a.ratio) return a.ratio;
  return state.freeRatio != null ? state.freeRatio : 16 / 9;
}

function buildPanel() {
  const panel = el('div', 'panel');
  const title = el('h3');
  const close = el('button', 'close', 'Fechar');
  close.addEventListener('click', () => {
    state.panel = null;
    render();
  });
  title.appendChild(close);
  panel.appendChild(title);

  const opts = el('div', 'opts');
  if (state.panel === 'settings') {
    title.insertBefore(document.createTextNode('Configurações'), close);
    opts.appendChild(setGroup('Câmera'));
    opts.appendChild(setToggle('Lanterna', state.torch, () => toggleTorch(), () => (!state.nativeMode && !state.torchSupported) || state.rec !== 'inactive'));
    opts.appendChild(setNav('Câmeras', state.devices.find((d) => d.id === state.deviceId)?.label || (state.facing === 'user' ? 'Frontal' : 'Traseira'), () => setPanel('cameras'), () => state.rec !== 'inactive'));
    opts.appendChild(setNav('Proporção', activeAspect().label, () => setPanel('aspect'), () => state.rec !== 'inactive' || state.nativeMode));
    opts.appendChild(setNav('Resolução', (RESOLUTIONS.find((r) => r.id === state.resolutionId) || RESOLUTIONS[0]).label, () => setPanel('resolution'), () => state.rec !== 'inactive' || state.nativeMode));
    opts.appendChild(setGroup('Captura'));
    opts.appendChild(setNav('Timer', `${state.timer}s`, () => setPanel('timer'), () => state.rec !== 'inactive'));
    opts.appendChild(setNav('Filtros', activeFilter().label, () => setPanel('filter'), () => state.rec !== 'inactive' || state.nativeMode));
    opts.appendChild(setGroup('Visor'));
    opts.appendChild(setToggle('Grade de terços', state.grid, () => (state.grid = !state.grid, render()), () => state.nativeMode));
    opts.appendChild(setToggle('Espelho', state.mirror, () => (state.mirror = !state.mirror, render()), () => state.rec !== 'inactive' || state.nativeMode));
    opts.appendChild(setToggle('Som no vídeo', state.audioOn, () => (state.audioOn = !state.audioOn, render()), () => state.mode !== 'video' || state.rec !== 'inactive' || state.nativeMode));
  } else if (state.panel === 'timer') {
    title.insertBefore(document.createTextNode('Timer'), close);
    TIMER_OPTIONS.forEach((t) => {
      const b = el('button', 'opt' + (state.timer === t.id ? ' active' : ''), t.label);
      b.addEventListener('click', () => {
        state.timer = t.id;
        render();
      });
      opts.appendChild(b);
    });
  } else if (state.panel === 'aspect') {
    title.insertBefore(document.createTextNode('Proporção'), close);
    ASPECTS.forEach((a) => {
      const b = el('button', 'opt' + (state.aspectId === a.id ? ' active' : ''), a.label);
      b.addEventListener('click', () => {
        state.aspectId = a.id;
        render();
      });
      opts.appendChild(b);
    });
  } else if (state.panel === 'filter') {
    title.insertBefore(document.createTextNode('Filtros'), close);
    FILTERS.forEach((f) => {
      const b = el('button', 'opt' + (state.filterId === f.id ? ' active' : ''), f.label);
      b.addEventListener('click', () => {
        state.filterId = f.id;
        render();
      });
      opts.appendChild(b);
    });
  } else if (state.panel === 'resolution') {
    title.insertBefore(document.createTextNode('Resolução de captura'), close);
    RESOLUTIONS.forEach((r) => {
      const b = el('button', 'opt' + (state.resolutionId === r.id ? ' active' : ''), r.label);
      b.disabled = state.rec !== 'inactive';
      b.addEventListener('click', () => {
        state.resolutionId = r.id;
        startCamera({ resolutionId: r.id });
      });
      opts.appendChild(b);
    });
  } else if (state.panel === 'cameras') {
    title.insertBefore(document.createTextNode('Câmera disponível'), close);
    const sel = el('select');
    (state.devices.length ? state.devices : [{ id: '', label: 'Câmera padrão' }]).forEach((d) => {
      const o = el('option', '', d.label);
      o.value = d.id;
      sel.appendChild(o);
    });
    sel.value = state.deviceId || (state.devices.length ? state.devices[0].id : '');
    sel.disabled = state.rec !== 'inactive';
    sel.addEventListener('change', () => selectDevice(sel.value));
    const wrap = el('div');
    wrap.appendChild(sel);
    panel.appendChild(wrap);
  }
  panel.appendChild(opts);
  return panel;
}

function openPreview(item) {
  state.preview = item;
  render();
}

function buildPreviewModal(item) {
  const modal = el('div', 'modal');
  modal.addEventListener('click', () => {
    state.preview = null;
    render();
  });

  const media =
    item.kind === 'video'
      ? (() => {
          const video = el('video');
          video.src = item.url;
          video.controls = true;
          video.autoplay = true;
          return video;
        })()
      : (() => {
          const img = el('img');
          img.src = item.url;
          return img;
        })();
  modal.appendChild(media);

  const actions = el('div', 'actions');
  const share = el('button', 'btn', 'Compartilhar');
  share.addEventListener('click', (e) => {
    e.stopPropagation();
    shareItem(item);
  });
  const save = el('button', 'btn', 'Salvar na galeria');
  save.addEventListener('click', (e) => {
    e.stopPropagation();
    saveToGallery(item);
  });
  const del = el('button', 'btn ghost', 'Excluir');
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    removeItem(item);
  });
  const closeBtn = el('button', 'btn ghost', 'Fechar');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.preview = null;
    state.toast = null;
    render();
  });
  actions.appendChild(save);
  actions.appendChild(share);
  actions.appendChild(del);
  actions.appendChild(closeBtn);
  modal.appendChild(actions);

  const meta = el(
    'div',
    'meta',
    `${item.kind === 'photo' ? 'Foto' : 'Vídeo'} · ${item.width}×${item.height} · ${fmtBytes(item.size)} · ${stamp()}`,
  );
  modal.appendChild(meta);

  if (state.toast) {
    const t = el('div', 'toast ' + (state.toast.ok ? 'ok' : 'err'), state.toast.msg);
    modal.appendChild(t);
  }

  return modal;
}

function render() {
  try {
    document.documentElement.classList.toggle('nativemode', !!state.nativeMode);
  } catch (_) {}
  const app = document.getElementById('app');
  app.innerHTML = '';
  buildApp();
}

window.retry = () => {
  state._recoveries = 0;
  startCamera();
};

/* ---------------- boot ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  // Captura back button do Android: sai do modal/panel antes de fechar o app.
  if (isNative) {
    document.addEventListener('backbutton', () => {
      if (state.preview) {
        state.preview = null;
        state.toast = null;
        render();
      } else if (state.panel) {
        state.panel = null;
        render();
      } else if (
        window.Capacitor &&
        window.Capacitor.Plugins &&
        window.Capacitor.Plugins.App &&
        typeof window.Capacitor.Plugins.App.exitApp === 'function'
      ) {
        window.Capacitor.Plugins.App.exitApp();
      }
    });
  }
  startCamera();
});