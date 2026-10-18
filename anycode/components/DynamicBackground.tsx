import React, { useEffect, useRef, useState } from 'react';
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

// --- WebGL Shaders ---

const DOT_VS = `
precision mediump float;

attribute vec2 a_origin;
attribute vec4 a_info;   // x: zDepth, y: baseRadius, z: baseOpacity, w: phaseOffset
attribute vec2 a_center; // x: centerDist, y: centerAngle

uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_spotlight;
uniform float u_spotlightRadius;
uniform float u_spotlightPeak;
uniform float u_spotlightAmbient;
uniform float u_ambientRatio;
uniform int u_pulsation; // 0: none, 1: breathe, 2: radial, 3: radar, 4: twinkle
uniform float u_breatheWave;
uniform float u_radarSweepAngle;
uniform float u_radialTickOffset;
uniform float u_twinkleTick;
uniform int u_physics;   // 0: none, 1: blackhole, 2: lens, 3: invert, 4: repel, 5: vortex
uniform float u_dotScale;
uniform float u_gridOpacity;
uniform int u_numShockwaves;
uniform vec4 u_shockwaves[4]; // x, y, radius, maxRadius

varying float v_opacity;

void main() {
    float zDepth = a_info.x;
    float baseRadius = a_info.y;
    float baseOpacity = a_info.z;
    float phaseOffset = a_info.w;

    float originX = a_origin.x;
    float originY = a_origin.y;

    float dx = u_mouse.x - originX;
    float dy = u_mouse.y - originY;
    float dist = sqrt(dx * dx + dy * dy);

    // Spotlight
    float spotFactor = 1.0;
    float spotlightRadiusMod = 0.0;
    float curBaseOpacity = baseOpacity;

    if (u_spotlight > 0.5 && u_mouseActive > 0.5 && u_mouse.x > -200.0) {
        float pAmbient = u_spotlightAmbient * (zDepth == 2.0 ? 1.2 : 0.85);
        if (dist < u_spotlightRadius) {
            spotFactor = pow(max(0.0, 1.0 - dist / u_spotlightRadius), 1.4);
            curBaseOpacity = pAmbient + (u_spotlightPeak - pAmbient) * spotFactor;
            spotlightRadiusMod = spotFactor * 1.6 * u_dotScale;
        } else {
            spotFactor = 0.0;
            curBaseOpacity = pAmbient;
        }
    } else if (u_spotlight > 0.5) {
        spotFactor = 0.0;
        curBaseOpacity = u_spotlightAmbient * (zDepth == 2.0 ? 1.2 : 0.85);
    }

    // Pulse scale
    float pulseScale = 1.0;
    if (u_spotlight > 0.5) {
        pulseScale = (u_mouseActive > 0.5 && u_mouse.x > -200.0)
            ? (u_ambientRatio + (1.0 - u_ambientRatio) * spotFactor)
            : u_ambientRatio;
    }

    float pulseRadiusMod = 0.0;
    float pulseOpacityMod = 0.0;

    // Pulsation modes
    if (u_pulsation == 1) { // breathe
        pulseRadiusMod = u_breatheWave * 0.6 * pulseScale;
        pulseOpacityMod = u_breatheWave * 0.14 * pulseScale;
    } else if (u_pulsation == 2) { // radial
        bool isCenterPulse = (u_spotlight < 0.5 || u_mouseActive < 0.5 || u_mouse.x <= -200.0);
        float cdist = isCenterPulse ? a_center.x : length(vec2(originX - u_mouse.x, originY - u_mouse.y));
        float wave = sin(cdist * 0.05 - u_radialTickOffset);
        if (wave > 0.0) {
            float intensity = wave * wave * wave * pulseScale;
            pulseRadiusMod = intensity * 0.9;
            pulseOpacityMod = intensity * 0.22;
        }
    } else if (u_pulsation == 3) { // radar
        bool isCenterPulse = (u_spotlight < 0.5 || u_mouseActive < 0.5 || u_mouse.x <= -200.0);
        float angle = isCenterPulse ? a_center.y : atan(originY - u_mouse.y, originX - u_mouse.x);
        float diff = angle - u_radarSweepAngle;
        const float PI = 3.141592653589793;
        const float TWO_PI = 6.283185307179586;
        if (diff < -PI) diff += TWO_PI;
        else if (diff > PI) diff -= TWO_PI;
        if (diff >= 0.0 && diff < 0.6) {
            float factor = (1.0 - diff / 0.6) * pulseScale;
            pulseRadiusMod = factor * 1.2;
            pulseOpacityMod = factor * 0.35;
        }
    } else if (u_pulsation == 4) { // twinkle
        float tw = sin(u_twinkleTick + phaseOffset);
        if (tw > 0.4) {
            float factor = ((tw - 0.4) / 0.6) * pulseScale;
            pulseRadiusMod = factor * 0.8;
            pulseOpacityMod = factor * 0.28;
        }
    }

    // Shockwaves
    float shockwaveX = 0.0;
    float shockwaveY = 0.0;
    for (int j = 0; j < 4; j++) {
        if (j >= u_numShockwaves) break;
        vec4 sw = u_shockwaves[j];
        float sdx = originX - sw.x;
        float sdy = originY - sw.y;
        float sdist = sqrt(sdx * sdx + sdy * sdy);
        float sdiff = abs(sdist - sw.z);
        if (sdiff < 35.0) {
            float factor = (1.0 - sdiff / 35.0) * max(0.0, 1.0 - sw.z / sw.w);
            float angle = atan(sdy, sdx);
            shockwaveX += cos(angle) * factor * 22.0;
            shockwaveY += sin(angle) * factor * 22.0;
            float swScale = (u_spotlight > 0.5) ? pulseScale : 1.0;
            pulseRadiusMod += factor * 1.8 * swScale;
            pulseOpacityMod += factor * 0.4 * swScale;
        }
    }

    // Mouse Physics
    float targetX = originX + shockwaveX;
    float targetY = originY + shockwaveY;
    float mouseRadiusMod = 0.0;
    float mouseOpacityMod = 0.0;

    const float maxDist = 220.0;
    if (u_physics > 0 && u_mouseActive > 0.5 && u_mouse.x > -200.0 && dist < maxDist) {
        float factor = 1.0 - dist / maxDist;
        float invDist = dist > 0.001 ? 1.0 / dist : 0.0;
        float cosA = dx * invDist;
        float sinA = dy * invDist;

        if (u_physics == 1) { // blackhole
            float pull = pow(max(0.0, factor), 1.8) * 36.0;
            targetX += cosA * pull;
            targetY += sinA * pull;
            mouseRadiusMod = -factor * 0.6;
            mouseOpacityMod = factor * 0.35;
        } else if (u_physics == 2) { // lens
            mouseRadiusMod = factor * 2.4;
            mouseOpacityMod = factor * 0.45;
            float push = factor * 8.0;
            targetX -= cosA * push;
            targetY -= sinA * push;
        } else if (u_physics == 3) { // invert
            mouseRadiusMod = -factor * 0.75;
            mouseOpacityMod = -factor * 0.08;
        } else if (u_physics == 4) { // repel
            float push = pow(max(0.0, factor), 1.2) * 44.0;
            targetX -= cosA * push;
            targetY -= sinA * push;
            mouseOpacityMod = factor * 0.3;
        } else if (u_physics == 5) { // vortex
            float angle = atan(dy, dx) + factor * 1.6;
            float swirlDist = max(6.0, dist - factor * 22.0);
            targetX = u_mouse.x - cos(angle) * swirlDist;
            targetY = u_mouse.y - sin(angle) * swirlDist;
            mouseRadiusMod = factor * 0.8;
            mouseOpacityMod = factor * 0.4;
        }
    }

    float finalRadius = max(0.4, baseRadius + pulseRadiusMod + mouseRadiusMod + spotlightRadiusMod);
    float finalOpacity = clamp(curBaseOpacity + pulseOpacityMod + mouseOpacityMod, 0.0, 1.0);

    v_opacity = finalOpacity;

    float clipX = (targetX / u_resolution.x) * 2.0 - 1.0;
    float clipY = 1.0 - (targetY / u_resolution.y) * 2.0;

    gl_Position = vec4(clipX, clipY, 0.0, 1.0);
    gl_PointSize = max(1.0, finalRadius * 2.0 * u_dpr);
}
`;

