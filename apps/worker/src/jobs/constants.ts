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
