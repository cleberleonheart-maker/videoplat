'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Mode = 'photo' | 'video';
type RecState = 'inactive' | 'recording' | 'paused';
type Status = 'idle' | 'starting' | 'ready' | 'error';

interface FilterPreset {
  id: string;
  label: string;
  css: string;
}

interface GalleryItem {
  id: string;
  kind: 'photo' | 'video';
  kindLabel: string;
  url: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: number;
  mimeType: string;
}

const FILTERS: FilterPreset[] = [
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

const ASPECTS: { id: string; label: string; ratio: number | null }[] = [
  { id: 'free', label: 'Livre', ratio: null },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

const RESOLUTIONS: { id: string; label: string; width: number | null; height: number | null }[] = [
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

function bitrateFor(resolutionId: string): number {
  switch (resolutionId) {
    case '4k':
      return 30_000_000;
    case '1080':
      return 12_000_000;
    case '720':
      return 6_000_000;
    default:
      return 12_000_000;
  }
}

function pickMimeType(): string {
  const candidates = [
    'video/mp4;codecs="avc1.42E01E,mp4a.40.2"',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

function extensionFor(mime: string): string {
  if (mime.startsWith('video/mp4')) return 'mp4';
  if (mime.startsWith('video/webm')) return 'webm';
  if (mime.startsWith('video/quicktime')) return 'mov';
  return 'media';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}

function hexId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function CameraApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const renderRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recordStartedAtRef = useRef<number>(0);
  const elapsedBaseRef = useRef<number>(0);
  const timerRef = useRef<number>(0);

  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('photo');
  const [recState, setRecState] = useState<RecState>('inactive');
  const [elapsed, setElapsed] = useState(0);
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [mirror, setMirror] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [torch, setTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [zoomCapabilities, setZoomCapabilities] = useState<{ min: number; max: number; step: number } | null>(null);
  const [aspectId, setAspectId] = useState('free');
  const [resolutionId, setResolutionId] = useState('source');
  const [filterId, setFilterId] = useState('original');
  const [timer, setTimer] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [flash, setFlash] = useState(false);
  const [grid, setGrid] = useState(false);
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [streamInfo, setStreamInfo] = useState<{ width: number; height: number } | null>(null);
  const [freeRatio, setFreeRatio] = useState<number | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [preview, setPreview] = useState<GalleryItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [showAspect, setShowAspect] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeFilter = useMemo(() => FILTERS.find((f) => f.id === filterId)!, [filterId]);
  const activeAspect = useMemo(() => ASPECTS.find((a) => a.id === aspectId)!, [aspectId]);

  const beep = useCallback((freq = 880, dur = 0.06, gain = 0.12) => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.value = gain;
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch {
      // Áudio não disponível: o app segue funcionando sem o "clique".
    }
  }, []);

  const applyZoom = useCallback(
    async (value: number) => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      const clamped = Math.min(Math.max(value, zoomCapabilities?.min ?? 1), zoomCapabilities?.max ?? 1);
      setZoom(clamped);
      try {
        await track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] });
      } catch {
        /* zoom não suportado pelo dispositivo */
      }
    },
    [zoomCapabilities],
  );

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {
      setError('A lanterna não é suportada neste dispositivo.');
    }
  }, [torch]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const enumerateDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      const cams = list
        .filter((d) => d.kind === 'videoinput')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Câmera ${d.deviceId.slice(0, 4)}` }));
      setDevices(cams);
    } catch {
      /* permissão negada: segue com apenas a seleção por facingMode */
    }
  }, []);

  const startCamera = useCallback(
    async (opts: { deviceId?: string; facing?: 'user' | 'environment'; resolutionId?: string } = {}) => {
      setStatus('starting');
      setError(null);
      stopStream();

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('getUserMedia não está disponível neste navegador.');
        }

        const res = RESOLUTIONS.find((r) => r.id === (opts.resolutionId ?? resolutionId))!;
        const videoConstraints: MediaTrackConstraints = {};
        if (opts.deviceId) {
          videoConstraints.deviceId = { exact: opts.deviceId };
        } else if (opts.facing) {
          videoConstraints.facingMode = opts.facing;
        } else if (deviceId) {
          videoConstraints.deviceId = { exact: deviceId };
        } else {
          videoConstraints.facingMode = facing;
        }
        if (res.width) videoConstraints.width = { ideal: res.width };
        if (res.height) videoConstraints.height = { ideal: res.height };

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: videoConstraints,
        });

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((t) => t.stop());
          throw new Error('Elemento de vídeo não encontrado.');
        }
        video.srcObject = stream;
        video.muted = true;
        video.setAttribute('playsinline', '');
        await video.play().catch(() => undefined);

        const track = stream.getVideoTracks()[0];
        const settings = track.getSettings();
        setStreamInfo({ width: settings.width ?? 0, height: settings.height ?? 0 });
        if (settings.width && settings.height) setFreeRatio(settings.width / settings.height);

        const caps = track.getCapabilities() as MediaTrackCapabilities & {
          zoom?: { min: number; max: number; step?: number };
          torch?: boolean;
        };
        if (caps.zoom) {
          setZoomCapabilities({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step ?? 0 });
        } else {
          setZoomCapabilities(null);
          setZoom(1);
        }
        setTorchSupported(!!caps.torch);

        await enumerateDevices();
        setStatus('ready');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Não foi possível acessar a câmera.';
        setError(`Permita o acesso à câmera e ao microfone: ${message}`);
        setStatus('error');
      }
    },
    [deviceId, enumerateDevices, facing, resolutionId, stopStream],
  );

  const startRef = useRef(startCamera);
  startRef.current = startCamera;

  useEffect(() => {
    void startRef.current();
    return () => {
      stopStream();
      cancelAnimationFrame(rafRef.current);
      window.clearInterval(timerRef.current);
      if (audioCtxRef.current) void audioCtxRef.current.close();
    };
  }, [stopStream]);

  const switchFacing = useCallback(() => {
    const next = facing === 'user' ? 'environment' : 'user';
    setFacing(next);
    setDeviceId('');
    setMirror(next === 'user');
    setZoom(1);
    void startCamera({ facing: next });
  }, [facing, startCamera]);

  const selectDevice = useCallback(
    (id: string) => {
      setDeviceId(id);
      setZoom(1);
      void startCamera({ deviceId: id });
    },
    [startCamera],
  );

  // Dimensões do quadro exportado a partir do stream + proporção escolhida.
  const cropRect = useCallback(
    (vw: number, vh: number) => {
      const ratio = activeAspect.ratio ?? (freeRatio && activeAspect.id === 'free' ? freeRatio : vw / vh);
      const target = ratio ?? vw / vh;
      let cw = vw;
      let ch = vh;
      if (vw / vh > target) {
        cw = Math.round(vh * target);
      } else if (vw / vh < target) {
        ch = Math.round(vw / target);
      }
      return { x: Math.round((vw - cw) / 2), y: Math.round((vh - ch) / 2), w: cw, h: ch };
    },
    [activeAspect, freeRatio],
  );

  const paintFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = renderRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { x, y, w, h } = cropRect(video.videoWidth, video.videoHeight);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.save();
    if (mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.clearRect(0, 0, w, h);
    if (activeFilter.css) ctx.filter = activeFilter.css;
    ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
    ctx.restore();
    ctx.filter = 'none';
  }, [activeFilter.css, cropRect, mirror]);

  const doCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = renderRef.current;
    if (!video || !canvas) return;
    paintFrame();
    setFlash(true);
    window.setTimeout(() => setFlash(false), 400);
    beep(1600, 0.2, 0.3);
    beep(2400, 0.25, 0.16);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        addToGallery({
          id: hexId(),
          kind: 'photo',
          kindLabel: 'Foto',
          url: URL.createObjectURL(blob),
          width: canvas.width,
          height: canvas.height,
          sizeBytes: blob.size,
          createdAt: Date.now(),
          mimeType: blob.type,
        });
      },
      'image/jpeg',
      0.95,
    );
  }, [paintFrame]);

  const addToGallery = useCallback((item: GalleryItem) => {
    setGallery((prev) => [item, ...prev]);
  }, []);

  const runCountdown = useCallback(
    (secs: number, onDone: () => void) => {
      setCountdown(secs);
      beep(660, 0.08, 0.14);
      let remaining = secs;
      window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => {
        remaining -= 1;
        beep(remaining === 0 ? 1200 : 660, remaining === 0 ? 0.18 : 0.08, 0.14);
        setCountdown(remaining);
        if (remaining <= 0) {
          window.clearInterval(timerRef.current);
          setCountdown(0);
          onDone();
        }
      }, 1000);
    },
    [beep],
  );

  const startRecording = useCallback(() => {
    const canvas = renderRef.current;
    const stream = streamRef.current;
    if (!canvas || !stream) return;

    const mimeType = pickMimeType();
    if (!mimeType) {
      setError('Gravação de vídeo não suportada neste navegador.');
      return;
    }

    // Desenha o primeiro quadro antes de iniciar o recorder para nunca
    // começar com um quadro preto.
    paintFrame();
    const captureStream = canvas.captureStream(30);
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = audioEnabled;
      captureStream.addTrack(audioTrack);
    }

    const recorder = new MediaRecorder(captureStream, {
      mimeType,
      videoBitsPerSecond: bitrateFor(resolutionId),
    });
    chunksRef.current = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
      const width = canvas.width;
      const height = canvas.height;
      addToGallery({
        id: hexId(),
        kind: 'video',
        kindLabel: 'Vídeo',
        url: URL.createObjectURL(blob),
        width,
        height,
        sizeBytes: blob.size,
        createdAt: Date.now(),
        mimeType: recorder.mimeType,
      });
      setRecState('inactive');
      recordStartedAtRef.current = 0;
      elapsedBaseRef.current = 0;
      setElapsed(0);
    };

    try {
      recorder.start(500);
      setRecState('recording');
      recordStartedAtRef.current = Date.now();
    } catch {
      setError('Falha ao iniciar a gravação.');
      recorderRef.current = null;
      return;
    }

    const draw = () => {
      const v = videoRef.current;
      if (v && v.videoWidth) {
        paintFrame();
        if (recorderRef.current?.state === 'inactive') {
          cancelAnimationFrame(rafRef.current);
          return;
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    draw();
  }, [addToGallery, audioEnabled, paintFrame, resolutionId]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    beep(880, 0.1, 0.18);
    recorder.stop();
  }, [beep]);

  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      setRecState('paused');
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setRecState('recording');
      recordStartedAtRef.current = Date.now() - elapsedBaseRef.current * 1000;
    }
  }, []);

  useEffect(() => {
    if (recState !== 'recording') return;
    recordStartedAtRef.current = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      setElapsed(Math.floor((now - recordStartedAtRef.current) / 1000));
      if (recorderRef.current?.state === 'recording') {
        elapsedBaseRef.current = Math.floor((now - recordStartedAtRef.current) / 1000);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [recState]);

  const onShutter = useCallback(() => {
    if (busy) return;
    if (mode === 'photo') {
      if (timer > 0) {
        runCountdown(timer, () => doCapture());
      } else {
        doCapture();
      }
    } else {
      if (recState === 'inactive') {
        setBusy(true);
        window.setTimeout(() => {
          setBusy(false);
          startRecording();
        }, 120);
        beep(440, 0.08, 0.15);
      } else {
        stopRecording();
      }
    }
  }, [beep, busy, doCapture, mode, recState, runCountdown, startRecording, stopRecording, timer]);

  const toggleMode = useCallback((next: Mode) => {
    if (recState !== 'inactive') return;
    setMode(next);
    setShowFilters(false);
    setShowAspect(false);
  }, [recState]);

  const removeItem = useCallback((id: string) => {
    setGallery((prev) => {
      const item = prev.find((g) => g.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter((g) => g.id !== id);
    });
  }, []);

  const downloadFile = useCallback((item: GalleryItem) => {
    const a = document.createElement('a');
    const ext = item.kind === 'photo' ? 'jpg' : extensionFor(item.mimeType);
    a.href = item.url;
    a.download = `${item.kind === 'photo' ? 'foto' : 'video'}-${stamp()}.${ext}`;
    a.click();
  }, []);

  const stageRatio = useMemo(() => {
    if (activeAspect.ratio) return activeAspect.ratio;
    return freeRatio ?? 16 / 9;
  }, [activeAspect.ratio, freeRatio]);

  const controlsEnabled = recState === 'inactive';

  const settingsButton = (
    label: string,
    active: boolean,
    disabled: boolean,
    onClick: () => void,
  ) => (
    <button
      type="button"
      className="cam-pill"
      style={pillStyle(active, disabled)}
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <div className="cam-shell" style={shellStyle}>
      <div className="cam-stage" style={stageStyle(stageRatio)}>
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          style={{
            ...videoStyle,
            transform: mirror ? 'scaleX(-1)' : undefined,
            filter: activeFilter.css || 'none',
          }}
        />

        {grid && <GridOverlay />}

        {status !== 'ready' && (
          <div className="cam-center" style={centerOverlayStyle}>
            {status === 'error' ? (
              <>
                <p className="error">A câmera não iniciou.</p>
                <p className="muted" style={{ fontSize: 13 }}>
                  {error}
                </p>
                <div style={{ marginTop: 16 }}>
                  <button onClick={() => void startCamera()}>Tentar novamente</button>
                </div>
              </>
            ) : (
              <span className="muted" style={{ fontSize: 14 }}>
                Iniciando câmera…
              </span>
            )}
          </div>
        )}

        {!controlsEnabled && status === 'ready' && (
          <div className="cam-top-hud" style={hudTopStyle}>
            <span className="rec-badge">
              <span className="rec-dot" />
              {recState === 'paused' ? 'Pausado' : formatTime(elapsed)}
            </span>
            <button
              type="button"
              className="cam-pill"
              style={{ ...pillStyle(false, false), padding: '4px 10px', fontSize: 12 }}
              onClick={pauseRecording}
            >
              {recState === 'paused' ? '▶ Retomar' : '⏸ Pausar'}
            </button>
          </div>
        )}

        {status === 'ready' && streamInfo && (
          <div className="cam-info" style={hudBottomRightStyle}>
            {streamInfo.width}×{streamInfo.height}
            {zoom !== 1 && zoomCapabilities ? ` · ${zoom.toFixed(1)}×` : ''}
            {activeFilter.id !== 'original' ? ` · ${activeFilter.label}` : ''}
          </div>
        )}

        {countdown > 0 && (
          <div className="cam-center" style={centerOverlayStyle}>
            <span className="cam-countdown">{countdown}</span>
          </div>
        )}

        {flash && <div className="camera-flash" style={flashStyle} />}

        <canvas ref={renderRef} style={{ display: 'none' }} />
      </div>

      {zoomCapabilities ? (
        <div className="cam-zoom" style={zoomBarStyle}>
          <span style={{ fontSize: 11, color: 'var(--muted)', width: 18 }}>1×</span>
          <input
            type="range"
            min={zoomCapabilities.min}
            max={zoomCapabilities.max}
            step={zoomCapabilities.step || 0.1}
            value={zoom}
            onChange={(e) => void applyZoom(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 11, color: 'var(--muted)', width: 34, textAlign: 'right' }}>
            {zoomCapabilities.max.toFixed(0)}×
          </span>
        </div>
      ) : null}

      <div className="cam-controls" style={controlsStyle}>
        <div className="cam-cols" style={controlsColsStyle}>
          {/* Coluna da esquerda: galeria */}
          <div style={{ width: 72 }}>
            {gallery.length > 0 ? (
              <button
                type="button"
                className="thumb-btn"
                onClick={() => setPreview(gallery[0])}
                style={thumbButtonStyle}
                aria-label="Abrir galeria"
              >
                <img src={gallery[0].url} alt="Última captura" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <span className="thumb-badge">{gallery.length}</span>
              </button>
            ) : (
              <button type="button" className="thumb-btn" onClick={() => setSettingsOpen(!settingsOpen)} style={thumbButtonStyle} aria-label="Abrir configurações">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </button>
            )}
          </div>

          {/* Coluna central: obturador + modo */}
          <div className="cam-mid" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div className="cam-mode-tabs" style={modeTabsStyle}>
              <button
                type="button"
                onClick={() => toggleMode('photo')}
                style={modeTabStyle(mode === 'photo')}
                disabled={!controlsEnabled}
              >
                FOTO
              </button>
              <button
                type="button"
                onClick={() => toggleMode('video')}
                style={modeTabStyle(mode === 'video')}
                disabled={!controlsEnabled}
              >
                VÍDEO
              </button>
            </div>

            <button
              type="button"
              className="shutter"
              onClick={onShutter}
              aria-label={mode === 'photo' ? 'Tirar foto' : 'Gravar vídeo'}
              style={shutterStyle}
            >
              <span
                style={{
                  ...shutterInnerStyle,
                  ...(mode === 'video' && recState !== 'inactive'
                    ? { background: '#ff4d4d', borderRadius: 6, width: 28, height: 28 }
                    : {}),
                }}
              />
            </button>
            <span className="muted" style={{ fontSize: 11, minHeight: 14 }}>
              {mode === 'photo' ? 'TOCAR PARA FOTOGRAFAR' : recState === 'inactive' ? 'TOQUE PARA GRAVAR' : recState === 'recording' ? formatTime(elapsed) : `Pausado · ${formatTime(elapsed)}`}
            </span>
          </div>

          {/* Coluna da direita: trocar câmera */}
          <button
            type="button"
            onClick={switchFacing}
            disabled={!controlsEnabled}
            style={{ ...iconBtnStyle, width: 72 }}
            aria-label="Trocar câmera"
            title="Trocar câmera"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m3 7 3 3L9 7" />
              <path d="M6 10V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v4" />
              <path d="m21 17-3-3-3 3" />
              <path d="M18 14v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Trilha de controles */}
      <div className="cam-strip" style={stripStyle}>
        {settingsButton('Lanterna', torch, !torchSupported || !controlsEnabled, () => void toggleTorch())}
        {settingsButton(`Timer ${timer}s`, timer > 0, !controlsEnabled, () => {
          setShowAspect(false);
          setShowFilters(false);
          setSettingsOpen(!settingsOpen);
        })}

        {settingsButton('Proporção', false, !controlsEnabled, () => {
          setShowAspect(!showAspect);
          setShowFilters(false);
        })}
        {settingsButton('Filtro', activeFilter.id !== 'original', !controlsEnabled, () => {
          setShowFilters(!showFilters);
          setShowAspect(false);
        })}
        {settingsButton('Grade', grid, false, () => setGrid(!grid))}
        {settingsButton(mirror ? 'Espelho on' : 'Espelho', mirror, !controlsEnabled, () => setMirror(!mirror))}
        {settingsButton(audioEnabled ? 'Som on' : 'Mudo', !audioEnabled, mode !== 'video' || !controlsEnabled, () => setAudioEnabled(!audioEnabled))}
        {settingsButton('Resolução', false, !controlsEnabled, () => {
          setSettingsOpen(!settingsOpen);
        })}

        {devices.length > 1 && !!controlsEnabled && (
          <button
            type="button"
            className="cam-pill"
            style={pillStyle(false, false)}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            Câmeras
          </button>
        )}
      </div>

      {settingsOpen && (
        <div className="cam-settings" style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Configurações</strong>
            <button type="button" className="secondary" onClick={() => setSettingsOpen(false)}>
              Fechar
            </button>
          </div>

          <label htmlFor="cam-res">Resolução de captura</label>
          <div className="cam-opts" style={optRowStyle}>
            {RESOLUTIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                className="cam-pill"
                disabled={!controlsEnabled}
                style={optStyle(resolutionId === r.id)}
                onClick={() => {
                  setResolutionId(r.id);
                  void startCamera({ resolutionId: r.id });
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          <label>Timer</label>
          <div className="cam-opts" style={optRowStyle}>
            {TIMER_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                className="cam-pill"
                style={optStyle(timer === t.id)}
                onClick={() => setTimer(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {devices.length > 1 && (
            <>
              <label htmlFor="cam-sel">Câmera disponível</label>
              <select
                id="cam-sel"
                value={deviceId}
                onChange={(e) => selectDevice(e.target.value)}
                disabled={!controlsEnabled}
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {showAspect && (
        <div className="cam-settings" style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Proporção</strong>
            <button type="button" className="secondary" onClick={() => setShowAspect(false)}>
              Fechar
            </button>
          </div>
          <div className="cam-opts" style={optRowStyle}>
            {ASPECTS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="cam-pill"
                style={optStyle(aspectId === a.id)}
                onClick={() => setAspectId(a.id)}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {showFilters && (
        <div className="cam-settings" style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 14 }}>Filtros</strong>
            <button type="button" className="secondary" onClick={() => setShowFilters(false)}>
              Fechar
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="cam-pill"
                style={{ ...optStyle(filterId === f.id), padding: '6px 10px', fontSize: 12 }}
                onClick={() => setFilterId(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {preview && (
        <div className="cam-preview" style={modalStyle} onClick={() => setPreview(null)}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            {preview.kind === 'video' ? (
              <video src={preview.url} controls autoPlay style={{ width: '100%', maxHeight: '60vh', background: '#000' }} />
            ) : (
              <img src={preview.url} alt="Prévia" style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain', background: '#000' }} />
            )}
            <div style={{ padding: 12, display: 'flex', gap: 10, background: 'var(--surface)', alignItems: 'center' }}>
              <span className="muted" style={{ flex: 1, fontSize: 12 }}>
                {preview.width}×{preview.height} · {formatBytes(preview.sizeBytes)}
              </span>
              <button type="button" onClick={() => downloadFile(preview)}>Baixar</button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  removeItem(preview.id);
                  setPreview(null);
                }}
              >
                Excluir
              </button>
              <button type="button" className="secondary" onClick={() => setPreview(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {gallery.length > 1 && !preview && (
        <div className="cam-gallery-strip" style={galleryStripStyle}>
          {gallery.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPreview(item)}
              style={galleryThumbStyle}
              title={item.kindLabel}
            >
              {item.kind === 'video' ? (
                <>
                  <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <span className="gallery-play" style={playBadgeStyle}>▶</span>
                </>
              ) : (
                <img src={item.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GridOverlay() {
  const line = { position: 'absolute' as const, background: 'rgba(255,255,255,0.25)' };
  return (
    <>
      <div style={{ ...line, top: '33.33%', left: 0, right: 0, height: 1 }} />
      <div style={{ ...line, top: '66.66%', left: 0, right: 0, height: 1 }} />
      <div style={{ ...line, left: '33.33%', top: 0, bottom: 0, width: 1 }} />
      <div style={{ ...line, left: '66.66%', top: 0, bottom: 0, width: 1 }} />
    </>
  );
}

// Estilos (o projeto usa estilos inline; mantemos o tema escuro do globals.css)
const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  maxWidth: 960,
  margin: '0 auto',
};

const stageStyle = (ratio: number): React.CSSProperties => ({
  position: 'relative',
  width: '100%',
  aspectRatio: String(ratio),
  maxHeight: '66vh',
  background: '#000',
  borderRadius: 14,
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

const videoStyle: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const centerOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: 24,
};

const hudTopStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  display: 'flex',
  gap: 10,
  alignItems: 'center',
};

const hudBottomRightStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 10,
  right: 12,
  fontSize: 11,
  color: '#fff',
  background: 'rgba(0,0,0,0.55)',
  padding: '4px 8px',
  borderRadius: 6,
};

const flashStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: '#fff',
  pointerEvents: 'none',
  animation: 'cam-flash 0.4s ease-out forwards',
};

const zoomBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
};

const controlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const controlsColsStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  justifyContent: 'space-between',
};

const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text)',
  padding: 10,
  border: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const thumbButtonStyle: React.CSSProperties = {
  width: 52,
  height: 52,
  borderRadius: 10,
  padding: 0,
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  position: 'relative',
  overflow: 'hidden',
};

const modeTabsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  background: 'var(--surface)',
  borderRadius: 999,
  padding: 3,
  border: '1px solid var(--border)',
};

const modeTabStyle = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent)' : 'transparent',
  color: active ? '#0f0f0f' : 'var(--muted)',
  padding: '5px 14px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
});

const shutterStyle: React.CSSProperties = {
  width: 68,
  height: 68,
  borderRadius: '50%',
  background: 'transparent',
  border: '3px solid var(--text)',
  padding: 4,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const shutterInnerStyle: React.CSSProperties = {
  width: 54,
  height: 54,
  borderRadius: '50%',
  background: '#fff',
  display: 'block',
  transition: 'all 200ms',
};

const stripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const pillStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent)' : 'var(--surface)',
  color: active ? '#0f0f0f' : 'var(--text)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  padding: '7px 12px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.4 : 1,
});

const panelStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 16,
};

const optRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
  marginTop: 8,
};

const optStyle = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent)' : 'var(--bg)',
  color: active ? '#0f0f0f' : 'var(--text)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  padding: '6px 12px',
  borderRadius: 8,
  fontSize: 12,
});

const modalStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.85)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const modalCardStyle: React.CSSProperties = {
  maxWidth: 720,
  width: '100%',
  borderRadius: 14,
  overflow: 'hidden',
  background: '#000',
};

const playBadgeStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: 16,
  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
};

const galleryStripStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  paddingBottom: 4,
};

const galleryThumbStyle: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: 8,
  overflow: 'hidden',
  padding: 0,
  flex: '0 0 auto',
  position: 'relative',
  border: '1px solid var(--border)',
};