const DOT_FS = `
precision mediump float;

uniform vec3 u_color;
varying float v_opacity;

void main() {
    if (v_opacity < 0.015) {
        discard;
    }
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord) * 2.0;
    float edge = smoothstep(1.0, 0.72, dist);
    if (edge < 0.01) {
        discard;
    }
    gl_FragColor = vec4(u_color, v_opacity * edge);
}
`;

const LINE_VS = `
precision mediump float;
attribute vec2 a_position;
uniform vec2 u_resolution;
void main() {
    float clipX = (a_position.x / u_resolution.x) * 2.0 - 1.0;
    float clipY = 1.0 - (a_position.y / u_resolution.y) * 2.0;
    gl_Position = vec4(clipX, clipY, 0.0, 1.0);
}
`;

const LINE_FS = `
precision mediump float;
uniform vec4 u_lineColor;
void main() {
    gl_FragColor = u_lineColor;
}
`;

const SPARK_VS = `
precision mediump float;
attribute vec2 a_position;
attribute float a_size;
attribute float a_alpha;
uniform vec2 u_resolution;
uniform float u_dpr;
varying float v_alpha;
void main() {
    float clipX = (a_position.x / u_resolution.x) * 2.0 - 1.0;
    float clipY = 1.0 - (a_position.y / u_resolution.y) * 2.0;
    gl_Position = vec4(clipX, clipY, 0.0, 1.0);
    gl_PointSize = max(1.0, a_size * 2.0 * u_dpr);
    v_alpha = a_alpha;
}
`;

const SPARK_FS = `
precision mediump float;
uniform vec3 u_sparkColor;
varying float v_alpha;
void main() {
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord) * 2.0;
    float edge = smoothstep(1.0, 0.65, dist);
    if (edge < 0.01) {
        discard;
    }
    gl_FragColor = vec4(u_sparkColor, v_alpha * edge);
}
`;

