/**
 * Lightweight synchronous playback state flag so UI/camera sound helpers
 * never play shutter clicks or wake Web Audio API while music is actively playing.
 */

let musicPlayingActive = false;

export function setMusicPlayingActive(active: boolean): void {
  musicPlayingActive = Boolean(active);
}

export function isMusicPlayingActive(): boolean {
  return musicPlayingActive;
}
