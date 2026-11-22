import React from 'react';
import { AlertTriangle, Radio } from 'lucide-react';
import { getTrackInitialLetter, resolveTrackTileColor } from './coverArt';
import { MusicTrackRecord } from './types';

interface TrackCoverTileProps {
  track: MusicTrackRecord | null;
  sizeClass?: string;
  textClass?: string;
  roundedClass?: string;
  showMissingBadge?: boolean;
}

export const TrackCoverTile: React.FC<TrackCoverTileProps> = ({
  track,
  sizeClass = 'w-12 h-12',
  textClass = 'text-lg',
  roundedClass = 'rounded-xl',
  showMissingBadge = true,
}) => {
  if (!track) {
    return (
      <div
        className={`${sizeClass} ${roundedClass} shrink-0 bg-gradient-to-br from-emerald-600 to-teal-700 text-white flex items-center justify-center font-extrabold ${textClass} shadow-sm border border-black/5 dark:border-white/10 select-none`}
      >
        ♪
      </div>
    );
  }

  const colorOption = resolveTrackTileColor(track.title, track.tileColor);
  const initial = getTrackInitialLetter(track.title);
  const isRadio = track.kind === 'radio';

  return (
    <div
      className={`relative ${sizeClass} ${roundedClass} shrink-0 overflow-hidden shadow-sm border border-black/10 dark:border-white/10 select-none flex items-center justify-center`}
      style={!track.coverDataUrl ? { background: colorOption.gradientCss } : undefined}
    >
      {track.coverDataUrl ? (
        <img
          src={track.coverDataUrl}
          alt={`غلاف ${track.title}`}
          className="w-full h-full object-cover"
        />
      ) : isRadio ? (
        <Radio className="w-1/2 h-1/2 text-white drop-shadow-sm" />
      ) : (
        <span
          aria-hidden="true"
          className={`font-black text-white drop-shadow-sm leading-none ${textClass}`}
        >
          {initial}
        </span>
      )}

      {showMissingBadge && track.missingFile && (
        <span
          aria-label="ملف مفقود"
          className="absolute inset-0 bg-amber-950/65 flex items-center justify-center text-amber-300"
        >
          <AlertTriangle className="w-5 h-5" />
        </span>
      )}
    </div>
  );
};
