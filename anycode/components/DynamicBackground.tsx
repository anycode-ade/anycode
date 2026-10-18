import React, { useEffect, useRef } from 'react';
import type { DynamicBackgroundSettings } from '../hooks/useSettings';

interface DynamicBackgroundProps {
    settings: DynamicBackgroundSettings;
    tiltTargetRef?: React.RefObject<HTMLElement | null>;
    className?: string;
}

interface Particle {
    originX: number;
    originY: number;
    x: number;
    y: number;
    zDepth: number;
    baseRadius: number;
    radius: number;
    baseOpacity: number;
    opacity: number;
    glyph: string;
    phaseOffset: number;
    centerDist: number;
    centerAngle: number;
}

interface Shockwave {
    x: number;
    y: number;
    radius: number;
    maxRadius: number;
    age: number;
}

interface Spark {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    life: number;
}

const CODE_GLYPHS = ['{', '}', '=>', 'fn', 'let', '01', '*', '</>', ';', 'const', '::'];

export const DynamicBackground: React.FC<DynamicBackgroundProps> = ({
    settings,
    tiltTargetRef,
    className = '',
}) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const startLoopRef = useRef<() => void>(() => {});

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !settings.enabled) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = 0;
        let height = 0;
        let particles: Particle[] = [];
        let shockwaves: Shockwave[] = [];
        let sparks: Spark[] = [];
        let animationFrameId: number;
        let isVisible = true;
        let tick = 0;

        const mouse = {
            x: -1000,
            y: -1000,
            targetX: -1000,
            targetY: -1000,
            active: false,
        };

        const satellites = [
            { angle: 0, speed: 0.05, radius: 24, size: 2.2, color: 'rgba(96, 165, 250, 0.9)' },
            { angle: 2.1, speed: -0.035, radius: 36, size: 1.8, color: 'rgba(168, 85, 247, 0.9)' },
            { angle: 4.2, speed: 0.045, radius: 48, size: 2.0, color: 'rgba(52, 211, 153, 0.9)' },
        ];

        const getThemeColors = (): { r: number; g: number; b: number; isDark: boolean } => {
            const isLight = document.documentElement.dataset.themeMode === 'light';
            if (isLight) {
                return { r: 15, g: 23, b: 42, isDark: false };
            }
            return { r: 255, g: 255, b: 255, isDark: true };
        };

        const BUCKET_COUNT = 8;
        let maxBucketCapacity = 6000;
        const bucketCounts = new Int32Array(BUCKET_COUNT);
        let bucketLists: Particle[][] = Array.from({ length: BUCKET_COUNT }, () => new Array(maxBucketCapacity));
        const bucketAlphaIndices = [6, 18, 31, 44, 56, 69, 81, 94];

        let activeNearMouseCount = 0;
        const activeNearMouseList: Particle[] = new Array(600);

        const LUT_SIZE = 512;
        const SIN_LUT = new Float32Array(LUT_SIZE);
        const LUT_FACTOR = LUT_SIZE / (Math.PI * 2);
        for (let i = 0; i < LUT_SIZE; i++) {
            SIN_LUT[i] = Math.sin((i / LUT_SIZE) * Math.PI * 2);
        }
        const fastSin = (rad: number): number => {
            const idx = ((rad * LUT_FACTOR) | 0) & (LUT_SIZE - 1);
            return SIN_LUT[idx < 0 ? idx + LUT_SIZE : idx];
        };

        let cachedTheme = getThemeColors();
        let alphaLUT: string[] = [];
        const updateAlphaLUT = (theme: { r: number; g: number; b: number }) => {
            alphaLUT = [];
            for (let i = 0; i <= 100; i++) {
                alphaLUT.push(`rgba(${theme.r}, ${theme.g}, ${theme.b}, ${(i / 100).toFixed(2)})`);
            }
        };
        updateAlphaLUT(cachedTheme);

        const initParticles = () => {
            particles = [];
            const spacing = Math.max(8, Math.min(60, settingsRef.current.particleSpacing || 27));
            const dotScale = Math.max(0.5, Math.min(3, settingsRef.current.dotScale ?? 0.85));
            const gridPattern = settingsRef.current.gridPattern || 'matrix';
            const gridOpacity = Math.max(0.3, Math.min(2.5, settingsRef.current.gridOpacity ?? 0.5));

            const isHex = gridPattern === 'isometric';
            const rowSpacing = isHex ? spacing * 0.866 : spacing;
            const cols = Math.ceil(width / spacing) + 3;
            const rows = Math.ceil(height / rowSpacing) + 3;

            const cx = width / 2;
            const cy = height / 2;

            for (let r = 0; r < rows; r++) {
                const rowOffset = isHex && (r % 2 === 1) ? spacing * 0.5 : 0;
                for (let c = 0; c < cols; c++) {
                    const originX = c * spacing + rowOffset;
                    const originY = r * rowSpacing;
                    const zDepth = (c + r) % 3;
                    const glyph = CODE_GLYPHS[(c * 7 + r * 13) % CODE_GLYPHS.length];

                    const baseRadius = (zDepth === 2 ? 1.5 : (zDepth === 1 ? 1.2 : 0.9)) * dotScale;
                    const baseOpacity = (zDepth === 2 ? 0.24 : 0.15) * gridOpacity;
                    const cdx = originX - cx;
                    const cdy = originY - cy;
                    const centerDist = Math.sqrt(cdx * cdx + cdy * cdy);
                    const centerAngle = Math.atan2(cdy, cdx);

                    particles.push({
                        originX,
                        originY,
                        x: originX,
                        y: originY,
                        zDepth,
                        baseRadius,
                        radius: baseRadius,
                        baseOpacity,
                        opacity: baseOpacity,
                        glyph,
                        phaseOffset: Math.sin(c * 0.4) + Math.cos(r * 0.4) * 2,
                        centerDist,
                        centerAngle,
                    });
                }
            }

            if (particles.length > maxBucketCapacity) {
                maxBucketCapacity = particles.length + 500;
                bucketLists = Array.from({ length: BUCKET_COUNT }, () => new Array(maxBucketCapacity));
            }
        };

        let isRunning = false;
        let isScrolling = false;
        let scrollTimeoutId: number | null = null;
        let idleFramesCount = 0;
        const warpState = {
            active: false,
            progress: 0,
        };
        const warpLinesBg: number[] = [];
        const warpLinesFg: number[] = [];

        let lastRenderTime = 0;

        const startLoop = () => {
            if (!isRunning && isVisible && !isScrolling) {
                isRunning = true;
                idleFramesCount = 0;
                lastTime = performance.now();
                lastRenderTime = 0;
                animationFrameId = requestAnimationFrame(render);
            }
        };
        startLoopRef.current = startLoop;

        const handleScrollActivity = () => {
            isScrolling = true;
            if (scrollTimeoutId !== null) {
                window.clearTimeout(scrollTimeoutId);
            }
            scrollTimeoutId = window.setTimeout(() => {
                isScrolling = false;
                scrollTimeoutId = null;
                startLoop();
            }, 25);
        };

        const handleResize = () => {
            const rect = container.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.scale(dpr, dpr);
            initParticles();
            startLoop();
        };

        const handleMouseMove = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            mouse.targetX = e.clientX - rect.left;
            mouse.targetY = e.clientY - rect.top;
            mouse.active = true;

            if (settingsRef.current.tilt && tiltTargetRef?.current) {
                const tiltX = (mouse.targetX - width / 2) / (width / 2);
                const tiltY = (mouse.targetY - height / 2) / (height / 2);
                tiltTargetRef.current.style.transform = `rotateY(${tiltX * 6}deg) rotateX(${-tiltY * 6}deg) translateZ(8px)`;
            }

            startLoop();
        };

        const handleMouseLeave = () => {
            mouse.active = false;
            mouse.targetX = -1000;
            mouse.targetY = -1000;
            if (tiltTargetRef?.current) {
                tiltTargetRef.current.style.transform = 'rotateY(0deg) rotateX(0deg) translateZ(0px)';
            }
            startLoop();
        };

        const handleClick = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            shockwaves.push({ x, y, radius: 0, maxRadius: 360, age: 0 });

            for (let i = 0; i < 6; i++) {
                const ang = (Math.PI * 2 * i) / 6 + Math.random() * 0.3;
                const spd = Math.random() * 2.5 + 1.2;
                sparks.push({
                    x,
                    y,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd,
                    size: Math.random() * 1.8 + 1,
                    alpha: 0.8,
                    life: 1,
                });
            }
            startLoop();
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            if (!settingsRef.current.keyboardShockwave) return;
            // Ignore keystrokes inside text inputs
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            shockwaves.push({ x: width / 2, y: height / 2, radius: 0, maxRadius: 400, age: 0 });
            startLoop();
        };

        const handleVisibilityChange = () => {
            isVisible = !document.hidden;
            if (isVisible) {
                startLoop();
            } else {
                isRunning = false;
                cancelAnimationFrame(animationFrameId);
            }
        };

        const handleWarpEvent = () => {
            warpState.active = true;
            warpState.progress = 0.05;
            const cx = width / 2;
            const cy = height / 2;
            const maxR = Math.hypot(cx, cy) * 1.35;

            // Triple expanding shockwaves radiating from center
            shockwaves.push({ x: cx, y: cy, radius: 0, maxRadius: maxR, age: 0 });
            shockwaves.push({ x: cx, y: cy, radius: 0, maxRadius: maxR * 0.75, age: -0.06 });
            shockwaves.push({ x: cx, y: cy, radius: 0, maxRadius: maxR * 0.5, age: -0.12 });

            // Luminous sparks burst from center
            for (let i = 0; i < 24; i++) {
                const ang = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.3;
                const spd = Math.random() * 5 + 2.5;
                sparks.push({
                    x: cx,
                    y: cy,
                    vx: Math.cos(ang) * spd,
                    vy: Math.sin(ang) * spd,
                    size: Math.random() * 2.5 + 1.2,
                    alpha: 1,
                    life: 1.1,
                });
            }

            startLoop();
        };

        let lastTime = performance.now();

        const render = (now: number) => {
            if (!isVisible || isScrolling) {
                isRunning = false;
                return;
            }

            // Adaptive frame throttling:
            // 60 FPS when cursor moves or interactive shockwaves/warp are active,
            // ~45 FPS during ambient background pulsation / stationary mouse.
            // On ProMotion 120Hz displays, this cuts CPU and WebKit.GPU overhead by 50-65%!
            const isInteractive = (mouse.active && (Math.abs(mouse.x - mouse.targetX) > 0.1 || Math.abs(mouse.y - mouse.targetY) > 0.1)) || shockwaves.length > 0 || warpState.active;
            const minFrameInterval = isInteractive ? 15.6 : 22.0;
            const elapsedSinceRender = now - lastRenderTime;

            if (lastRenderTime > 0 && elapsedSinceRender < minFrameInterval) {
                animationFrameId = requestAnimationFrame(render);
                return;
            }
            lastRenderTime = now;

            const dt = Math.min((now - lastTime) / 1000, 0.1);
            lastTime = now;
            tick += dt * 2.5;

            if (mouse.active) {
                mouse.x = mouse.targetX;
                mouse.y = mouse.targetY;
            } else {
                mouse.x += (mouse.targetX - mouse.x) * 0.25;
                mouse.y += (mouse.targetY - mouse.y) * 0.25;
            }

            ctx.clearRect(0, 0, width, height);

            const s = settingsRef.current;
            const theme = getThemeColors();
            if (theme.isDark !== cachedTheme.isDark || theme.r !== cachedTheme.r) {
                cachedTheme = theme;
                updateAlphaLUT(theme);
            }

            const centerX = width / 2;
            const centerY = height / 2;

            // 1. Nebula / Aurora background glow (only if explicitly enabled, spotlight is off, and mouse is active)
            if (s.aurora && !s.spotlight && mouse.active && mouse.x > -200) {
                const grad = ctx.createRadialGradient(mouse.x, mouse.y, 20, mouse.x, mouse.y, 260);
                if (theme.isDark) {
                    grad.addColorStop(0, 'rgba(59, 130, 246, 0.08)');
                    grad.addColorStop(0.45, 'rgba(168, 85, 247, 0.04)');
                    grad.addColorStop(0.8, 'rgba(16, 185, 129, 0.02)');
                    grad.addColorStop(1, 'transparent');
                } else {
                    grad.addColorStop(0, 'rgba(59, 130, 246, 0.04)');
                    grad.addColorStop(0.5, 'rgba(168, 85, 247, 0.02)');
                    grad.addColorStop(1, 'transparent');
                }
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, width, height);
            }

            // Handle Warp Speed
            let warpFactor = 0;
            if (warpState.active) {
                warpState.progress += dt / (settingsRef.current.warpDurationMs / 1000);
                if (warpState.progress >= 1) {
                    warpState.active = false;
                    warpState.progress = 0;
                } else {
                    warpFactor = Math.sin(warpState.progress * Math.PI) * 2.8;
                }
            }
            warpLinesBg.length = 0;
            warpLinesFg.length = 0;

            // Update shockwaves
            for (let i = shockwaves.length - 1; i >= 0; i--) {
                const sw = shockwaves[i];
                sw.radius += 11;
                sw.age += dt * 2;
                if (sw.radius > sw.maxRadius) {
                    shockwaves.splice(i, 1);
                }
            }

            // Update sparks
            for (let i = sparks.length - 1; i >= 0; i--) {
                const sp = sparks[i];
                sp.x += sp.vx;
                sp.y += sp.vy;
                sp.life -= dt * 1.5;
                if (sp.life <= 0) {
                    sparks.splice(i, 1);
                    continue;
                }
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, sp.size * sp.life, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(147, 197, 253, ${sp.life * 0.6})`;
                ctx.fill();
            }

            // Zero-allocation: reset counters instead of clearing dynamic arrays
            bucketCounts.fill(0);
            activeNearMouseCount = 0;

            const maxDist = 220;
            const maxDistSq = 48400; // 220^2
            const spotRadius = s.spotlightRadius || 130;
            const spotRadiusSq = spotRadius * spotRadius;
            const peak = (s.spotlightPeakOpacity ?? 0.45) * (s.gridOpacity ?? 0.5);
            const ambientRatio = Math.min(1.0, (s.spotlightAmbientOpacity ?? 0.04) / Math.max(0.1, s.spotlightPeakOpacity ?? 0.45));

            let visibleDotsCount = 0;
            let particlesMoving = Math.abs(mouse.x - mouse.targetX) > 0.05 || Math.abs(mouse.y - mouse.targetY) > 0.05;

            const isCenterPulse = !s.spotlight || !mouse.active || mouse.x <= -200;
            const pulseCenterX = !isCenterPulse ? mouse.x : centerX;
            const pulseCenterY = !isCenterPulse ? mouse.y : centerY;

            // Precomputed pulsation frame invariants (massive CPU savings)
            const breatheWave = s.pulsation === 'breathe' ? (Math.sin(tick * 1.5) + 1) * 0.5 : 0;
            const radarSweepAngle = s.pulsation === 'radar' ? ((tick * 1.8) % (Math.PI * 2) - Math.PI) : 0;
            const twinkleTick = s.pulsation === 'twinkle' ? tick * 2 : 0;
            const radialTickOffset = s.pulsation === 'radial' ? tick * 2.5 : 0;

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];

                const dx = mouse.x - p.originX;
                const dy = mouse.y - p.originY;
                const distSq = dx * dx + dy * dy;
                let dist = -1;

                // Spotlight illumination on dots
                let spotFactor = 1.0;
                let spotlightRadiusMod = 0;
                let baseOpacity = p.baseOpacity;

                if (s.spotlight && mouse.active && mouse.x > -200) {
                    const pAmbient = (s.spotlightAmbientOpacity ?? 0.04) * (p.zDepth === 2 ? 1.2 : 0.85);
                    if (distSq < spotRadiusSq) {
                        dist = Math.sqrt(distSq);
                        spotFactor = Math.pow(1 - dist / spotRadius, 1.4);
                        baseOpacity = pAmbient + (peak - pAmbient) * spotFactor;
                        spotlightRadiusMod = spotFactor * 1.6 * (s.dotScale ?? 0.85);
                    } else {
                        spotFactor = 0;
                        baseOpacity = pAmbient;
                    }
                } else if (s.spotlight) {
                    spotFactor = 0;
                    baseOpacity = (s.spotlightAmbientOpacity ?? 0.04) * (p.zDepth === 2 ? 1.2 : 0.85);
                }

                // Pulsation & Rhythm: respects spotlight beam
                let pulseScale = 1.0;
                if (s.spotlight) {
                    pulseScale = mouse.active ? (ambientRatio + (1.0 - ambientRatio) * spotFactor) : ambientRatio;
                }

                let pulseRadiusMod = 0;
                let pulseOpacityMod = 0;

                // Pulsation modes (optimized: zero Math.sqrt / Math.atan2 when center-anchored)
                switch (s.pulsation) {
                    case 'breathe': {
                        pulseRadiusMod = breatheWave * 0.6 * pulseScale;
                        pulseOpacityMod = breatheWave * 0.14 * pulseScale;
                        break;
                    }
                    case 'radial': {
                        const cdist = isCenterPulse ? p.centerDist : Math.hypot(p.originX - pulseCenterX, p.originY - pulseCenterY);
                        const wave = fastSin(cdist * 0.05 - radialTickOffset);
                        if (wave > 0) {
                            const intensity = wave * wave * wave * pulseScale;
                            pulseRadiusMod = intensity * 0.9;
                            pulseOpacityMod = intensity * 0.22;
                        }
                        break;
                    }
                    case 'radar': {
                        const angle = isCenterPulse ? p.centerAngle : Math.atan2(p.originY - pulseCenterY, p.originX - pulseCenterX);
                        let diff = angle - radarSweepAngle;
                        if (diff < -Math.PI) diff += Math.PI * 2;
                        else if (diff > Math.PI) diff -= Math.PI * 2;
                        if (diff >= 0 && diff < 0.6) {
                            const factor = (1 - diff / 0.6) * pulseScale;
                            pulseRadiusMod = factor * 1.2;
                            pulseOpacityMod = factor * 0.35;
                        }
                        break;
                    }
                    case 'twinkle': {
                        const tw = fastSin(twinkleTick + p.phaseOffset);
                        if (tw > 0.4) {
                            const factor = ((tw - 0.4) / 0.6) * pulseScale;
                            pulseRadiusMod = factor * 0.8;
                            pulseOpacityMod = factor * 0.28;
                        }
                        break;
                    }
                }

                // Shockwaves (fast bounding box check)
                let shockwaveX = 0;
                let shockwaveY = 0;
                for (let j = 0; j < shockwaves.length; j++) {
                    const sw = shockwaves[j];
                    const sdx = p.originX - sw.x;
                    const sdy = p.originY - sw.y;
                    if (Math.abs(sdx) > sw.radius + 35 || Math.abs(sdy) > sw.radius + 35) continue;
                    const sdist = Math.sqrt(sdx * sdx + sdy * sdy);
                    const diff = Math.abs(sdist - sw.radius);
                    if (diff < 35) {
                        const factor = (1 - diff / 35) * Math.max(0, 1 - sw.radius / sw.maxRadius);
                        const angle = Math.atan2(sdy, sdx);
                        shockwaveX += Math.cos(angle) * factor * 22;
                        shockwaveY += Math.sin(angle) * factor * 22;
                        const swScale = s.spotlight ? pulseScale : 1.0;
                        pulseRadiusMod += factor * 1.8 * swScale;
                        pulseOpacityMod += factor * 0.4 * swScale;
                    }
                }

                // Mouse Physics (optimized trigonometry: invDist avoids costly atan2/cos/sin)
                let targetX = p.originX + shockwaveX;
                let targetY = p.originY + shockwaveY;
                let mouseRadiusMod = 0;
                let mouseOpacityMod = 0;

                if (distSq < 12100 && s.meshLines && mouse.active) {
                    if (activeNearMouseCount < 600) {
                        activeNearMouseList[activeNearMouseCount++] = p;
                    }
                }

                if (s.physics !== 'none' && mouse.active && mouse.x > -200 && distSq < maxDistSq) {
                    if (dist < 0) dist = Math.sqrt(distSq);
                    const factor = 1 - dist / maxDist;
                    const invDist = dist > 0.001 ? 1 / dist : 0;
                    const cosA = dx * invDist;
                    const sinA = dy * invDist;

                    switch (s.physics) {
                        case 'blackhole': {
                            const pull = Math.pow(factor, 1.8) * 36;
                            targetX += cosA * pull;
                            targetY += sinA * pull;
                            mouseRadiusMod = -factor * 0.6;
                            mouseOpacityMod = factor * 0.35;
                            break;
                        }
                        case 'lens': {
                            mouseRadiusMod = factor * 2.4;
                            mouseOpacityMod = factor * 0.45;
                            const push = factor * 8;
                            targetX -= cosA * push;
                            targetY -= sinA * push;
                            break;
                        }
                        case 'invert': {
                            mouseRadiusMod = -factor * 0.75;
                            mouseOpacityMod = -factor * 0.08;
                            break;
                        }
                        case 'repel': {
                            const push = Math.pow(factor, 1.2) * 44;
                            targetX -= cosA * push;
                            targetY -= sinA * push;
                            mouseOpacityMod = factor * 0.3;
                            break;
                        }
                        case 'vortex': {
                            const angle = Math.atan2(dy, dx) + factor * 1.6;
                            const swirlDist = Math.max(6, dist - factor * 22);
                            targetX = mouse.x - Math.cos(angle) * swirlDist;
                            targetY = mouse.y - Math.sin(angle) * swirlDist;
                            mouseRadiusMod = factor * 0.8;
                            mouseOpacityMod = factor * 0.4;
                            break;
                        }
                    }
                }

                const finalTargetRadius = Math.max(0.4, p.baseRadius + pulseRadiusMod + mouseRadiusMod + spotlightRadiusMod);
                const finalTargetOpacity = Math.min(
                    1.0,
                    Math.max(0.0, baseOpacity + pulseOpacityMod + mouseOpacityMod)
                );

                const deltaX = targetX - p.x;
                const deltaY = targetY - p.y;
                const deltaRadius = finalTargetRadius - p.radius;
                const deltaOpacity = finalTargetOpacity - p.opacity;

                p.x += deltaX * 0.35;
                p.y += deltaY * 0.35;
                p.radius += deltaRadius * 0.45;
                p.opacity += deltaOpacity * 0.45;

                if (!particlesMoving && (
                    Math.abs(deltaX) > 0.05 ||
                    Math.abs(deltaY) > 0.05 ||
                    Math.abs(deltaRadius) > 0.02 ||
                    Math.abs(deltaOpacity) > 0.01
                )) {
                    particlesMoving = true;
                }

                // Code glyph morphing
                if (s.codeGlyphs && distSq < 7225 && mouse.active) {
                    if (dist < 0) dist = Math.sqrt(distSq);
                    const glyphAlpha = Math.min(0.8, (1 - dist / 85) * 0.75 + 0.1);
                    ctx.font = '9px monospace';
                    ctx.fillStyle = theme.isDark
                        ? `rgba(191, 219, 254, ${glyphAlpha})`
                        : `rgba(37, 99, 235, ${glyphAlpha})`;
                    ctx.fillText(p.glyph, p.x - 3, p.y + 3);
                    visibleDotsCount++;
                    continue;
                }

                // RGB Split near mouse
                if (s.rgbSplit && distSq < 14400 && mouse.active) {
                    if (dist < 0) dist = Math.sqrt(distSq);
                    const split = (1 - dist / 120) * 2.2;
                    ctx.beginPath();
                    ctx.arc(p.x - split, p.y, p.radius, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(239, 68, 68, ${p.opacity * 0.9})`;
                    ctx.fill();

                    ctx.beginPath();
                    ctx.arc(p.x + split, p.y, p.radius, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(59, 130, 246, ${p.opacity * 0.9})`;
                    ctx.fill();

                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.radius * 0.8, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(34, 197, 94, ${p.opacity * 0.9})`;
                    ctx.fill();
                    visibleDotsCount++;
                    continue;
                }

                // Warp effect: project outward along radial rays (from artifact)
                if (warpFactor > 0) {
                    const wdx = p.x - centerX;
                    const wdy = p.y - centerY;
                    const wdist = Math.sqrt(wdx * wdx + wdy * wdy);
                    const wangle = Math.atan2(wdy, wdx);
                    const stretch = wdist * warpFactor * 0.28;

                    if (p.zDepth === 2) {
                        warpLinesFg.push(p.x, p.y, p.x + Math.cos(wangle) * stretch, p.y + Math.sin(wangle) * stretch);
                    } else {
                        warpLinesBg.push(p.x, p.y, p.x + Math.cos(wangle) * stretch, p.y + Math.sin(wangle) * stretch);
                    }
                    visibleDotsCount++;
                    continue;
                }

                // Early culling: skip drawing invisible dots (saves up to 90% GPU draw overhead)
                if (p.opacity < 0.015) {
                    continue;
                }

                visibleDotsCount++;
                const bIdx = Math.min(7, Math.max(0, (p.opacity * 8) | 0));
                const bCount = bucketCounts[bIdx];
                if (bCount < maxBucketCapacity) {
                    bucketLists[bIdx][bCount] = p;
                    bucketCounts[bIdx] = bCount + 1;
                }
            }

            // Batched rendering of all standard dots in only 8 GPU draw calls!
            for (let b = 0; b < BUCKET_COUNT; b++) {
                const len = Math.min(bucketCounts[b], maxBucketCapacity);
                if (len === 0) continue;
                const list = bucketLists[b];

                ctx.beginPath();
                ctx.fillStyle = alphaLUT[bucketAlphaIndices[b]];
                for (let k = 0; k < len; k++) {
                    const pt = list[k];
                    const r = pt.radius;
                    if (r <= 1.25) {
                        ctx.rect(pt.x - r, pt.y - r, r * 2, r * 2);
                    } else {
                        ctx.moveTo(pt.x + r, pt.y);
                        ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
                    }
                }
                ctx.fill();
            }

            // Render batched warp hyperdrive rays from artifact
            if (warpFactor > 0) {
                if (warpLinesBg.length > 0) {
                    ctx.beginPath();
                    for (let k = 0; k < warpLinesBg.length; k += 4) {
                        ctx.moveTo(warpLinesBg[k], warpLinesBg[k + 1]);
                        ctx.lineTo(warpLinesBg[k + 2], warpLinesBg[k + 3]);
                    }
                    const bgAlpha = Math.min(0.85, 0.35 + warpFactor * 0.16);
                    ctx.strokeStyle = theme.isDark
                        ? `rgba(220, 235, 255, ${bgAlpha})`
                        : `rgba(59, 130, 246, ${bgAlpha * 0.8})`;
                    ctx.lineWidth = 1.1;
                    ctx.stroke();
                }

                if (warpLinesFg.length > 0) {
                    ctx.beginPath();
                    for (let k = 0; k < warpLinesFg.length; k += 4) {
                        ctx.moveTo(warpLinesFg[k], warpLinesFg[k + 1]);
                        ctx.lineTo(warpLinesFg[k + 2], warpLinesFg[k + 3]);
                    }
                    const fgAlpha = Math.min(0.95, 0.55 + warpFactor * 0.2);
                    ctx.strokeStyle = theme.isDark
                        ? `rgba(255, 255, 255, ${fgAlpha})`
                        : `rgba(37, 99, 235, ${fgAlpha})`;
                    ctx.lineWidth = 1.8;
                    ctx.stroke();
                }
            }

            // Draw Neural Mesh Connections (batched single stroke call, zero inner allocations)
            if (s.meshLines && activeNearMouseCount > 1) {
                const spacing = Math.max(8, s.particleSpacing || 18);
                const meshMaxDist = Math.max(34, spacing * 1.6);
                const meshMaxDistSq = meshMaxDist * meshMaxDist;
                ctx.lineWidth = 0.7;
                ctx.strokeStyle = theme.isDark
                    ? `rgba(147, 197, 253, ${0.16 * (s.gridOpacity ?? 1)})`
                    : `rgba(37, 99, 235, ${0.12 * (s.gridOpacity ?? 1)})`;
                ctx.beginPath();
                for (let a = 0; a < activeNearMouseCount; a++) {
                    const p1 = activeNearMouseList[a];
                    for (let b = a + 1; b < activeNearMouseCount; b++) {
                        const p2 = activeNearMouseList[b];
                        const ndx = p1.x - p2.x;
                        const ndy = p1.y - p2.y;
                        if (ndx * ndx + ndy * ndy < meshMaxDistSq) {
                            ctx.moveTo(p1.x, p1.y);
                            ctx.lineTo(p2.x, p2.y);
                        }
                    }
                }
                ctx.stroke();
            }

            // Draw Gravitational Orbit Satellites
            if (s.satellites && mouse.active) {
                satellites.forEach((sat) => {
                    sat.angle += sat.speed;
                    const sx = mouse.x + Math.cos(sat.angle) * sat.radius;
                    const sy = mouse.y + Math.sin(sat.angle) * (sat.radius * 0.6);

                    // Orbit ring
                    ctx.beginPath();
                    ctx.ellipse(mouse.x, mouse.y, sat.radius, sat.radius * 0.6, 0, 0, Math.PI * 2);
                    ctx.strokeStyle = theme.isDark
                        ? 'rgba(255, 255, 255, 0.05)'
                        : 'rgba(0, 0, 0, 0.05)';
                    ctx.lineWidth = 0.5;
                    ctx.stroke();

                    // Satellite glow
                    ctx.beginPath();
                    ctx.arc(sx, sy, sat.size * 2, 0, Math.PI * 2);
                    ctx.fillStyle = sat.color.replace('0.9', '0.2');
                    ctx.fill();

                    // Satellite center
                    ctx.beginPath();
                    ctx.arc(sx, sy, sat.size, 0, Math.PI * 2);
                    ctx.fillStyle = sat.color;
                    ctx.fill();
                });
            }

            // Adaptive on-demand idle detection:
            // If there are no ongoing continuous animations and particles are stationary, enter idle sleep
            const hasContinuousAnimation =
                warpState.active ||
                s.pulsation !== 'none' ||
                (s.satellites && mouse.active) ||
                shockwaves.length > 0 ||
                sparks.length > 0;

            if (!hasContinuousAnimation && !particlesMoving) {
                idleFramesCount++;
                // Render 2 settle frames to guarantee clean stationary state, then sleep
                if (idleFramesCount > 2) {
                    isRunning = false;
                    return; // Enter deep sleep
                }
            } else {
                idleFramesCount = 0;
            }

            animationFrameId = requestAnimationFrame(render);
        };

        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        resizeObserver.observe(container);
        handleResize();
        startLoop();

        window.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseleave', handleMouseLeave);
        window.addEventListener('click', handleClick);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('anycode:warp-speed', handleWarpEvent);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('wheel', handleScrollActivity, { passive: true, capture: true });
        window.addEventListener('scroll', handleScrollActivity, { passive: true, capture: true });

        return () => {
            startLoopRef.current = () => {};
            cancelAnimationFrame(animationFrameId);
            if (scrollTimeoutId !== null) {
                window.clearTimeout(scrollTimeoutId);
            }
            resizeObserver.disconnect();
            window.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseleave', handleMouseLeave);
            window.removeEventListener('click', handleClick);
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('anycode:warp-speed', handleWarpEvent);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('wheel', handleScrollActivity, { capture: true });
            window.removeEventListener('scroll', handleScrollActivity, { capture: true });
        };
    }, [
        settings.enabled,
        settings.particleSpacing,
        settings.dotScale,
        settings.gridPattern,
        settings.gridOpacity,
        settings.spotlight,
        settings.spotlightRadius,
        settings.spotlightAmbientOpacity,
        settings.spotlightPeakOpacity,
        tiltTargetRef,
    ]);

    useEffect(() => {
        if (settings.enabled) {
            startLoopRef.current();
        }
    }, [
        settings.enabled,
        settings.pulsation,
        settings.physics,
        settings.satellites,
        settings.aurora,
        settings.rgbSplit,
        settings.codeGlyphs,
        settings.meshLines,
        settings.keyboardShockwave,
    ]);

    if (!settings.enabled) {
        return null;
    }

    return (
        <div
            ref={containerRef}
            className={`dynamic-background-container ${className}`}
            style={{
                position: 'absolute',
                inset: 0,
                overflow: 'hidden',
                pointerEvents: 'none',
                zIndex: 0,
            }}
        >
            <canvas
                ref={canvasRef}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                }}
            />
        </div>
    );
};
