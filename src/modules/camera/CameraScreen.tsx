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
  Smartphone,
} from 'lucide-react';
import {
  AppSettings,
  FlashMode,
  ShelfPhoto,
} from '../../types';
import {
  getAllPhotos,
} from '../db';
import {
  checkImageBlurFromCanvas,
  DEFAULT_BLUR_THRESHOLD,
} from './blurDetection';
import {
  compressCanvasToJpeg,
  drawCroppedRotatedToCanvas,
  estimateDataUrlBytes,
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
  CameraCaptureMethod,
  readCameraDiagnostics,
  saveCameraDiagnostics,
} from './cameraDiagnostics';
import {
  CameraCandidateRecord,
  MAX_BACK_CAMERA_CANDIDATES,
  ZOOM_PRESETS,
  areVideoDeviceLabelsEmpty,
  clampHardwareZoom,
  computeDevicesSignature,
  extractZoomRangeFromCapabilities,
  pickBestTorchCandidate,
  resolveAvailableZoomPresets,
  selectBackCameraCandidates,
} from './cameraSelection';
import {
  FREEZE_OVERLAY_MAX_MS,
  MAX_CAPTURE_QUEUE_PENDING,
  MAX_SAVED_PHOTO_LONG_SIDE,
  SAVED_PHOTO_JPEG_QUALITY,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_LONG_SIDE,
  resolveCaptureMode,
} from './captureQueue';
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
import { enqueuePhotoEnhancement } from './photoEnhancementQueue';
import { resolveEnhanceLevel } from './photoEnhancement';
import {
  enqueueBatchedPhotoWrite,
  notifyCameraActivity,
  notifyShutterPressed,
  setCapturesInFlight,
} from './backgroundCameraQueue';
import {
  getEffectiveCameraPowerProfile,
  incrementSessionCaptureCount,
  markCameraSessionStarted,
  markCameraSessionStopped,
} from '../power/batterySaver';
import {
  AdaptivePreviewState,
  createAdaptivePreviewState,
  getTargetPreviewDims,
  resolvePreviewResolutionSetting,
  stepAdaptivePreviewState,
} from './cameraPerf';

function enqueueCapturedShotToBatchLog(params: {
  shot: {
    dataUrl: string;
    thumbnailDataUrl?: string;
    width: number;
    height: number;
    byteLength?: number;
  };
  photoMeta?: {
    id: string;
    sessionId: string;
    timestamp: number;
    dateKey: string;
    enhancementStatus?: 'pending';
  };
  sessionId: string;
  onEnqueued?: (record: ShelfPhoto) => void;
  onFlushed?: (record: ShelfPhoto, savingMs: number) => void;
}): ShelfPhoto {
  const now = params.photoMeta?.timestamp ?? Date.now();
  const record: ShelfPhoto = {
    id:
      params.photoMeta?.id ??
      `ph_${now}_${Math.random().toString(36).slice(2, 7)}`,
    sessionId: params.photoMeta?.sessionId ?? params.sessionId,
    timestamp: now,
    dateKey: params.photoMeta?.dateKey ?? getLocalDateKey(now),
    dataUrl: params.shot.dataUrl,
    ...(params.shot.thumbnailDataUrl
      ? { thumbnailDataUrl: params.shot.thumbnailDataUrl }
      : {}),
    width: params.shot.width,
    height: params.shot.height,
    ...(params.photoMeta?.enhancementStatus
      ? { enhancementStatus: params.photoMeta.enhancementStatus }
      : {}),
  };
  params.onEnqueued?.(record);
  void enqueueBatchedPhotoWrite(record, (savingMs) => {
    params.onFlushed?.(record, savingMs);
  });
  return record;
}

interface PendingReviewShot {
  dataUrl: string;
  thumbnailDataUrl?: string;
  width: number;
  height: number;
  byteLength?: number;
  isBlurry: boolean;
  variance: number;
  captureMethod?: CameraCaptureMethod;
  captureMs?: number;
  processingMs?: number;
}

interface CameraScreenProps {
  sessionId: string;
  settings: AppSettings;
  isOnline: boolean;
  isBatterySaverOn?: boolean;
  onPhotoQueued: () => void;
  onOpenPhotoInLog?: (photoId: string) => void;
  onUpdateSettings?: (partial: Partial<AppSettings>) => Promise<void>;
}

const FLASH_CYCLE: FlashMode[] = ['auto', 'on', 'off'];

// Preserves the user's selected flash mode across internal app tab switches
let rememberedFlashMode: FlashMode | null = null;
let rememberedUserToggledFlash = false;
let noTorchNoticeShownOnce = false;

