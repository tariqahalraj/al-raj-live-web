import React, { useEffect, useRef } from 'react';
import { webRtcSessionManager } from '@/features/media-transport';
import { AudioAnalyser } from '@/features/audio-engine';
import { getAssetUrl } from '@/shared/utils/asset';

export interface HostAvatarGlowProps {
  /** Host/Murshid avatar URL */
  avatarUrl?: string;
  /** Host name for alt text */
  hostName?: string;
  /** Whether the host is online */
  isOnline?: boolean;
  /** Whether the host has muted their microphone */
  isHostMuted?: boolean;
  /** Additional container styling */
  className?: string;
}

/**
 * HostAvatarGlow
 *
 * Renders an exquisite, noble gold aura (#FFFDE8 → #FFF7D6 → #E8C766) that continuously
 * flows radially outward in compact, gentle concentric waves from behind Our Murshid's portrait,
 * smoothly responsive to the host's voice.
 *
 * Palette:
 * - Inner Core / Highlights: #FFFDE8 (luminous pearl white-gold)
 * - Mid Tone: #FFF7D6 (warm moonlight gold)
 * - Outer Glow / Ring Accent: #E8C766 (refined antique gold)
 * - Compact radius (scale: 1.44) and continuous 3-phase outward ripple.
 *
 * When host mic is muted:
 * - The gold glow softly rests at a calm, subtle simmer without changing color.
 */
