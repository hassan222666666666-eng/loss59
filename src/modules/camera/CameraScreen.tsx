import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  ImagePlus,
  WifiOff,
  Check,
  RotateCcw,
  AlertTriangle,
  Images,
  Zap,
  ZapOff,
} from 'lucide-react';
import { AppSettings, FlashMode, Shelf, ShelfPhoto, ShortageItem } from '../../types';
import {
  deletePhotoAndShortages,
  getAllShelves,
  getAllShortages,
  getPhotoById,
  getPhotosBySession,
  savePhoto,
} from '../db';
import {
  checkImageBlurFromCanvas,
  DEFAULT_BLUR_THRESHOLD,
} from './blurDetection';
import {
  calculateTargetDimensions,
  compressCanvasToJpeg,
  drawCroppedRotatedToCanvas,
  fileOrDataUrlToCanvas,
  getVideoCaptureRotationDeg,
  processCaptureOffThread,
} from './imageCompression';
import { SessionPhotosModal } from './SessionPhotosModal';
import { analysisQueue } from '../analysis/analysisQueue';
import { getLocalDateKey } from '../../utils/arabicText';
import { playShutterSound, warmAudioContext } from '../../utils/sound';

let sharedPreviewCanvas: HTMLCanvasElement | null = null;

function createFastPreviewFromSource(
  source: ImageBitmap | HTMLCanvasElement,
  digitalScale: number,
  rotationDeg: 0 | 90 | 180 | 270 = 0
): { dataUrl: string; width: number; height: number } | null {
  const srcW = source.width;
  const srcH = source.height;
  if (!srcW || !srcH) return null;

  const scale = digitalScale > 1.01 ? digitalScale : 1;
  const cropW = srcW / scale;
  const cropH = srcH / scale;
  const cropX = (srcW - cropW) / 2;
  const cropY = (srcH - cropH) / 2;

  const quarterTurn = rotationDeg === 90 || rotationDeg === 270;
  const outCropW = quarterTurn ? cropH : cropW;
  const outCropH = quarterTurn ? cropW : cropH;

  const target = calculateTargetDimensions(outCropW, outCropH, 480);
  if (!sharedPreviewCanvas) {
    sharedPreviewCanvas = document.createElement('canvas');
  }
  sharedPreviewCanvas.width = target.width;
  sharedPreviewCanvas.height = target.height;
  const ctx = sharedPreviewCanvas.getContext('2d');
  if (!ctx) return null;

  drawCroppedRotatedToCanvas(
    ctx,
    source,
    cropX,
    cropY,
    cropW,
    cropH,
    target.width,
    target.height,
    rotationDeg
  );

  return {
    dataUrl: sharedPreviewCanvas.toDataURL('image/jpeg', 0.78),
    width: Math.round(outCropW),
    height: Math.round(outCropH),
  };
}

async function persistCapturedShotToLog(params: {
  shot: { dataUrl: string; width: number; height: number };
  sessionId: string;
  aiEnabled: boolean;
  onSaved?: (record: ShelfPhoto) => void;
}): Promise<void> {
  const now = Date.now();
  const record: ShelfPhoto = {
    id: `ph_${now}_${Math.random().toString(36).slice(2, 7)}`,
    sessionId: params.sessionId,
    timestamp: now,
    dateKey: getLocalDateKey(now),
    dataUrl: params.shot.dataUrl,
    width: params.shot.width,
    height: params.shot.height,
    status: params.aiEnabled ? 'pending' : 'manual_only',
  };
  await savePhoto(record);
  analysisQueue.notify();
  params.onSaved?.(record);
  if (params.aiEnabled) {
    analysisQueue.processQueue();
  }
}

interface PendingReviewShot {
  dataUrl: string;
  width: number;
  height: number;
  isBlurry: boolean;
  variance: number;
}

interface ExtendedMediaCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  zoom?: { min: number; max: number; step?: number };
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
}

interface CameraScreenProps {
  sessionId: string;
  settings: AppSettings;
  isOnline: boolean;
  onPhotoQueued: () => void;
  onOpenPhotoInLog?: (photoId: string) => void;
}

const FLASH_LABELS: Record<FlashMode, string> = {
  auto: 'تلقائي',
  on: 'تشغيل',
  off: 'إيقاف',
};

const FLASH_CYCLE: FlashMode[] = ['auto', 'on', 'off'];
const ZOOM_PRESETS = [1, 2, 3] as const;

const LOW_LUMA_THRESHOLD = 82;
const BASE_HIGH_LUMA_THRESHOLD = 142;
const MAX_HIGH_LUMA_THRESHOLD = 195;
const SAMPLE_INTERVAL_MS = 400;
const TURN_ON_HOLD_MS = 750;
const TURN_OFF_HOLD_MS = 1100;

