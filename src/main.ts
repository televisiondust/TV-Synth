import * as THREE from 'three';
import './style.css';
import { ModuleGraph } from './core/ModuleGraph';
import { ShaderGenerator } from './core/ShaderGenerator';
import { NodeEditor } from './ui/NodeEditor';
import postFrag from './shaders/post.frag?raw';

const PREVIEW_W = 640;
const PREVIEW_H = 480;

class TVSynth {
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    clock: THREE.Clock;
    renderTarget1!: THREE.WebGLRenderTarget;
    renderTarget2!: THREE.WebGLRenderTarget;
    geometry!: THREE.PlaneGeometry;
    synthMaterial!: THREE.ShaderMaterial;
    postMaterial!: THREE.ShaderMaterial;
    quad!: THREE.Mesh;
    postQuad!: THREE.Mesh;
    postScene: THREE.Scene;

    graph: ModuleGraph;
    nodeEditor: NodeEditor;
    needsRecompile = false;
    errorEl!: HTMLElement;

    // Video sources
    blackTex: THREE.DataTexture;
    camVideo: HTMLVideoElement;
    screenVideo: HTMLVideoElement;
    camTexture: THREE.VideoTexture | null = null;
    screenTexture: THREE.VideoTexture | null = null;

    constructor() {
        this.scene = new THREE.Scene();
        this.postScene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(PREVIEW_W, PREVIEW_H);

        this.renderer.debug.onShaderError = (_gl, _prog, _vert, frag) => {
            const gl = this.renderer.getContext();
            const log = gl.getShaderInfoLog(frag as WebGLShader) ?? 'Shader compilation failed';
            this.showError(log);
        };

        // Floating preview window — top-right corner
        const preview = document.createElement('div');
        preview.id = 'preview';
        const previewLabel = document.createElement('div');
        previewLabel.className = 'preview-label';
        previewLabel.textContent = 'OUTPUT';
        preview.appendChild(previewLabel);

        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'preview-resize-handle';
        preview.appendChild(resizeHandle);

        preview.appendChild(this.renderer.domElement);
        document.body.appendChild(preview);

        this.setupPreviewInteractivity(preview, resizeHandle);

        // 1×1 black texture used as placeholder for inactive video sources
        this.blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
        this.blackTex.needsUpdate = true;

        this.camVideo = this.makeVideoEl();
        this.screenVideo = this.makeVideoEl();

        this.clock = new THREE.Clock();
        this.graph = new ModuleGraph();

        this.setupInitialGraph();
        this.setupRenderTargets();
        this.setupMaterials();
        this.setupScene();

        const editorEl = document.getElementById('node-editor')!;
        this.nodeEditor = new NodeEditor(editorEl, this.graph, () => this.recompile());

        this.setupToolbar();

        this.errorEl = document.createElement('div');
        this.errorEl.id = 'shader-error';
        editorEl.appendChild(this.errorEl);

        this.animate();
    }

    private makeVideoEl(): HTMLVideoElement {
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;
        return v;
    }

    // ── Video source management ──────────────────────────────────────────────

