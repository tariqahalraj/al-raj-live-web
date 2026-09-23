import { Capacitor } from '@capacitor/core';

export const platform = {
  isNative: Capacitor.isNativePlatform(),
  isAndroid: Capacitor.getPlatform() === 'android',
  isIOS: Capacitor.getPlatform() === 'ios',
  isWeb: Capacitor.getPlatform() === 'web',
  getPlatform: () => Capacitor.getPlatform(),
};

export async function requestMicrophonePermission(): Promise<boolean> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn('getUserMedia not supported in this environment');
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop tracks immediately after verifying permission grant
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (err) {
    console.error('Microphone permission denied or unavailable:', err);
    return false;
  }
}