export const HostAvatarGlow: React.FC<HostAvatarGlowProps> = ({
  avatarUrl,
  hostName = 'Our Murshid',
  isOnline = true,
  isHostMuted = false,
  className = '',
}) => {
  const coreGlowRef = useRef<HTMLDivElement>(null);
  const wavesContainerRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number | null>(null);

  const analyserRef = useRef<AudioAnalyser>(
    new AudioAnalyser({
      noiseFloor: 0.003,
      noiseGate: 0.002,
      maxExpectedRms: 0.10, // Sensitive to vocal recitation
      attackFactor: 0.40,   // Quick, smooth onset
      decayFactor: 0.06,    // Natural release
      powerCurve: 0.72,
    })
  );

  const isHostMutedRef = useRef(isHostMuted);
  useEffect(() => {
    isHostMutedRef.current = isHostMuted;
  }, [isHostMuted]);

  useEffect(() => {
    // Unblock browser AudioContext on any user interaction
    const unlockAudio = () => {
      const ctx = webRtcSessionManager.getRemoteAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      webRtcSessionManager.unlockAudio();
    };

    window.addEventListener('click', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
    window.addEventListener('pointerdown', unlockAudio, { passive: true });

    // Accessibility check
    const mediaQuery =
      typeof window !== 'undefined'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let prefersReducedMotion = mediaQuery ? mediaQuery.matches : false;
    const handleMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
    };
    if (mediaQuery && mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleMotionChange);
    }

    const analyser = analyserRef.current;
    const startTime = performance.now();

    const renderLoop = (now: number) => {
      const currentHostMuted = isHostMutedRef.current;
      let level = 0;

      if (!currentHostMuted) {
        const node = webRtcSessionManager.getRemoteAnalyserNode();
        level = analyser.sample(node, false);
      } else {
        level = analyser.sample(null, true);
      }

      // Gentle spiritual breathing shimmer for resting state (~2.8s rhythm)
      const elapsed = (now - startTime) / 1000;
      const breath = prefersReducedMotion ? 0.5 : (Math.sin(elapsed * 2.2) + 1) * 0.5;

      if (coreGlowRef.current && wavesContainerRef.current) {
        if (currentHostMuted) {
          // Host muted: serene, quiet resting gold shimmer
          coreGlowRef.current.style.transform = 'scale(1.0)';
          coreGlowRef.current.style.opacity = '0.35';
          wavesContainerRef.current.style.opacity = '0.20';
          wavesContainerRef.current.style.transform = 'scale(0.96)';
        } else {
          // Dynamic Gold Voice Response:
          // 1. Central Core expands gently with voice
          const coreScale = 1.02 + level * 0.18 + (prefersReducedMotion ? 0 : breath * 0.03);
          const coreOpacity = 0.55 + level * 0.28 + breath * 0.06;
          coreGlowRef.current.style.transform = `scale(${coreScale.toFixed(3)})`;
          coreGlowRef.current.style.opacity = coreOpacity.toFixed(3);

          // 2. Outward Waves surge gently in brightness and size with voice
          const wavesScale = 1.0 + level * 0.12;
          const wavesBrightness = 1.0 + level * 0.45;
          wavesContainerRef.current.style.transform = `scale(${wavesScale.toFixed(3)})`;
          wavesContainerRef.current.style.opacity = (0.70 + level * 0.25).toFixed(3);
          wavesContainerRef.current.style.filter = `brightness(${wavesBrightness.toFixed(2)})`;
        }
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
    };

    rafIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
      window.removeEventListener('pointerdown', unlockAudio);
      if (mediaQuery && mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMotionChange);
      }
    };
  }, []);

  return (
    <div className={`relative flex items-center justify-center select-none py-2 ${className}`}>
      {/* Refined CSS for continuous outward radial flow of gold waves (#FFFDE8 → #FFF7D6 → #E8C766) */}
      <style>{`
        @keyframes goldOutwardFlow {
          0% {
            transform: scale(0.98);
            opacity: 0.58;
            box-shadow: 0 0 12px rgba(232, 199, 102, 0.45), inset 0 0 8px rgba(255, 253, 232, 0.6);
          }
          45% {
            opacity: 0.36;
          }
          80% {
            opacity: 0.10;
          }
          100% {
            transform: scale(1.44);
            opacity: 0;
            box-shadow: 0 0 20px rgba(232, 199, 102, 0), inset 0 0 12px rgba(255, 253, 232, 0);
          }
        }
        .gold-flow-wave {
          position: absolute;
          width: 7rem; /* 112px */
          height: 7rem;
          border-radius: 9999px;
          border: 1px solid rgba(232, 199, 102, 0.55);
          background: radial-gradient(circle, rgba(255, 253, 232, 0.28) 0%, rgba(255, 247, 214, 0.18) 50%, rgba(232, 199, 102, 0.10) 75%, transparent 100%);
          pointer-events: none;
          will-change: transform, opacity;
          animation: goldOutwardFlow 3.6s cubic-bezier(0.2, 0.45, 0.35, 1.0) infinite;
        }
        .gold-flow-wave-1 { animation-delay: 0s; }
        .gold-flow-wave-2 { animation-delay: 1.2s; }
        .gold-flow-wave-3 { animation-delay: 2.4s; }
      `}</style>

      {/* Outer Ambient Gold Glow (Soft, compact radius) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute w-40 h-40 rounded-full bg-gradient-to-tr from-[#E8C766]/20 via-[#FFF7D6]/20 to-transparent blur-2xl"
      />

      {/* Constantly Flowing Outward Waves (3 Staggered Layers, Compact 1.44x Radius) */}
      <div
        ref={wavesContainerRef}
        aria-hidden="true"
        className="pointer-events-none absolute flex items-center justify-center will-change-transform transition-all duration-150"
      >
        <div className="gold-flow-wave gold-flow-wave-1" />
        <div className="gold-flow-wave gold-flow-wave-2" />
        <div className="gold-flow-wave gold-flow-wave-3" />
      </div>

      {/* Central Luminous Core (Soft gold #FFFDE8 → #FFF7D6 → #E8C766 directly behind avatar) */}
      <div
        ref={coreGlowRef}
        aria-hidden="true"
        className="pointer-events-none absolute w-30 h-30 rounded-full will-change-transform transition-opacity duration-150 blur-md"
        style={{
          width: '7.5rem',
          height: '7.5rem',
          background: 'radial-gradient(circle, #FFFDE8 0%, #FFF7D6 45%, rgba(232, 199, 102, 0.35) 75%, transparent 100%)',
          boxShadow: '0 0 24px rgba(232, 199, 102, 0.45)',
          transform: 'scale(1.02)',
          opacity: 0.60,
        }}
      />

      {/* Murshid Avatar Portrait + Live Online Badge */}
      <div className="relative z-10 w-28 h-28">
        <div className="w-full h-full rounded-full overflow-hidden border-2 border-white shadow-[0_2px_16px_rgba(232,199,102,0.30)] ring-1.5 ring-[#FFF7D6]/70 bg-slate-100 flex items-center justify-center">
          <img
            src={avatarUrl || getAssetUrl('assets/host-avatar.jpg')}
            alt={hostName}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = getAssetUrl('assets/app-logo.png');
            }}
          />
        </div>

        {/* Crisp Round Online Indicator Badge */}
        {isOnline && (
          <span
            className="absolute bottom-1 right-1 w-5 h-5 rounded-full bg-[#10B981] border-[2.5px] border-white shadow-xs z-20"
            title="Online"
          />
        )}
      </div>
    </div>
  );
};