export const CameraScreen: React.FC<CameraScreenProps> = ({
  sessionId,
  settings,
  isBatterySaverOn = false,
  onPhotoQueued,
}) => {
  const effectivePowerProfile = getEffectiveCameraPowerProfile({
    settings,
    isBatterySaverOn: Boolean(isBatterySaverOn),
  });
  const effectiveFrameRate = effectivePowerProfile.frameRate;
  const effectiveIdleTimeoutSec = effectivePowerProfile.idleTimeoutSec;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const meterCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Direct DOM refs to avoid React re-renders during streaming, freeze-frame overlay, and shutter flash
  const freezeOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const freezeOverlayTimerRef = useRef<number | null>(null);
  const freezeTokenRef = useRef(0);
  const flashOverlayRef = useRef<HTMLDivElement | null>(null);
  const zoomLabelRef = useRef<HTMLDivElement | null>(null);
  const pendingBadgeRef = useRef<HTMLSpanElement | null>(null);
  const savedCountRef = useRef<HTMLSpanElement | null>(null);
  const savedPhotoCountValueRef = useRef(0);
  const inFlightHardwareCaptureRef = useRef(false);
  const captureQueueChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingCountRef = useRef(0);
  const isMountedRef = useRef(true);
  const startRunIdRef = useRef(0);

  const [cameraState, setCameraState] = useState<
    'starting' | 'active' | 'idle' | 'denied' | 'unavailable'
  >('starting');
  const cameraStateRef = useRef<
    'starting' | 'active' | 'idle' | 'denied' | 'unavailable'
  >('starting');
  cameraStateRef.current = cameraState;

  const effectiveFrameRateRef = useRef<number>(effectiveFrameRate);
  effectiveFrameRateRef.current = effectiveFrameRate;
  const effectiveIdleTimeoutSecRef = useRef<number>(effectiveIdleTimeoutSec);
  effectiveIdleTimeoutSecRef.current = effectiveIdleTimeoutSec;
  const idleStopTimerRef = useRef<number | null>(null);
  const pausedByVisibilityRef = useRef(false);
  const [savedPhotoCount, setSavedPhotoCount] = useState<number>(0);
  const [reviewShot, setReviewShot] = useState<PendingReviewShot | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [previewDowngradedNotice, setPreviewDowngradedNotice] = useState(false);
  const adaptivePreviewStateRef = useRef<AdaptivePreviewState>(
    createAdaptivePreviewState()
  );
  const previewDowngradedRef = useRef(false);
  const measuredFpsRef = useRef<number | null>(null);

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

  // Zoom state (range & active chip/overlay updated directly on DOM during pinch gestures)
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

  const zoomValueRef = useRef<number>(1);

  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number>(1);
  const zoomFadeTimerRef = useRef<number | null>(null);
  const zoomRafRef = useRef<number | null>(null);
  const pendingHwZoomRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const syncPendingBadgeDom = useCallback((nextPending: number) => {
    pendingCountRef.current = nextPending;
    const badge = pendingBadgeRef.current;
    if (!badge) return;
    if (nextPending > 0) {
      badge.textContent = `+${nextPending}`;
      badge.style.display = 'inline-flex';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  }, []);

  const incrementSavedPhotoCounterDom = useCallback(() => {
    savedPhotoCountValueRef.current += 1;
    if (savedCountRef.current) {
      savedCountRef.current.textContent = String(savedPhotoCountValueRef.current);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    getAllPhotos()
      .then((list) => {
        if (isMountedRef.current) {
          savedPhotoCountValueRef.current = list.length;
          setSavedPhotoCount(list.length);
          if (savedCountRef.current) {
            savedCountRef.current.textContent = String(list.length);
          }
        }
      })
      .catch(() => {});
    return () => {
      isMountedRef.current = false;
      setCapturesInFlight(0);
    };
  }, []);

  useEffect(() => {
    saveCameraDiagnostics({
      lastCaptureMode: resolveCaptureMode(settings.captureMode),
    });
  }, [settings.captureMode]);

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

  const triggerShutterFeedback = useCallback(
    (playSound: boolean, showFlashBar: boolean = true) => {
      if (playSound) {
        playShutterSound();
      }
      if (
        typeof navigator !== 'undefined' &&
        typeof navigator.vibrate === 'function'
      ) {
        try {
          navigator.vibrate(28);
        } catch {
          // Ignore if blocked
        }
      }
      if (!showFlashBar) return;
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
    },
    []
  );

  const triggerZoomOverlay = useCallback(() => {
    if (zoomLabelRef.current) {
      zoomLabelRef.current.style.opacity = '1';
    }
    if (zoomFadeTimerRef.current !== null) {
      window.clearTimeout(zoomFadeTimerRef.current);
    }
    zoomFadeTimerRef.current = window.setTimeout(() => {
      if (zoomLabelRef.current) {
        zoomLabelRef.current.style.opacity = '0';
      }
      zoomFadeTimerRef.current = null;
    }, 2000);
  }, []);

  const hideFreezeOverlay = useCallback((token?: number) => {
    if (token !== undefined && token !== freezeTokenRef.current) {
      return;
    }
    if (freezeOverlayTimerRef.current !== null) {
      window.clearTimeout(freezeOverlayTimerRef.current);
      freezeOverlayTimerRef.current = null;
    }
    const fc = freezeOverlayCanvasRef.current;
    if (fc) {
      fc.style.opacity = '0';
    }
  }, []);

  const showFreezeOverlay = useCallback(
    (video: HTMLVideoElement): number => {
      const token = ++freezeTokenRef.current;
      const fc = freezeOverlayCanvasRef.current;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (fc && vw > 0 && vh > 0) {
        if (fc.width !== vw) fc.width = vw;
        if (fc.height !== vh) fc.height = vh;
        const ctx = fc.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, vw, vh);
          fc.style.opacity = '1';
        }
      }
      if (freezeOverlayTimerRef.current !== null) {
        window.clearTimeout(freezeOverlayTimerRef.current);
      }
      freezeOverlayTimerRef.current = window.setTimeout(() => {
        hideFreezeOverlay(token);
      }, FREEZE_OVERLAY_MAX_MS);
      return token;
    },
    [hideFreezeOverlay]
  );

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
      if (freezeOverlayTimerRef.current !== null) {
        window.clearTimeout(freezeOverlayTimerRef.current);
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
      if (idleStopTimerRef.current !== null) {
        window.clearTimeout(idleStopTimerRef.current);
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
      // Never scale the preview with CSS or apply filters to <video>
      if (videoRef.current && videoRef.current.style.transform) {
        videoRef.current.style.transform = '';
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
      const hw = hardwareZoomRangeRef.current;
      if (!hw || hw.max <= hw.min) {
        zoomValueRef.current = 1;
        syncZoomToDom(1, true);
        return;
      }
      const rounded = clampHardwareZoom(next, hw);
      if (Math.abs(rounded - zoomValueRef.current) >= 0.05) {
        lastZoomChangedAtRef.current = Date.now();
      }
      zoomValueRef.current = rounded;
      syncZoomToDom(rounded, syncPreset);
      if (showOverlay) {
        triggerZoomOverlay();
      }

      const track = videoTrackRef.current;
      constraintStateRef.current = {
        ...constraintStateRef.current,
        zoom: rounded,
      };
      pendingHwZoomRef.current = rounded;
      if (track && zoomRafRef.current === null) {
        zoomRafRef.current = requestAnimationFrame(() => {
          zoomRafRef.current = null;
          if (pendingHwZoomRef.current !== null && videoTrackRef.current) {
            void syncUnifiedTrackConstraints({ showMismatchOnce: false });
          }
        });
      }
    },
    [syncZoomToDom, triggerZoomOverlay, syncUnifiedTrackConstraints]
  );

  useEffect(() => {
    if (!settings.zoomControls) {
      applyZoom(1, false, true);
      if (zoomLabelRef.current) {
        zoomLabelRef.current.style.opacity = '0';
      }
    }
  }, [settings.zoomControls, applyZoom]);

  const clearIdleStopTimer = useCallback(() => {
    if (idleStopTimerRef.current !== null) {
      window.clearTimeout(idleStopTimerRef.current);
      idleStopTimerRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
    clearIdleStopTimer();
    markCameraSessionStopped();
    if (postPlayTimerRef.current !== null) {
      window.clearTimeout(postPlayTimerRef.current);
      postPlayTimerRef.current = null;
    }
    postPlayReadyRef.current = false;

    constraintStateRef.current = {
      ...constraintStateRef.current,
      torch: false,
    };
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
  }, [clearIdleStopTimer]);

  const scheduleIdleStopTimer = useCallback(() => {
    clearIdleStopTimer();
    const timeoutSec = effectiveIdleTimeoutSecRef.current;
    if (
      !isMountedRef.current ||
      cameraStateRef.current !== 'active' ||
      timeoutSec <= 0 ||
      document.visibilityState !== 'visible'
    ) {
      return;
    }
    idleStopTimerRef.current = window.setTimeout(() => {
      idleStopTimerRef.current = null;
      if (!isMountedRef.current || cameraStateRef.current !== 'active') {
        return;
      }
      if (pendingCountRef.current > 0 || inFlightHardwareCaptureRef.current) {
        scheduleIdleStopTimer();
        return;
      }
      pausedByVisibilityRef.current = false;
      startRunIdRef.current++;
      stopCamera();
      setCameraState('idle');
    }, timeoutSec * 1000);
  }, [clearIdleStopTimer, stopCamera]);

  const recordUserActivity = useCallback(() => {
    notifyCameraActivity();
    if (cameraStateRef.current === 'active') {
      scheduleIdleStopTimer();
    }
  }, [scheduleIdleStopTimer]);

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
      c.width = 32;
      c.height = 24;
      meterCanvasRef.current = c;
    }
    const ctx = meterCanvasRef.current.getContext('2d', {
      willReadFrequently: true,
    });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 32, 24);
    const pixels = ctx.getImageData(0, 0, 32, 24).data;
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
    async (options?: {
      silentBackground?: boolean;
      overrideResolution?: '720p' | '1080p';
      lockedDeviceId?: string | null;
    }) => {
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

      if (document.visibilityState === 'hidden') {
        pausedByVisibilityRef.current = true;
        stopCamera();
        return;
      }

      if (!silent) {
        setCameraState('starting');
        previewDowngradedRef.current = false;
        adaptivePreviewStateRef.current = createAdaptivePreviewState();
        setPreviewDowngradedNotice(false);
      }
      torchMismatchNoticeShownRef.current = false;
      setFlashUnavailableNotice(false);
      stopCamera();

      const resolvedPreviewRes =
        options?.overrideResolution ||
        (previewDowngradedRef.current
          ? '720p'
          : resolvePreviewResolutionSetting(
              settings.previewResolution,
              settings.cameraHighQuality
            ));
      const requestedFps = effectiveFrameRateRef.current;
      const targetDims = getTargetPreviewDims(resolvedPreviewRes, requestedFps);
      saveCameraDiagnostics({
        requestedPreviewWidth: targetDims.width,
        requestedPreviewHeight: targetDims.height,
        requestedFrameRate: targetDims.frameRate,
        previewDowngraded: previewDowngradedRef.current,
      });

      const diagBefore = readCameraDiagnostics();
      const manualDeviceId =
        options?.lockedDeviceId?.trim() ||
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
            previewResolution: resolvedPreviewRes,
            frameRate: requestedFps,
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
            previewResolution: resolvedPreviewRes,
            frameRate: requestedFps,
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
                    previewResolution: resolvedPreviewRes,
                    frameRate: requestedFps,
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
                    previewResolution: resolvedPreviewRes,
                    frameRate: requestedFps,
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

        const isDocHiddenNow = () =>
          typeof document !== 'undefined' &&
          document.visibilityState === 'hidden';

        if (isStale() || isDocHiddenNow()) {
          pausedByVisibilityRef.current = isDocHiddenNow();
          stopStreamTracks(activeStream);
          return;
        }

        const activeTrackTorch = await inspectTrackCapabilities(track);
        if (isStale() || isDocHiddenNow()) {
          pausedByVisibilityRef.current = isDocHiddenNow();
          stopStreamTracks(activeStream);
          return;
        }
        if (!activeTrackTorch && finalNoTorchFound) {
          noTorchAvailableRef.current = true;
          setNoTorchAvailable(true);
        } else if (activeTrackTorch) {
          noTorchAvailableRef.current = false;
          setNoTorchAvailable(false);
        }

        setCameraState('active');
        cameraStateRef.current = 'active';
        markCameraSessionStarted();
        notifyCameraActivity();
        scheduleIdleStopTimer();

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
      scheduleIdleStopTimer,
      showNoTorchNoticeOnce,
      settings.cameraHighQuality,
      settings.previewResolution,
      settings.selectedCameraDeviceId,
    ]
  );

  useEffect(() => {
    startCamera({ silentBackground: false });

    const restoreOnTabReturn = async () => {
      if (!isMountedRef.current) return;
      if (cameraStateRef.current === 'idle' && !pausedByVisibilityRef.current) {
        return;
      }
      const track = videoTrackRef.current;
      if (!track || track.readyState !== 'live') {
        pausedByVisibilityRef.current = false;
        void startCamera({
          silentBackground: false,
          lockedDeviceId: activeDeviceIdRef.current,
        });
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
        scheduleIdleStopTimer();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (
          cameraStateRef.current === 'active' ||
          cameraStateRef.current === 'starting'
        ) {
          pausedByVisibilityRef.current = true;
        }
        startRunIdRef.current++;
        stopCamera();
      } else if (document.visibilityState === 'visible') {
        if (pausedByVisibilityRef.current) {
          pausedByVisibilityRef.current = false;
          void startCamera({
            silentBackground: false,
            lockedDeviceId: activeDeviceIdRef.current,
          });
        } else if (cameraStateRef.current === 'active') {
          void restoreOnTabReturn();
        }
      }
    };

    const handleFocus = () => {
      if (document.visibilityState === 'visible') {
        if (pausedByVisibilityRef.current) {
          pausedByVisibilityRef.current = false;
          void startCamera({
            silentBackground: false,
            lockedDeviceId: activeDeviceIdRef.current,
          });
        } else if (cameraStateRef.current === 'active') {
          void restoreOnTabReturn();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);

    let permStatus: PermissionStatus | null = null;
    const handlePermChange = () => {
      if (permStatus?.state === 'granted' && cameraStateRef.current !== 'idle') {
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
    scheduleIdleStopTimer,
  ]);

  // Keep idle-stop timer synchronized with active state & configured/effective timeout
  useEffect(() => {
    if (cameraState === 'active' && effectiveIdleTimeoutSec > 0) {
      scheduleIdleStopTimer();
    } else {
      clearIdleStopTimer();
    }
    return () => {
      clearIdleStopTimer();
    };
  }, [
    cameraState,
    effectiveIdleTimeoutSec,
    scheduleIdleStopTimer,
    clearIdleStopTimer,
  ]);

  // Apply updated frame rate constraint smoothly without restarting the camera when FPS setting / Battery Saver toggles
  useEffect(() => {
    if (cameraState !== 'active') return;
    saveCameraDiagnostics({ requestedFrameRate: effectiveFrameRate });
    const track = videoTrackRef.current;
    if (!track || track.readyState !== 'live' || typeof track.applyConstraints !== 'function') {
      return;
    }
    track
      .applyConstraints({
        frameRate: { ideal: effectiveFrameRate, max: effectiveFrameRate },
      })
      .catch(() =>
        track
          .applyConstraints({ frameRate: { ideal: effectiveFrameRate } })
          .catch(() => {})
      );
  }, [cameraState, effectiveFrameRate]);

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

  // Adaptive preview FPS monitor (auto mode): downgrades 1080p -> 720p on same deviceId if FPS < 20 for 3s while idle
  useEffect(() => {
    const mode = resolvePreviewResolutionSetting(
      settings.previewResolution,
      settings.cameraHighQuality
    );
    if (cameraState !== 'active' || mode !== 'auto' || previewDowngradedRef.current) {
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let rvfcId: number | null = null;
    const frameTimes: number[] = [];
    const rVfc = (
      video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: (now: number) => void) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      }
    ).requestVideoFrameCallback;

    if (typeof rVfc === 'function') {
      const onFrame = (now: number) => {
        if (cancelled) return;
        if (document.visibilityState === 'visible') {
          frameTimes.push(now);
          while (frameTimes.length > 0 && now - frameTimes[0] > 1500) {
            frameTimes.shift();
          }
          if (frameTimes.length >= 2) {
            const spanMs = frameTimes[frameTimes.length - 1] - frameTimes[0];
            if (spanMs > 300) {
              measuredFpsRef.current = ((frameTimes.length - 1) * 1000) / spanMs;
            }
          }
        }
        rvfcId = rVfc.call(video, onFrame);
      };
      rvfcId = rVfc.call(video, onFrame);
    }

    const triggerAdaptiveDowngrade = async () => {
      if (
        cancelled ||
        previewDowngradedRef.current ||
        pendingCountRef.current > 0 ||
        inFlightHardwareCaptureRef.current
      ) {
        return;
      }
      const track = videoTrackRef.current;
      const keepDeviceId = activeDeviceIdRef.current;
      const targetFps = effectiveFrameRateRef.current;
      previewDowngradedRef.current = true;
      setPreviewDowngradedNotice(true);
      saveCameraDiagnostics({
        previewDowngraded: true,
        requestedPreviewWidth: 1280,
        requestedPreviewHeight: 720,
        requestedFrameRate: targetFps,
      });

      if (track && track.readyState === 'live') {
        try {
          await track.applyConstraints({
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: targetFps, max: targetFps },
          });
          await new Promise<void>((r) => window.setTimeout(r, 350));
          if (cancelled || pendingCountRef.current > 0 || inFlightHardwareCaptureRef.current) {
            return;
          }
          if (video.videoWidth > 0 && video.videoWidth <= 1280) {
            saveCameraDiagnostics({
              previewWidth: video.videoWidth,
              previewHeight: video.videoHeight,
            });
            return;
          }
        } catch {
          // Fallback to same-device stream restart below
        }
      }

      if (
        !cancelled &&
        pendingCountRef.current === 0 &&
        !inFlightHardwareCaptureRef.current
      ) {
        void startCamera({
          silentBackground: true,
          overrideResolution: '720p',
          lockedDeviceId: keepDeviceId,
        });
      }
    };

    const intervalId = window.setInterval(() => {
      if (cancelled || document.visibilityState !== 'visible') {
        adaptivePreviewStateRef.current = createAdaptivePreviewState();
        frameTimes.length = 0;
        measuredFpsRef.current = null;
        return;
      }
      const step = stepAdaptivePreviewState(adaptivePreviewStateRef.current, {
        mode,
        targetFps: effectiveFrameRate,
        currentFps: measuredFpsRef.current,
        nowMs: performance.now(),
        isCapturing:
          pendingCountRef.current > 0 || inFlightHardwareCaptureRef.current,
      });
      adaptivePreviewStateRef.current = step.nextState;
      if (step.shouldDowngrade) {
        void triggerAdaptiveDowngrade();
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      const cancelRvfc = (
        video as HTMLVideoElement & {
          cancelVideoFrameCallback?: (id: number) => void;
        }
      ).cancelVideoFrameCallback;
      if (rvfcId !== null && typeof cancelRvfc === 'function') {
        try {
          cancelRvfc.call(video, rvfcId);
        } catch {
          // Ignore
        }
      }
    };
  }, [
    cameraState,
    settings.previewResolution,
    settings.cameraHighQuality,
    effectiveFrameRate,
    startCamera,
  ]);

  // Smart Auto Flash: samples brightness at most 2x/sec (500ms) on 32x24 canvas; paused when manual or page hidden
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
      if (
        document.hidden ||
        document.visibilityState === 'hidden' ||
        flashModeRef.current !== 'auto' ||
        inFlightHardwareCaptureRef.current ||
        !postPlayReadyRef.current
      ) {
        return;
      }
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

  const shouldEnhanceCaptureMethod = useCallback(
    (captureMethod?: CameraCaptureMethod) => {
      const level = resolveEnhanceLevel(settings.photoEnhanceLevel);
      if (!level) return null;
      if (captureMethod === 'gallery' && !settings.enhanceGalleryImports) {
        return null;
      }
      return level;
    },
    [settings.photoEnhanceLevel, settings.enhanceGalleryImports]
  );

  const commitPhotoToDB = useCallback(
    async (
      shot: {
        dataUrl: string;
        thumbnailDataUrl?: string;
        width: number;
        height: number;
        byteLength?: number;
      },
      photoMeta?: {
        id: string;
        sessionId: string;
        timestamp: number;
        dateKey: string;
        enhancementStatus?: 'pending';
      },
      captureMethod?: CameraCaptureMethod,
      timings?: { captureMs?: number; processingMs?: number; captureMode?: 'high-quality' | 'fast' }
    ) => {
      const enhanceLevel = shouldEnhanceCaptureMethod(captureMethod);
      const effectiveMeta = photoMeta
        ? {
            ...photoMeta,
            ...(enhanceLevel ? { enhancementStatus: 'pending' as const } : {}),
          }
        : enhanceLevel
        ? {
            id: `ph_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            sessionId,
            timestamp: Date.now(),
            dateKey: getLocalDateKey(Date.now()),
            enhancementStatus: 'pending' as const,
          }
        : undefined;

      const saved = enqueueCapturedShotToBatchLog({
        shot,
        photoMeta: effectiveMeta,
        sessionId,
        onEnqueued: (record) => {
          const byteSize =
            shot.byteLength ?? estimateDataUrlBytes(record.dataUrl);
          saveCameraDiagnostics({
            ...(timings?.captureMode ? { lastCaptureMode: timings.captureMode } : {}),
            lastCaptureTimestamp: record.timestamp,
            ...(typeof timings?.captureMs === 'number'
              ? { lastCaptureMs: timings.captureMs }
              : {}),
            ...(typeof timings?.processingMs === 'number'
              ? { lastProcessingMs: timings.processingMs }
              : {}),
            ...(record.width > 0 && record.height > 0
              ? {
                  lastSavedPhotoWidth: record.width,
                  lastSavedPhotoHeight: record.height,
                }
              : {}),
            ...(byteSize > 0 ? { lastSavedPhotoBytes: byteSize } : {}),
            ...(captureMethod ? { lastSavedPhotoMethod: captureMethod } : {}),
          });
          if (isMountedRef.current) {
            incrementSavedPhotoCounterDom();
            onPhotoQueued();
          }
        },
        onFlushed: (_record, savingMs) => {
          saveCameraDiagnostics({ lastSavingMs: savingMs });
        },
      });

      if (enhanceLevel) {
        enqueuePhotoEnhancement({
          photoId: saved.id,
          sourceDataUrl: shot.dataUrl,
          level: enhanceLevel,
          keepOriginal: Boolean(settings.keepOriginalPhoto),
        });
      }
    },
    [
      incrementSavedPhotoCounterDom,
      onPhotoQueued,
      sessionId,
      settings.keepOriginalPhoto,
      shouldEnhanceCaptureMethod,
    ]
  );

  const finalizeProcessedShot = useCallback(
    async (processed: {
      dataUrl: string;
      thumbnailDataUrl?: string;
      width: number;
      height: number;
      byteLength?: number;
      processingMs?: number;
      savingMs?: number;
      savedInWorker?: boolean;
      photoId?: string;
      photoTimestamp?: number;
      isBlurry: boolean;
      variance: number;
      captureMethod?: CameraCaptureMethod;
      captureMs?: number;
      captureMode?: 'high-quality' | 'fast';
    }) => {
      if (processed.savedInWorker) {
        saveCameraDiagnostics({
          ...(processed.captureMode
            ? { lastCaptureMode: processed.captureMode }
            : {}),
          lastCaptureTimestamp: processed.photoTimestamp ?? Date.now(),
          ...(typeof processed.captureMs === 'number'
            ? { lastCaptureMs: processed.captureMs }
            : {}),
          ...(typeof processed.processingMs === 'number'
            ? { lastProcessingMs: processed.processingMs }
            : {}),
          ...(typeof processed.savingMs === 'number'
            ? { lastSavingMs: processed.savingMs }
            : {}),
          ...(processed.width > 0 && processed.height > 0
            ? {
                lastSavedPhotoWidth: processed.width,
                lastSavedPhotoHeight: processed.height,
              }
            : {}),
          ...(typeof processed.byteLength === 'number' &&
          processed.byteLength > 0
            ? { lastSavedPhotoBytes: processed.byteLength }
            : {}),
          ...(processed.captureMethod
            ? { lastSavedPhotoMethod: processed.captureMethod }
            : {}),
        });
        if (isMountedRef.current) {
          incrementSavedPhotoCounterDom();
          onPhotoQueued();
        }
        const enhanceLevel = shouldEnhanceCaptureMethod(processed.captureMethod);
        if (enhanceLevel && processed.photoId) {
          enqueuePhotoEnhancement({
            photoId: processed.photoId,
            level: enhanceLevel,
            keepOriginal: Boolean(settings.keepOriginalPhoto),
          });
        }
        return;
      }

      if (settings.continuousMode !== false) {
        await commitPhotoToDB(
          {
            dataUrl: processed.dataUrl,
            thumbnailDataUrl: processed.thumbnailDataUrl,
            width: processed.width,
            height: processed.height,
            byteLength: processed.byteLength,
          },
          processed.photoId
            ? {
                id: processed.photoId,
                sessionId,
                timestamp: processed.photoTimestamp ?? Date.now(),
                dateKey: getLocalDateKey(processed.photoTimestamp ?? Date.now()),
              }
            : undefined,
          processed.captureMethod,
          {
            captureMs: processed.captureMs,
            processingMs: processed.processingMs,
            captureMode: processed.captureMode,
          }
        );
        return;
      }

      if (isMountedRef.current) {
        setReviewShot({
          dataUrl: processed.dataUrl,
          thumbnailDataUrl: processed.thumbnailDataUrl,
          width: processed.width,
          height: processed.height,
          byteLength: processed.byteLength,
          isBlurry: processed.isBlurry,
          variance: processed.variance,
          captureMethod: processed.captureMethod,
          captureMs: processed.captureMs,
          processingMs: processed.processingMs,
        });
      } else if (!processed.isBlurry) {
        await commitPhotoToDB(
          {
            dataUrl: processed.dataUrl,
            thumbnailDataUrl: processed.thumbnailDataUrl,
            width: processed.width,
            height: processed.height,
            byteLength: processed.byteLength,
          },
          undefined,
          processed.captureMethod,
          {
            captureMs: processed.captureMs,
            processingMs: processed.processingMs,
            captureMode: processed.captureMode,
          }
        );
      }
    },
    [
      commitPhotoToDB,
      incrementSavedPhotoCounterDom,
      onPhotoQueued,
      sessionId,
      settings.continuousMode,
      settings.keepOriginalPhoto,
      shouldEnhanceCaptureMethod,
    ]
  );

  const handleCapture = () => {
    if (pendingCountRef.current >= MAX_CAPTURE_QUEUE_PENDING) return;
    warmAudioContext();

    if (cameraState !== 'active' || !videoRef.current) {
      return;
    }

    const video = videoRef.current;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) {
      return;
    }

    const previewW = video.clientWidth || vw;
    const previewH = video.clientHeight || vh;
    const activeCaptureMode = resolveCaptureMode(settings.captureMode);
    const skipBlurReview = settings.continuousMode !== false;
    const blurThreshold = skipBlurReview ? 0 : DEFAULT_BLUR_THRESHOLD;
    const capturedSessionId = sessionId;
    const pressTimestamp = Date.now();

    // Pause background workers/storage for 1.5s after each shutter press while camera is open
    notifyShutterPressed(pressTimestamp);
    recordUserActivity();

    // 1) Freeze-frame overlay + white flash ONLY in 'high-quality' mode; 'fast' mode captures without any freeze
    const freezeToken =
      activeCaptureMode === 'high-quality'
        ? showFreezeOverlay(video)
        : freezeTokenRef.current;
    triggerShutterFeedback(
      settings.shutterSound,
      activeCaptureMode === 'high-quality'
    );

    // 2) Grab instant fallback ImageBitmap from current video frame before any async wait
    const instantVideoBitmapPromise: Promise<ImageBitmap | undefined> =
      typeof createImageBitmap === 'function'
        ? createImageBitmap(video).catch(() => undefined)
        : Promise.resolve(undefined);

    const drawFullResVideoCanvas = (): HTMLCanvasElement | null => {
      if (!video || !video.videoWidth || !video.videoHeight) return null;
      const w = video.videoWidth;
      const h = video.videoHeight;
      const rot = getVideoCaptureRotationDeg(w, h, previewW, previewH);
      const quarterTurn = rot === 90 || rot === 270;
      const outW = Math.round(quarterTurn ? h : w);
      const outH = Math.round(quarterTurn ? w : h);

      const c = document.createElement('canvas');
      c.width = outW;
      c.height = outH;
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      drawCroppedRotatedToCanvas(ctx, video, 0, 0, w, h, outW, outH, rot);
      return c;
    };

    // 3) Enqueue immediately (up to 5 pending) with direct DOM badge update (zero React re-render on shutter)
    syncPendingBadgeDom(pendingCountRef.current + 1);
    incrementSessionCaptureCount();

    const runQueuedJob = async () => {
      let instantBitmap: ImageBitmap | undefined;
      let captureStageMarked = false;
      try {
        const captureStart = performance.now();
        setCapturesInFlight(1);
        captureStageMarked = true;

        // Only wait if zoom just changed within the last 300ms
        const settleWaitMs = computeFocusSettleWaitMs(
          lastZoomChangedAtRef.current,
          Date.now()
        );
        if (settleWaitMs > 0) {
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, settleWaitMs)
          );
        }

        let takePhotoBlob: Blob | null = null;
        if (activeCaptureMode === 'high-quality' && videoTrackRef.current) {
          const WinImageCapture = (
            window as unknown as {
              ImageCapture?: new (track: MediaStreamTrack) => {
                takePhoto?: (settings?: Record<string, unknown>) => Promise<Blob>;
              };
            }
          ).ImageCapture;

          if (typeof WinImageCapture === 'function') {
            inFlightHardwareCaptureRef.current = true;
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
                const takePhotoDeadline =
                  performance.now() + CAMERA_TAKE_PHOTO_TIMEOUT_MS;
                const tryTakePhoto = (opts?: Record<string, unknown>) => {
                  const remainingMs = Math.round(
                    takePhotoDeadline - performance.now()
                  );
                  if (remainingMs <= 20) {
                    return Promise.resolve(null);
                  }
                  return Promise.race([
                    opts ? ic.takePhoto!(opts) : ic.takePhoto!(),
                    new Promise<null>((resolve) =>
                      window.setTimeout(() => resolve(null), remainingMs)
                    ),
                  ]);
                };

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
                  if (
                    torchWasRequestedOn &&
                    videoTrackRef.current &&
                    videoTrackRef.current.readyState === 'live'
                  ) {
                    constraintStateRef.current = {
                      ...constraintStateRef.current,
                      torch: true,
                    };
                    await syncUnifiedTrackConstraints({
                      showMismatchOnce: false,
                    });
                  }
                }
              }
            } catch {
              takePhotoBlob = null;
            } finally {
              inFlightHardwareCaptureRef.current = false;
            }
          }
        }

        instantBitmap = await instantVideoBitmapPromise;

        let capturedBitmap: ImageBitmap | undefined;
        let fallbackCanvasData: HTMLCanvasElement | null = null;
        let captureMethod: 'takePhoto' | 'videoFrame' = 'videoFrame';

        if (takePhotoBlob && typeof createImageBitmap === 'function') {
          try {
            capturedBitmap = await createImageBitmap(takePhotoBlob, {
              imageOrientation: 'from-image',
            });
            captureMethod = 'takePhoto';
            if (instantBitmap) {
              try {
                instantBitmap.close();
              } catch {
                // Ignore
              }
              instantBitmap = undefined;
            }
          } catch {
            capturedBitmap = undefined;
          }
        }

        if (!capturedBitmap) {
          if (instantBitmap) {
            capturedBitmap = instantBitmap;
            instantBitmap = undefined;
            captureMethod = 'videoFrame';
          } else if (
            videoRef.current &&
            videoRef.current.videoWidth > 0 &&
            typeof createImageBitmap === 'function'
          ) {
            try {
              capturedBitmap = await createImageBitmap(videoRef.current);
              captureMethod = 'videoFrame';
            } catch {
              capturedBitmap = undefined;
            }
          }
        }

        if (!capturedBitmap) {
          fallbackCanvasData = drawFullResVideoCanvas();
          captureMethod = 'videoFrame';
        }

        const captureMs = Math.max(
          1,
          Math.round(performance.now() - captureStart)
        );
        setCapturesInFlight(0);
        captureStageMarked = false;

        // Remove freeze-frame overlay immediately once the photo is captured
        if (activeCaptureMode === 'high-quality') {
          hideFreezeOverlay(freezeToken);
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

        const shouldEnhanceThisShot = Boolean(
          shouldEnhanceCaptureMethod(captureMethod)
        );
        const photoMeta = {
          id: `ph_${pressTimestamp}_${Math.random().toString(36).slice(2, 7)}`,
          sessionId: capturedSessionId,
          timestamp: pressTimestamp,
          dateKey: getLocalDateKey(pressTimestamp),
          ...(shouldEnhanceThisShot ? { enhancementStatus: 'pending' as const } : {}),
        };

        if (capturedBitmap) {
          try {
            const processed = await processCaptureOffThread({
              bitmap: capturedBitmap,
              digitalScale: 1,
              rotationDeg,
              maxDim: MAX_SAVED_PHOTO_LONG_SIDE,
              quality: SAVED_PHOTO_JPEG_QUALITY,
              thumbnailMaxDim: THUMBNAIL_MAX_LONG_SIDE,
              thumbnailQuality: THUMBNAIL_JPEG_QUALITY,
              blurThreshold,
              saveToDb: false,
              waitForIdleSlot: skipBlurReview,
              photoMeta,
              fallbackCanvas: drawFullResVideoCanvas,
              fallbackBlurCheck:
                blurThreshold > 0
                  ? (c) => checkImageBlurFromCanvas(c, blurThreshold)
                  : undefined,
            });
            await finalizeProcessedShot({
              ...processed,
              photoTimestamp: pressTimestamp,
              captureMethod,
              captureMs,
              captureMode: activeCaptureMode,
            });
          } catch {
            const fallbackC = drawFullResVideoCanvas();
            if (!fallbackC) return;
            const procStart = performance.now();
            const compressed = compressCanvasToJpeg(
              fallbackC,
              MAX_SAVED_PHOTO_LONG_SIDE,
              SAVED_PHOTO_JPEG_QUALITY
            );
            const blur =
              blurThreshold > 0
                ? checkImageBlurFromCanvas(fallbackC, blurThreshold)
                : { variance: 100, isBlurry: false };
            const processingMs = Math.max(
              1,
              Math.round(performance.now() - procStart)
            );
            await finalizeProcessedShot({
              ...compressed,
              photoId: photoMeta.id,
              photoTimestamp: pressTimestamp,
              processingMs,
              isBlurry: blur.isBlurry,
              variance: blur.variance,
              captureMethod: 'videoFrame',
              captureMs,
              captureMode: activeCaptureMode,
            });
          }
        } else if (fallbackCanvasData) {
          const procStart = performance.now();
          const compressed = compressCanvasToJpeg(
            fallbackCanvasData,
            MAX_SAVED_PHOTO_LONG_SIDE,
            SAVED_PHOTO_JPEG_QUALITY
          );
          const blur =
            blurThreshold > 0
              ? checkImageBlurFromCanvas(fallbackCanvasData, blurThreshold)
              : { variance: 100, isBlurry: false };
          const processingMs = Math.max(
            1,
            Math.round(performance.now() - procStart)
          );
          await finalizeProcessedShot({
            ...compressed,
            photoId: photoMeta.id,
            photoTimestamp: pressTimestamp,
            processingMs,
            isBlurry: blur.isBlurry,
            variance: blur.variance,
            captureMethod: 'videoFrame',
            captureMs,
            captureMode: activeCaptureMode,
          });
        }
      } catch {
        if (activeCaptureMode === 'high-quality') {
          hideFreezeOverlay(freezeToken);
        }
        if (instantBitmap) {
          try {
            instantBitmap.close();
          } catch {
            // Ignore
          }
        }
      } finally {
        if (captureStageMarked) {
          setCapturesInFlight(0);
        }
        syncPendingBadgeDom(Math.max(0, pendingCountRef.current - 1));
      }
    };

    const nextInChain = captureQueueChainRef.current.then(
      runQueuedJob,
      runQueuedJob
    );
    captureQueueChainRef.current = nextInChain;
  };

  const handleFilePicked = async (
    e: React.ChangeEvent<HTMLInputElement>,
    sourceMethod: 'gallery' | 'nativeCamera' = 'gallery'
  ) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;

    const skipBlurReview = settings.continuousMode !== false;
    const blurThreshold = skipBlurReview ? 0 : DEFAULT_BLUR_THRESHOLD;
    const activeCaptureMode = resolveCaptureMode(settings.captureMode);

    const shouldEnhanceImport = Boolean(
      shouldEnhanceCaptureMethod(sourceMethod)
    );

    if (files.length === 1) {
      const ts = Date.now();
      const photoMeta = {
        id: `ph_${ts}_${Math.random().toString(36).slice(2, 7)}`,
        sessionId,
        timestamp: ts,
        dateKey: getLocalDateKey(ts),
        ...(shouldEnhanceImport ? { enhancementStatus: 'pending' as const } : {}),
      };
      try {
        const processed = await processCaptureOffThread({
          blob: files[0],
          maxDim: MAX_SAVED_PHOTO_LONG_SIDE,
          quality: SAVED_PHOTO_JPEG_QUALITY,
          thumbnailMaxDim: THUMBNAIL_MAX_LONG_SIDE,
          thumbnailQuality: THUMBNAIL_JPEG_QUALITY,
          blurThreshold,
          saveToDb: skipBlurReview,
          photoMeta,
          fallbackBlurCheck:
            blurThreshold > 0
              ? (c) => checkImageBlurFromCanvas(c, blurThreshold)
              : undefined,
        });
        await finalizeProcessedShot({
          ...processed,
          photoTimestamp: ts,
          captureMethod: sourceMethod,
          captureMs: 0,
          captureMode: activeCaptureMode,
        });
      } catch {
        const procStart = performance.now();
        const canvas = await fileOrDataUrlToCanvas(
          files[0],
          MAX_SAVED_PHOTO_LONG_SIDE
        );
        const compressed = compressCanvasToJpeg(
          canvas,
          MAX_SAVED_PHOTO_LONG_SIDE,
          SAVED_PHOTO_JPEG_QUALITY
        );
        const blur =
          blurThreshold > 0
            ? checkImageBlurFromCanvas(canvas, blurThreshold)
            : { variance: 100, isBlurry: false };
        const processingMs = Math.max(
          1,
          Math.round(performance.now() - procStart)
        );
        await finalizeProcessedShot({
          ...compressed,
          photoId: photoMeta.id,
          photoTimestamp: ts,
          processingMs,
          isBlurry: blur.isBlurry,
          variance: blur.variance,
          captureMethod: sourceMethod,
          captureMs: 0,
          captureMode: activeCaptureMode,
        });
      }
    } else {
      for (const file of files) {
        const ts = Date.now();
        const photoMeta = {
          id: `ph_${ts}_${Math.random().toString(36).slice(2, 7)}`,
          sessionId,
          timestamp: ts,
          dateKey: getLocalDateKey(ts),
          ...(shouldEnhanceImport
            ? { enhancementStatus: 'pending' as const }
            : {}),
        };
        try {
          const processed = await processCaptureOffThread({
            blob: file,
            maxDim: MAX_SAVED_PHOTO_LONG_SIDE,
            quality: SAVED_PHOTO_JPEG_QUALITY,
            thumbnailMaxDim: THUMBNAIL_MAX_LONG_SIDE,
            thumbnailQuality: THUMBNAIL_JPEG_QUALITY,
            blurThreshold: 0,
            saveToDb: true,
            photoMeta,
          });
          await finalizeProcessedShot({
            ...processed,
            photoTimestamp: ts,
            captureMethod: sourceMethod,
            captureMs: 0,
            captureMode: activeCaptureMode,
          });
        } catch {
          const procStart = performance.now();
          const canvas = await fileOrDataUrlToCanvas(
            file,
            MAX_SAVED_PHOTO_LONG_SIDE
          );
          const compressed = compressCanvasToJpeg(
            canvas,
            MAX_SAVED_PHOTO_LONG_SIDE,
            SAVED_PHOTO_JPEG_QUALITY
          );
          const processingMs = Math.max(
            1,
            Math.round(performance.now() - procStart)
          );
          await commitPhotoToDB(
            {
              dataUrl: compressed.dataUrl,
              thumbnailDataUrl: compressed.thumbnailDataUrl,
              width: compressed.width,
              height: compressed.height,
              byteLength: compressed.byteLength,
            },
            photoMeta,
            sourceMethod,
            {
              captureMs: 0,
              processingMs,
              captureMode: activeCaptureMode,
            }
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
        thumbnailDataUrl: shot.thumbnailDataUrl,
        width: shot.width,
        height: shot.height,
        byteLength: shot.byteLength,
      },
      undefined,
      shot.captureMethod,
      {
        captureMs: shot.captureMs,
        processingMs: shot.processingMs,
        captureMode: resolveCaptureMode(settings.captureMode),
      }
    );
  };

  const availableZoomPresets = resolveAvailableZoomPresets(hardwareZoomRange);
  const hasHardwareZoom = availableZoomPresets.length >= 2;

  const handleCycleZoomPreset = () => {
    if (!hasHardwareZoom) return;
    const cur = zoomValueRef.current;
    const curIdx = availableZoomPresets.findIndex(
      (p) => Math.abs(cur - p) < 0.25
    );
    const next =
      availableZoomPresets[(curIdx + 1) % availableZoomPresets.length];
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

  // Pinch-to-zoom touch handlers updating hardware zoom constraint only (no CSS scaling)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (!settings.zoomControls || !hasHardwareZoom || e.touches.length !== 2) {
      return;
    }
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    pinchStartDistRef.current = Math.hypot(dx, dy);
    pinchStartZoomRef.current = zoomValueRef.current;
    triggerZoomOverlay();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (
      !settings.zoomControls ||
      !hasHardwareZoom ||
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
      onPointerDown={() => {
        if (cameraStateRef.current === 'active') {
          recordUserActivity();
        }
      }}
      onTouchStart={(e) => {
        if (cameraStateRef.current === 'active') {
          recordUserActivity();
        }
        handleTouchStart(e);
      }}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Hidden gallery input (multi-select supported, no capture attribute) */}
      <input
        ref={galleryInputRef}
        data-testid="camera-gallery-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void handleFilePicked(e, 'gallery')}
        className="hidden"
      />

      {/* Hidden native phone camera input (accept=image/* capture=environment) */}
      <input
        ref={nativeCameraInputRef}
        data-testid="camera-native-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => void handleFilePicked(e, 'nativeCamera')}
        className="hidden"
      />

      {/* Live Video Stream (never CSS-scaled or filtered) */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`w-full h-full object-cover ${
          cameraState === 'active' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Instant Freeze-Frame Canvas Overlay covering the viewfinder on shutter press */}
      <canvas
        ref={freezeOverlayCanvasRef}
        data-testid="camera-freeze-overlay"
        style={{ opacity: 0 }}
        className="pointer-events-none absolute inset-0 w-full h-full object-cover z-20"
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
                اسمح باستخدام الكاميرا من إعدادات المتصفح أو التقط بكاميرا الهاتف.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => nativeCameraInputRef.current?.click()}
                className="min-h-[50px] w-full px-5 rounded-2xl bg-emerald-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
              >
                <Smartphone className="w-5 h-5" />
                <span>التقاط بكاميرا الهاتف الأصلية</span>
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="min-h-[48px] w-full px-5 rounded-2xl bg-slate-800 text-slate-100 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
              >
                <ImagePlus className="w-5 h-5" />
                <span>اختيار من المعرض</span>
              </button>
              <button
                type="button"
                onClick={() => startCamera({ silentBackground: false })}
                className="min-h-[48px] w-full px-4 rounded-2xl bg-slate-800/70 text-slate-300 font-bold text-sm flex items-center justify-center gap-2 active:scale-95 transition"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إعادة المحاولة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Starting Skeleton Viewfinder (NO CSS animations over camera viewport) */}
      {cameraState === 'starting' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950 px-6">
          <div className="w-full max-w-sm aspect-[3/4] rounded-[24px] bg-slate-900 border border-slate-800 flex flex-col items-center justify-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-emerald-400">
              <Camera className="w-7 h-7" />
            </div>
            <span className="text-sm font-bold text-slate-300">
              جاري تشغيل الكاميرا…
            </span>
          </div>
        </div>
      )}

      {/* Idle Battery-Saving Viewfinder State — full-viewfinder tap target resumes immediately */}
      {cameraState === 'idle' && (
        <button
          type="button"
          data-testid="camera-idle-resume-btn"
          onClick={() => {
            pausedByVisibilityRef.current = false;
            notifyCameraActivity();
            void startCamera({
              silentBackground: false,
              lockedDeviceId: activeDeviceIdRef.current,
            });
          }}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center px-6 bg-slate-950 text-center cursor-pointer"
        >
          <div className="w-full max-w-xs rounded-[24px] bg-slate-900 border border-slate-800 p-6 flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-emerald-400">
              <Camera className="w-7 h-7" />
            </div>
            <p className="text-sm font-extrabold text-slate-100 leading-relaxed">
              الكاميرا متوقفة لتوفير البطارية · المس الشاشة للتشغيل
            </p>
          </div>
        </button>
      )}

      {/* Active Camera Controls ONLY — NO backdrop-blur, CSS animations, filters, or large box-shadows */}
      {cameraState === 'active' && (
        <>
          {/* Photo Counter with direct-DOM Queue Pending Badge */}
          <div
            data-testid="camera-photo-counter"
            className="pointer-events-none absolute top-[max(12px,env(safe-area-inset-top,0px))] right-3.5 z-30 h-9 px-3 rounded-full bg-black/70 border border-white/15 text-white text-xs font-extrabold flex items-center gap-2"
          >
            <Camera className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span ref={savedCountRef} className="tabular-nums">
              {savedPhotoCount}
            </span>
            <span
              ref={pendingBadgeRef}
              data-testid="camera-pending-count"
              style={{ display: 'none' }}
              className="px-1.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold tabular-nums leading-none"
            />
          </div>

          {/* Top-left subtle chips: Battery Saver indicator + optional preview resolution notice */}
          {(isBatterySaverOn || previewDowngradedNotice) && (
            <div className="pointer-events-none absolute top-[max(12px,env(safe-area-inset-top,0px))] left-3.5 z-20 flex flex-col items-end gap-1.5">
              {isBatterySaverOn && (
                <div
                  data-testid="camera-battery-saver-chip"
                  className="h-8 px-2.5 rounded-full bg-amber-500/20 border border-amber-400/50 text-amber-200 text-[11px] font-extrabold flex items-center"
                >
                  توفير البطارية
                </div>
              )}
              {previewDowngradedNotice && (
                <div
                  data-testid="camera-preview-downgraded-note"
                  className="px-2.5 py-1.5 rounded-full bg-black/70 border border-white/15 text-slate-200 text-[10px] font-bold"
                >
                  خُفضت دقة المعاينة لتحسين السلاسة
                </div>
              )}
            </div>
          )}

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

          {/* Vertical Icon-Only Edge Toolbar (Right default, or Left from Settings; NO backdrop-blur / shadow) */}
          <div
            data-testid="camera-vertical-toolbar"
            data-side={toolbarOnLeft ? 'left' : 'right'}
            className={`absolute top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-2 p-1.5 rounded-full bg-black/65 border border-white/15 ${
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
                className={`relative w-11 h-11 rounded-full flex items-center justify-center ${
                  torchOn
                    ? 'bg-amber-400 text-slate-950'
                    : flashMode === 'off' || flashMode === 'on'
                    ? 'text-white/60'
                    : 'text-white'
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

            {/* 2) Hardware Zoom cycle ONLY when track supports zoom (no CSS preview scaling) */}
            {settings.zoomControls && hasHardwareZoom && (
              <div className="relative flex items-center justify-center">
                <button
                  type="button"
                  data-testid="camera-zoom-btn"
                  onClick={handleCycleZoomPreset}
                  className={`w-11 h-11 rounded-full flex items-center justify-center ${
                    activePresetZoom > 1
                      ? 'bg-emerald-500 text-white'
                      : 'text-white'
                  }`}
                  aria-label="التقريب"
                  title="التقريب (1x / 2x / 3x)"
                >
                  <ZoomIn className="w-5 h-5" />
                </button>

                <div
                  ref={zoomLabelRef}
                  dir="ltr"
                  style={{ opacity: 0 }}
                  className={`pointer-events-none absolute top-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-black/75 text-emerald-300 text-[11px] font-extrabold tabular-nums ${
                    toolbarOnLeft ? 'left-14' : 'right-14'
                  }`}
                >
                  1.0x
                </div>
              </div>
            )}

            {/* 3) More options (⋯) */}
            <button
              type="button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              className={`w-11 h-11 rounded-full flex items-center justify-center ${
                showMoreMenu ? 'bg-white/25 text-white' : 'text-white'
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
                className={`absolute top-1/2 -translate-y-1/2 z-30 w-56 rounded-2xl bg-slate-900/95 border border-white/15 p-1.5 flex flex-col gap-1 text-white text-xs font-bold ${
                  toolbarOnLeft ? 'left-16' : 'right-16'
                }`}
              >
                <button
                  type="button"
                  data-testid="camera-native-btn"
                  onClick={() => {
                    setShowMoreMenu(false);
                    nativeCameraInputRef.current?.click();
                  }}
                  className="w-full min-h-[42px] px-3 rounded-xl flex items-center gap-2.5 text-right"
                >
                  <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>التقاط بكاميرا الهاتف الأصلية</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMoreMenu(false);
                    galleryInputRef.current?.click();
                  }}
                  className="w-full min-h-[42px] px-3 rounded-xl flex items-center gap-2.5 text-right"
                >
                  <ImagePlus className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>اختيار من المعرض</span>
                </button>
              </div>
            </>
          )}

          {/* Bottom: ONLY the Big Green Capture Button (NO large shadow) */}
          <div className="pointer-events-none absolute bottom-0 inset-x-0 z-20 pb-6 flex justify-center">
            <button
              type="button"
              onClick={() => handleCapture()}
              aria-label="التقاط صورة للرف"
              className="pointer-events-auto w-[78px] h-[78px] rounded-full bg-white p-1.5 flex items-center justify-center"
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
