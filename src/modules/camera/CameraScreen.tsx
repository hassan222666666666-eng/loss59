import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  ImagePlus,
  Check,
  RotateCcw,
  AlertTriangle,
  Zap,
  ZapOff,
  MoreHorizontal,
  ZoomIn,
} from 'lucide-react';
import {
  AppSettings,
  FlashMode,
  ShelfPhoto,
} from '../../types';
import { savePhoto } from '../db';
import {
  checkImageBlurFromCanvas,
  DEFAULT_BLUR_THRESHOLD,
} from './blurDetection';
import {
  compressCanvasToJpeg,
  drawCroppedRotatedToCanvas,
  fileOrDataUrlToCanvas,
  getVideoCaptureRotationDeg,
  processCaptureOffThread,
} from './imageCompression';
import {
  CAMERA_BACKGROUND_RETRY_MS,
  CAMERA_POST_PLAY_APPLY_DELAY_MS,
  CAMERA_TAKE_PHOTO_TIMEOUT_MS,
  PhotoCapabilitiesLike,
  acquireStreamWithTimeout,
  buildTakePhotoSettings,
  computeFocusSettleWaitMs,
  extractMaxPhotoDimensions,
  isCameraPermissionDeniedError,
  startCameraWithRetryLadder,
} from './cameraStartup';
import {
  CameraTrackCapabilitiesLike,
  UnifiedCameraConstraintState,
  applyUnifiedTrackConstraints,
  buildUnifiedAdvancedConstraints,
  createDefaultCameraConstraintState,
  formatConstraintsError,
  readTrackSettingsSnapshot,
} from './cameraConstraints';
import {
  readCameraDiagnostics,
  saveCameraDiagnostics,
} from './cameraDiagnostics';
import {
  CameraCandidateRecord,
  MAX_BACK_CAMERA_CANDIDATES,
  areVideoDeviceLabelsEmpty,
  computeDevicesSignature,
  extractZoomRangeFromCapabilities,
  pickBestTorchCandidate,
  selectBackCameraCandidates,
} from './cameraSelection';
import { getLocalDateKey } from '../../utils/arabicText';
import { playShutterSound, warmAudioContext } from '../../utils/sound';
import {
  AUTO_FLASH_DEFAULTS,
  AutoFlashState,
  computeBrightnessMetricsFromRgba,
  createInitialAutoFlashState,
  isSceneDimForTorch,
  stepAutoFlashState,
} from './autoFlashDecision';

async function persistCapturedShotToLog(params: {
  shot: { dataUrl: string; width: number; height: number };
  sessionId: string;
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
  };
  await savePhoto(record);
  params.onSaved?.(record);
}

interface PendingReviewShot {
  dataUrl: string;
  width: number;
  height: number;
  isBlurry: boolean;
  variance: number;
}

interface CameraScreenProps {
  sessionId: string;
  settings: AppSettings;
  isOnline: boolean;
  onPhotoQueued: () => void;
  onOpenPhotoInLog?: (photoId: string) => void;
  onUpdateSettings?: (partial: Partial<AppSettings>) => Promise<void>;
}

const FLASH_CYCLE: FlashMode[] = ['auto', 'on', 'off'];
const ZOOM_PRESETS = [1, 2, 3] as const;

// Preserves the user's selected flash mode across internal app tab switches
let rememberedFlashMode: FlashMode | null = null;
let rememberedUserToggledFlash = false;
let noTorchNoticeShownOnce = false;

