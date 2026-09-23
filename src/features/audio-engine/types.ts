export type AudioPermissionStatus =
  | 'unknown'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'error';

export type AudioEngineStatus =
  | 'uninitialized'
  | 'requesting_permission'
  | 'ready'
  | 'capturing'
  | 'muted'
  | 'error';

export type RecordingStatus =
  | 'idle'
  | 'recording'
  | 'paused'
  | 'stopped'
  | 'finalizing'
  | 'finalized'
  | 'error';

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  groupId: string;
  isDefault?: boolean;
}

export interface AudioEngineConfig {
  sampleRate?: number; // Request preferred (e.g. 48000), but don't hard-code
  channelCount?: number; // 1 for mono
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  highpassFilterCutoff?: number; // e.g. 80 Hz for voice rumble reduction
}

export interface AudioLevelData {
  rms: number; // 0.0 to 1.0
  peak: number; // 0.0 to 1.0
  isSpeaking: boolean;
}

export interface RecordingChunkMetadata {
  sessionId: string;
  chunkIndex: number;
  sequenceNumber: number;
  timestamp: number;
  durationMs: number;
  byteLength: number;
  mimeType: string;
  isInitChunk: boolean;
  data: Blob;
}

export interface RecordingSessionManifest {
  sessionId: string;
  sessionTitle: string;
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  chunkCount: number;
  totalBytes: number;
  mimeType: string;
  isFinalized: boolean;
  exportUrl?: string;
}

export type AudioLevelListener = (data: AudioLevelData) => void;