    async initCam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            this.camVideo.srcObject = stream;
            await this.camVideo.play();
            this.camTexture = new THREE.VideoTexture(this.camVideo);
            this.camTexture.colorSpace = THREE.SRGBColorSpace;
            this.synthMaterial.uniforms.tCam.value = this.camTexture;
        } catch (err) {
            this.showError(`Camera access denied: ${err}`);
        }
    }

    async initScreen() {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            this.screenVideo.srcObject = stream;
            await this.screenVideo.play();
            this.screenTexture = new THREE.VideoTexture(this.screenVideo);
            this.screenTexture.colorSpace = THREE.SRGBColorSpace;
            this.synthMaterial.uniforms.tScreen.value = this.screenTexture;
            // Auto-stop when user ends screen share from browser UI
            stream.getVideoTracks()[0].addEventListener('ended', () => this.stopScreen());
        } catch (err) {
            this.showError(`Screen capture denied: ${err}`);
        }
    }

    stopCam() {
        (this.camVideo.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
        this.camVideo.srcObject = null;
        this.camTexture = null;
        this.synthMaterial.uniforms.tCam.value = this.blackTex;
    }

    stopScreen() {
        (this.screenVideo.srcObject as MediaStream | null)?.getTracks().forEach(t => t.stop());
        this.screenVideo.srcObject = null;
        this.screenTexture = null;
        this.synthMaterial.uniforms.tScreen.value = this.blackTex;
    }

    private setupPreviewInteractivity(preview: HTMLElement, resizeHandle: HTMLElement) {
        let isMoving = false;
        let isResizing = false;
        let startX = 0, startY = 0;
        let startW = 0, startH = 0;
        let startLeft = 0, startTop = 0;

        preview.addEventListener('mousedown', (e) => {
            if (e.target === resizeHandle) {
                isResizing = true;
                const rect = preview.getBoundingClientRect();
                startW = rect.width;
                startH = rect.height;
                preview.classList.add('resizing');
            } else {
                isMoving = true;
                const rect = preview.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
            }
            startX = e.clientX;
            startY = e.clientY;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (isMoving) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                preview.style.left = `${startLeft + dx}px`;
                preview.style.top = `${startTop + dy}px`;
                preview.style.right = 'auto'; // Disable right-anchor once moved
            } else if (isResizing) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                const newW = Math.max(160, startW + dx);
                const newH = Math.max(120, startH + dy);
                preview.style.width = `${newW}px`;
                preview.style.height = `${newH}px`;

                this.renderer.setSize(newW, newH);
                this.synthMaterial.uniforms.uResolution.value.set(newW, newH);
                this.postMaterial.uniforms.uResolution.value.set(newW, newH);

                // Re-create render targets if size changed significantly or just update them
                this.renderTarget1.setSize(newW, newH);
                this.renderTarget2.setSize(newW, newH);
            }
        });

        window.addEventListener('mouseup', () => {
            isMoving = false;
            isResizing = false;
            preview.classList.remove('resizing');
        });
    }

    // ── Graph / shader ───────────────────────────────────────────────────────

    setupInitialGraph() {
        const osc1 = this.graph.addModule('OSC', { dir: 0, freq: 5.0, speed: 1.0, type: 0, chromaOffset: 0.0 }, { x: 200, y: 260 });
        const output = this.graph.addModule('OUTPUT', {}, { x: 480, y: 260 });
        this.graph.connect(osc1, output, 'signal');
    }

    setupRenderTargets() {
        this.renderTarget1 = new THREE.WebGLRenderTarget(PREVIEW_W, PREVIEW_H);
        this.renderTarget2 = new THREE.WebGLRenderTarget(PREVIEW_W, PREVIEW_H);
    }

    setupMaterials() {
        const fragmentShader = ShaderGenerator.generateFragmentShader(this.graph);

        this.synthMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uResolution: { value: new THREE.Vector2(PREVIEW_W, PREVIEW_H) },
                tFeedback: { value: null },
                tCam: { value: this.blackTex },
                tScreen: { value: this.blackTex },
            },
            fragmentShader,
            vertexShader: `
                varying vec2 vUv;
                void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
            `,
        });

        this.postMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                uResolution: { value: new THREE.Vector2(PREVIEW_W, PREVIEW_H) },
                uScanlineIntensity: { value: 0.3 },
                uCurvature: { value: 0.2 },
                uChromaticAberration: { value: 0.005 },
                uTime: { value: 0 },
            },
            fragmentShader: postFrag,
            vertexShader: `
                varying vec2 vUv;
                void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
            `,
        });
    }

    setupScene() {
        this.geometry = new THREE.PlaneGeometry(2, 2);
        this.quad = new THREE.Mesh(this.geometry, this.synthMaterial);
        this.scene.add(this.quad);
        this.postQuad = new THREE.Mesh(this.geometry, this.postMaterial);
        this.postScene.add(this.postQuad);
    }

    recompile() { this.needsRecompile = true; }

    updateShader() {
        this.clearError();

        // Activate/deactivate video sources based on current graph
        const mods = Array.from(this.graph.modules.values());
        const hasCam = mods.some(m => m.type === 'CAMERA');
        const hasScreen = mods.some(m => m.type === 'SCREEN');

        if (hasCam && !this.camTexture) this.initCam();
        if (!hasCam && this.camTexture) this.stopCam();
        if (hasScreen && !this.screenTexture) this.initScreen();
        if (!hasScreen && this.screenTexture) this.stopScreen();

        const newShader = ShaderGenerator.generateFragmentShader(this.graph);
        this.synthMaterial.fragmentShader = newShader;
        this.synthMaterial.needsUpdate = true;
        this.needsRecompile = false;
    }

    showError(msg: string) {
        const lines = msg.split('\n').filter(l => l.trim().length > 0);
        this.errorEl.textContent = lines.join('\n');
        this.errorEl.style.display = 'block';
    }

    clearError() {
        this.errorEl.style.display = 'none';
        this.errorEl.textContent = '';
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        if (this.needsRecompile) this.updateShader();

        // Keep video textures fresh
        if (this.camTexture) this.camTexture.needsUpdate = true;
        if (this.screenTexture) this.screenTexture.needsUpdate = true;

        const time = this.clock.getElapsedTime();
        this.synthMaterial.uniforms.uTime.value = time;
        this.postMaterial.uniforms.uTime.value = time;

        this.synthMaterial.uniforms.tFeedback.value = this.renderTarget2.texture;
        this.renderer.setRenderTarget(this.renderTarget1);
        this.renderer.render(this.scene, this.camera);

        this.postMaterial.uniforms.tDiffuse.value = this.renderTarget1.texture;
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.postScene, this.camera);

        const temp = this.renderTarget1;
        this.renderTarget1 = this.renderTarget2;
        this.renderTarget2 = temp;
    }
    private setupToolbar() {
        const toolbar = document.createElement('div');
        toolbar.className = 'toolbar';
        document.body.appendChild(toolbar);

        // Move the menu trigger into the toolbar if it exists, or let NodeEditor handle it
        // Actually, let's keep NodeEditor's trigger and add Save/Load next to it
        const trigger = document.querySelector('.menu-trigger') as HTMLElement;
        if (trigger) toolbar.appendChild(trigger);

        const saveBtn = document.createElement('button');
        saveBtn.className = 'toolbar-btn';
        saveBtn.innerHTML = 'Save Patch';
        saveBtn.onclick = () => this.savePatch();
        toolbar.appendChild(saveBtn);

        const loadBtn = document.createElement('button');
        loadBtn.className = 'toolbar-btn';
        loadBtn.innerHTML = 'Load Patch';
        loadBtn.onclick = () => this.loadPatch();
        toolbar.appendChild(loadBtn);
    }

    private savePatch() {
        const json = this.graph.toJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tvsynth-patch-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    private loadPatch() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (re) => {
                const content = re.target?.result as string;
                try {
                    this.graph.fromJSON(content);
                    this.nodeEditor.render();
                    this.recompile();
                } catch (err) {
                    this.showError(`Failed to load patch: ${err}`);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }
}

new TVSynth();
