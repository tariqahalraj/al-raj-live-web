import { registerPlugin } from '@capacitor/core';

export interface LiveBackgroundPlugin {
  startLiveService(options?: { title?: string; text?: string; isHost?: boolean }): Promise<{ success: boolean }>;
  stopLiveService(): Promise<{ success: boolean }>;
  triggerLiveAlert(options?: { title?: string; body?: string; sessionId?: string }): Promise<{ success: boolean }>;
  startLiveMonitoring(): Promise<{ success: boolean }>;
}

const LiveBackgroundPluginNative = registerPlugin<LiveBackgroundPlugin>('LiveBackgroundService');

export async function startBackgroundLiveService(title: string, isHost: boolean) {
  try {
    const text = isHost ? 'Broadcasting live audio to listeners...' : 'Listening to live audio stream...';
    await LiveBackgroundPluginNative.startLiveService({
      title: title || 'Tariqah al-Raj Live',
      text,
      isHost,
    });
    console.log('[LiveBackgroundService] Foreground service started successfully');
  } catch (err) {
    // Graceful fallback for non-Android environments (web browser, tests)
    console.warn('[LiveBackgroundService] startLiveService notice (safe on web):', err);
  }
}

export async function stopBackgroundLiveService() {
  try {
    await LiveBackgroundPluginNative.stopLiveService();
    console.log('[LiveBackgroundService] Foreground service stopped successfully');
  } catch (err) {
    // Graceful fallback for non-Android environments
    console.warn('[LiveBackgroundService] stopLiveService notice (safe on web):', err);
  }
}

export async function triggerNativeLiveAlert(title?: string, body?: string, sessionId?: string) {
  try {
    await LiveBackgroundPluginNative.triggerLiveAlert({
      title: title || '🔴 Tariqah al-Raj Live Now!',
      body: body || 'Our Murshid is live. Tap to listen to the live Zikr.',
      sessionId,
    });
    console.log('[LiveBackgroundService] Native alert posted successfully');
  } catch (err) {
    console.warn('[LiveBackgroundService] triggerLiveAlert notice (safe on web):', err);
  }
}

export async function startNativeLiveMonitoring() {
  try {
    await LiveBackgroundPluginNative.startLiveMonitoring();
    console.log('[LiveBackgroundService] Background live monitoring started successfully');
  } catch (err) {
    console.warn('[LiveBackgroundService] startLiveMonitoring notice (safe on web):', err);
  }
}
