import { webRtcSessionManager } from '../media-transport/WebRtcSessionManager';
import { supabase } from '../../core/supabase-client';
import { useAppStore } from '../../shared/stores/app-store';

export class RecoveryCoordinator {
  private isRecovering: boolean = false;
  private attemptCount: number = 0;
  private recoveryTimer: number | null = null;
  private currentSessionId: string | null = null;
  private isHost: boolean = false;
  private removeListeners: Array<() => void> = [];

  init() {
    this.cleanup();

    // 1. Network online/offline
    const handleOnline = () => {
      console.log('[RecoveryCoordinator] Network came online');
      this.triggerRecovery('network_online');
    };
    const handleOffline = () => {
      console.warn('[RecoveryCoordinator] Network went offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 2. Visibility change (user unlocks phone or returns to app)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        console.log('[RecoveryCoordinator] App became visible');
        this.verifyAndReconcile();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // 3. WebRTC status monitoring
    const unregisterWebRtc = webRtcSessionManager.addStatusListener((status) => {
      if (status === 'recovery_required') {
        console.warn('[RecoveryCoordinator] WebRTC signaled recovery required');
        this.triggerRecovery('webrtc_failure');
      }
    });

    this.removeListeners.push(() => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
      unregisterWebRtc();
    });
  }

  setSession(sessionId: string, isHost: boolean) {
    this.currentSessionId = sessionId;
    this.isHost = isHost;
    this.attemptCount = 0;
  }

  /**
   * Coalesced recovery entry point
   */
  triggerRecovery(reason: string) {
    if (this.isRecovering) {
      console.log(`[RecoveryCoordinator] Recovery already in progress, skipping event: ${reason}`);
      return;
    }

    if (!this.currentSessionId) {
      return;
    }

    this.isRecovering = true;
    const delay = reason === 'network_online' ? 250 : this.calculateBackoff(this.attemptCount);
    console.log(`[RecoveryCoordinator] Scheduling recovery in ${delay}ms (reason: ${reason}, attempt: ${this.attemptCount + 1})`);

    this.recoveryTimer = window.setTimeout(async () => {
      this.attemptCount += 1;
      await this.executeRecovery(reason);
      this.isRecovering = false;
    }, delay);
  }

  private calculateBackoff(attempt: number): number {
    const base = 1000;
    const max = 15000;
    const factor = Math.pow(1.4, Math.min(attempt, 5));
    const jitter = Math.random() * 300;
    return Math.min(max, Math.floor(base * factor + jitter));
  }

  /**
   * Soft and Hard Recovery Execution
   */
  private async executeRecovery(triggerReason?: string) {
    if (!this.currentSessionId) return;

    try {
      // 1. Verify session state in Supabase
      const { data: session, error } = await supabase
        .from('live_sessions')
        .select('*')
        .eq('id', this.currentSessionId)
        .single();

      if (error || !session) {
        console.warn('[RecoveryCoordinator] Could not fetch session state during recovery:', error);
        return;
      }

      // If session ended or failed in DB, cleanly exit
      if (session.state === 'ENDED' || session.state === 'FAILED') {
        console.log('[RecoveryCoordinator] Session has ended or failed.');
        webRtcSessionManager.teardown();
        const state = useAppStore.getState();
        const isHost =
          this.isHost ||
          state.user?.role === 'HOST' ||
          state.user?.role === 'ADMIN';
        state.endSession();
        state.setView(isHost ? 'host-prelive' : 'listener-preview');
        return;
      }

      const currentGen = webRtcSessionManager.getGeneration();

      // Check if media generation advanced (Tier 2 Hard Reset)
      if (session.media_generation > currentGen) {
        console.log(`[RecoveryCoordinator] Detected generation change: ${currentGen} -> ${session.media_generation}`);
        if (!this.isHost && session.cloudflare_session_id && session.cloudflare_track_id) {
          await webRtcSessionManager.subscribeHostAudio(
            session.id,
            session.cloudflare_session_id,
            session.cloudflare_track_id,
            session.media_generation
          );
          webRtcSessionManager.playRemoteAudio().catch(console.warn);
          this.attemptCount = 0;
          return;
        }
      }

      // If this is a network reconnection, always force fresh ICE negotiation
      const isNetworkReconnection = triggerReason === 'network_online' || triggerReason === 'webrtc_failure';

      // Tier 1 Soft Recovery: check current transport status
      const transportStatus = webRtcSessionManager.getStatus();
      if (transportStatus === 'connected' && !isNetworkReconnection) {
        // Already healthy
        this.attemptCount = 0;
        return;
      }

      if (this.isHost) {
        console.log('[RecoveryCoordinator] Host attempting re-publish recovery');
      } else {
        // Listener re-subscribes with fresh ICE candidates
        if (session.cloudflare_session_id && session.cloudflare_track_id) {
          console.log('[RecoveryCoordinator] Listener re-subscribing to host track after network change');
          await webRtcSessionManager.subscribeHostAudio(
            session.id,
            session.cloudflare_session_id,
            session.cloudflare_track_id,
            session.media_generation
          );
          webRtcSessionManager.playRemoteAudio().catch(console.warn);
          this.attemptCount = 0;
        }
      }
    } catch (err) {
      console.error('[RecoveryCoordinator] Recovery execution failed:', err);
      // If retries exceeded 5, notify user or stop
      if (this.attemptCount > 5) {
        console.error('[RecoveryCoordinator] Maximum recovery attempts reached');
      }
    }
  }

  /**
   * Check session health when app regains focus/visibility
   */
  private async verifyAndReconcile() {
    if (!this.currentSessionId) return;
    const transportStatus = webRtcSessionManager.getStatus();
    if (transportStatus === 'error' || transportStatus === 'recovery_required') {
      this.triggerRecovery('visibility_focus_repair');
    }
  }

  cleanup() {
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.isRecovering = false;
    this.currentSessionId = null;
    this.attemptCount = 0;
  }

  destroy() {
    this.cleanup();
    this.removeListeners.forEach((fn) => fn());
    this.removeListeners = [];
  }
}

export const recoveryCoordinator = new RecoveryCoordinator();
