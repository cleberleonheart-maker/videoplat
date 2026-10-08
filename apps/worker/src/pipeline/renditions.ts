export const QUEUE_NAMES = {
  VIDEO: 'video',
} as const;

export const VIDEO_JOBS = {
  TRANSCODE: 'transcode',
} as const;

export interface TranscodeJobData {
  videoId: string;
  sourceKey: string;
}

export interface RenditionSpec {
  label: string;
  width: number;
  height: number;
  bitrateKbps: number;
  maxRateKbps: number;
  bufSizeKbps: number;
  audioKbps: number;
}

/**
 * Bitrates seguem a taxa de compressão do YouTube (~0.55 bits/pixel/frame).
 * Vídeos verticais (Shorts) são detectados no probe e recortados para 9:16
 * em vez de criar mais uma família de variantes.
 */
export const RENDITIONS: RenditionSpec[] = [
  { label: '240p', width: 426, height: 240, bitrateKbps: 400, maxRateKbps: 500, bufSizeKbps: 800, audioKbps: 64 },
  { label: '360p', width: 640, height: 360, bitrateKbps: 800, maxRateKbps: 1000, bufSizeKbps: 1600, audioKbps: 96 },
  { label: '480p', width: 854, height: 480, bitrateKbps: 1400, maxRateKbps: 1750, bufSizeKbps: 2800, audioKbps: 128 },
  { label: '720p', width: 1280, height: 720, bitrateKbps: 2800, maxRateKbps: 3500, bufSizeKbps: 5600, audioKbps: 128 },
  { label: '1080p', width: 1920, height: 1080, bitrateKbps: 5000, maxRateKbps: 6250, bufSizeKbps: 10000, audioKbps: 192 },
];

export const THUMBNAIL_SPECS = [
  { label: 'mq', width: 320, height: 180 },
  { label: 'hq', width: 480, height: 270 },
  { label: 'sd', width: 640, height: 360 },
] as const;
