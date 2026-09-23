import React from 'react';
import { Mic, MicOff } from 'lucide-react';
import { audioEngine } from '../AudioEngine';
import { HorizontalVoiceVisualizer } from './HorizontalVoiceVisualizer';

export interface AudioReactiveMicPulseProps {
  /** Whether host microphone is muted */
  isMuted?: boolean;
  /** Whether session is actively broadcasting */
  isLive?: boolean;
  /** Optional explicit audio level in [0.0, 1.0] to bypass real mic capture */
  audioLevel?: number;
  /** Click action for the central microphone button */
  onClick?: () => void;
  /** Additional container styling */
  className?: string;
  /** Accessibility title */
  title?: string;
  /** Custom background for muted state */
  mutedBgClass?: string;
  /** Custom background for active broadcast state */
  activeBgClass?: string;
  /** Custom color for the horizontal waveform bars */
  barColor?: string;
}

/**
 * AudioReactiveMicPulse
 *
 * Combines the centered broadcast microphone button with the real-time
 * blue horizontal streaming voice visualizer positioned directly below it.
 */
export const AudioReactiveMicPulse: React.FC<AudioReactiveMicPulseProps> = ({
  isMuted = false,
  isLive = true,
  audioLevel,
  onClick,
  className = '',
  title,
  mutedBgClass = 'bg-slate-200 text-slate-500',
  activeBgClass = 'bg-[#15803D] text-white',
  barColor = '#2563EB',
}) => {
  const handleClick = () => {
    // Resume audio context if suspended on browser user gesture
    const ctx = audioEngine.getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    onClick?.();
  };

  return (
    <div className={`w-full flex flex-col items-center justify-center my-2 select-none ${className}`}>
      {/* Central Microphone Button (Full original size: w-24 h-24 / 96px) */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        title={title || (isMuted ? 'Unmute Microphone' : 'Mute Microphone')}
        aria-label={isMuted ? 'Unmute Microphone' : 'Mute Microphone'}
        className={`w-24 h-24 rounded-full flex items-center justify-center shadow-xs transition-colors duration-200 outline-none focus-visible:ring-3 focus-visible:ring-blue-500/50 ${
          onClick ? 'cursor-pointer hover:opacity-95 active:scale-95' : ''
        } ${isMuted ? mutedBgClass : activeBgClass}`}
      >
        {isMuted ? (
          <MicOff className="w-10 h-10 stroke-[2.2]" />
        ) : (
          <Mic className="w-10 h-10 stroke-[2.2]" />
        )}
      </div>

      {/* Real-time Blue Horizontal Streaming Voice Visualizer */}
      <div className="w-full mt-3 px-2">
        <HorizontalVoiceVisualizer
          isMuted={isMuted}
          isLive={isLive}
          audioLevel={audioLevel}
          barColor={barColor}
          barWidth={3}
          barGap={3}
          minBarHeight={3}
          maxBarHeight={32}
        />
      </div>
    </div>
  );
};