export const CameraScreen: React.FC<CameraScreenProps> = ({
  sessionId,
  settings,
  onPhotoQueued,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Direct DOM refs to avoid React re-renders during streaming, shutter flash, and pinch zoom
  const flashOverlayRef = useRef<HTMLDivElement | null>(null);
  const zoomLabelRef = useRef<HTMLDivElement | null>(null);
  const isCapturingRef = useRef(false);
  const isMountedRef = useRef(true);
  const startRunIdRef = useRef(0);
  const captureUnlockTimerRef = useRef<number | null>(null);

  const [cameraState, setCameraState] = useState<
    'starting' | 'active' | 'denied' | 'unavailable'
  >('starting');
  const [reviewShot, setReviewShot] = useState<PendingReviewShot | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const maxPhotoDimsRef = useRef<{ imageWidth?: number; imageHeight?: number }>(
    {}
  );
  const takePhotoSupportedRef = useRef<boolean>(false);
  const lastZoomChangedAtRef = useRef<number>(0);

  // Flash & torch capabilities + Single source of truth for track constraints
  const [torchSupported, setTorchSupported] = useState(false);
  const [noTorchAvailable, setNoTorchAvailable] = useState(false);
  const [noTorchNoticeVisible, setNoTorchNoticeVisible] = useState(false);
  const [photoFlashSupported, setPhotoFlashSupported] = useState(false);
  const initialFlashMode: FlashMode =
    rememberedFlashMode ?? (settings.autoFlash ? 'auto' : 'off');
  const [flashMode, setFlashMode] = useState<FlashMode>(initialFlashMode);
  const flashModeRef = useRef<FlashMode>(initialFlashMode);
  const [torchOn, setTorchOn] = useState(false);
  const [flashUnavailableNotice, setFlashUnavailableNotice] = useState(false);
  const torchOnRef = useRef(false);
  const noTorchAvailableRef = useRef(false);
  const torchMismatchNoticeShownRef = useRef(false);
  const activeDeviceIdRef = useRef<string | null>(null);
  const constraintStateRef = useRef<UnifiedCameraConstraintState>(
    createDefaultCameraConstraintState()
  );
  const trackCapabilitiesRef = useRef<CameraTrackCapabilitiesLike | null>(null);
  const constraintsChainRef = useRef<Promise<boolean>>(Promise.resolve(false));
  const postPlayTimerRef = useRef<number | null>(null);
  const postPlayReadyRef = useRef(false);
  const autoFlashStateRef = useRef<AutoFlashState>(
    createInitialAutoFlashState(false)
  );
  const userToggledFlashRef = useRef(rememberedUserToggledFlash);
  const flashNoticeTimerRef = useRef<number | null>(null);
  const noTorchTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const updateFlashModeState = useCallback((nextMode: FlashMode) => {
    flashModeRef.current = nextMode;
    rememberedFlashMode = nextMode;
    setFlashMode(nextMode);
  }, []);

  useEffect(() => {
    if (!settings.autoFlash && flashMode === 'auto') {
      updateFlashModeState('off');
      constraintStateRef.current = { ...constraintStateRef.current, torch: false };
      autoFlashStateRef.current = createInitialAutoFlashState(false);
    } else if (
      settings.autoFlash &&
      flashMode === 'off' &&
      !userToggledFlashRef.current
    ) {
      updateFlashModeState('auto');
    }
  }, [settings.autoFlash, flashMode, updateFlashModeState]);

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
      if (flashNoticeTimerRef.current !== null) {
        window.clearTimeout(flashNoticeTimerRef.current);
      }
      if (postPlayTimerRef.current !== null) {
        window.clearTimeout(postPlayTimerRef.current);
      }
      if (noTorchTimerRef.current !== null) {
        window.clearTimeout(noTorchTimerRef.current);
      }
    };
  }, []);

  const showNoTorchNoticeOnce = useCallback(() => {
    if (noTorchNoticeShownOnce) return;
    noTorchNoticeShownOnce = true;
    setNoTorchNoticeVisible(true);
    if (noTorchTimerRef.current !== null) {
      window.clearTimeout(noTorchTimerRef.current);
    }
    noTorchTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setNoTorchNoticeVisible(false);
      }
      noTorchTimerRef.current = null;
    }, 6000);
  }, []);

  const showTorchMismatchNoticeOnce = useCallback(() => {
    if (torchMismatchNoticeShownRef.current) return;
    torchMismatchNoticeShownRef.current = true;
    setFlashUnavailableNotice(true);
    if (flashNoticeTimerRef.current !== null) {
      window.clearTimeout(flashNoticeTimerRef.current);
    }
    flashNoticeTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setFlashUnavailableNotice(false);
      }
      flashNoticeTimerRef.current = null;
    }, 5000);
  }, []);

  /**
   * Single-call unified constraint applier:
   * Always reads the single source of truth `constraintStateRef.current` and
   * sends ONE `applyConstraints({ advanced: [ { ...all supported fields } ] })`.
   */
  const syncUnifiedTrackConstraints = useCallback(
    (options?: { showMismatchOnce?: boolean }): Promise<boolean> => {
      const showMismatchOnce = Boolean(options?.showMismatchOnce);

      const run = async (): Promise<boolean> => {
        const track = videoTrackRef.current;
        if (!track || track.readyState !== 'live') return false;

        const stateSnapshot: UnifiedCameraConstraintState = {
          ...constraintStateRef.current,
        };
        const caps =
          trackCapabilitiesRef.current ??
          (typeof track.getCapabilities === 'function'
            ? (track.getCapabilities() as CameraTrackCapabilitiesLike)
            : null);
        if (caps) {
          trackCapabilitiesRef.current = caps;
        }

        const result = await applyUnifiedTrackConstraints(
          track,
          stateSnapshot,
          caps
        );

        const realTorchOn = result.actualTorch === true;
        torchOnRef.current = realTorchOn;
        autoFlashStateRef.current.torchOn = realTorchOn;
        if (realTorchOn) {
          autoFlashStateRef.current.lastTurnedOnAt = Date.now();
        } else if (stateSnapshot.torch === false) {
          autoFlashStateRef.current.lastTurnedOffAt = Date.now();
        }

        if (isMountedRef.current) {
          setTorchSupported(result.torchSupported);
          setTorchOn(realTorchOn);
        }

        const vidW =
          videoRef.current?.videoWidth || result.trackSettings?.width;
        const vidH =
          videoRef.current?.videoHeight || result.trackSettings?.height;
        saveCameraDiagnostics({
          ...(vidW ? { previewWidth: vidW } : {}),
          ...(vidH ? { previewHeight: vidH } : {}),
          ...(typeof result.trackSettings?.frameRate === 'number'
            ? { frameRate: result.trackSettings.frameRate }
            : {}),
          focusMode: result.trackSettings?.focusMode,
          exposureMode: result.trackSettings?.exposureMode,
          whiteBalanceMode: result.trackSettings?.whiteBalanceMode,
          torchSupported: result.torchSupported,
          requestedTorch: result.requestedTorch,
          actualTorch:
            result.actualTorch === undefined ? null : result.actualTorch,
          lastApplyConstraintsError:
            result.errorMessage ??
            (result.requestedTorch && !result.torchSupported
              ? 'NotSupportedError: torch capability is not supported on active camera'
              : null),
          ...(result.constraintsSent
            ? {
                lastAppliedConstraints:
                  result.constraintsSent as unknown as Record<string, unknown>,
              }
            : {}),
        });

        const differsFromRequested = result.requestedTorch
          ? result.actualTorch !== true
          : result.torchSupported && result.actualTorch === true;

        if (differsFromRequested && showMismatchOnce && isMountedRef.current) {
          showTorchMismatchNoticeOnce();
        } else if (result.requestedTorch && result.actualTorch === true) {
          torchMismatchNoticeShownRef.current = false;
          if (isMountedRef.current) {
            setFlashUnavailableNotice(false);
          }
        }

        return result.applied && !differsFromRequested;
      };

      const next = constraintsChainRef.current.then(run, run);
      constraintsChainRef.current = next;
      return next;
    },
    [showTorchMismatchNoticeOnce]
  );

  const syncZoomToDom = useCallback(
    (rounded: number, commitPresetState: boolean) => {
      const hw = hardwareZoomRangeRef.current;
      const hwApplied = hw ? Math.max(hw.min, Math.min(hw.max, rounded)) : 1;
      const digitalScale = hw
        ? Math.max(1, rounded / Math.max(1, hwApplied))
        : rounded;

      if (videoRef.current) {
        videoRef.current.style.transform =
          digitalScale > 1.01 ? `scale(${digitalScale})` : '';
      }
      if (zoomLabelRef.current) {
        zoomLabelRef.current.textContent = `${rounded.toFixed(1)}x`;
      }
      if (commitPresetState) {
        const matched = ZOOM_PRESETS.find((p) => Math.abs(rounded - p) < 0.15);
        setActivePresetZoom(matched ?? -1);
      }
    },
    []
  );

  const applyZoom = useCallback(
    (next: number, showOverlay: boolean = true, syncPreset: boolean = true) => {
      const { min, max } = zoomBoundsRef.current;
      const clamped = Math.max(min, Math.min(max, next));
      const rounded = Math.round(clamped * 10) / 10;
      if (Math.abs(rounded - zoomValueRef.current) >= 0.05) {
        lastZoomChangedAtRef.current = Date.now();
      }
      zoomValueRef.current = rounded;
      syncZoomToDom(rounded, syncPreset);
      if (showOverlay) {
        triggerZoomOverlay();
      }

      const track = videoTrackRef.current;
      const hw = hardwareZoomRangeRef.current;
      if (hw) {
        const hwTarget = Math.max(hw.min, Math.min(hw.max, rounded));
        constraintStateRef.current = {
          ...constraintStateRef.current,
          zoom: hwTarget,
        };
        pendingHwZoomRef.current = hwTarget;
        if (track && zoomRafRef.current === null) {
          zoomRafRef.current = requestAnimationFrame(() => {
            zoomRafRef.current = null;
            if (pendingHwZoomRef.current !== null && videoTrackRef.current) {
              void syncUnifiedTrackConstraints({ showMismatchOnce: false });
            }
          });
        }
      }
    },
    [syncZoomToDom, triggerZoomOverlay, syncUnifiedTrackConstraints]
  );

  useEffect(() => {
    if (!settings.zoomControls) {
      applyZoom(1, false, true);
      setShowZoomOverlay(false);
    }
  }, [settings.zoomControls, applyZoom]);

  const stopCamera = useCallback(() => {
    if (postPlayTimerRef.current !== null) {
      window.clearTimeout(postPlayTimerRef.current);
      postPlayTimerRef.current = null;
    }
    postPlayReadyRef.current = false;

    if (torchOnRef.current && videoTrackRef.current) {
      const offConstraints = buildUnifiedAdvancedConstraints(
        { ...constraintStateRef.current, torch: false },
        trackCapabilitiesRef.current
      );
      if (offConstraints) {
        videoTrackRef.current.applyConstraints(offConstraints).catch(() => {});
      }
    }
    torchOnRef.current = false;
    setTorchOn(false);
    videoTrackRef.current = null;
    trackCapabilitiesRef.current = null;
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore stop errors
        }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /**
   * Reads capabilities ONLY without sending any separate applyConstraints call.
   */
  const inspectTrackCapabilities = useCallback(
    async (t: MediaStreamTrack | null): Promise<boolean> => {
      if (!t || typeof t.getCapabilities !== 'function') {
        trackCapabilitiesRef.current = null;
        setTorchSupported(false);
        setPhotoFlashSupported(false);
        hardwareZoomRangeRef.current = null;
        setHardwareZoomRange(null);
        maxPhotoDimsRef.current = {};
        takePhotoSupportedRef.current = false;
        saveCameraDiagnostics({
          torchSupported: false,
        });
        return false;
      }

      const caps = t.getCapabilities() as CameraTrackCapabilitiesLike;
      trackCapabilitiesRef.current = caps;

      const hasTrackTorch = caps.torch === true;
      let hasPhotoFlash = false;
      let maxPhotoDims: { imageWidth?: number; imageHeight?: number } = {};

      const WinImageCapture = (
        window as unknown as {
          ImageCapture?: new (track: MediaStreamTrack) => {
            takePhoto?: (settings?: Record<string, unknown>) => Promise<Blob>;
            getPhotoCapabilities?: () => Promise<PhotoCapabilitiesLike>;
          };
        }
      ).ImageCapture;

      let takePhotoSupported = false;
      if (typeof WinImageCapture === 'function') {
        try {
          const ic = new WinImageCapture(t);
          takePhotoSupported = typeof ic.takePhoto === 'function';
          if (typeof ic.getPhotoCapabilities === 'function') {
            const photoCaps = await Promise.race([
              ic.getPhotoCapabilities(),
              new Promise<null>((resolve) =>
                window.setTimeout(() => resolve(null), 350)
              ),
            ]);
            if (photoCaps) {
              maxPhotoDims = extractMaxPhotoDimensions(photoCaps);
              if (
                Array.isArray(photoCaps.fillLightMode) &&
                (photoCaps.fillLightMode.includes('flash') ||
                  photoCaps.fillLightMode.includes('auto'))
              ) {
                hasPhotoFlash = true;
              }
            }
          }
        } catch {
          // ignore
        }
      }

      maxPhotoDimsRef.current = maxPhotoDims;
      takePhotoSupportedRef.current = takePhotoSupported;
      setTorchSupported(hasTrackTorch);
      setPhotoFlashSupported(hasPhotoFlash);

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
        const targetZ = Math.max(
          caps.zoom.min,
          Math.min(caps.zoom.max, zoomValueRef.current || 1)
        );
        zoomValueRef.current = targetZ;
        constraintStateRef.current = {
          ...constraintStateRef.current,
          zoom: targetZ,
        };
        syncZoomToDom(targetZ, true);
      } else {
        hardwareZoomRangeRef.current = null;
        setHardwareZoomRange(null);
      }

      const trackSettings = readTrackSettingsSnapshot(t);
      const vidW = videoRef.current?.videoWidth || trackSettings?.width;
      const vidH = videoRef.current?.videoHeight || trackSettings?.height;
      saveCameraDiagnostics({
        ...(vidW ? { previewWidth: vidW } : {}),
        ...(vidH ? { previewHeight: vidH } : {}),
        ...(typeof trackSettings?.frameRate === 'number'
          ? { frameRate: trackSettings.frameRate }
          : {}),
        takePhotoSupported,
        maxPhotoWidth: maxPhotoDims.imageWidth,
        maxPhotoHeight: maxPhotoDims.imageHeight,
        focusMode: trackSettings?.focusMode,
        exposureMode: trackSettings?.exposureMode,
        whiteBalanceMode: trackSettings?.whiteBalanceMode,
        torchSupported: hasTrackTorch,
        actualTorch:
          typeof trackSettings?.torch === 'boolean' ? trackSettings.torch : null,
      });

      return hasTrackTorch;
    },
    [syncZoomToDom]
  );

  const waitForVideoPlaying = useCallback(
    async (video: HTMLVideoElement | null, runId: number): Promise<void> => {
      if (
        !video ||
        !isMountedRef.current ||
        startRunIdRef.current !== runId
      ) {
        return;
      }
      if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        !video.paused
      ) {
        return;
      }
      await new Promise<void>((resolve) => {
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener('playing', onReady);
          video.removeEventListener('loadeddata', onReady);
          window.clearTimeout(timer);
          resolve();
        };
        const onReady = () => {
          if (
            !isMountedRef.current ||
            startRunIdRef.current !== runId ||
            video.videoWidth > 0
          ) {
            done();
          }
        };
        const timer = window.setTimeout(done, 1800);
        video.addEventListener('playing', onReady);
        video.addEventListener('loadeddata', onReady);
      });
    },
    []
  );

  const sampleVideoBrightnessMetrics = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    if (!meterCanvasRef.current) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      meterCanvasRef.current = c;
    }
    const ctx = meterCanvasRef.current.getContext('2d', {
      willReadFrequently: true,
    });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 16, 16);
    const pixels = ctx.getImageData(0, 0, 16, 16).data;
    return computeBrightnessMetricsFromRgba(pixels);
  }, []);

  /**
   * Re-applies full constraint state in ONE call ~300ms after video is playing:
   * - manual ON stays ON
   * - manual OFF stays OFF
   * - auto mode recomputes from live video brightness
   */
  const schedulePostPlayConstraintRestore = useCallback(
    (track: MediaStreamTrack, runId: number) => {
      if (postPlayTimerRef.current !== null) {
        window.clearTimeout(postPlayTimerRef.current);
      }
      postPlayReadyRef.current = false;

      postPlayTimerRef.current = window.setTimeout(async () => {
        postPlayTimerRef.current = null;
        if (
          !isMountedRef.current ||
          startRunIdRef.current !== runId ||
          videoTrackRef.current !== track ||
          track.readyState !== 'live'
        ) {
          return;
        }

        await inspectTrackCapabilities(track);
        if (
          !isMountedRef.current ||
          startRunIdRef.current !== runId ||
          videoTrackRef.current !== track ||
          track.readyState !== 'live'
        ) {
          return;
        }

        const mode = flashModeRef.current;
        let nextTorch = false;
        if (noTorchAvailableRef.current) {
          nextTorch = false;
          autoFlashStateRef.current = createInitialAutoFlashState(false);
        } else if (mode === 'on') {
          nextTorch = true;
          autoFlashStateRef.current = createInitialAutoFlashState(true);
        } else if (mode === 'off') {
          nextTorch = false;
          autoFlashStateRef.current = createInitialAutoFlashState(false);
        } else {
          // Auto mode recomputes from current brightness after playback stabilizes
          const metrics = sampleVideoBrightnessMetrics();
          const shouldTurnOn = metrics ? isSceneDimForTorch(metrics) : false;
          nextTorch = shouldTurnOn;
          autoFlashStateRef.current = createInitialAutoFlashState(shouldTurnOn);
        }

        constraintStateRef.current = {
          ...constraintStateRef.current,
          torch: nextTorch,
        };
        postPlayReadyRef.current = true;
        await syncUnifiedTrackConstraints({
          showMismatchOnce: mode === 'on' && !noTorchAvailableRef.current,
        });
      }, CAMERA_POST_PLAY_APPLY_DELAY_MS);
    },
    [
      inspectTrackCapabilities,
      sampleVideoBrightnessMetrics,
      syncUnifiedTrackConstraints,
    ]
  );

  const stopStreamTracks = useCallback((s: MediaStream | null) => {
    if (!s) return;
    for (const tr of s.getTracks()) {
      try {
        tr.stop();
      } catch {
        // Ignore
      }
    }
  }, []);

  const startCamera = useCallback(
    async (options?: { silentBackground?: boolean }) => {
      const silent = Boolean(options?.silentBackground);
      const runId = ++startRunIdRef.current;
      const isStale = () =>
        !isMountedRef.current || startRunIdRef.current !== runId;

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setCameraState('unavailable');
        return;
      }

      if (!silent) {
        setCameraState('starting');
      }
      torchMismatchNoticeShownRef.current = false;
      setFlashUnavailableNotice(false);
      stopCamera();

      const diagBefore = readCameraDiagnostics();
      const manualDeviceId =
        settings.selectedCameraDeviceId?.trim() ||
        diagBefore.selectedCameraDeviceId?.trim() ||
        null;
      const rememberedTorchId =
        diagBefore.rememberedTorchDeviceId?.trim() || null;
      const lockedInitialDeviceId = manualDeviceId || rememberedTorchId || null;

      try {
        let stream: MediaStream;
        try {
          stream = await startCameraWithRetryLadder({
            highQuality: settings.cameraHighQuality !== false,
            targetDeviceId: lockedInitialDeviceId,
            getUserMedia: (constraints) =>
              navigator.mediaDevices.getUserMedia(constraints),
            isCancelled: isStale,
            beforeAttempt: () => {
              stopCamera();
            },
          });
        } catch (lockedErr) {
          if (isStale() || !lockedInitialDeviceId || isCameraPermissionDeniedError(lockedErr)) {
            throw lockedErr;
          }
          // Saved/selected deviceId no longer exists or rejected exact constraint: clear stale remembered ID and retry default stream
          saveCameraDiagnostics({
            ...(manualDeviceId ? { selectedCameraDeviceId: null } : {}),
            ...(!manualDeviceId ? { rememberedTorchDeviceId: null } : {}),
          });
          stream = await startCameraWithRetryLadder({
            highQuality: settings.cameraHighQuality !== false,
            targetDeviceId: null,
            getUserMedia: (constraints) =>
              navigator.mediaDevices.getUserMedia(constraints),
            isCancelled: isStale,
            beforeAttempt: () => {
              stopCamera();
            },
          });
        }

        if (isStale()) {
          stopStreamTracks(stream);
          return;
        }

        // Camera permission is now granted: enumerate & probe back-camera candidates (at most 4)
        let activeStream = stream;
        let finalNoTorchFound = false;

        if (typeof navigator.mediaDevices.enumerateDevices === 'function') {
          try {
            const allDevices = await navigator.mediaDevices.enumerateDevices();
            if (isStale()) {
              stopStreamTracks(activeStream);
              return;
            }

            const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
            const labelsEmpty = areVideoDeviceLabelsEmpty(videoInputs);
            const sig = computeDevicesSignature(videoInputs);

            const initTrack = activeStream.getVideoTracks()[0] || null;
            const initCaps =
              initTrack && typeof initTrack.getCapabilities === 'function'
                ? (initTrack.getCapabilities() as CameraTrackCapabilitiesLike)
                : null;
            const initSettings = readTrackSettingsSnapshot(initTrack);
            const initDeviceId =
              initSettings?.deviceId || lockedInitialDeviceId || null;

            if (labelsEmpty) {
              // Labels empty -> keep default facingMode: 'environment' stream
              const initTorch = initCaps?.torch === true;
              const initZoom = extractZoomRangeFromCapabilities(initCaps);
              const singleCandidate: CameraCandidateRecord[] = initDeviceId
                ? [
                    {
                      deviceId: initDeviceId,
                      label: initTrack?.label || '',
                      index: 0,
                      isPreferredMainBack: true,
                      torchSupported: initTorch,
                      ...(initZoom
                        ? {
                            zoomMin: initZoom.min,
                            zoomMax: initZoom.max,
                            zoomStep: initZoom.step,
                          }
                        : {}),
                      probed: true,
                    },
                  ]
                : [];
              finalNoTorchFound = !initTorch;
              saveCameraDiagnostics({
                candidates: singleCandidate,
                cameraProbeSignature: sig,
                noTorchCandidateFound: finalNoTorchFound,
                activeCameraDeviceId: initDeviceId,
                activeCameraLabel: initTrack?.label || null,
              });
            } else if (manualDeviceId) {
              // Respect user's manual selection from Settings; keep candidate list up to date
              const baseList =
                diagBefore.cameraProbeSignature === sig &&
                Array.isArray(diagBefore.candidates) &&
                diagBefore.candidates.length > 0
                  ? diagBefore.candidates
                  : selectBackCameraCandidates(
                      videoInputs,
                      MAX_BACK_CAMERA_CANDIDATES
                    ).map((c) => ({
                      ...c,
                      torchSupported: false,
                      probed: false,
                    }));

              const initZoom = extractZoomRangeFromCapabilities(initCaps);
              const initTorch = initCaps?.torch === true;
              const updatedList = baseList.map((c) =>
                c.deviceId === (initDeviceId || manualDeviceId)
                  ? {
                      ...c,
                      torchSupported: initTorch,
                      ...(initZoom
                        ? {
                            zoomMin: initZoom.min,
                            zoomMax: initZoom.max,
                            zoomStep: initZoom.step,
                          }
                        : {}),
                      probed: true,
                    }
                  : c
              );
              const anyTorch =
                initTorch || updatedList.some((c) => c.torchSupported);
              finalNoTorchFound = !anyTorch;
              saveCameraDiagnostics({
                candidates: updatedList,
                cameraProbeSignature: sig,
                noTorchCandidateFound: finalNoTorchFound,
                activeCameraDeviceId: initDeviceId || manualDeviceId,
                activeCameraLabel: initTrack?.label || null,
              });
            } else {
              // Auto mode with device labels available
              const rawCandidates = selectBackCameraCandidates(
                videoInputs,
                MAX_BACK_CAMERA_CANDIDATES
              );
              const alreadyProbed =
                diagBefore.cameraProbeSignature === sig &&
                Array.isArray(diagBefore.candidates) &&
                diagBefore.candidates.length > 0 &&
                diagBefore.candidates.every((c) => c.probed);

              if (alreadyProbed && diagBefore.candidates) {
                const winner = pickBestTorchCandidate(diagBefore.candidates);
                finalNoTorchFound = !winner;
                if (winner && winner.deviceId !== initDeviceId) {
                  stopStreamTracks(activeStream);
                  activeStream = await startCameraWithRetryLadder({
                    highQuality: settings.cameraHighQuality !== false,
                    targetDeviceId: winner.deviceId,
                    getUserMedia: (constraints) =>
                      navigator.mediaDevices.getUserMedia(constraints),
                    isCancelled: isStale,
                    beforeAttempt: () => stopCamera(),
                  });
                }
              } else if (rawCandidates.length > 0) {
                const probedCandidates: CameraCandidateRecord[] =
                  rawCandidates.map((cand) => {
                    if (initDeviceId && cand.deviceId === initDeviceId) {
                      const zr = extractZoomRangeFromCapabilities(initCaps);
                      return {
                        ...cand,
                        torchSupported: initCaps?.torch === true,
                        ...(zr
                          ? {
                              zoomMin: zr.min,
                              zoomMax: zr.max,
                              zoomStep: zr.step,
                            }
                          : {}),
                        probed: true,
                      };
                    }
                    return {
                      ...cand,
                      torchSupported: false,
                      probed: false,
                    };
                  });

                const unprobedCount = probedCandidates.filter(
                  (c) => !c.probed
                ).length;

                if (unprobedCount > 0) {
                  // Release active stream before sequential candidate probes (single-camera Android HAL)
                  stopStreamTracks(activeStream);

                  for (const cand of probedCandidates) {
                    if (cand.probed) continue;
                    if (isStale()) return;

                    let testStream: MediaStream | null = null;
                    try {
                      testStream = await acquireStreamWithTimeout(
                        (c) => navigator.mediaDevices.getUserMedia(c),
                        {
                          audio: false,
                          video: { deviceId: { exact: cand.deviceId } },
                        },
                        3500
                      );
                      const t = testStream.getVideoTracks()[0] || null;
                      const caps =
                        t && typeof t.getCapabilities === 'function'
                          ? (t.getCapabilities() as CameraTrackCapabilitiesLike)
                          : null;
                      const zr = extractZoomRangeFromCapabilities(caps);
                      cand.torchSupported = caps?.torch === true;
                      if (zr) {
                        cand.zoomMin = zr.min;
                        cand.zoomMax = zr.max;
                        cand.zoomStep = zr.step;
                      }
                      cand.probed = true;
                    } catch (probeErr) {
                      cand.torchSupported = false;
                      cand.probed = true;
                      cand.probeError = formatConstraintsError(probeErr);
                    } finally {
                      stopStreamTracks(testStream);
                    }
                  }
                }

                if (isStale()) return;

                const winner = pickBestTorchCandidate(probedCandidates);
                const fallbackMain =
                  rawCandidates.find((c) => c.isPreferredMainBack) ||
                  rawCandidates[0] ||
                  null;
                const chosenDeviceId =
                  winner?.deviceId || fallbackMain?.deviceId || null;
                finalNoTorchFound = !winner;

                saveCameraDiagnostics({
                  candidates: probedCandidates,
                  rememberedTorchDeviceId: winner ? winner.deviceId : null,
                  cameraProbeSignature: sig,
                  noTorchCandidateFound: finalNoTorchFound,
                });

                const stillHasMatchingOpenStream =
                  unprobedCount === 0 &&
                  chosenDeviceId !== null &&
                  chosenDeviceId === initDeviceId;

                if (!stillHasMatchingOpenStream) {
                  if (unprobedCount === 0) {
                    stopStreamTracks(activeStream);
                  }
                  activeStream = await startCameraWithRetryLadder({
                    highQuality: settings.cameraHighQuality !== false,
                    targetDeviceId: chosenDeviceId,
                    getUserMedia: (constraints) =>
                      navigator.mediaDevices.getUserMedia(constraints),
                    isCancelled: isStale,
                    beforeAttempt: () => stopCamera(),
                  });
                }
              }
            }
          } catch {
            // If enumeration or reopen fails unexpectedly, keep usable stream if live
          }
        }

        if (isStale()) {
          stopStreamTracks(activeStream);
          return;
        }

        const track = activeStream.getVideoTracks()[0] || null;
        streamRef.current = activeStream;
        videoTrackRef.current = track;

        const finalSettings = readTrackSettingsSnapshot(track);
        const finalDeviceId =
          finalSettings?.deviceId || lockedInitialDeviceId || null;
        activeDeviceIdRef.current = finalDeviceId;
        noTorchAvailableRef.current = finalNoTorchFound;

        if (isMountedRef.current) {
          setNoTorchAvailable(finalNoTorchFound);
          if (finalNoTorchFound) {
            constraintStateRef.current = {
              ...constraintStateRef.current,
              torch: false,
            };
            showNoTorchNoticeOnce();
          }
        }

        saveCameraDiagnostics({
          activeCameraDeviceId: finalDeviceId,
          activeCameraLabel: track?.label || null,
          noTorchCandidateFound: finalNoTorchFound,
        });

        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.srcObject = activeStream;
          await videoEl.play().catch(() => {});
          if (isStale() || videoRef.current !== videoEl) {
            return;
          }
          await waitForVideoPlaying(videoEl, runId);
          if (
            !isStale() &&
            videoEl.videoWidth > 0 &&
            videoEl.videoHeight > 0
          ) {
            saveCameraDiagnostics({
              previewWidth: videoEl.videoWidth,
              previewHeight: videoEl.videoHeight,
            });
          }
        }

        if (isStale()) {
          return;
        }

        const activeTrackTorch = await inspectTrackCapabilities(track);
        if (!activeTrackTorch && finalNoTorchFound) {
          noTorchAvailableRef.current = true;
          setNoTorchAvailable(true);
        } else if (activeTrackTorch) {
          noTorchAvailableRef.current = false;
          setNoTorchAvailable(false);
        }

        setCameraState('active');

        if (track) {
          schedulePostPlayConstraintRestore(track, runId);
        }
      } catch (err) {
        if (isStale()) {
          return;
        }
        stopCamera();
        setCameraState(
          isCameraPermissionDeniedError(err) ? 'denied' : 'unavailable'
        );
      }
    },
    [
      stopCamera,
      stopStreamTracks,
      inspectTrackCapabilities,
      waitForVideoPlaying,
      schedulePostPlayConstraintRestore,
      showNoTorchNoticeOnce,
      settings.cameraHighQuality,
      settings.selectedCameraDeviceId,
    ]
  );

  useEffect(() => {
    startCamera({ silentBackground: false });

    const restoreOnTabReturn = async () => {
      if (!isMountedRef.current) return;
      const track = videoTrackRef.current;
      if (!track || track.readyState !== 'live') {
        startCamera({ silentBackground: false });
        return;
      }
      const runId = startRunIdRef.current;
      const videoEl = videoRef.current;
      if (videoEl) {
        await videoEl.play().catch(() => {});
        if (
          !isMountedRef.current ||
          startRunIdRef.current !== runId ||
          videoRef.current !== videoEl
        ) {
          return;
        }
        await waitForVideoPlaying(videoEl, runId);
      }
      if (
        isMountedRef.current &&
        startRunIdRef.current === runId &&
        videoTrackRef.current === track &&
        track.readyState === 'live'
      ) {
        schedulePostPlayConstraintRestore(track, runId);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void restoreOnTabReturn();
      }
    };

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        void restoreOnTabReturn();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    let permStatus: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (permStatus?.state === 'granted') {
        startCamera({ silentBackground: false });
      }
    };
    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'camera' as PermissionName })
        .then((ps) => {
          if (!isMountedRef.current) return;
          permStatus = ps;
          ps.addEventListener('change', handlePermChange);
        })
        .catch(() => {});
    }

    return () => {
      startRunIdRef.current++;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      if (permStatus) {
        permStatus.removeEventListener('change', handlePermChange);
      }
      stopCamera();
    };
  }, [
    startCamera,
    stopCamera,
    waitForVideoPlaying,
    schedulePostPlayConstraintRestore,
  ]);

  // Quiet background retry every 5s while camera is unavailable/denied; auto-dismisses when recovered
  useEffect(() => {
    if (cameraState !== 'denied' && cameraState !== 'unavailable') return;
    const intervalId = window.setInterval(() => {
      if (!isMountedRef.current || document.visibilityState !== 'visible') {
        return;
      }
      startCamera({ silentBackground: true });
    }, CAMERA_BACKGROUND_RETRY_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [cameraState, startCamera]);

  // Smart Auto Flash: samples brightness every 300ms with hysteresis, using the same single-call path
  useEffect(() => {
    if (
      cameraState !== 'active' ||
      flashMode !== 'auto' ||
      !settings.autoFlash ||
      reviewShot ||
      !torchSupported
    ) {
      return;
    }

    autoFlashStateRef.current = createInitialAutoFlashState(torchOnRef.current);

    const evaluateBrightness = () => {
      if (isCapturingRef.current || !postPlayReadyRef.current) return;
      const metrics = sampleVideoBrightnessMetrics();
      if (!metrics) return;

      const { nextState, desiredTorch } = stepAutoFlashState(
        autoFlashStateRef.current,
        metrics,
        Date.now()
      );
      autoFlashStateRef.current = nextState;

      if (desiredTorch !== null) {
        constraintStateRef.current = {
          ...constraintStateRef.current,
          torch: desiredTorch,
        };
        void syncUnifiedTrackConstraints({ showMismatchOnce: false }).then(
          (ok) => {
            if (desiredTorch && !ok) {
              autoFlashStateRef.current.torchOn = false;
            }
          }
        );
      }
    };

    const intervalId = window.setInterval(
      evaluateBrightness,
      AUTO_FLASH_DEFAULTS.sampleIntervalMs
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    torchSupported,
    cameraState,
    flashMode,
    settings.autoFlash,
    reviewShot,
    sampleVideoBrightnessMetrics,
    syncUnifiedTrackConstraints,
  ]);

  const commitPhotoToDB = useCallback(
    async (
      shot: { dataUrl: string; width: number; height: number },
      _unused?: string,
      captureMethod?: 'takePhoto' | 'videoFrame' | 'gallery'
    ) => {
      await persistCapturedShotToLog({
        shot,
        sessionId,
        onSaved: (record) => {
          if (captureMethod && record.width > 0 && record.height > 0) {
            saveCameraDiagnostics({
              lastSavedPhotoWidth: record.width,
              lastSavedPhotoHeight: record.height,
              lastSavedPhotoMethod: captureMethod,
            });
          }
          if (isMountedRef.current) {
            onPhotoQueued();
          }
        },
      });
    },
    [sessionId, onPhotoQueued]
  );

  const finalizeProcessedShot = useCallback(
    async (processed: {
      dataUrl: string;
      width: number;
      height: number;
      isBlurry: boolean;
      variance: number;
      captureMethod?: 'takePhoto' | 'videoFrame' | 'gallery';
    }) => {
      if (settings.continuousMode !== false) {
        await commitPhotoToDB(
          {
            dataUrl: processed.dataUrl,
            width: processed.width,
            height: processed.height,
          },
          undefined,
          processed.captureMethod
        );
        return;
      }

      if (isMountedRef.current) {
        setReviewShot(processed);
      } else if (!processed.isBlurry) {
        await commitPhotoToDB(
          {
            dataUrl: processed.dataUrl,
            width: processed.width,
            height: processed.height,
          },
          undefined,
          processed.captureMethod
        );
      }
    },
    [commitPhotoToDB, settings.continuousMode]
  );

  const handleCapture = async () => {
    if (isCapturingRef.current) return;
    warmAudioContext();

    if (cameraState !== 'active' || !videoRef.current) {
      return;
    }

    isCapturingRef.current = true;
    const settleWaitMs = computeFocusSettleWaitMs(
      lastZoomChangedAtRef.current,
      Date.now()
    );
    if (settleWaitMs > 0) {
      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, settleWaitMs)
      );
      if (!isMountedRef.current || !videoRef.current) {
        isCapturingRef.current = false;
        return;
      }
    }

    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      isCapturingRef.current = false;
      return;
    }

    const previewW = video.clientWidth || vw;
    const previewH = video.clientHeight || vh;

    triggerShutterFeedback(settings.shutterSound);

    const hw = hardwareZoomRangeRef.current;
    const curZoom = zoomValueRef.current;
    const hwApplied = hw ? Math.max(hw.min, Math.min(hw.max, curZoom)) : 1;
    const digitalScale = hw
      ? Math.max(1, curZoom / Math.max(1, hwApplied))
      : curZoom;

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

    // Use ImageCapture.takePhoto() at max supported sensor resolution when available
    let takePhotoBlob: Blob | null = null;
    if (videoTrackRef.current) {
      const WinImageCapture = (
        window as unknown as {
          ImageCapture?: new (track: MediaStreamTrack) => {
            takePhoto?: (settings?: Record<string, unknown>) => Promise<Blob>;
          };
        }
      ).ImageCapture;

      if (typeof WinImageCapture === 'function') {
        try {
          const ic = new WinImageCapture(videoTrackRef.current);
          if (typeof ic.takePhoto === 'function') {
            const torchWasRequestedOn = Boolean(
              constraintStateRef.current.torch ||
                torchOnRef.current ||
                flashModeRef.current === 'on'
            );
            const torchActiveOrSupported = Boolean(
              torchSupported ||
                trackCapabilitiesRef.current?.torch === true ||
                torchWasRequestedOn
            );

            // Never pass a fillLightMode that conflicts with torch
            let fillLightMode: 'flash' | undefined;
            if (!torchActiveOrSupported && photoFlashSupported) {
              let shouldFireFlash = flashModeRef.current === 'on';
              if (
                !shouldFireFlash &&
                flashModeRef.current === 'auto' &&
                settings.autoFlash
              ) {
                const metrics = sampleVideoBrightnessMetrics();
                if (metrics) {
                  shouldFireFlash =
                    metrics.avgLuma < AUTO_FLASH_DEFAULTS.lowLumaThreshold;
                }
              }
              if (shouldFireFlash) {
                fillLightMode = 'flash';
              }
            }

            const takeOptions = buildTakePhotoSettings({
              fillLightMode,
              torchActive: torchActiveOrSupported,
              maxPhotoDims: maxPhotoDimsRef.current,
            });
            const tryTakePhoto = (opts?: Record<string, unknown>) =>
              Promise.race([
                opts ? ic.takePhoto!(opts) : ic.takePhoto!(),
                new Promise<null>((resolve) =>
                  window.setTimeout(
                    () => resolve(null),
                    CAMERA_TAKE_PHOTO_TIMEOUT_MS
                  )
                ),
              ]);

            try {
              takePhotoBlob = await tryTakePhoto(takeOptions);
            } catch {
              if (takeOptions?.imageWidth) {
                const fallbackOpts = buildTakePhotoSettings({
                  fillLightMode,
                  torchActive: torchActiveOrSupported,
                });
                takePhotoBlob = await tryTakePhoto(fallbackOpts).catch(
                  () => null
                );
              }
            } finally {
              // If takePhoto() reset torch on this device, restore full constraints right after the shot
              if (
                torchWasRequestedOn &&
                videoTrackRef.current &&
                videoTrackRef.current.readyState === 'live'
              ) {
                constraintStateRef.current = {
                  ...constraintStateRef.current,
                  torch: true,
                };
                await syncUnifiedTrackConstraints({ showMismatchOnce: false });
                const verifySnap = readTrackSettingsSnapshot(
                  videoTrackRef.current
                );
                if (
                  verifySnap?.torch === false &&
                  trackCapabilitiesRef.current?.torch === true
                ) {
                  window.setTimeout(() => {
                    if (
                      isMountedRef.current &&
                      videoTrackRef.current?.readyState === 'live' &&
                      constraintStateRef.current.torch
                    ) {
                      void syncUnifiedTrackConstraints({
                        showMismatchOnce: false,
                      });
                    }
                  }, 60);
                }
              }
            }
          }
        } catch {
          takePhotoBlob = null;
        }
      }
    }

    let capturedBitmap: ImageBitmap | undefined;
    let fallbackCanvasData: HTMLCanvasElement | null = null;
    let captureMethod: 'takePhoto' | 'videoFrame' = 'videoFrame';
    try {
      if (takePhotoBlob && typeof createImageBitmap === 'function') {
        try {
          capturedBitmap = await createImageBitmap(takePhotoBlob, {
            imageOrientation: 'from-image',
          });
          captureMethod = 'takePhoto';
        } catch {
          capturedBitmap = undefined;
        }
      }
      if (!capturedBitmap && typeof createImageBitmap === 'function') {
        try {
          capturedBitmap = await createImageBitmap(video);
          captureMethod = 'videoFrame';
        } catch {
          capturedBitmap = undefined;
        }
      }
      if (!capturedBitmap) {
        fallbackCanvasData = drawFullResVideoCanvas();
        captureMethod = 'videoFrame';
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

    const rotationDeg: 0 | 90 | 180 | 270 =
      captureMethod === 'takePhoto'
        ? 0
        : capturedBitmap
        ? getVideoCaptureRotationDeg(
            capturedBitmap.width,
            capturedBitmap.height,
            previewW,
            previewH
          )
        : 0;

    const skipBlurReview = settings.continuousMode !== false;
    const blurThreshold = skipBlurReview ? 0 : DEFAULT_BLUR_THRESHOLD;
    const capturedSessionId = sessionId;
    const photoMaxDim = settings.cameraHighQuality !== false ? 0 : 2048;
    const photoQuality = 0.92;

    if (capturedBitmap) {
      processCaptureOffThread({
        bitmap: capturedBitmap,
        digitalScale,
        rotationDeg,
        maxDim: photoMaxDim,
        quality: photoQuality,
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
              onSaved: (record) => {
                if (record.width > 0 && record.height > 0) {
                  saveCameraDiagnostics({
                    lastSavedPhotoWidth: record.width,
                    lastSavedPhotoHeight: record.height,
                    lastSavedPhotoMethod: captureMethod,
                  });
                }
                if (isMountedRef.current) {
                  onPhotoQueued();
                }
              },
            });
          }
          return finalizeProcessedShot({
            ...processed,
            captureMethod,
          });
        })
        .catch(async () => {
          const fallbackC = drawFullResVideoCanvas();
          if (!fallbackC) return;
          const compressed = compressCanvasToJpeg(
            fallbackC,
            photoMaxDim,
            photoQuality
          );
          const blur =
            blurThreshold > 0
              ? checkImageBlurFromCanvas(fallbackC, blurThreshold)
              : { variance: 100, isBlurry: false };
          await finalizeProcessedShot({
            ...compressed,
            isBlurry: blur.isBlurry,
            variance: blur.variance,
            captureMethod: 'videoFrame',
          });
        });
    } else if (fallbackCanvasData) {
      const compressed = compressCanvasToJpeg(
        fallbackCanvasData,
        photoMaxDim,
        photoQuality
      );
      const blur =
        blurThreshold > 0
          ? checkImageBlurFromCanvas(fallbackCanvasData, blurThreshold)
          : { variance: 100, isBlurry: false };
      finalizeProcessedShot({
        ...compressed,
        isBlurry: blur.isBlurry,
        variance: blur.variance,
        captureMethod: 'videoFrame',
      }).catch(() => {});
    }
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    const skipBlurReview = settings.continuousMode !== false;
    const blurThreshold = skipBlurReview ? 0 : DEFAULT_BLUR_THRESHOLD;
    const galleryMaxDim = settings.cameraHighQuality !== false ? 0 : 2048;
    const galleryQuality = 0.92;

    if (files.length === 1) {
      try {
        const processed = await processCaptureOffThread({
          blob: files[0],
          maxDim: galleryMaxDim,
          quality: galleryQuality,
          blurThreshold,
          fallbackBlurCheck:
            blurThreshold > 0
              ? (c) => checkImageBlurFromCanvas(c, blurThreshold)
              : undefined,
        });
        await finalizeProcessedShot({
          ...processed,
          captureMethod: 'gallery',
        });
      } catch {
        const canvas = await fileOrDataUrlToCanvas(files[0], galleryMaxDim);
        const compressed = compressCanvasToJpeg(
          canvas,
          galleryMaxDim,
          galleryQuality
        );
        const blur =
          blurThreshold > 0
            ? checkImageBlurFromCanvas(canvas, blurThreshold)
            : { variance: 100, isBlurry: false };
        await finalizeProcessedShot({
          ...compressed,
          isBlurry: blur.isBlurry,
          variance: blur.variance,
          captureMethod: 'gallery',
        });
      }
    } else {
      for (const file of files) {
        try {
          const processed = await processCaptureOffThread({
            blob: file,
            maxDim: galleryMaxDim,
            quality: galleryQuality,
            blurThreshold: 0,
          });
            await commitPhotoToDB(
              {
                dataUrl: processed.dataUrl,
                width: processed.width,
                height: processed.height,
              },
              undefined,
              'gallery'
            );
          } catch {
            const canvas = await fileOrDataUrlToCanvas(file, galleryMaxDim);
            const compressed = compressCanvasToJpeg(
              canvas,
              galleryMaxDim,
              galleryQuality
            );
            await commitPhotoToDB(
              {
                dataUrl: compressed.dataUrl,
                width: compressed.width,
                height: compressed.height,
              },
              undefined,
              'gallery'
            );
          }
        }
      }
    };

  const handleConfirmReviewShot = async () => {
    if (!reviewShot) return;
    const shot = reviewShot;
    setReviewShot(null);
    await commitPhotoToDB(
      {
        dataUrl: shot.dataUrl,
        width: shot.width,
        height: shot.height,
      },
      undefined,
      (shot as PendingReviewShot & { captureMethod?: 'takePhoto' | 'videoFrame' | 'gallery' }).captureMethod
    );
  };

  const handleCycleZoomPreset = () => {
    const cur = zoomValueRef.current;
    const curIdx = ZOOM_PRESETS.findIndex((p) => Math.abs(cur - p) < 0.25);
    const next = ZOOM_PRESETS[(curIdx + 1) % ZOOM_PRESETS.length];
    applyZoom(next, true, true);
  };

  const cycleFlashMode = async () => {
    userToggledFlashRef.current = true;
    rememberedUserToggledFlash = true;

    const currentMode = flashModeRef.current;
    const idx = FLASH_CYCLE.indexOf(currentMode);
    let next = FLASH_CYCLE[(idx + 1) % FLASH_CYCLE.length];
    if (next === 'auto' && !settings.autoFlash) {
      next = 'on';
    }

    updateFlashModeState(next);

    if (next === 'on') {
      autoFlashStateRef.current = createInitialAutoFlashState(true);
      constraintStateRef.current = {
        ...constraintStateRef.current,
        torch: true,
      };
      await syncUnifiedTrackConstraints({ showMismatchOnce: true });
    } else if (next === 'off') {
      setFlashUnavailableNotice(false);
      autoFlashStateRef.current = createInitialAutoFlashState(false);
      constraintStateRef.current = {
        ...constraintStateRef.current,
        torch: false,
      };
      await syncUnifiedTrackConstraints({ showMismatchOnce: false });
    } else {
      setFlashUnavailableNotice(false);
      const metrics = sampleVideoBrightnessMetrics();
      const shouldTurnOn = metrics ? isSceneDimForTorch(metrics) : false;
      autoFlashStateRef.current = createInitialAutoFlashState(shouldTurnOn);
      constraintStateRef.current = {
        ...constraintStateRef.current,
        torch: shouldTurnOn,
      };
      await syncUnifiedTrackConstraints({ showMismatchOnce: false });
    }
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

  const toolbarOnLeft = settings.cameraToolbarSide === 'left';

  return (
    <div
      className="relative w-full h-[calc(100dvh-68px-env(safe-area-inset-bottom,0px))] bg-slate-950 overflow-hidden select-none touch-pan-y"
      dir="rtl"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Hidden gallery input (multi-select supported, no capture attribute) */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFilePicked}
        className="hidden"
      />

      {/* Live Video Stream */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`w-full h-full object-cover ${
          cameraState === 'active' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* 120ms White Shutter Feedback Overlay */}
      <div
        ref={flashOverlayRef}
        style={{ opacity: 0 }}
        className="pointer-events-none absolute inset-0 bg-white/45 z-40"
      />

      {/* Clean Fallback Card ONLY after all retries fail — ZERO controls behind or overlapping */}
      {(cameraState === 'denied' || cameraState === 'unavailable') && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 bg-slate-950">
          <div className="w-full max-w-xs rounded-[24px] bg-slate-900 border border-slate-800 p-6 text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto text-emerald-400">
              <Camera className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-lg font-extrabold text-white">
                الكاميرا غير متاحة
              </h1>
              <p className="text-xs text-slate-300 leading-relaxed">
                اسمح باستخدام الكاميرا من إعدادات المتصفح أو الموقع.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="min-h-[50px] w-full px-5 rounded-2xl bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
              >
                <ImagePlus className="w-5 h-5" />
                <span>اختيار من المعرض</span>
              </button>
              <button
                type="button"
                onClick={() => startCamera({ silentBackground: false })}
                className="min-h-[48px] w-full px-4 rounded-2xl bg-slate-800 text-slate-100 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Starting Skeleton Viewfinder (controls completely hidden until video is playing) */}
      {cameraState === 'starting' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950 px-6">
          <div className="w-full max-w-sm aspect-[3/4] rounded-[24px] bg-slate-900/90 border border-slate-800/80 animate-pulse flex flex-col items-center justify-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-emerald-400">
              <Camera className="w-7 h-7 animate-pulse" />
            </div>
            <span className="text-sm font-bold text-slate-300">
              جاري تشغيل الكاميرا…
            </span>
          </div>
        </div>
      )}

      {/* Active Camera Controls ONLY */}
      {cameraState === 'active' && (
        <>
          {/* No candidate supports torch — shown ONCE per unsupported device */}
          {noTorchNoticeVisible && (
            <div className="absolute top-[calc(5.2rem+env(safe-area-inset-top,0px))] inset-x-4 z-20 flex justify-center">
              <div className="max-w-md w-full px-3.5 py-2.5 rounded-2xl bg-black/80 text-white text-xs font-bold flex items-center justify-between gap-2">
                <span>هذا الهاتف/المتصفح لا يدعم الفلاش من هنا</span>
                <button
                  type="button"
                  onClick={() => setNoTorchNoticeVisible(false)}
                  className="px-2.5 py-1 rounded-xl bg-white/15 text-white font-extrabold shrink-0"
                >
                  حسناً
                </button>
              </div>
            </div>
          )}

          {/* Flash unsupported / rejected inline tip (shown once per mismatch) */}
          {!noTorchNoticeVisible && flashUnavailableNotice && (
            <div className="absolute top-[calc(5.2rem+env(safe-area-inset-top,0px))] inset-x-4 z-20 flex justify-center">
              <div className="max-w-md w-full px-3.5 py-2.5 rounded-2xl bg-black/80 text-white text-xs font-bold flex items-center justify-between gap-2">
                <span>الفلاش غير مدعوم أو مرفوض</span>
                <button
                  type="button"
                  onClick={() => setFlashUnavailableNotice(false)}
                  className="px-2.5 py-1 rounded-xl bg-white/15 text-white font-extrabold shrink-0"
                >
                  حسناً
                </button>
              </div>
            </div>
          )}

          {/* Vertical Icon-Only Semi-Transparent Edge Toolbar (Right default, or Left from Settings) */}
          <div
            data-testid="camera-vertical-toolbar"
            data-side={toolbarOnLeft ? 'left' : 'right'}
            className={`absolute top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2 p-1.5 rounded-full bg-black/45 backdrop-blur-md border border-white/15 shadow-lg ${
              toolbarOnLeft ? 'left-3' : 'right-3'
            }`}
            onTouchStart={(e) => e.stopPropagation()}
          >
            {/* 1) Flash cycle (hidden when no camera candidate supports torch) */}
            {!noTorchAvailable && (
              <button
                type="button"
                onClick={cycleFlashMode}
                data-torch-on={torchOn ? 'true' : 'false'}
                data-flash-mode={flashMode}
                className={`relative w-11 h-11 rounded-full flex items-center justify-center transition active:scale-90 ${
                  torchOn
                    ? 'bg-amber-400 text-slate-950'
                    : flashMode === 'off' || flashMode === 'on'
                    ? 'text-white/60 hover:bg-white/10'
                    : 'text-white hover:bg-white/15'
                }`}
                aria-label={`الفلاش: ${flashMode}`}
                title="الفلاش"
              >
                {torchOn ? (
                  <Zap className="w-5 h-5" />
                ) : flashMode === 'auto' ? (
                  <Zap className="w-5 h-5" />
                ) : (
                  <ZapOff className="w-5 h-5" />
                )}
                {flashMode === 'auto' && !torchOn && (
                  <span
                    aria-hidden="true"
                    className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-300"
                  />
                )}
              </button>
            )}

            {/* 2) Zoom cycle (tap rotates 1x -> 2x -> 3x) */}
            <div className="relative flex items-center justify-center">
              <button
                type="button"
                onClick={handleCycleZoomPreset}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition active:scale-90 ${
                  activePresetZoom > 1
                    ? 'bg-emerald-500 text-white'
                    : 'text-white hover:bg-white/15'
                }`}
                aria-label="التقريب"
                title="التقريب (1x / 2x / 3x)"
              >
                <ZoomIn className="w-5 h-5" />
              </button>

              <div
                ref={zoomLabelRef}
                dir="ltr"
                className={`pointer-events-none absolute top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-black/70 text-emerald-300 text-[11px] font-extrabold tabular-nums transition-opacity duration-200 ${
                  toolbarOnLeft ? 'left-14' : 'right-14'
                } ${showZoomOverlay ? 'opacity-100' : 'opacity-0'}`}
              >
                1.0x
              </div>
            </div>

            {/* 3) More options (⋯) */}
            <button
              type="button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition active:scale-90 ${
                showMoreMenu
                  ? 'bg-white/25 text-white'
                  : 'text-white hover:bg-white/15'
              }`}
              aria-label="المزيد من الخيارات"
              aria-expanded={showMoreMenu}
              title="المزيد"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>

          {/* Compact Popover for More Options (⋯) */}
          {showMoreMenu && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setShowMoreMenu(false)}
              />
              <div
                data-testid="camera-more-menu"
                className={`absolute top-1/2 -translate-y-1/2 z-30 w-52 rounded-2xl bg-slate-900/90 backdrop-blur-md border border-white/15 shadow-2xl p-1.5 flex flex-col gap-1 text-white text-xs font-bold ${
                  toolbarOnLeft ? 'left-16' : 'right-16'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    galleryInputRef.current?.click();
                  }}
                  className="w-full min-h-[42px] px-3 rounded-xl hover:bg-white/10 flex items-center gap-2.5 text-right"
                >
                  <ImagePlus className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>اختيار من المعرض</span>
                </button>
              </div>
            </>
          )}

          {/* Bottom: ONLY the Big Green Capture Button */}
          <div className="pointer-events-none absolute bottom-0 inset-x-0 z-20 pb-6 flex justify-center">
            <button
              type="button"
              onClick={() => handleCapture()}
              aria-label="التقاط صورة للرف"
              className="pointer-events-auto w-[78px] h-[78px] rounded-full bg-white p-1.5 flex items-center justify-center active:scale-95 shadow-2xl"
            >
              <span className="w-full h-full rounded-full bg-emerald-500 border-4 border-white flex items-center justify-center">
                <Camera className="w-7 h-7 text-white" />
              </span>
            </button>
          </div>
        </>
      )}

      {/* Preview / Blurry Rejection Modal (when continuousMode is explicitly disabled) */}
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
    </div>
  );
};