const AURORA_VS = `
precision mediump float;
attribute vec2 a_position;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const AURORA_FS = `
precision mediump float;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_isDark;
void main() {
    vec2 pixelCoord = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
    float dist = length(pixelCoord - u_mouse);
    float radius = 260.0;
    if (dist > radius) {
        discard;
    }
    float norm = dist / radius;
    vec4 c1 = (u_isDark > 0.5) ? vec4(0.23, 0.51, 0.96, 0.08) : vec4(0.23, 0.51, 0.96, 0.04);
    vec4 c2 = (u_isDark > 0.5) ? vec4(0.66, 0.33, 0.97, 0.04) : vec4(0.66, 0.33, 0.97, 0.02);
    vec4 col = mix(c1, c2, smoothstep(0.0, 0.5, norm));
    col = mix(col, vec4(0.0), smoothstep(0.5, 1.0, norm));
    gl_FragColor = col;
}
`;

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.warn('WebGL shader compile error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function createProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.warn('WebGL program link error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    return program;
}

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
    const [webglFailed, setWebglFailed] = useState(false);

    // If codeGlyphs is enabled, we use 2D canvas for native text rendering.
    // Otherwise, WebGL delivers ~0.1% CPU point shader acceleration.
    const useWebGL = !settings.codeGlyphs && !webglFailed;

    useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container || !settings.enabled) return;

        let width = 0;
        let height = 0;
        let shockwaves: Shockwave[] = [];
        let sparks: Spark[] = [];
        let animationFrameId: number;
        let isVisible = true;
        let tick = 0;
        let isRunning = false;
        let isScrolling = false;
        let scrollTimeoutId: number | null = null;
        let idleFramesCount = 0;
        let lastRenderTime = 0;
        let lastTime = performance.now();

        const mouse = {
            x: -1000,
            y: -1000,
            targetX: -1000,
            targetY: -1000,
            active: false,
        };

        const satellites = [
            { angle: 0, speed: 0.05, radius: 24, size: 2.2, color: [96 / 255, 165 / 255, 250 / 255] },
            { angle: 2.1, speed: -0.035, radius: 36, size: 1.8, color: [168 / 255, 85 / 255, 247 / 255] },
            { angle: 4.2, speed: 0.045, radius: 48, size: 2.0, color: [52 / 255, 211 / 255, 153 / 255] },
        ];

        const warpState = {
            active: false,
            progress: 0,
        };

        const getThemeColors = (): { r: number; g: number; b: number; isDark: boolean } => {
            const isLight = document.documentElement.dataset.themeMode === 'light';
            if (isLight) {
                return { r: 15, g: 23, b: 42, isDark: false };
            }
            return { r: 255, g: 255, b: 255, isDark: true };
        };

        // =========================================================================
        // WEBGL ENGINE (0.1% CPU Hardware Accelerated Points Shader)
        // =========================================================================
        if (useWebGL) {
            const gl = canvas.getContext('webgl', {
                alpha: true,
                antialias: true,
                depth: false,
                stencil: false,
                preserveDrawingBuffer: false,
                powerPreference: 'low-power',
            });

            if (!gl) {
                console.warn('WebGL not supported, falling back to 2D canvas');
                setWebglFailed(true);
                return;
            }

            const dotProgram = createProgram(gl, DOT_VS, DOT_FS);
            const lineProgram = createProgram(gl, LINE_VS, LINE_FS);
            const sparkProgram = createProgram(gl, SPARK_VS, SPARK_FS);
            const auroraProgram = createProgram(gl, AURORA_VS, AURORA_FS);

            if (!dotProgram || !lineProgram || !sparkProgram || !auroraProgram) {
                console.warn('Failed to compile WebGL shaders, falling back to 2D canvas');
                setWebglFailed(true);
                return;
            }

            // Dot Program Uniforms & Attributes
            const uDotResolution = gl.getUniformLocation(dotProgram, 'u_resolution');
            const uDotDpr = gl.getUniformLocation(dotProgram, 'u_dpr');
            const uDotMouse = gl.getUniformLocation(dotProgram, 'u_mouse');
            const uDotMouseActive = gl.getUniformLocation(dotProgram, 'u_mouseActive');
            const uDotSpotlight = gl.getUniformLocation(dotProgram, 'u_spotlight');
            const uDotSpotlightRadius = gl.getUniformLocation(dotProgram, 'u_spotlightRadius');
            const uDotSpotlightPeak = gl.getUniformLocation(dotProgram, 'u_spotlightPeak');
            const uDotSpotlightAmbient = gl.getUniformLocation(dotProgram, 'u_spotlightAmbient');
            const uDotAmbientRatio = gl.getUniformLocation(dotProgram, 'u_ambientRatio');
            const uDotPulsation = gl.getUniformLocation(dotProgram, 'u_pulsation');
            const uDotBreatheWave = gl.getUniformLocation(dotProgram, 'u_breatheWave');
            const uDotRadarSweepAngle = gl.getUniformLocation(dotProgram, 'u_radarSweepAngle');
            const uDotRadialTickOffset = gl.getUniformLocation(dotProgram, 'u_radialTickOffset');
            const uDotTwinkleTick = gl.getUniformLocation(dotProgram, 'u_twinkleTick');
            const uDotPhysics = gl.getUniformLocation(dotProgram, 'u_physics');
            const uDotScale = gl.getUniformLocation(dotProgram, 'u_dotScale');
            const uDotGridOpacity = gl.getUniformLocation(dotProgram, 'u_gridOpacity');
            const uDotNumShockwaves = gl.getUniformLocation(dotProgram, 'u_numShockwaves');
            const uDotShockwaves = gl.getUniformLocation(dotProgram, 'u_shockwaves');
            const uDotColor = gl.getUniformLocation(dotProgram, 'u_color');

            const aDotOrigin = gl.getAttribLocation(dotProgram, 'a_origin');
            const aDotInfo = gl.getAttribLocation(dotProgram, 'a_info');
            const aDotCenter = gl.getAttribLocation(dotProgram, 'a_center');

            // Line Program Uniforms & Attributes
            const uLineResolution = gl.getUniformLocation(lineProgram, 'u_resolution');
            const uLineColor = gl.getUniformLocation(lineProgram, 'u_lineColor');
            const aLinePosition = gl.getAttribLocation(lineProgram, 'a_position');

            // Spark Program Uniforms & Attributes
            const uSparkResolution = gl.getUniformLocation(sparkProgram, 'u_resolution');
            const uSparkDpr = gl.getUniformLocation(sparkProgram, 'u_dpr');
            const uSparkColor = gl.getUniformLocation(sparkProgram, 'u_sparkColor');
            const aSparkPosition = gl.getAttribLocation(sparkProgram, 'a_position');
            const aSparkSize = gl.getAttribLocation(sparkProgram, 'a_size');
            const aSparkAlpha = gl.getAttribLocation(sparkProgram, 'a_alpha');

            // Aurora Program Uniforms & Attributes
            const uAuroraResolution = gl.getUniformLocation(auroraProgram, 'u_resolution');
            const uAuroraMouse = gl.getUniformLocation(auroraProgram, 'u_mouse');
            const uAuroraIsDark = gl.getUniformLocation(auroraProgram, 'u_isDark');
            const aAuroraPosition = gl.getAttribLocation(auroraProgram, 'a_position');

            // GPU Buffers
            const dotVbo = gl.createBuffer();
            const lineVbo = gl.createBuffer();
            const sparkVbo = gl.createBuffer();
            const quadVbo = gl.createBuffer();

            // Setup fullscreen quad for Aurora
            gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
                gl.STATIC_DRAW
            );

            // CPU buffers for dynamic geometry
            const MAX_LINE_VERTICES = 4096;
            const lineBufferData = new Float32Array(MAX_LINE_VERTICES * 2);

            const MAX_SPARKS = 128;
            const sparkBufferData = new Float32Array(MAX_SPARKS * 4); // x, y, size, alpha

            const shockwavesFlat = new Float32Array(16); // up to 4 vec4s

            let particleCount = 0;
            let gridCols = 0;
            let gridRows = 0;
            let gridSpacing = 27;
            let gridRowSpacing = 27;
            let gridIsHex = false;
            let rawOrigins: Float32Array | null = null;

            const initParticlesGL = () => {
                gridSpacing = Math.max(8, Math.min(60, settingsRef.current.particleSpacing || 27));
                const dotScale = Math.max(0.5, Math.min(3, settingsRef.current.dotScale ?? 0.85));
                const gridPattern = settingsRef.current.gridPattern || 'matrix';
                const gridOpacity = Math.max(0.3, Math.min(2.5, settingsRef.current.gridOpacity ?? 0.5));

                gridIsHex = gridPattern === 'isometric';
                gridRowSpacing = gridIsHex ? gridSpacing * 0.866 : gridSpacing;
                gridCols = Math.ceil(width / gridSpacing) + 3;
                gridRows = Math.ceil(height / gridRowSpacing) + 3;
                particleCount = gridCols * gridRows;

                // Interleaved buffer: 8 floats per particle
                // [originX, originY, zDepth, baseRadius, baseOpacity, phaseOffset, centerDist, centerAngle]
                const buffer = new Float32Array(particleCount * 8);
                rawOrigins = new Float32Array(particleCount * 2);

                const cx = width / 2;
                const cy = height / 2;

                let idx = 0;
                for (let r = 0; r < gridRows; r++) {
                    const rowOffset = gridIsHex && (r % 2 === 1) ? gridSpacing * 0.5 : 0;
                    for (let c = 0; c < gridCols; c++) {
                        const originX = c * gridSpacing + rowOffset;
                        const originY = r * gridRowSpacing;
                        const zDepth = (c + r) % 3;
                        const baseRadius = (zDepth === 2 ? 1.5 : (zDepth === 1 ? 1.2 : 0.9)) * dotScale;
                        const baseOpacity = (zDepth === 2 ? 0.24 : 0.15) * gridOpacity;
                        const phaseOffset = Math.sin(c * 0.4) + Math.cos(r * 0.4) * 2;

                        const cdx = originX - cx;
                        const cdy = originY - cy;
                        const centerDist = Math.sqrt(cdx * cdx + cdy * cdy);
                        const centerAngle = Math.atan2(cdy, cdx);

                        const offset = idx * 8;
                        buffer[offset] = originX;
                        buffer[offset + 1] = originY;
                        buffer[offset + 2] = zDepth;
                        buffer[offset + 3] = baseRadius;
                        buffer[offset + 4] = baseOpacity;
                        buffer[offset + 5] = phaseOffset;
                        buffer[offset + 6] = centerDist;
                        buffer[offset + 7] = centerAngle;

                        rawOrigins[idx * 2] = originX;
                        rawOrigins[idx * 2 + 1] = originY;

                        idx++;
                    }
                }

                gl.bindBuffer(gl.ARRAY_BUFFER, dotVbo);
                gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
            };

            const startLoop = () => {
                if (!isRunning && isVisible && !isScrolling) {
                    isRunning = true;
                    idleFramesCount = 0;
                    lastTime = performance.now();
                    lastRenderTime = 0;
                    animationFrameId = requestAnimationFrame(renderGL);
                }
            };
            startLoopRef.current = startLoop;

            const handleResize = () => {
                const rect = container.getBoundingClientRect();
                width = rect.width;
                height = rect.height;
                const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
                canvas.width = Math.round(width * dpr);
                canvas.height = Math.round(height * dpr);
                gl.viewport(0, 0, canvas.width, canvas.height);
                initParticlesGL();
                startLoop();
            };

            const renderGL = (now: number) => {
                if (!isVisible || isScrolling) {
                    isRunning = false;
                    return;
                }

                // Adaptive frame throttling on 120Hz displays
                const isInteractive =
                    (mouse.active && (Math.abs(mouse.x - mouse.targetX) > 0.1 || Math.abs(mouse.y - mouse.targetY) > 0.1)) ||
                    shockwaves.length > 0 ||
                    warpState.active;
                const minFrameInterval = isInteractive ? 15.6 : 22.0;
                const elapsedSinceRender = now - lastRenderTime;

                if (lastRenderTime > 0 && elapsedSinceRender < minFrameInterval) {
                    animationFrameId = requestAnimationFrame(renderGL);
                    return;
                }
                lastRenderTime = now;

                const dt = Math.min((now - lastTime) / 1000, 0.1);
                lastTime = now;
                tick += dt * 2.5;

                // Smooth mouse tracking
                if (mouse.active) {
                    mouse.x += (mouse.targetX - mouse.x) * 0.35;
                    mouse.y += (mouse.targetY - mouse.y) * 0.35;
                    if (Math.abs(mouse.targetX - mouse.x) < 0.1) mouse.x = mouse.targetX;
                    if (Math.abs(mouse.targetY - mouse.y) < 0.1) mouse.y = mouse.targetY;
                } else {
                    mouse.x += (mouse.targetX - mouse.x) * 0.25;
                    mouse.y += (mouse.targetY - mouse.y) * 0.25;
                }

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
                let sparkCount = 0;
                for (let i = sparks.length - 1; i >= 0; i--) {
                    const sp = sparks[i];
                    sp.x += sp.vx;
                    sp.y += sp.vy;
                    sp.life -= dt * 1.5;
                    if (sp.life <= 0) {
                        sparks.splice(i, 1);
                        continue;
                    }
                    if (sparkCount < MAX_SPARKS) {
                        const sOff = sparkCount * 4;
                        sparkBufferData[sOff] = sp.x;
                        sparkBufferData[sOff + 1] = sp.y;
                        sparkBufferData[sOff + 2] = sp.size * sp.life;
                        sparkBufferData[sOff + 3] = sp.life * 0.6;
                        sparkCount++;
                    }
                }

                // Warp speed progress
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

                const s = settingsRef.current;
                const theme = getThemeColors();
                const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

                // Setup WebGL state
                gl.viewport(0, 0, canvas.width, canvas.height);
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);

                // 1. Aurora Background Quad (if enabled)
                if (s.aurora && !s.spotlight && mouse.active && mouse.x > -200) {
                    gl.useProgram(auroraProgram);
                    gl.uniform2f(uAuroraResolution, width, height);
                    gl.uniform2f(uAuroraMouse, mouse.x, mouse.y);
                    gl.uniform1f(uAuroraIsDark, theme.isDark ? 1.0 : 0.0);

                    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
                    gl.enableVertexAttribArray(aAuroraPosition);
                    gl.vertexAttribPointer(aAuroraPosition, 2, gl.FLOAT, false, 0, 0);
                    gl.drawArrays(gl.TRIANGLES, 0, 6);
                }

                // 2. Hardware Points Grid Shader (Zero-CPU per dot computation)
                gl.useProgram(dotProgram);

                const spotRadius = s.spotlightRadius || 130;
                const peak = (s.spotlightPeakOpacity ?? 0.45) * (s.gridOpacity ?? 0.5);
                const ambientRatio = Math.min(
                    1.0,
                    (s.spotlightAmbientOpacity ?? 0.04) / Math.max(0.1, s.spotlightPeakOpacity ?? 0.45)
                );

                let pulseModeInt = 0;
                if (s.pulsation === 'breathe') pulseModeInt = 1;
                else if (s.pulsation === 'radial') pulseModeInt = 2;
                else if (s.pulsation === 'radar') pulseModeInt = 3;
                else if (s.pulsation === 'twinkle') pulseModeInt = 4;

                let physicsModeInt = 0;
                if (s.physics === 'blackhole') physicsModeInt = 1;
                else if (s.physics === 'lens') physicsModeInt = 2;
                else if (s.physics === 'invert') physicsModeInt = 3;
                else if (s.physics === 'repel') physicsModeInt = 4;
                else if (s.physics === 'vortex') physicsModeInt = 5;

                const breatheWave = s.pulsation === 'breathe' ? (Math.sin(tick * 1.5) + 1) * 0.5 : 0;
                const radarSweepAngle = s.pulsation === 'radar' ? ((tick * 1.8) % (Math.PI * 2) - Math.PI) : 0;
                const radialTickOffset = s.pulsation === 'radial' ? tick * 2.5 : 0;
                const twinkleTick = s.pulsation === 'twinkle' ? tick * 2 : 0;

                gl.uniform2f(uDotResolution, width, height);
                gl.uniform1f(uDotDpr, dpr);
                gl.uniform2f(uDotMouse, mouse.x, mouse.y);
                gl.uniform1f(uDotMouseActive, mouse.active ? 1.0 : 0.0);
                gl.uniform1f(uDotSpotlight, s.spotlight ? 1.0 : 0.0);
                gl.uniform1f(uDotSpotlightRadius, spotRadius);
                gl.uniform1f(uDotSpotlightPeak, peak);
                gl.uniform1f(uDotSpotlightAmbient, s.spotlightAmbientOpacity ?? 0.04);
                gl.uniform1f(uDotAmbientRatio, ambientRatio);
                gl.uniform1i(uDotPulsation, pulseModeInt);
                gl.uniform1f(uDotBreatheWave, breatheWave);
                gl.uniform1f(uDotRadarSweepAngle, radarSweepAngle);
                gl.uniform1f(uDotRadialTickOffset, radialTickOffset);
                gl.uniform1f(uDotTwinkleTick, twinkleTick);
                gl.uniform1i(uDotPhysics, physicsModeInt);
                gl.uniform1f(uDotScale, s.dotScale ?? 0.85);
                gl.uniform1f(uDotGridOpacity, s.gridOpacity ?? 0.5);
                gl.uniform3f(uDotColor, theme.r / 255, theme.g / 255, theme.b / 255);

                // Shockwaves uniform packing
                const numSw = Math.min(4, shockwaves.length);
                gl.uniform1i(uDotNumShockwaves, numSw);
                if (numSw > 0) {
                    for (let j = 0; j < numSw; j++) {
                        const sw = shockwaves[j];
                        shockwavesFlat[j * 4] = sw.x;
                        shockwavesFlat[j * 4 + 1] = sw.y;
                        shockwavesFlat[j * 4 + 2] = sw.radius;
                        shockwavesFlat[j * 4 + 3] = sw.maxRadius;
                    }
                    gl.uniform4fv(uDotShockwaves, shockwavesFlat);
                }

                // Bind interleaved dot buffer
                gl.bindBuffer(gl.ARRAY_BUFFER, dotVbo);
                const STRIDE = 32; // 8 floats * 4 bytes
                gl.enableVertexAttribArray(aDotOrigin);
                gl.vertexAttribPointer(aDotOrigin, 2, gl.FLOAT, false, STRIDE, 0);
                gl.enableVertexAttribArray(aDotInfo);
                gl.vertexAttribPointer(aDotInfo, 4, gl.FLOAT, false, STRIDE, 8);
                gl.enableVertexAttribArray(aDotCenter);
                gl.vertexAttribPointer(aDotCenter, 2, gl.FLOAT, false, STRIDE, 24);

                gl.drawArrays(gl.POINTS, 0, particleCount);

                // 3. Neural Mesh Connections (gl.LINES)
                if (s.meshLines && mouse.active && mouse.x > -200 && rawOrigins) {
                    const spacing = Math.max(8, s.particleSpacing || 18);
                    const meshMaxDist = Math.max(34, spacing * 1.6);
                    const meshMaxDistSq = meshMaxDist * meshMaxDist;

                    // Efficient spatial query: inspect only ~30 particles near mouse
                    const minR = Math.max(0, Math.floor((mouse.y - 110) / gridRowSpacing));
                    const maxR = Math.min(gridRows - 1, Math.ceil((mouse.y + 110) / gridRowSpacing));
                    const minC = Math.max(0, Math.floor((mouse.x - 110) / gridSpacing) - 1);
                    const maxC = Math.min(gridCols - 1, Math.ceil((mouse.x + 110) / gridSpacing) + 1);

                    const nearX: number[] = [];
                    const nearY: number[] = [];

                    for (let r = minR; r <= maxR; r++) {
                        for (let c = minC; c <= maxC; c++) {
                            const pIdx = r * gridCols + c;
                            if (pIdx < 0 || pIdx >= particleCount) continue;
                            const ox = rawOrigins[pIdx * 2];
                            const oy = rawOrigins[pIdx * 2 + 1];

                            const dx = mouse.x - ox;
                            const dy = mouse.y - oy;
                            const distSq = dx * dx + dy * dy;
                            if (distSq < 12100) {
                                let px = ox;
                                let py = oy;
                                if (s.physics !== 'none' && distSq < 48400) {
                                    const dist = Math.sqrt(distSq);
                                    const factor = 1 - dist / 220;
                                    const invDist = dist > 0.001 ? 1 / dist : 0;
                                    const cosA = dx * invDist;
                                    const sinA = dy * invDist;
                                    if (s.physics === 'blackhole') {
                                        const pull = Math.pow(factor, 1.8) * 36;
                                        px += cosA * pull;
                                        py += sinA * pull;
                                    } else if (s.physics === 'lens') {
                                        const push = factor * 8;
                                        px -= cosA * push;
                                        py -= sinA * push;
                                    } else if (s.physics === 'repel') {
                                        const push = Math.pow(factor, 1.2) * 44;
                                        px -= cosA * push;
                                        py -= sinA * push;
                                    }
                                }
                                nearX.push(px);
                                nearY.push(py);
                            }
                        }
                    }

                    let lineVertCount = 0;
                    for (let a = 0; a < nearX.length; a++) {
                        for (let b = a + 1; b < nearX.length; b++) {
                            const ndx = nearX[a] - nearX[b];
                            const ndy = nearY[a] - nearY[b];
                            if (ndx * ndx + ndy * ndy < meshMaxDistSq) {
                                if (lineVertCount + 2 <= MAX_LINE_VERTICES) {
                                    lineBufferData[lineVertCount * 2] = nearX[a];
                                    lineBufferData[lineVertCount * 2 + 1] = nearY[a];
                                    lineBufferData[lineVertCount * 2 + 2] = nearX[b];
                                    lineBufferData[lineVertCount * 2 + 3] = nearY[b];
                                    lineVertCount += 2;
                                }
                            }
                        }
                    }

                    if (lineVertCount > 0) {
                        gl.useProgram(lineProgram);
                        gl.uniform2f(uLineResolution, width, height);
                        const lineAlpha = (theme.isDark ? 0.16 : 0.12) * (s.gridOpacity ?? 1);
                        gl.uniform4f(
                            uLineColor,
                            theme.isDark ? 147 / 255 : 37 / 255,
                            theme.isDark ? 197 / 255 : 99 / 255,
                            theme.isDark ? 253 / 255 : 235 / 255,
                            lineAlpha
                        );

                        gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
                        gl.bufferData(
                            gl.ARRAY_BUFFER,
                            lineBufferData.subarray(0, lineVertCount * 2),
                            gl.DYNAMIC_DRAW
                        );
                        gl.enableVertexAttribArray(aLinePosition);
                        gl.vertexAttribPointer(aLinePosition, 2, gl.FLOAT, false, 0, 0);
                        gl.drawArrays(gl.LINES, 0, lineVertCount);
                    }
                }

                // 4. Warp Hyperdrive Lines (gl.LINES)
                if (warpFactor > 0 && rawOrigins) {
                    const cx = width / 2;
                    const cy = height / 2;
                    let warpVertCount = 0;
                    const step = Math.max(1, (particleCount / 600) | 0);

                    for (let i = 0; i < particleCount && warpVertCount + 2 <= MAX_LINE_VERTICES; i += step) {
                        const px = rawOrigins[i * 2];
                        const py = rawOrigins[i * 2 + 1];
                        const wdx = px - cx;
                        const wdy = py - cy;
                        const wdist = Math.sqrt(wdx * wdx + wdy * wdy);
                        if (wdist < 10) continue;
                        const stretch = wdist * warpFactor * 0.28;
                        const invW = 1 / wdist;

                        lineBufferData[warpVertCount * 2] = px;
                        lineBufferData[warpVertCount * 2 + 1] = py;
                        lineBufferData[warpVertCount * 2 + 2] = px + wdx * invW * stretch;
                        lineBufferData[warpVertCount * 2 + 3] = py + wdy * invW * stretch;
                        warpVertCount += 2;
                    }

                    if (warpVertCount > 0) {
                        gl.useProgram(lineProgram);
                        gl.uniform2f(uLineResolution, width, height);
                        const warpAlpha = Math.min(0.85, 0.35 + warpFactor * 0.16);
                        gl.uniform4f(
                            uLineColor,
                            theme.isDark ? 220 / 255 : 59 / 255,
                            theme.isDark ? 235 / 255 : 130 / 255,
                            theme.isDark ? 255 / 255 : 246 / 255,
                            warpAlpha
                        );

                        gl.bindBuffer(gl.ARRAY_BUFFER, lineVbo);
                        gl.bufferData(
                            gl.ARRAY_BUFFER,
                            lineBufferData.subarray(0, warpVertCount * 2),
                            gl.DYNAMIC_DRAW
                        );
                        gl.enableVertexAttribArray(aLinePosition);
                        gl.vertexAttribPointer(aLinePosition, 2, gl.FLOAT, false, 0, 0);
                        gl.drawArrays(gl.LINES, 0, warpVertCount);
                    }
                }

                // 5. Sparks (gl.POINTS)
                if (sparkCount > 0) {
                    gl.useProgram(sparkProgram);
                    gl.uniform2f(uSparkResolution, width, height);
                    gl.uniform1f(uSparkDpr, dpr);
                    gl.uniform3f(uSparkColor, 147 / 255, 197 / 255, 253 / 255);

                    gl.bindBuffer(gl.ARRAY_BUFFER, sparkVbo);
                    gl.bufferData(
                        gl.ARRAY_BUFFER,
                        sparkBufferData.subarray(0, sparkCount * 4),
                        gl.DYNAMIC_DRAW
                    );
                    const SPARK_STRIDE = 16;
                    gl.enableVertexAttribArray(aSparkPosition);
                    gl.vertexAttribPointer(aSparkPosition, 2, gl.FLOAT, false, SPARK_STRIDE, 0);
                    gl.enableVertexAttribArray(aSparkSize);
                    gl.vertexAttribPointer(aSparkSize, 1, gl.FLOAT, false, SPARK_STRIDE, 8);
                    gl.enableVertexAttribArray(aSparkAlpha);
                    gl.vertexAttribPointer(aSparkAlpha, 1, gl.FLOAT, false, SPARK_STRIDE, 12);

                    gl.drawArrays(gl.POINTS, 0, sparkCount);
                }

                // 6. Gravitational Orbit Satellites
                if (s.satellites && mouse.active) {
                    satellites.forEach((sat) => {
                        sat.angle += sat.speed;
                        const sx = mouse.x + Math.cos(sat.angle) * sat.radius;
                        const sy = mouse.y + Math.sin(sat.angle) * (sat.radius * 0.6);

                        // Draw satellite core and glow as sparks
                        const satSparks = new Float32Array([
                            sx, sy, sat.size, 1.0,
                            sx, sy, sat.size * 2.2, 0.25,
                        ]);

                        gl.useProgram(sparkProgram);
                        gl.uniform2f(uSparkResolution, width, height);
                        gl.uniform1f(uSparkDpr, dpr);
                        gl.uniform3f(uSparkColor, sat.color[0], sat.color[1], sat.color[2]);

                        gl.bindBuffer(gl.ARRAY_BUFFER, sparkVbo);
                        gl.bufferData(gl.ARRAY_BUFFER, satSparks, gl.DYNAMIC_DRAW);
                        gl.enableVertexAttribArray(aSparkPosition);
                        gl.vertexAttribPointer(aSparkPosition, 2, gl.FLOAT, false, 16, 0);
                        gl.enableVertexAttribArray(aSparkSize);
                        gl.vertexAttribPointer(aSparkSize, 1, gl.FLOAT, false, 16, 8);
                        gl.enableVertexAttribArray(aSparkAlpha);
                        gl.vertexAttribPointer(aSparkAlpha, 1, gl.FLOAT, false, 16, 12);
                        gl.drawArrays(gl.POINTS, 0, 2);
                    });
                }

                // Adaptive idle sleep:
                // When static and mouse stopped, completely stop RAF for 0.0% CPU!
                const isMouseMoving = mouse.active && (Math.abs(mouse.x - mouse.targetX) > 0.05 || Math.abs(mouse.y - mouse.targetY) > 0.05);
                const hasContinuousAnimation =
                    warpState.active ||
                    s.pulsation !== 'none' ||
                    (s.satellites && mouse.active) ||
                    shockwaves.length > 0 ||
                    sparkCount > 0;

                if (!hasContinuousAnimation && !isMouseMoving) {
                    idleFramesCount++;
                    if (idleFramesCount > 2) {
                        isRunning = false;
                        return; // Deep sleep (0% CPU)
                    }
                } else {
                    idleFramesCount = 0;
                }

                animationFrameId = requestAnimationFrame(renderGL);
            };

            const resizeObserver = new ResizeObserver(() => handleResize());
            resizeObserver.observe(container);
            handleResize();
            startLoop();

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

                shockwaves.push({ x: cx, y: cy, radius: 0, maxRadius: maxR, age: 0 });
                shockwaves.push({ x: cx, y: cy, radius: 0, maxRadius: maxR * 0.75, age: -0.06 });
                shockwaves.push({ x: cx, y: cy, radius: 0, maxRadius: maxR * 0.5, age: -0.12 });

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

                // Cleanup WebGL resources
                gl.deleteBuffer(dotVbo);
                gl.deleteBuffer(lineVbo);
                gl.deleteBuffer(sparkVbo);
                gl.deleteBuffer(quadVbo);
                gl.deleteProgram(dotProgram);
                gl.deleteProgram(lineProgram);
                gl.deleteProgram(sparkProgram);
                gl.deleteProgram(auroraProgram);
            };
        }

        // =========================================================================
        // CANVAS 2D FALLBACK (Used if WebGL fails or codeGlyphs is enabled)
        // =========================================================================
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let particles: Particle[] = [];
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

        const initParticles2D = () => {
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
                        centerDist: Math.sqrt(cdx * cdx + cdy * cdy),
                        centerAngle: Math.atan2(cdy, cdx),
                    });
                }
            }

            if (particles.length > maxBucketCapacity) {
                maxBucketCapacity = particles.length + 500;
                bucketLists = Array.from({ length: BUCKET_COUNT }, () => new Array(maxBucketCapacity));
            }
        };

        const startLoop2D = () => {
            if (!isRunning && isVisible && !isScrolling) {
                isRunning = true;
                idleFramesCount = 0;
                lastTime = performance.now();
                lastRenderTime = 0;
                animationFrameId = requestAnimationFrame(render2D);
            }
        };
        startLoopRef.current = startLoop2D;

        const handleResize2D = () => {
            const rect = container.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ctx.scale(dpr, dpr);
            initParticles2D();
            startLoop2D();
        };

        const render2D = (now: number) => {
            if (!isVisible || isScrolling) {
                isRunning = false;
                return;
            }

            const isInteractive =
                (mouse.active && (Math.abs(mouse.x - mouse.targetX) > 0.1 || Math.abs(mouse.y - mouse.targetY) > 0.1)) ||
                shockwaves.length > 0 ||
                warpState.active;
            const minFrameInterval = isInteractive ? 15.6 : 22.0;
            const elapsedSinceRender = now - lastRenderTime;

            if (lastRenderTime > 0 && elapsedSinceRender < minFrameInterval) {
                animationFrameId = requestAnimationFrame(render2D);
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

            bucketCounts.fill(0);
            activeNearMouseCount = 0;

            const spotRadius = s.spotlightRadius || 130;
            const spotRadiusSq = spotRadius * spotRadius;
            const peak = (s.spotlightPeakOpacity ?? 0.45) * (s.gridOpacity ?? 0.5);
            const ambientRatio = Math.min(
                1.0,
                (s.spotlightAmbientOpacity ?? 0.04) / Math.max(0.1, s.spotlightPeakOpacity ?? 0.45)
            );

            let particlesMoving = Math.abs(mouse.x - mouse.targetX) > 0.05 || Math.abs(mouse.y - mouse.targetY) > 0.05;
            const isCenterPulse = !s.spotlight || !mouse.active || mouse.x <= -200;
            const pulseCenterX = !isCenterPulse ? mouse.x : width / 2;
            const pulseCenterY = !isCenterPulse ? mouse.y : height / 2;

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

                let pulseScale = 1.0;
                if (s.spotlight) {
                    pulseScale = mouse.active ? (ambientRatio + (1.0 - ambientRatio) * spotFactor) : ambientRatio;
                }

                let pulseRadiusMod = 0;
                let pulseOpacityMod = 0;

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

                let targetX = p.originX + shockwaveX;
                let targetY = p.originY + shockwaveY;
                let mouseRadiusMod = 0;
                let mouseOpacityMod = 0;

                if (distSq < 12100 && s.meshLines && mouse.active) {
                    if (activeNearMouseCount < 600) {
                        activeNearMouseList[activeNearMouseCount++] = p;
                    }
                }

                if (s.physics !== 'none' && mouse.active && mouse.x > -200 && distSq < 48400) {
                    if (dist < 0) dist = Math.sqrt(distSq);
                    const factor = 1 - dist / 220;
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
                const finalTargetOpacity = Math.min(1.0, Math.max(0.0, baseOpacity + pulseOpacityMod + mouseOpacityMod));

                const deltaX = targetX - p.x;
                const deltaY = targetY - p.y;
                const deltaRadius = finalTargetRadius - p.radius;
                const deltaOpacity = finalTargetOpacity - p.opacity;

                p.x += deltaX * 0.35;
                p.y += deltaY * 0.35;
                p.radius += deltaRadius * 0.45;
                p.opacity += deltaOpacity * 0.45;

                if (
                    !particlesMoving &&
                    (Math.abs(deltaX) > 0.05 ||
                        Math.abs(deltaY) > 0.05 ||
                        Math.abs(deltaRadius) > 0.02 ||
                        Math.abs(deltaOpacity) > 0.01)
                ) {
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
                    continue;
                }

                if (p.opacity < 0.015) continue;

                const bIdx = Math.min(7, Math.max(0, (p.opacity * 8) | 0));
                const bCount = bucketCounts[bIdx];
                if (bCount < maxBucketCapacity) {
                    bucketLists[bIdx][bCount] = p;
                    bucketCounts[bIdx] = bCount + 1;
                }
            }

            // Batched 2D draw
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

            // Mesh lines 2D
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

            const hasContinuousAnimation =
                warpState.active ||
                s.pulsation !== 'none' ||
                (s.satellites && mouse.active) ||
                shockwaves.length > 0 ||
                sparks.length > 0;

            if (!hasContinuousAnimation && !particlesMoving) {
                idleFramesCount++;
                if (idleFramesCount > 2) {
                    isRunning = false;
                    return;
                }
            } else {
                idleFramesCount = 0;
            }

            animationFrameId = requestAnimationFrame(render2D);
        };

        const resizeObserver2D = new ResizeObserver(() => handleResize2D());
        resizeObserver2D.observe(container);
        handleResize2D();
        startLoop2D();

        const handleMouseMove2D = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            mouse.targetX = e.clientX - rect.left;
            mouse.targetY = e.clientY - rect.top;
            mouse.active = true;
            startLoop2D();
        };

        const handleMouseLeave2D = () => {
            mouse.active = false;
            mouse.targetX = -1000;
            mouse.targetY = -1000;
            startLoop2D();
        };

        const handleClick2D = (e: MouseEvent) => {
            const rect = container.getBoundingClientRect();
            shockwaves.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, radius: 0, maxRadius: 360, age: 0 });
            startLoop2D();
        };

        window.addEventListener('mousemove', handleMouseMove2D);
        document.addEventListener('mouseleave', handleMouseLeave2D);
        window.addEventListener('click', handleClick2D);

        return () => {
            startLoopRef.current = () => {};
            cancelAnimationFrame(animationFrameId);
            resizeObserver2D.disconnect();
            window.removeEventListener('mousemove', handleMouseMove2D);
            document.removeEventListener('mouseleave', handleMouseLeave2D);
            window.removeEventListener('click', handleClick2D);
        };
    }, [
        useWebGL,
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
                key={useWebGL ? 'bg-webgl' : 'bg-2d'}
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
