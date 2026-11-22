import React from 'react';

interface MusicEqualizerProps {
  active?: boolean;
  reactiveLevels?: readonly [number, number, number] | null;
  className?: string;
}

export const MusicEqualizer: React.FC<MusicEqualizerProps> = ({
  active = true,
  reactiveLevels = null,
  className = '',
}) => {
  const useReactive = Boolean(active && reactiveLevels);
  return (
    <span
      aria-hidden="true"
      data-testid="music-equalizer"
      className={`inline-flex items-end gap-[2px] h-3 ${className}`}
    >
      <span
        style={
          useReactive && reactiveLevels
            ? {
                transform: `scaleY(${Math.max(0.25, Math.min(1, reactiveLevels[0]))})`,
              }
            : undefined
        }
        className={`w-[2.5px] h-full rounded-full bg-current origin-bottom ${
          useReactive
            ? 'transition-transform duration-75'
            : active
            ? 'music-eq-bar'
            : 'scale-y-50'
        }`}
      />
      <span
        style={
          useReactive && reactiveLevels
            ? {
                transform: `scaleY(${Math.max(0.25, Math.min(1, reactiveLevels[1]))})`,
              }
            : undefined
        }
        className={`w-[2.5px] h-full rounded-full bg-current origin-bottom ${
          useReactive
            ? 'transition-transform duration-75'
            : active
            ? 'music-eq-bar music-eq-bar-2'
            : 'scale-y-75'
        }`}
      />
      <span
        style={
          useReactive && reactiveLevels
            ? {
                transform: `scaleY(${Math.max(0.25, Math.min(1, reactiveLevels[2]))})`,
              }
            : undefined
        }
        className={`w-[2.5px] h-full rounded-full bg-current origin-bottom ${
          useReactive
            ? 'transition-transform duration-75'
            : active
            ? 'music-eq-bar music-eq-bar-3'
            : 'scale-y-40'
        }`}
      />
    </span>
  );
};
