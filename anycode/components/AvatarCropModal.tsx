import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Icons } from './Icons';
import {
  prepareSourceImage,
  CHAT_AVATAR_SIZES,
  CHAT_AVATAR_SIZE_KEYS,
  type ChatAvatarSize,
} from '../hooks/useUserProfile';
import './AvatarCropModal.css';

export interface AvatarCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  currentAvatar: string | null;
  currentOriginal?: string | null;
  chatAvatarSize?: ChatAvatarSize;
  hideSizeSelector?: boolean;
  onSave: (
    croppedAvatarDataUrl: string | null,
    originalDataUrl: string | null,
    newSize?: ChatAvatarSize
  ) => void;
}

const VIEWPORT_SIZE = 280;
const CROP_DIAMETER = 240;
const CROP_RADIUS = CROP_DIAMETER / 2;
const CENTER = VIEWPORT_SIZE / 2;
const EXPORT_SIZE = 256;

export const normalizeImageUrl = (input: string): string => {
  let url = input.trim();
  if (!url) return '';
  if (url.startsWith('@')) {
    return `https://github.com/${url.slice(1)}.png`;
  }
  if (url.toLowerCase().startsWith('github:')) {
    return `https://github.com/${url.slice(7)}.png`;
  }
  if (!/^https?:\/\//i.test(url) && !url.startsWith('data:') && !url.startsWith('/')) {
    return `https://${url}`;
  }
  return url;
};

