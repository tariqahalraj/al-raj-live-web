export type TransportStatus =
  | 'idle'
  | 'creating'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'recovery_required'
  | 'soft_recovery'
  | 'hard_reset'
  | 'closing'
  | 'closed';

export interface CloudflareTrack {
  location: 'local' | 'remote';
  mid: string;
  trackName: string;
  sessionId?: string;
  status?: 'active' | 'waiting' | 'inactive';
}

export interface CloudflareSessionResponse {
  sessionId: string;
}

export interface CloudflareTracksResponse {
  sessionDescription: RTCSessionDescriptionInit;
  tracks: CloudflareTrack[];
}

export interface MediaTransportStats {
  bitrateKbps: number;
  packetLossPercent: number;
  roundTripTimeMs: number;
  jitterMs: number;
  audioLevel: number;
  timestamp: number;
}

export interface NegotiationTask {
  id: string;
  generation: number;
  type: 'publish' | 'subscribe' | 'renegotiate' | 'close';
  createdAt: number;
}

export type TransportStatusListener = (status: TransportStatus) => void;
export type MediaStatsListener = (stats: MediaTransportStats) => void;
