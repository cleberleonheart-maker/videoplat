export const QUEUE_NAMES = {
  VIDEO: 'video',
} as const;

export const VIDEO_JOBS = {
  TRANSCODE: 'transcode',
} as const;

export interface TranscodeJobData {
  videoId: string;
  sourceKey: string;
  /** Corte, em segundos, antes da transcodificação (opcional). */
  trimStartSec?: number;
  trimEndSec?: number;
  /** Tempo (s) do frame escolhido como capa (opcional). */
  thumbnailTimeSec?: number;
}
