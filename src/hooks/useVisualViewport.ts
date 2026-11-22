import { useEffect, useState } from 'react';

export interface VisualViewportState {
  height: number;
  offsetTop: number;
  layoutHeight: number;
  isViewportShrunk: boolean;
}

function readViewport(): VisualViewportState {
  if (typeof window === 'undefined') {
    return {
      height: 800,
      offsetTop: 0,
      layoutHeight: 800,
      isViewportShrunk: false,
    };
  }
  const layoutHeight = window.innerHeight || 800;
  const vv = window.visualViewport;
  const height = vv ? Math.round(vv.height) : layoutHeight;
  const offsetTop = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0;
  const isViewportShrunk = layoutHeight - height > 120;
  return { height, offsetTop, layoutHeight, isViewportShrunk };
}

export function useVisualViewport(): VisualViewportState {
  const [viewport, setViewport] = useState<VisualViewportState>(() =>
    readViewport()
  );

  useEffect(() => {
    const update = () => {
      setViewport((prev) => {
        const next = readViewport();
        if (
          prev.height === next.height &&
          prev.offsetTop === next.offsetTop &&
          prev.layoutHeight === next.layoutHeight &&
          prev.isViewportShrunk === next.isViewportShrunk
        ) {
          return prev;
        }
        return next;
      });
    };

    update();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);

    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return viewport;
}