export const CameraScreen: React.FC<CameraScreenProps> = ({
  sessionId,
  settings,
  isOnline,
  onPhotoQueued,
  onOpenPhotoInLog,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraFallbackInputRef = useRef<HTMLInputElement | null>(null);
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Direct DOM refs to avoid React re-renders during streaming, shutter flash, and pinch zoom
  const flashOverlayRef = useRef<HTMLDivElement | null>(null);
  const zoomLabelRef = useRef<HTMLDivElement | null>(null);
  const verticalSliderRef = useRef<HTMLInputElement | null>(null);
  const isCapturingRef = useRef(false);
  const isMountedRef = useRef(true);
  const captureUnlockTimerRef = useRef<number | null>(null);

  const [cameraState, setCameraState] = useState<
    'starting' | 'active' | 'denied' | 'unsupported'
  >('starting');
  const [cameraError, setCameraError] = useState<string>('');
  const [sessionPhotos, setSessionPhotos] = useState<ShelfPhoto[]>([]);
  const [sessionShelves, setSessionShelves] = useState<Shelf[]>([]);
  const [sessionShortages, setSessionShortages] = useState<ShortageItem[]>([]);
  const [showSessionGrid, setShowSessionGrid] = useState(false);
  const [reviewShot, setReviewShot] = useState<PendingReviewShot | null>(null);

  // Flash & torch capabilities
  const [torchSupported, setTorchSupported] = useState(false);
  const [flashMode, setFlashMode] = useState<FlashMode>(
    settings.autoFlash ? 'auto' : 'off'
  );
  const [torchOn, setTorchOn] = useState(false);
  const torchOnRef = useRef(false);
  const lowLumaSinceRef = useRef<number | null>(null);
  const highLumaSinceRef = useRef<number | null>(null);
  const adaptiveHighLumaRef = useRef<number>(BASE_HIGH_LUMA_THRESHOLD);
  const lastTorchTurnedOnAtRef = useRef<number>(0);
  const lastTorchTurnedOffAtRef = useRef<number>(0);
  const userToggledFlashRef = useRef(false);

  // Zoom state (range & active chip/overlay visibility) without re-rendering per pinch frame
  const [hardwareZoomRange, setHardwareZoomRange] = useState<{
    min: number;
    max: number;
    step: number;
  } | null>(null);
  const hardwareZoomRangeRef = useRef<{
    min: number;
    max: number;
    step: number;
  } | null>(null);
  const [activePresetZoom, setActivePresetZoom] = useState<number>(1);
  const [showZoomOverlay, setShowZoomOverlay] = useState(false);

  const zoomValueRef = useRef<number>(1);
  const zoomMin = hardwareZoomRange ? Math.min(1, hardwareZoomRange.min) : 1;
  const zoomMax = Math.max(4, hardwareZoomRange ? hardwareZoomRange.max : 4);
  const zoomStep = hardwareZoomRange ? hardwareZoomRange.step : 0.1;
  const zoomBoundsRef = useRef({ min: 1, max: 4 });
  zoomBoundsRef.current = { min: zoomMin, max: zoomMax };

  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const zoomFadeTimerRef = useRef<number | null>(null);
  const zoomRafRef = useRef<number | null>(null);
  const pendingHwZoomRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const loadSessionPhotos = useCallback(async () => {
    const [list, shelves, shortages] = await Promise.all([
      getPhotosBySession(sessionId),
      getAllShelves(),
      getAllShortages(),
    ]);
    setSessionPhotos(list);
    setSessionShelves(shelves);
    setSessionShortages(shortages);
  }, [sessionId]);

  useEffect(() => {
    isMountedRef.current = true;
    loadSessionPhotos();
    const unsub = analysisQueue.subscribe(() => {
      if (isMountedRef.current) {
        loadSessionPhotos();
      }
    });
    return () => {
      isMountedRef.current = false;
      unsub();
    };
  }, [loadSessionPhotos]);

  useEffect(() => {
    if (!settings.autoFlash && flashMode === 'auto') {
      setFlashMode('off');
    } else if (
      settings.autoFlash &&
      flashMode === 'off' &&
      !userToggledFlashRef.current
    ) {
      setFlashMode('auto');
    }
  }, [settings.autoFlash, flashMode]);

  const triggerShutterFeedback = useCallback((playSound: boolean) => {
    if (playSound) {
      playShutterSound();
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(28);
      } catch {
        // Ignore if blocked
      }
    }
    const overlay = flashOverlayRef.current;
    if (overlay) {
      overlay.style.opacity = '1';
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
      flashTimerRef.current = window.setTimeout(() => {
        if (flashOverlayRef.current) {
          flashOverlayRef.current.style.opacity = '0';
        }
        flashTimerRef.current = null;
      }, 120);
    }
  }, []);

  const triggerZoomOverlay = useCallback(() => {
    setShowZoomOverlay(true);
    if (zoomFadeTimerRef.current !== null) {
      window.clearTimeout(zoomFadeTimerRef.current);
    }
    zoomFadeTimerRef.current = window.setTimeout(() => {
      setShowZoomOverlay(false);
      zoomFadeTimerRef.current = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (zoomFadeTimerRef.current !== null) {
        window.clearTimeout(zoomFadeTimerRef.current);
      }
      if (zoomRafRef.current !== null) {
        cancelAnimationFrame(zoomRafRef.current);
      }
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
      if (captureUnlockTimerRef.current !== null) {
        window.clearTimeout(captureUnlockTimerRef.current);
      }
    };
  }, []);

  const applyTorch = useCallback(async (enabled: boolean) => {
    const track = videoTrackRef.current;
    if (!track) return;
    let applied = false;
    try {
      await track.applyConstraints({
        advanced: [{ torch: enabled } as unknown as MediaTrackConstraintSet],
      });
      applied = true;
    } catch {
      // Try direct constraint below
    }

    try {
      const currentSettings =
        typeof track.getSettings === 'function'
          ? (track.getSettings() as MediaTrackSettings & { torch?: boolean })
          : null;
      if (
        !applied ||
        (currentSettings &&
          typeof currentSettings.torch === 'boolean' &&
          currentSettings.torch !== enabled)
      ) {
        await track.applyConstraints({
          torch: enabled,
        } as unknown as MediaTrackConstraints);
        applied = true;
      }
    } catch {
      // Ignore if device rejects direct torch constraint
    }

    if (applied) {
      torchOnRef.current = enabled;
      setTorchOn(enabled);
    }
  }, []);

  const syncZoomToDom = useCallback(
    (rounded: number, commitPresetState: boolean) => {
      const hw = hardwareZoomRangeRef.current;
      const hwApplied = hw ? Math.max(hw.min, Math.min(hw.max, rounded)) : 1;
      const digitalScale = settings.zoomControls
        ? hw
          ? Math.max(1, rounded / Math.max(1, hwApplied))
          : rounded
        : 1;

      if (videoRef.current) {
        videoRef.current.style.transform =
          digitalScale > 1.01 ? `scale(${digitalScale})` : '';
      }
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = `${rounded.toFixed(1)}x`;
      }
      if (verticalSliderRef.current) {
        verticalSliderRef.current.value = String(rounded);
      }
      if (commitPresetState) {
        const matched = ZOOM_PRESETS.find((p) => Math.abs(rounded - p) < 0.15);
        setActivePresetZoom(matched ?? -1);
      }
    },
    [settings.zoomControls]
  );

  const applyZoom = useCallback(
    (next: number, showOverlay: boolean = true, syncPreset: boolean = true) => {
      const { min, max } = zoomBoundsRef.current;
      const clamped = Math.max(min, Math.min(max, next));
      const rounded = Math.round(clamped * 10) / 10;
      zoomValueRef.current = rounded;
      syncZoomToDom(rounded, syncPreset);
      if (showOverlay) {
        triggerZoomOverlay();
      }

      const track = videoTrackRef.current;
      const hw = hardwareZoomRangeRef.current;
      if (track && hw) {
        const hwTarget = Math.max(hw.min, Math.min(hw.max, rounded));
        pendingHwZoomRef.current = hwTarget;
        if (zoomRafRef.current === null) {
          zoomRafRef.current = requestAnimationFrame(() => {
            zoomRafRef.current = null;
            const target = pendingHwZoomRef.current;
            const activeTrack = videoTrackRef.current;
            if (target !== null && activeTrack) {
              activeTrack
                .applyConstraints({
                  advanced: [
                    { zoom: target } as unknown as MediaTrackConstraintSet,
                  ],
                })
                .catch(() => {});
            }
          });
        }
      }
    },
    [syncZoomToDom, triggerZoomOverlay]
  );

  useEffect(() => {
    if (!settings.zoomControls) {
      applyZoom(1, false, true);
      setShowZoomOverlay(false);
    }
  }, [settings.zoomControls, applyZoom]);

  const stopCamera = useCallback(() => {
    if (torchOnRef.current && videoTrackRef.current) {
      videoTrackRef.current
        .applyConstraints({
          advanced: [{ torch: false } as unknown as MediaTrackConstraintSet],
        })
        .catch(() => {});
    }
    torchOnRef.current = false;
    setTorchOn(false);
    videoTrackRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      setCameraState('unsupported');
      setCameraError(
        'المتصفح لا يدعم الكاميرا المباشرة، يمكنك اختيار صورة من الجهاز.'
      );
      return;
    }

    setCameraState('starting');
    setCameraError('');
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] || null;
      videoTrackRef.current = track;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      const inspectTrackCapabilities = (t: MediaStreamTrack | null) => {
        if (!t || typeof t.getCapabilities !== 'function') {
          setTorchSupported(false);
          hardwareZoomRangeRef.current = null;
          setHardwareZoomRange(null);
          zoomValueRef.current = 1;
          setActivePresetZoom(1);
          return false;
        }
        const caps = t.getCapabilities() as ExtendedMediaCapabilities;
        const hasTorch = Boolean(caps.torch);
        setTorchSupported(hasTorch);

        // Continuous focus, exposure, and white balance when supported
        const advancedConstraints: Record<string, string>[] = [];
        if (
          Array.isArray(caps.focusMode) &&
          caps.focusMode.includes('continuous')
        ) {
          advancedConstraints.push({ focusMode: 'continuous' });
        }
        if (
          Array.isArray(caps.exposureMode) &&
          caps.exposureMode.includes('continuous')
        ) {
          advancedConstraints.push({ exposureMode: 'continuous' });
        }
        if (
          Array.isArray(caps.whiteBalanceMode) &&
          caps.whiteBalanceMode.includes('continuous')
        ) {
          advancedConstraints.push({ whiteBalanceMode: 'continuous' });
        }
        if (advancedConstraints.length > 0) {
          t.applyConstraints({
            advanced:
              advancedConstraints as unknown as MediaTrackConstraintSet[],
          }).catch(() => {});
        }

        if (
          caps.zoom &&
          typeof caps.zoom.min === 'number' &&
          typeof caps.zoom.max === 'number' &&
          caps.zoom.max > caps.zoom.min
        ) {
          const range = {
            min: caps.zoom.min,
            max: caps.zoom.max,
            step: caps.zoom.step || 0.1,
          };
          hardwareZoomRangeRef.current = range;
          setHardwareZoomRange(range);
          const initialZ = Math.max(caps.zoom.min, 1);
          zoomValueRef.current = initialZ;
          setActivePresetZoom(Math.abs(initialZ - 1) < 0.15 ? 1 : -1);
        } else {
          hardwareZoomRangeRef.current = null;
          setHardwareZoomRange(null);
          zoomValueRef.current = 1;
          setActivePresetZoom(1);
        }
        return hasTorch;
      };

      const foundTorch = inspectTrackCapabilities(track);
      if (!foundTorch && track) {
        // Some Android devices expose torch capability only after stream frames settle
        window.setTimeout(() => {
          if (isMountedRef.current && videoTrackRef.current === track) {
            inspectTrackCapabilities(track);
          }
        }, 350);
      }

      setCameraState('active');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setCameraState('denied');
      setCameraError(
        msg.toLowerCase().includes('permission') ||
          msg.toLowerCase().includes('denied') ||
          msg.toLowerCase().includes('notallowed')
          ? 'تم رفض إذن الكاميرا. يمكنك السماح من إعدادات المتصفح أو اختيار صورة من الجهاز.'
          : 'تعذر تشغيل الكاميرا الخلفية. يمكنك التصوير أو اختيار صورة من الجهاز.'
      );
    }
  }, [stopCamera]);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  // Apply explicit flash mode changes (on / off)
  useEffect(() => {
    if (!torchSupported || cameraState !== 'active') return;
    if (flashMode === 'on') {
      lowLumaSinceRef.current = null;
      highLumaSinceRef.current = null;
      applyTorch(true);
    } else if (flashMode === 'off') {
      lowLumaSinceRef.current = null;
      highLumaSinceRef.current = null;
      applyTorch(false);
    }
  }, [flashMode, torchSupported, cameraState, applyTorch]);

  // Smart Auto Flash: samples brightness every 400ms, turns ON quickly in dim shelves,
  // adapts turn-off threshold to prevent close-object torch reflection flicker,
  // and turns OFF cleanly when moving to well-lit aisles.
  useEffect(() => {
    if (
      !torchSupported ||
      cameraState !== 'active' ||
      flashMode !== 'auto' ||
      !settings.autoFlash ||
      reviewShot
    ) {
      return;
    }

    lowLumaSinceRef.current = null;
    highLumaSinceRef.current = null;
    adaptiveHighLumaRef.current = BASE_HIGH_LUMA_THRESHOLD;

    if (!meterCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      meterCanvasRef.current = c;
    }

    const evaluateBrightness = () => {
      if (isCapturingRef.current) return;
      const video = videoRef.current;
      const canvas = meterCanvasRef.current;
      if (
        !video ||
        !canvas ||
        video.videoWidth === 0 ||
        video.videoHeight === 0
      ) {
        return;
      }
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, 16, 16);
      const pixels = ctx.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      const total = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        sum +=
          0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
      }
      const avgLuma = total > 0 ? sum / total : 128;
      const now = Date.now();

      if (!torchOnRef.current) {
        highLumaSinceRef.current = null;
        if (avgLuma < LOW_LUMA_THRESHOLD) {
          if (lowLumaSinceRef.current === null) {
            lowLumaSinceRef.current = now;
          } else if (now - lowLumaSinceRef.current >= TURN_ON_HOLD_MS) {
            // If scene immediately went dark again after auto turn-off, raise off-threshold
            // so close-object reflection from our own torch doesn't cause blinking
            if (now - lastTorchTurnedOffAtRef.current < 1800) {
              adaptiveHighLumaRef.current = Math.min(
                MAX_HIGH_LUMA_THRESHOLD,
                adaptiveHighLumaRef.current + 22
              );
            }
            lowLumaSinceRef.current = null;
            lastTorchTurnedOnAtRef.current = now;
            applyTorch(true);
          }
        } else {
          lowLumaSinceRef.current = null;
          if (avgLuma > 108) {
            adaptiveHighLumaRef.current = BASE_HIGH_LUMA_THRESHOLD;
          }
        }
      } else {
        lowLumaSinceRef.current = null;
        // Let camera auto-exposure settle for 1.4s after torch turns on before checking turn-off
        if (now - lastTorchTurnedOnAtRef.current < 1400) {
          highLumaSinceRef.current = null;
          return;
        }
        if (avgLuma > adaptiveHighLumaRef.current) {
          if (highLumaSinceRef.current === null) {
            highLumaSinceRef.current = now;
          } else if (now - highLumaSinceRef.current >= TURN_OFF_HOLD_MS) {
            highLumaSinceRef.current = null;
            lastTorchTurnedOffAtRef.current = now;
            applyTorch(false);
          }
        } else {
          highLumaSinceRef.current = null;
        }
      }
    };

    const initialTimer = window.setTimeout(evaluateBrightness, 200);
    const intervalId = window.setInterval(evaluateBrightness, SAMPLE_INTERVAL_MS);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(intervalId);
    };
  }, [
    torchSupported,
    cameraState,
    flashMode,
    settings.autoFlash,
    reviewShot,
    applyTorch,
  ]);

  const commitPhotoToDB = useCallback(
    async (shot: { dataUrl: string; width: number; height: number }) => {
      await persistCapturedShotToLog({
        shot,
        sessionId,
        aiEnabled: settings.aiAnalysisEnabled,
        onSaved: (record) => {
          if (isMountedRef.current) {
            setSessionPhotos((prev) =>
              prev.some((p) => p.id === record.id) ? prev : [record, ...prev]
            );
            onPhotoQueued();
          }
        },
      });
    },
    [sessionId, settings.aiAnalysisEnabled, onPhotoQueued]
  );

  const finalizeProcessedShot = useCallback(
    async (processed: {
      dataUrl: string;
      width: number;
      height: number;
      isBlurry: boolean;
      variance: number;
    }) => {
      if (settings.continuousMode) {
        await commitPhotoToDB({
          dataUrl: processed.dataUrl,
          width: processed.width,
          height: processed.height,
        });
        return;
      }

      if (isMountedRef.current) {
        setReviewShot(processed);
      } else if (!processed.isBlurry) {
        await commitPhotoToDB({
          dataUrl: processed.dataUrl,
          width: processed.width,
          height: processed.height,
        });
      }
    },
    [commitPhotoToDB, settings.continuousMode]
  );

  const handleCapture = async () => {
    if (isCapturingRef.current) return;
    warmAudioContext();

    if (cameraState !== 'active' || !videoRef.current) {
      cameraFallbackInputRef.current?.click();
      return;
    }

    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    const previewW = video.clientWidth || vw;
    const previewH = video.clientHeight || vh;

    isCapturingRef.current = true;
    // Instant shutter flash + vibration without blocking camera live preview
    triggerShutterFeedback(settings.shutterSound);

    const hw = hardwareZoomRangeRef.current;
    const curZoom = zoomValueRef.current;
    const hwApplied = hw ? Math.max(hw.min, Math.min(hw.max, curZoom)) : 1;
    const digitalScale = settings.zoomControls
      ? hw
        ? Math.max(1, curZoom / Math.max(1, hwApplied))
        : curZoom
      : 1;

    const drawFullResVideoCanvas = (): HTMLCanvasElement | null => {
      if (!video || !video.videoWidth || !video.videoHeight) return null;
      const w = video.videoWidth;
      const h = video.videoHeight;
      const rot = getVideoCaptureRotationDeg(w, h, previewW, previewH);
      const scale = digitalScale > 1.01 ? digitalScale : 1;
      const sw = w / scale;
      const sh = h / scale;
      const sx = (w - sw) / 2;
      const sy = (h - sh) / 2;
      const quarterTurn = rot === 90 || rot === 270;
      const outW = Math.round(quarterTurn ? sh : sw);
      const outH = Math.round(quarterTurn ? sw : sh);

      const c = document.createElement('canvas');
      c.width = outW;
      c.height = outH;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      drawCroppedRotatedToCanvas(ctx, video, sx, sy, sw, sh, outW, outH, rot);
      return c;
    };

    // Grab the live video frame instantaneously (<10ms) without ImageCapture.takePhoto() hardware stalls
    let capturedBitmap: ImageBitmap | undefined;
    let fallbackCanvasData: HTMLCanvasElement | null = null;
    try {
      if (typeof createImageBitmap === 'function') {
        try {
          capturedBitmap = await createImageBitmap(video);
        } catch {
          capturedBitmap = undefined;
        }
      }
      if (!capturedBitmap) {
        fallbackCanvasData = drawFullResVideoCanvas();
      }
    } finally {
      if (captureUnlockTimerRef.current !== null) {
        window.clearTimeout(captureUnlockTimerRef.current);
      }
      captureUnlockTimerRef.current = window.setTimeout(() => {
        isCapturingRef.current = false;
        captureUnlockTimerRef.current = null;
      }, 80);
    }

    const rotationDeg: 0 | 90 | 180 | 270 = capturedBitmap
      ? getVideoCaptureRotationDeg(
          capturedBitmap.width,
          capturedBitmap.height,
          previewW,
          previewH
        )
      : 0;

    const skipBlurReview = Boolean(settings.continuousMode);
    const blurThreshold = skipBlurReview ? 0 : DEFAULT_BLUR_THRESHOLD;
    const capturedSessionId = sessionId;

    // Instant two-stage save in continuous mode: save upright fast preview to Session Photos + Log immediately (~15ms),
    // then upgrade to full 2048px EXIF-free upright JPEG in the background without blocking UI or camera.
    if (settings.continuousMode && (capturedBitmap || fallbackCanvasData)) {
      const preview = capturedBitmap
        ? createFastPreviewFromSource(capturedBitmap, digitalScale, rotationDeg)
        : createFastPreviewFromSource(fallbackCanvasData!, 1, 0);

      if (preview) {
        const now = Date.now();
        const photoId = `ph_${now}_${Math.random().toString(36).slice(2, 7)}`;
        const initialRecord: ShelfPhoto = {
          id: photoId,
          sessionId: capturedSessionId,
          timestamp: now,
          dateKey: getLocalDateKey(now),
          dataUrl: preview.dataUrl,
          width: preview.width,
          height: preview.height,
          status: settings.aiAnalysisEnabled ? 'pending' : 'manual_only',
        };

        // Update UI immediately on next frame
        if (isMountedRef.current) {
          setSessionPhotos((prev) => [initialRecord, ...prev]);
        }

        const saveInitialPromise = savePhoto(initialRecord)
          .then(() => {
            analysisQueue.notify();
            if (isMountedRef.current) {
              onPhotoQueued();
            }
          })
          .catch(() => {});

        const upgradePromise = (async () => {
          await saveInitialPromise;
          let fullDataUrl = '';
          let fullW = preview.width;
          let fullH = preview.height;

          if (capturedBitmap) {
            try {
              const processed = await processCaptureOffThread({
                bitmap: capturedBitmap,
                digitalScale,
                rotationDeg,
                maxDim: 2048,
                quality: 0.88,
                blurThreshold: 0,
                fallbackCanvas: drawFullResVideoCanvas,
              });
              fullDataUrl = processed.dataUrl;
              fullW = processed.width;
              fullH = processed.height;
            } catch {
              const fallbackC = drawFullResVideoCanvas();
              if (fallbackC) {
                const compressed = compressCanvasToJpeg(fallbackC, 2048, 0.88);
                fullDataUrl = compressed.dataUrl;
                fullW = compressed.width;
                fullH = compressed.height;
              }
            }
          } else if (fallbackCanvasData) {
            await new Promise<void>((r) => setTimeout(r, 0));
            const compressed = compressCanvasToJpeg(fallbackCanvasData, 2048, 0.88);
            fullDataUrl = compressed.dataUrl;
            fullW = compressed.width;
            fullH = compressed.height;
          }

          if (!fullDataUrl) return;
          const existing = await getPhotoById(photoId);
          if (!existing) return; // Respect immediate deletion by user
          await savePhoto({
            ...existing,
            dataUrl: fullDataUrl,
            width: fullW,
            height: fullH,
          });
          analysisQueue.notify();
        })();

        analysisQueue.registerPendingUpgrade(photoId, upgradePromise);
        return;
      }
    }

    // Offload resize/compression to Web Worker asynchronously for preview mode
    if (capturedBitmap) {
      processCaptureOffThread({
        bitmap: capturedBitmap,
        digitalScale,
        rotationDeg,
        maxDim: 2048,
        quality: 0.88,
        blurThreshold,
        fallbackCanvas: drawFullResVideoCanvas,
        fallbackBlurCheck:
          blurThreshold > 0
            ? (c) => checkImageBlurFromCanvas(c, blurThreshold)
            : undefined,
      })
        .then((processed) => {
          if (skipBlurReview) {
            return persistCapturedShotToLog({
              shot: {
                dataUrl: processed.dataUrl,
                width: processed.width,
                height: processed.height,
              },
              sessionId: capturedSessionId,
              aiEnabled: settings.aiAnalysisEnabled,
              onSaved: (record) => {
                if (isMountedRef.current) {
                  setSessionPhotos((prev) =>
                    prev.some((p) => p.id === record.id) ? prev : [record, ...prev]
                  );
                  onPhotoQueued();
                }
              },
            });
          }
          return finalizeProcessedShot(processed);
        })
        .catch(async () => {
          const fallbackC = drawFullResVideoCanvas();
          if (!fallbackC) return;
          const compressed = compressCanvasToJpeg(fallbackC, 2048, 0.88);
          const blur =
            blurThreshold > 0
              ? checkImageBlurFromCanvas(fallbackC, blurThreshold)
              : { variance: 100, isBlurry: false };
          await finalizeProcessedShot({
            ...compressed,
            isBlurry: blur.isBlurry,
            variance: blur.variance,
          });
        });
    } else if (fallbackCanvasData) {
      const compressed = compressCanvasToJpeg(fallbackCanvasData, 2048, 0.88);
      const blur =
        blurThreshold > 0
          ? checkImageBlurFromCanvas(fallbackCanvasData, blurThreshold)
          : { variance: 100, isBlurry: false };
      finalizeProcessedShot({
        ...compressed,
        isBlurry: blur.isBlurry,
        variance: blur.variance,
      }).catch(() => {});
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    const skipBlurReview = Boolean(settings.continuousMode);
    const blurThreshold = skipBlurReview ? 0 : DEFAULT_BLUR_THRESHOLD;

    if (files.length === 1) {
      try {
        const processed = await processCaptureOffThread({
          blob: files[0],
          maxDim: 2048,
          quality: 0.9,
          blurThreshold,
          fallbackBlurCheck:
            blurThreshold > 0
              ? (c) => checkImageBlurFromCanvas(c, blurThreshold)
              : undefined,
        });
        await finalizeProcessedShot(processed);
      } catch {
        const canvas = await fileOrDataUrlToCanvas(files[0], 2048);
        const compressed = compressCanvasToJpeg(canvas, 2048, 0.9);
        const blur =
          blurThreshold > 0
            ? checkImageBlurFromCanvas(canvas, blurThreshold)
            : { variance: 100, isBlurry: false };
        await finalizeProcessedShot({
          ...compressed,
          isBlurry: blur.isBlurry,
          variance: blur.variance,
        });
      }
    } else {
      for (const file of files) {
        try {
          const processed = await processCaptureOffThread({
            blob: file,
            maxDim: 2048,
            quality: 0.9,
            blurThreshold: 0,
          });
          await commitPhotoToDB({
            dataUrl: processed.dataUrl,
            width: processed.width,
            height: processed.height,
          });
        } catch {
          const canvas = await fileOrDataUrlToCanvas(file, 2048);
          const compressed = compressCanvasToJpeg(canvas, 2048, 0.9);
          await commitPhotoToDB({
            dataUrl: compressed.dataUrl,
            width: compressed.width,
            height: compressed.height,
          });
        }
      }
    }
  };

  const handleConfirmReviewShot = async () => {
    if (!reviewShot) return;
    const shot = reviewShot;
    setReviewShot(null);
    await commitPhotoToDB({
      dataUrl: shot.dataUrl,
      width: shot.width,
      height: shot.height,
    });
  };

  const handleDeleteSessionPhoto = async (photoId: string) => {
    await deletePhotoAndShortages(photoId);
    setSessionPhotos((prev) => prev.filter((p) => p.id !== photoId));
    setSessionShortages((prev) => prev.filter((s) => s.photoId !== photoId));
    analysisQueue.notify();
    onPhotoQueued();
  };

  const handleRetrySessionPhoto = async (photoId: string) => {
    await analysisQueue.retryPhoto(photoId);
    await loadSessionPhotos();
  };

  const cycleFlashMode = () => {
    userToggledFlashRef.current = true;
    const idx = FLASH_CYCLE.indexOf(flashMode);
    let next = FLASH_CYCLE[(idx + 1) % FLASH_CYCLE.length];
    if (next === 'auto' && !settings.autoFlash) {
      next = 'on';
    }
    setFlashMode(next);
  };

  // Pinch-to-zoom touch handlers updating DOM directly without re-rendering during motion
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!settings.zoomControls || e.touches.length !== 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchStartDistRef.current = Math.hypot(dx, dy);
    pinchStartZoomRef.current = zoomValueRef.current;
    triggerZoomOverlay();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (
      !settings.zoomControls ||
      e.touches.length !== 2 ||
      pinchStartDistRef.current === null
    ) {
      return;
    }
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    if (pinchStartDistRef.current > 10) {
      const ratio = dist / pinchStartDistRef.current;
      applyZoom(pinchStartZoomRef.current * ratio, true, false);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2 && pinchStartDistRef.current !== null) {
      pinchStartDistRef.current = null;
      syncZoomToDom(zoomValueRef.current, true);
    }
  };

  const lastPhoto = sessionPhotos[0] || null;
  const pendingCount = sessionPhotos.filter(
    (p) => p.status === 'pending' || p.status === 'analyzing'
  ).length;

  return (
    <div
      className="relative w-full h-[calc(100dvh-68px-env(safe-area-inset-bottom,0px))] bg-slate-950 overflow-hidden select-none touch-pan-y"
      dir="rtl"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Hidden gallery input (no capture attribute -> opens Photo Gallery) */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilePicked}
        className="hidden"
      />

      {/* Hidden camera fallback input */}
      <input
        ref={cameraFallbackInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFilePicked}
        className="hidden"
      />

      {/* Live Video Stream (no CSS transitions or shadows over video) */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`w-full h-full object-cover ${
          cameraState === 'active' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* 120ms White Shutter Feedback Overlay (controlled directly via ref) */}
      <div
        ref={flashOverlayRef}
        style={{ opacity: 0 }}
        className="pointer-events-none absolute inset-0 bg-white/45 z-30"
      />

      {/* Fallback when camera denied or unsupported */}
      {(cameraState === 'denied' || cameraState === 'unsupported') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center bg-slate-900">
          <div className="w-20 h-20 rounded-[24px] bg-slate-800 flex items-center justify-center mb-5 text-emerald-400">
            <Camera className="w-10 h-10" />
          </div>
          <h1 className="text-xl font-extrabold text-white mb-2">
            نقص الرفوف
          </h1>
          <p className="text-sm text-slate-300 max-w-sm leading-relaxed mb-6">
            {cameraError}
          </p>
          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              type="button"
              onClick={() => cameraFallbackInputRef.current?.click()}
              className="min-h-[56px] w-full px-5 rounded-2xl bg-emerald-500 text-white font-bold text-base flex items-center justify-center gap-2"
            >
              <Camera className="w-5 h-5" />
              التقاط صورة بالكاميرا
            </button>
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              className="min-h-[54px] w-full px-5 rounded-2xl bg-slate-800 text-white font-bold text-base flex items-center justify-center gap-2"
            >
              <ImagePlus className="w-5 h-5" />
              اختيار من المعرض
            </button>
            {cameraState === 'denied' && (
              <button
                type="button"
                onClick={startCamera}
                className="min-h-[52px] px-4 rounded-2xl bg-slate-800 text-slate-200 font-semibold text-sm flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                إعادة المحاولة
              </button>
            )}
          </div>
        </div>
      )}

      {/* Starting status indicator (only while stream initializes) */}
      {cameraState === 'starting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-white gap-3">
          <Camera className="w-8 h-8 text-emerald-400" />
          <span className="text-sm text-slate-300">جاري تشغيل الكاميرا...</span>
        </div>
      )}

      {/* Top Overlay Bar (plain semi-transparent solid backgrounds, no blur/shadow) */}
      <div className="absolute top-0 inset-x-0 z-20 px-4 pb-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="px-3.5 py-2.5 rounded-2xl bg-black/55 text-white text-sm font-bold flex items-center gap-2">
            <span>التصوير</span>
            <span className="text-slate-300">·</span>
            <span className="text-emerald-400">
              {settings.continuousMode ? 'مستمر' : 'معاينة'}
            </span>
          </div>

          {/* Torch / Flash 3-state button (hidden if unsupported) */}
          {torchSupported && cameraState === 'active' && (
            <button
              type="button"
              onClick={cycleFlashMode}
              className={`min-h-[52px] px-3.5 rounded-2xl text-xs font-bold flex items-center gap-1.5 ${
                torchOn || flashMode === 'on'
                  ? 'bg-amber-400 text-slate-950'
                  : 'bg-black/55 text-white'
              }`}
              aria-label="وضع الفلاش"
            >
              {flashMode === 'off' ? (
                <ZapOff className="w-4 h-4" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              <span>{FLASH_LABELS[flashMode]}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isOnline && settings.aiAnalysisEnabled && (
            <div className="px-3 py-2 rounded-2xl bg-amber-500 text-slate-950 text-xs font-extrabold flex items-center gap-1.5">
              <WifiOff className="w-4 h-4" />
              <span>طابور</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowSessionGrid(true)}
            className="min-h-[52px] px-4 rounded-2xl bg-black/55 text-white flex items-center gap-2 font-bold text-sm"
            aria-label="عدد صور الجلسة"
          >
            <Images className="w-4 h-4 text-emerald-400" />
            <span className="tabular-nums">{sessionPhotos.length}</span>
            {settings.aiAnalysisEnabled && pendingCount > 0 && (
              <span className="text-[11px] text-amber-300 tabular-nums">
                ({pendingCount})
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Thin Vertical Zoom Slider on Right Edge (visible 2s on pinch/chip tap, no blur/shadow) */}
      {settings.zoomControls && cameraState === 'active' && (
        <div
          className={`absolute right-2 top-1/2 -translate-y-1/2 z-20 transition-opacity duration-300 ${
            showZoomOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <div className="w-8 h-44 flex items-center justify-center rounded-full bg-black/55 py-2">
            <input
              ref={verticalSliderRef}
              type="range"
              min={zoomMin}
              max={zoomMax}
              step={zoomStep}
              defaultValue={1}
              onChange={(e) =>
                applyZoom(parseFloat(e.target.value), true, true)
              }
              aria-label="شريط التقريب العمودي"
              className="w-36 h-1.5 -rotate-90 accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>
      )}

      {/* Bottom One-Handed Controls + Compact 1x 2x 3x Pill (no blur/heavy shadows) */}
      <div className="absolute bottom-0 inset-x-0 z-20 pb-5 pt-6 px-5 space-y-3">
        {settings.zoomControls && cameraState === 'active' && (
          <div className="flex flex-col items-center gap-1.5" dir="ltr">
            <div
              ref={zoomLabelRef}
              className={`px-2.5 py-0.5 rounded-full bg-black/65 text-emerald-400 text-[11px] font-extrabold tabular-nums transition-opacity duration-300 ${
                showZoomOverlay ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
            >
              1.0x
            </div>
            <div className="h-[36px] px-1 rounded-full bg-black/60 flex items-center gap-1">
              {ZOOM_PRESETS.map((preset) => {
                const isActive = activePresetZoom === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyZoom(preset, true, true)}
                    className={`h-[28px] min-w-[38px] px-2.5 rounded-full text-xs font-extrabold tabular-nums ${
                      isActive ? 'bg-emerald-500 text-white' : 'text-white/85'
                    }`}
                  >
                    {preset}x
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="max-w-md mx-auto flex items-center justify-between">
          {/* Last Photo Thumbnail */}
          <button
            type="button"
            onClick={() => setShowSessionGrid(true)}
            className="w-[56px] h-[56px] rounded-2xl overflow-hidden bg-black/55 border-2 border-white/40 flex items-center justify-center shrink-0"
            aria-label="عرض صور الجلسة"
          >
            {lastPhoto && lastPhoto.dataUrl ? (
              <img
                src={lastPhoto.dataUrl}
                alt="آخر صورة"
                className="w-full h-full object-cover"
              />
            ) : (
              <Images className="w-6 h-6 text-white/70" />
            )}
          </button>

          {/* Big Round Shutter Button */}
          <button
            type="button"
            onClick={handleCapture}
            aria-label="التقاط صورة للرف"
            className="w-[78px] h-[78px] rounded-full bg-white p-1.5 flex items-center justify-center active:scale-95"
          >
            <span className="w-full h-full rounded-full bg-emerald-500 border-4 border-white flex items-center justify-center">
              <Camera className="w-7 h-7 text-white" />
            </span>
          </button>

          {/* Gallery shortcut (no capture attribute) */}
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="w-[56px] h-[56px] rounded-2xl bg-black/55 border border-white/25 text-white flex items-center justify-center shrink-0"
            aria-label="اختيار صور من المعرض"
          >
            <ImagePlus className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Preview / Blurry Rejection Modal */}
      {reviewShot && (
        <div
          className="fixed inset-0 z-50 bg-slate-950 flex flex-col justify-between px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
          dir="rtl"
          role="dialog"
          aria-modal="true"
        >
          <div className="pt-2">
            {reviewShot.isBlurry ? (
              <div className="bg-amber-500/15 border border-amber-400/50 rounded-[20px] p-4 flex items-start gap-3 text-amber-100">
                <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-base">
                    الصورة غير واضحة أو مهزوزة
                  </div>
                  <div className="text-xs text-amber-200/90 mt-1">
                    يُفضل إعادة التصوير لتحديد أماكن النقص بدقة.
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-white font-bold text-base py-2">
                معاينة الصورة قبل الحفظ
              </div>
            )}
          </div>

          <div className="flex-1 my-4 rounded-[20px] overflow-hidden bg-black flex items-center justify-center">
            <img
              src={reviewShot.dataUrl}
              alt="معاينة اللقطة"
              className="max-w-full max-h-full object-contain"
            />
          </div>

          <div className="flex items-center gap-3 max-w-md w-full mx-auto">
            <button
              type="button"
              onClick={() => setReviewShot(null)}
              className="min-h-[56px] flex-1 rounded-2xl bg-slate-800 text-white font-bold text-base flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-5 h-5" />
              إعادة
            </button>
            <button
              type="button"
              onClick={handleConfirmReviewShot}
              className="min-h-[56px] flex-1 rounded-2xl bg-emerald-500 text-white font-bold text-base flex items-center justify-center gap-2"
            >
              <Check className="w-5 h-5" />
              {reviewShot.isBlurry ? 'استخدمها رغم ذلك' : 'حفظ'}
            </button>
          </div>
        </div>
      )}

      {/* Session Photos Grid Modal */}
      {showSessionGrid && (
        <SessionPhotosModal
          photos={sessionPhotos}
          shelves={sessionShelves}
          shortages={sessionShortages}
          aiEnabled={settings.aiAnalysisEnabled}
          onDeletePhoto={handleDeleteSessionPhoto}
          onRetryPhoto={handleRetrySessionPhoto}
          onOpenInLog={(photoId) => {
            setShowSessionGrid(false);
            onOpenPhotoInLog?.(photoId);
          }}
          onClose={() => setShowSessionGrid(false)}
        />
      )}
    </div>
  );
};