export const AvatarCropModal: React.FC<AvatarCropModalProps> = ({
  isOpen,
  onClose,
  title,
  currentAvatar,
  currentOriginal = null,
  chatAvatarSize = 'medium',
  hideSizeSelector = false,
  onSave,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<HTMLImageElement | null>(null);
  const [selectedSize, setSelectedSize] = useState<ChatAvatarSize>(chatAvatarSize);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;

  const [showUrlInput, setShowUrlInput] = useState(false);
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset state when opening popup
  useEffect(() => {
    if (!isOpen) return;
    const initialSrc = currentOriginal || currentAvatar || null;
    setImageSrc(initialSrc);
    setLoadedImage(null);
    setSelectedSize(chatAvatarSize);
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setRotation(0);
    setShowUrlInput(false);
    setAvatarUrlInput('');
    setUrlError(null);
    setIsDragOver(false);
    dragCounterRef.current = 0;
  }, [isOpen, currentAvatar, currentOriginal, chatAvatarSize]);

  // Load image when imageSrc changes
  useEffect(() => {
    if (!isOpen || !imageSrc) {
      setLoadedImage(null);
      return;
    }

    let isCancelled = false;
    const img = new Image();
    // Do NOT set crossOrigin for data: or blob: URIs
    if (!imageSrc.startsWith('data:') && !imageSrc.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }

    const onLoad = () => {
      if (isCancelled) return;
      setLoadedImage(img);
    };

    const onError = () => {
      if (isCancelled) return;
      // Retry without crossOrigin if CORS rejected anonymous request
      const fallback = new Image();
      fallback.onload = () => {
        if (isCancelled) return;
        setLoadedImage(fallback);
      };
      fallback.onerror = () => {
        if (isCancelled) return;
        setLoadedImage(null);
        setUrlError('Failed to load image');
      };
      fallback.src = imageSrc;
    };

    img.onload = onLoad;
    img.onerror = onError;
    img.src = imageSrc;

    if (img.complete && img.naturalWidth > 0) {
      setLoadedImage(img);
    }

    return () => {
      isCancelled = true;
    };
  }, [isOpen, imageSrc]);

  // Compute clamping bounds based on current rotation and zoom
  const getClampedPan = useCallback(
    (
      currentPan: { x: number; y: number },
      currentZoom: number,
      currentRotation: number,
      targetImg?: HTMLImageElement | null
    ) => {
      const img = targetImg ?? loadedImage;
      if (!img || img.naturalWidth === 0) return currentPan;

      const isRotated90 = currentRotation === 90 || currentRotation === 270;
      const effectiveW = isRotated90 ? img.naturalHeight : img.naturalWidth;
      const effectiveH = isRotated90 ? img.naturalWidth : img.naturalHeight;

      const baseScale = CROP_DIAMETER / Math.min(effectiveW, effectiveH);
      const totalScale = baseScale * currentZoom;
      const scaledW = effectiveW * totalScale;
      const scaledH = effectiveH * totalScale;

      const maxPanX = Math.max(0, (scaledW - CROP_DIAMETER) / 2);
      const maxPanY = Math.max(0, (scaledH - CROP_DIAMETER) / 2);

      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, currentPan.x)),
        y: Math.max(-maxPanY, Math.min(maxPanY, currentPan.y)),
      };
    },
    [loadedImage],
  );

  // Redraw canvas
  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const img = loadedImage;
    if (!canvas || !img || img.naturalWidth === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = VIEWPORT_SIZE * dpr;
    canvas.height = VIEWPORT_SIZE * dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, VIEWPORT_SIZE, VIEWPORT_SIZE);

    const isRotated90 = rotation === 90 || rotation === 270;
    const effectiveW = isRotated90 ? img.naturalHeight : img.naturalWidth;
    const effectiveH = isRotated90 ? img.naturalWidth : img.naturalHeight;

    const baseScale = CROP_DIAMETER / Math.min(effectiveW, effectiveH);
    const totalScale = baseScale * zoom;
    const clamped = getClampedPan(pan, zoom, rotation, img);

    // 1. Draw image with pan & rotation
    ctx.save();
    ctx.translate(CENTER + clamped.x, CENTER + clamped.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const drawW = img.naturalWidth * totalScale;
    const drawH = img.naturalHeight * totalScale;
    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // 2. Draw circular cutout mask (dim everything outside crop circle)
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, VIEWPORT_SIZE, VIEWPORT_SIZE);
    ctx.arc(CENTER, CENTER, CROP_RADIUS, 0, Math.PI * 2, true);
    ctx.fill();

    // 3. Rule-of-thirds grid inside circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CROP_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1;
    const step = CROP_DIAMETER / 3;
    const leftEdge = CENTER - CROP_RADIUS;
    ctx.beginPath();
    ctx.moveTo(leftEdge + step, 0);
    ctx.lineTo(leftEdge + step, VIEWPORT_SIZE);
    ctx.moveTo(leftEdge + step * 2, 0);
    ctx.lineTo(leftEdge + step * 2, VIEWPORT_SIZE);
    ctx.moveTo(0, leftEdge + step);
    ctx.lineTo(VIEWPORT_SIZE, leftEdge + step);
    ctx.moveTo(0, leftEdge + step * 2);
    ctx.lineTo(VIEWPORT_SIZE, leftEdge + step * 2);
    ctx.stroke();
    ctx.restore();

    // 4. Circular border ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(CENTER, CENTER, CROP_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }, [loadedImage, zoom, pan, rotation, getClampedPan]);

  // Redraw canvas whenever zoom, pan, rotation, or loadedImage changes
  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // Pointer drag handling
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const rawPan = {
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    };
    const clamped = getClampedPan(rawPan, zoomRef.current, rotationRef.current, loadedImage);
    panRef.current = clamped;
    setPan(clamped);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
    }
  };

  const changeZoom = useCallback(
    (newZoomOrUpdater: number | ((prevZoom: number) => number)) => {
      const prevZoom = zoomRef.current;
      const rawNext =
        typeof newZoomOrUpdater === 'function'
          ? newZoomOrUpdater(prevZoom)
          : newZoomOrUpdater;
      const nextZoom = Math.max(0.5, Math.min(5.0, parseFloat(rawNext.toFixed(3))));
      if (nextZoom === prevZoom) return;

      const ratio = nextZoom / prevZoom;
      const prevPan = panRef.current;
      const nextPan = {
        x: prevPan.x * ratio,
        y: prevPan.y * ratio,
      };
      const clampedPan = getClampedPan(nextPan, nextZoom, rotationRef.current, loadedImage);

      zoomRef.current = nextZoom;
      panRef.current = clampedPan;

      setZoom(nextZoom);
      setPan(clampedPan);
    },
    [getClampedPan, loadedImage]
  );

  // Keep pan within valid bounds when rotation or image changes
  useEffect(() => {
    if (!loadedImage) return;
    setPan((prevPan) => {
      const clamped = getClampedPan(prevPan, zoomRef.current, rotationRef.current, loadedImage);
      panRef.current = clamped;
      if (clamped.x === prevPan.x && clamped.y === prevPan.y) {
        return prevPan;
      }
      return clamped;
    });
  }, [rotation, loadedImage, getClampedPan]);

  // Wheel and pinch zoom handling on canvas wrapper (anchored strictly to crop center)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const isPinch = e.ctrlKey;
      const step = isPinch ? -e.deltaY * 0.015 : -e.deltaY * 0.002;
      changeZoom((prev) => prev + step);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [changeZoom]);

  // Keyboard navigation (Escape to close)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleRotate = () => {
    const nextRotation = (rotation + 90) % 360;
    setRotation(nextRotation);
    rotationRef.current = nextRotation;
    setPan((currentPan) => {
      const rotatedPan = { x: -currentPan.y, y: currentPan.x };
      const clamped = getClampedPan(rotatedPan, zoomRef.current, nextRotation, loadedImage);
      panRef.current = clamped;
      return clamped;
    });
  };

  const handleRecenter = () => {
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
  };

  const handleResetTransform = () => {
    zoomRef.current = 1.0;
    panRef.current = { x: 0, y: 0 };
    rotationRef.current = 0;
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  };

  const handleProcessFile = async (file: File) => {
    try {
      setIsProcessing(true);
      setUrlError(null);
      const src = await prepareSourceImage(file);
      setImageSrc(src);
      setZoom(1.0);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setShowUrlInput(false);
    } catch (err) {
      console.error('Failed to prepare avatar:', err);
      setUrlError('Failed to process image file');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Upload photo handler inside popup
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleProcessFile(file);
  };

  // Load from URL (used by URL input form, drag & drop link, and clipboard paste)
  const loadFromDirectUrl = async (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;

    const url = normalizeImageUrl(clean);
    setIsProcessing(true);
    setUrlError(null);

    try {
      let loadedDataUrl: string | null = null;
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (response.ok) {
          const blob = await response.blob();
          if (blob.type.startsWith('image/') || blob.size > 0) {
            loadedDataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
          }
        }
      } catch {
        // Fallback below
      }

      if (!loadedDataUrl) {
        try {
          loadedDataUrl = await new Promise<string>((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              try {
                const canvas = document.createElement('canvas');
                const MAX_DIM = 1200;
                const scale = Math.min(1, Math.min(MAX_DIM / img.naturalWidth, MAX_DIM / img.naturalHeight));
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('No 2D context');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/png'));
              } catch (canvasErr) {
                reject(canvasErr);
              }
            };
            img.onerror = () => reject(new Error('Image CORS blocked'));
            img.src = url;
          });
        } catch {
          // Fallback below
        }
      }

      if (loadedDataUrl) {
        setImageSrc(loadedDataUrl);
        setZoom(1.0);
        setPan({ x: 0, y: 0 });
        setRotation(0);
        setShowUrlInput(false);
        setAvatarUrlInput('');
        return;
      }

      // Check if image loads as an <img> tag without canvas
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image from URL. Please check the link.'));
        img.src = url;
      });

      setImageSrc(url);
      setZoom(1.0);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setShowUrlInput(false);
      setAvatarUrlInput('');
    } catch (err: any) {
      setUrlError(err?.message || 'Failed to load image from URL');
    } finally {
      setIsProcessing(false);
    }
  };

  // URL input submit handler inside popup
  const handleLoadFromUrl = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await loadFromDirectUrl(avatarUrlInput);
  };

  // Drag and Drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);

    const file = e.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|svg)$/i.test(file.name))) {
      await handleProcessFile(file);
      return;
    }

    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (uri && (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:image/'))) {
      await loadFromDirectUrl(uri);
    }
  };

  // Clipboard paste support (Cmd+V / Ctrl+V)
  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleProcessFile(file);
            return;
          }
        }
      }

      const text = e.clipboardData?.getData('text')?.trim();
      if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:image/'))) {
        e.preventDefault();
        loadFromDirectUrl(text);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isOpen]);

  const handleSave = () => {
    // If no image is set, remove avatar and save selected size
    if (!imageSrc) {
      onSave(null, null, selectedSize);
      onClose();
      return;
    }

    const img = loadedImage;
    if (!img || img.naturalWidth === 0) {
      // Direct external URL or still loading
      onSave(imageSrc, imageSrc, selectedSize);
      onClose();
      return;
    }

    const outCanvas = document.createElement('canvas');
    outCanvas.width = EXPORT_SIZE;
    outCanvas.height = EXPORT_SIZE;

    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      onSave(imageSrc, imageSrc, selectedSize);
      onClose();
      return;
    }

    const scaleFactor = EXPORT_SIZE / CROP_DIAMETER;
    const clamped = getClampedPan(pan, zoom, rotation, loadedImage);

    const isRotated90 = rotation === 90 || rotation === 270;
    const effectiveW = isRotated90 ? img.naturalHeight : img.naturalWidth;
    const effectiveH = isRotated90 ? img.naturalWidth : img.naturalHeight;

    const baseScale = CROP_DIAMETER / Math.min(effectiveW, effectiveH);
    const totalScale = baseScale * zoom;

    outCtx.save();
    outCtx.beginPath();
    outCtx.arc(EXPORT_SIZE / 2, EXPORT_SIZE / 2, EXPORT_SIZE / 2, 0, Math.PI * 2);
    outCtx.clip();
    outCtx.translate(EXPORT_SIZE / 2 + clamped.x * scaleFactor, EXPORT_SIZE / 2 + clamped.y * scaleFactor);
    outCtx.rotate((rotation * Math.PI) / 180);
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';

    const drawW = img.naturalWidth * totalScale * scaleFactor;
    const drawH = img.naturalHeight * totalScale * scaleFactor;
    outCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    outCtx.restore();

    try {
      const croppedDataUrl = outCanvas.toDataURL('image/png', 0.95);
      onSave(croppedDataUrl, imageSrc, selectedSize);
    } catch (err) {
      console.warn('Canvas tainted by external URL, saving URL directly:', err);
      onSave(imageSrc, imageSrc, selectedSize);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="avatar-crop-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Customize Avatar"
    >
      <div
        className={`avatar-crop-dialog ${isDragOver ? 'is-drag-over' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="avatar-crop-drop-overlay">
            <div className="avatar-crop-drop-overlay-icon">📥</div>
            <div className="avatar-crop-drop-overlay-title">Drop image here</div>
            <div className="avatar-crop-drop-overlay-desc">PNG, JPG, WebP, GIF, or SVG</div>
          </div>
        )}
        <div className="avatar-crop-header">
          <h3 className="avatar-crop-title">{title || 'Avatar Settings'}</h3>
          <button
            type="button"
            className="avatar-crop-close-btn"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close"
          >
            ✕
          </button>
        </div>

        <div className="avatar-crop-body">
          {imageSrc ? (
            <>
              <div className="avatar-crop-canvas-wrapper" ref={wrapperRef}>
                <canvas
                  ref={(el) => {
                    canvasRef.current = el;
                    if (el && loadedImage) {
                      drawCanvas();
                    }
                  }}
                  className={`avatar-crop-canvas ${isDragging ? 'is-dragging' : ''}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onDoubleClick={() => {
                    zoomRef.current = 1.0;
                    panRef.current = { x: 0, y: 0 };
                    setZoom(1.0);
                    setPan({ x: 0, y: 0 });
                  }}
                  title="Drag to position photo, scroll or pinch to zoom, double-click to reset"
                />
              </div>

              <div className="avatar-crop-hint">
                <span>🖱️ Drag to position</span>
                <span>•</span>
                <span>🔍 Scroll or pinch to zoom</span>
              </div>

              <div className="avatar-crop-controls">
                <div className="avatar-crop-zoom-row">
                  <button
                    type="button"
                    className="avatar-crop-zoom-btn"
                    onClick={() => changeZoom((prev) => parseFloat((prev - 0.2).toFixed(2)))}
                    title="Zoom out"
                    aria-label="Zoom out"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    className="avatar-crop-zoom-slider"
                    min="0.5"
                    max="5.0"
                    step="0.01"
                    value={zoom}
                    onChange={(e) => changeZoom(parseFloat(e.target.value))}
                    aria-label="Zoom slider"
                  />
                  <button
                    type="button"
                    className="avatar-crop-zoom-btn"
                    onClick={() => changeZoom((prev) => parseFloat((prev + 0.2).toFixed(2)))}
                    title="Zoom in"
                    aria-label="Zoom in"
                  >
                    +
                  </button>
                  <span className="avatar-crop-zoom-val">{Math.round(zoom * 100)}%</span>
                </div>

                <div className="avatar-crop-tools-row">
                  <button
                    type="button"
                    className="avatar-crop-tool-btn"
                    onClick={handleRotate}
                    title="Rotate 90° clockwise"
                  >
                    <Icons.Refresh size={14} /> Rotate
                  </button>
                  <button
                    type="button"
                    className="avatar-crop-tool-btn"
                    onClick={handleRecenter}
                    title="Center photo"
                  >
                    Center
                  </button>
                  <button
                    type="button"
                    className="avatar-crop-tool-btn"
                    onClick={handleResetTransform}
                    title="Reset zoom and position"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="avatar-crop-empty-state">
              <div className="avatar-crop-empty-icon">📷</div>
              <div className="avatar-crop-empty-title">No avatar selected</div>
              <div className="avatar-crop-empty-desc">
                Upload a photo or enter an image URL below
              </div>
            </div>
          )}

          {/* Source toolbar buttons */}
          <div className="avatar-crop-source-toolbar">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <button
              type="button"
              className="user-profile-btn secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
            >
              {imageSrc ? 'Replace photo…' : 'Upload photo…'}
            </button>
            <button
              type="button"
              className={`user-profile-btn secondary ${showUrlInput ? 'active' : ''}`}
              onClick={() => {
                setShowUrlInput(!showUrlInput);
                setUrlError(null);
              }}
              disabled={isProcessing}
            >
              From URL…
            </button>
            {imageSrc && (
              <button
                type="button"
                className="user-profile-btn secondary"
                onClick={() => {
                  setImageSrc(null);
                  setLoadedImage(null);
                  setUrlError(null);
                }}
                disabled={isProcessing}
                title="Remove avatar"
              >
                Remove
              </button>
            )}
          </div>

          {/* URL Input Form */}
          {showUrlInput && (
            <form className="user-profile-url-form" onSubmit={handleLoadFromUrl}>
              <input
                type="text"
                className="user-profile-input user-profile-url-input"
                placeholder="https://… or @github_username"
                value={avatarUrlInput}
                onChange={(e) => setAvatarUrlInput(e.target.value)}
                autoFocus
                disabled={isProcessing}
              />
              <button
                type="submit"
                className="user-profile-btn primary"
                disabled={isProcessing || !avatarUrlInput.trim()}
              >
                {isProcessing ? 'Loading…' : 'Load'}
              </button>
              <button
                type="button"
                className="user-profile-btn secondary"
                onClick={() => {
                  setShowUrlInput(false);
                  setUrlError(null);
                }}
                disabled={isProcessing}
              >
                Cancel
              </button>
            </form>
          )}

          {urlError && <div className="user-profile-url-error">{urlError}</div>}

          {/* Chat Size Selector */}
          {!hideSizeSelector && (
            <div className="avatar-crop-size-section">
              <span className="user-profile-size-caption">Chat size:</span>
              <div className="user-profile-size-segmented" role="radiogroup" aria-label="Chat avatar size">
                {CHAT_AVATAR_SIZE_KEYS.map((sizeKey) => {
                  const cfg = CHAT_AVATAR_SIZES[sizeKey];
                  const isSelected = selectedSize === sizeKey;
                  return (
                    <button
                      key={sizeKey}
                      type="button"
                      className={`user-profile-size-pill ${isSelected ? 'active' : ''}`}
                      onClick={() => setSelectedSize(sizeKey)}
                      title={`${cfg.label} (${cfg.px}px)`}
                      role="radio"
                      aria-checked={isSelected}
                    >
                      {cfg.shortLabel}
                    </button>
                  );
                })}
              </div>
              <span className="user-profile-size-badge">{CHAT_AVATAR_SIZES[selectedSize].px}px</span>
            </div>
          )}
        </div>

        <div className="avatar-crop-footer">
          <button type="button" className="avatar-crop-btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="avatar-crop-btn primary" onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
};
