import { CloudflareTracksResponse } from './types';
import { supabase } from '../../core/supabase-client';

export class CloudflareApiAdapter {

  private async callEdgeFunction<T>(action: string, payload: unknown): Promise<T> {
    const { data, error } = await supabase.functions.invoke('cloudflare-sfu', {
      body: { action, payload },
    });

    if (error) {
      console.error(`[CloudflareApiAdapter] Edge Function invoke error for "${action}":`, error);
      throw new Error(`[CloudflareApiAdapter] Remote Edge Function error: ${error.message}`);
    }

    return data as T;
  }

  async createSession(): Promise<string> {
    const res = await this.callEdgeFunction<{ sessionId: string }>('create-session', {});
    if (!res?.sessionId) {
      throw new Error('[CloudflareApiAdapter] Failed to obtain valid Cloudflare session ID');
    }
    return res.sessionId;
  }

  async publishTrack(
    sessionId: string,
    offer: RTCSessionDescriptionInit,
    mid: string,
    trackName: string,
    appSessionId?: string
  ): Promise<CloudflareTracksResponse> {
    return this.callEdgeFunction<CloudflareTracksResponse>('publish-track', {
      sessionId,
      sessionDescription: offer,
      tracks: [{ location: 'local', mid, trackName }],
      appSessionId,
    });
  }

  async subscribeTrack(
    sessionId: string,
    offer: RTCSessionDescriptionInit,
    remoteSessionId: string,
    remoteTrackName: string
  ): Promise<CloudflareTracksResponse> {
    return this.callEdgeFunction<CloudflareTracksResponse>('subscribe-track', {
      sessionId,
      sessionDescription: offer,
      tracks: [{ location: 'remote', sessionId: remoteSessionId, trackName: remoteTrackName }],
    });
  }

  async renegotiate(sessionId: string, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    const res = await this.callEdgeFunction<{ sessionDescription: RTCSessionDescriptionInit }>(
      'renegotiate',
      { sessionId, sessionDescription: offer }
    );
    return res.sessionDescription;
  }

  async closeTracks(sessionId: string, trackNames: string[]): Promise<void> {
    await this.callEdgeFunction('close-tracks', {
      sessionId,
      tracks: trackNames.map((trackName) => ({ trackName })),
    });
  }
}

export const cloudflareApiAdapter = new CloudflareApiAdapter();
