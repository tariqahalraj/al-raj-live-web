import React, { useEffect, useRef } from 'react';
import { audioEngine } from '../AudioEngine';
import { AudioAnalyser } from '../audio-analyser';

export interface HorizontalVoiceVisualizerProps {
  /** Whether the microphone is muted */
  isMuted?: boolean;
  /** Whether live broadcast is running */
  isLive?: boolean;
  /** Direct audio level override in [0, 1] if bypassing AnalyserNode */
  audioLevel?: number;
  /** Primary bar color */
  barColor?: string;
  /** Width of each vertical bar in pixels */
  barWidth?: number;
  /** Gap between adjacent bars in pixels */
  barGap?: number;
  /** Minimum resting bar height during silence */
  minBarHeight?: number;
  /** Maximum bar height for loud syllables */
  maxBarHeight?: number;
  /** Additional container styling */
  className?: string;
}

/**
 * HorizontalVoiceVisualizer
 *
 * Real-time continuous scrolling blue voice waveform visualizer.
 * Streams vertical rounded amplitude bars horizontally across the full card width,
 * creating a professional voice recording tape effect (like Apple Voice Memos / WhatsApp).
 *
 * Powered by 60 FPS GPU-accelerated HTML5 Canvas with devicePixelRatio scaling
 * and zero React re-renders in the drawing loop.
 */
export const HorizontalVoiceVisualizer: React.FC<HorizontalVoiceVisualizerProps> = ({
  isMuted = false,
  isLive = true,
  audioLevel,
  barColor = '#2563EB',
  barWidth = 3,
  barGap = 3,
  minBarHeight = 3,
  maxBarHeight = 34,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafIdRef = useRef<number | null>(null);

  const analyserRef = useRef<AudioAnalyser>(new AudioAnalyser({
    noiseFloor: 0.012,
    noiseGate: 0.006,
    maxExpectedRms: 0.20,
    attackFactor: 0.40,
    decayFactor: 0.08,
  }));

  // Buffer storing past amplitude slices
  const bufferRef = useRef<number[]>([]);
  const lastSampleTimeRef = useRef<number>(0);

  // Latest props in refs to avoid recreating the animation loop
  const isMutedRef = useRef(isMuted);
  const isLiveRef = useRef(isLive);
  const audioLevelRef = useRef(audioLevel);

  useEffect(() => {
    isMutedRef.current = isMuted;
    isLiveRef.current = isLive;
    audioLevelRef.current = audioLevel;
  }, [isMuted, isLive, audioLevel]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Check prefers-reduced-motion
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

    let width = container.clientWidth || 240;
    let height = container.clientHeight || 44;

    const stepWidth = barWidth + barGap;
    let maxBars = Math.max(10, Math.floor(width / stepWidth));

    // Initialize buffer with flat resting values
    bufferRef.current = new Array(maxBars).fill(0);

    const updateCanvasSize = () => {
      if (!container || !canvas) return;
      const rect = container.getBoundingClientRect();
      width = Math.floor(rect.width) || 240;
      height = Math.floor(rect.height) || 44;

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      ctx.resetTransform?.();
      ctx.scale(dpr, dpr);

      maxBars = Math.max(10, Math.floor(width / stepWidth));
      if (bufferRef.current.length < maxBars) {
        const diff = maxBars - bufferRef.current.length;
        bufferRef.current = [...new Array(diff).fill(0), ...bufferRef.current];
      } else if (bufferRef.current.length > maxBars) {
        bufferRef.current = bufferRef.current.slice(bufferRef.current.length - maxBars);
      }
    };

    updateCanvasSize();

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasSize();
    });
    resizeObserver.observe(container);

    const analyser = analyserRef.current;
    const sampleIntervalMs = 40; // ~25-30 samples per second for smooth tape scroll

    const renderLoop = (timestamp: number) => {
      const currentMuted = isMutedRef.current;
      const currentLive = isLiveRef.current;
      const explicitLevel = audioLevelRef.current;

      // 1. Sample current audio level
      let currentSample = 0;
      if (currentLive && !currentMuted) {
        if (explicitLevel !== undefined) {
          currentSample = analyser.stepWithDirectLevel(explicitLevel, currentMuted);
        } else {
          const node = audioEngine.getAnalyserNode();
          currentSample = analyser.sample(node, currentMuted);
        }
      } else {
        currentSample = analyser.sample(null, true);
      }

      // 2. Stream new slice into rolling buffer periodically
      if (!prefersReducedMotion) {
        if (timestamp - lastSampleTimeRef.current >= sampleIntervalMs) {
          lastSampleTimeRef.current = timestamp;
          const buf = bufferRef.current;
          buf.shift();
          buf.push(currentSample);
        }
      } else {
        // Reduced motion: stationary level
        const buf = bufferRef.current;
        buf.fill(currentSample * 0.5);
      }

      // 3. Clear canvas
      ctx.clearRect(0, 0, width, height);

      // 4. Draw horizontal streaming waveform
      const centerY = height / 2;
      const buf = bufferRef.current;
      const totalBars = buf.length;

      ctx.fillStyle = currentMuted ? '#94A3B8' : barColor;
      ctx.lineCap = 'round';
      ctx.lineWidth = barWidth;
      ctx.strokeStyle = currentMuted ? '#94A3B8' : barColor;

      // Draw subtle centered resting baseline guide during silence
      ctx.beginPath();
      ctx.strokeStyle = currentMuted ? '#E2E8F0' : '#DBEAFE'; // subtle blue-50 baseline
      ctx.lineWidth = 1;
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Reset style for vertical bars
      ctx.lineWidth = barWidth;
      ctx.strokeStyle = currentMuted ? '#94A3B8' : barColor;

      for (let i = 0; i < totalBars; i++) {
        const x = i * stepWidth + barWidth / 2;
        const amp = buf[i];

        // Calculate bar height: minBarHeight during silence, up to maxBarHeight
        const h = Math.max(minBarHeight, amp * maxBarHeight);
        const yTop = centerY - h / 2;
        const yBottom = centerY + h / 2;

        ctx.beginPath();
        ctx.moveTo(x, yTop);
        ctx.lineTo(x, yBottom);
        ctx.stroke();
      }

      rafIdRef.current = requestAnimationFrame(renderLoop);
    };

    rafIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      resizeObserver.disconnect();
      if (mediaQuery && mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMotionChange);
      }
    };
  }, [barColor, barWidth, barGap, minBarHeight, maxBarHeight]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-11 relative flex items-center justify-center overflow-hidden select-none ${className}`}
      aria-label="Real-time Voice Waveform Visualizer"
    >
      <canvas ref={canvasRef} className="block w-full h-full pointer-events-none" />
    </div>
  );
};
