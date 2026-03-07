import { ModuleGraph, type ModuleType, type ModuleState } from '../core/ModuleGraph';

const UV_PORT = 'uv';

const PORT_DEFS: Record<string, { inputs: string[]; outputs: string[] }> = {
    OSC: { inputs: ['uv'], outputs: ['out'] },
    NOISE: { inputs: ['uv'], outputs: ['out'] },
    SHAPE: { inputs: ['uv'], outputs: ['out'] },
    HATCH: { inputs: ['uv'], outputs: ['out'] },
    CAMERA: { inputs: ['uv'], outputs: ['out'] },
    SCREEN: { inputs: ['uv'], outputs: ['out'] },
    COLOR: { inputs: ['src'], outputs: ['out'] },
    BLEND: { inputs: ['uv', 'a', 'b'], outputs: ['out'] },
    FEEDBACK: { inputs: ['uv', 'src'], outputs: ['out'] },
    ROTATE: { inputs: ['uv'], outputs: ['uv'] },
    SCALE: { inputs: ['uv'], outputs: ['uv'] },
    SCROLL: { inputs: ['uv'], outputs: ['uv'] },
    KALEID: { inputs: ['uv'], outputs: ['uv'] },
    PIXELATE: { inputs: ['uv'], outputs: ['uv'] },
    WARP: { inputs: ['uv', 'src'], outputs: ['uv'] },
    MIRROR: { inputs: ['uv'], outputs: ['uv'] },
    OUTPUT: { inputs: ['signal'], outputs: [] },
};

const MODULE_COLOR: Record<string, string> = {
    OSC: '#ff6b6b',
    NOISE: '#ffa040',
    SHAPE: '#ffd93d',
    HATCH: '#b8f5b8',
    CAMERA: '#00cec9',
    SCREEN: '#00b4d8',
    COLOR: '#a29bfe',
    BLEND: '#55efc4',
    FEEDBACK: '#fd79a8',
    ROTATE: '#74b9ff',
    SCALE: '#0984e3',
    SCROLL: '#6c5ce7',
    KALEID: '#e17055',
    PIXELATE: '#00b894',
    WARP: '#e84393',
    MIRROR: '#81ecec',
    OUTPUT: '#b2bec3',
};

const MENU_GROUPS: { label: string; types: ModuleType[] }[] = [
    { label: 'Sources', types: ['OSC', 'NOISE', 'SHAPE', 'HATCH'] },
    { label: 'Live Input', types: ['CAMERA', 'SCREEN'] },
    { label: 'Color / Mix', types: ['COLOR', 'BLEND', 'FEEDBACK'] },
    { label: 'Transforms', types: ['ROTATE', 'SCALE', 'SCROLL', 'KALEID', 'PIXELATE', 'WARP', 'MIRROR'] },
];

interface DragState {
    id: string;
    startX: number; startY: number;
    startMX: number; startMY: number;
}

interface ConnectState {
    fromId: string;
    fromPort: string;
    isOutput: boolean;
    tmpLine: SVGPathElement;
}

export class NodeEditor {
    private container: HTMLElement;
    private svg: SVGSVGElement;
    private nodeLayer: HTMLElement;
    private menuEl!: HTMLElement;
    private triggerEl!: HTMLElement;
    private menuOpen = false;
    private menuSpawnPos: { x: number; y: number } | null = null;

    private graph: ModuleGraph;
    private onChange: () => void;
    private dragging: DragState | null = null;
    private connecting: ConnectState | null = null;

    private pan = { x: 0, y: 0 };
    private zoom = 1;
    private isPanning = false;
    private panStart = { x: 0, y: 0 };
    private transformLayer: HTMLElement;
    private contextConn: { fromId: string; toId: string; inputName: string } | null = null;
    private helpOverlay!: HTMLElement;
    private helpVisible = true;

    constructor(container: HTMLElement, graph: ModuleGraph, onChange: () => void) {
        this.container = container;
        this.graph = graph;
        this.onChange = onChange;

        // Layer -1: Background for panning/contextmenu
        const bg = document.createElement('div');
        bg.className = 'node-editor-bg';
        container.appendChild(bg);

        // Layer 0: Transform wrapper
        this.transformLayer = document.createElement('div');
        this.transformLayer.className = 'node-transform-layer';
        container.appendChild(this.transformLayer);

        // Layer 1: SVG for connection lines
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
        this.svg.classList.add('node-svg');
        this.transformLayer.appendChild(this.svg);

        // Layer 2: node cards
        this.nodeLayer = document.createElement('div');
        this.nodeLayer.className = 'node-layer';
        this.transformLayer.appendChild(this.nodeLayer);

        // Layer 3: module menu + trigger (above everything)
        this.createMenu();

        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        this.container.addEventListener('wheel', this.onWheel, { passive: false });
        bg.addEventListener('mousedown', this.onMouseDown);

        // Click-to-connect: clicking outside any port cancels a pending connection
        window.addEventListener('click', this.onWindowClick);
        // Escape key cancels
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.connecting) this.cancelConnect();
        });

        window.addEventListener('contextmenu', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.node-card') || target.closest('#preview') || target.closest('.module-menu') || target.closest('.menu-trigger') || target.closest('.port-dot')) return;

            // Check if right-clicking a connection line
            if (target.classList.contains('conn-line')) {
                // We'll handle this later for node insertion
                return;
            }
            this.contextConn = null;
            e.preventDefault();
            if (this.menuOpen) this.closeMenu();
            this.openMenuAt(e.clientX, e.clientY);
        });

        this.render();
        this.applyTransform();
        this.createHelpOverlay();
        requestAnimationFrame(() => this.drawConnections());
    }

    private applyTransform() {
        this.transformLayer.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.zoom})`;
    }

    private screenToCanvas(x: number, y: number) {
        const r = this.container.getBoundingClientRect();
        return {
            x: (x - r.left - this.pan.x) / this.zoom,
            y: (y - r.top - this.pan.y) / this.zoom
        };
    }

    private onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = Math.pow(1.05, delta / 100);
        const newZoom = Math.min(Math.max(this.zoom * factor, 0.1), 5);

        const mouseCanvas = this.screenToCanvas(e.clientX, e.clientY);
        this.zoom = newZoom;

        const r = this.container.getBoundingClientRect();
        this.pan.x = e.clientX - r.left - mouseCanvas.x * this.zoom;
        this.pan.y = e.clientY - r.top - mouseCanvas.y * this.zoom;

        this.applyTransform();
        this.drawConnections();
    };

    private onMouseDown = (e: MouseEvent) => {
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            this.isPanning = true;
            this.panStart = { x: e.clientX - this.pan.x, y: e.clientY - this.pan.y };
            e.preventDefault();
        }
    };

    private createHelpOverlay() {
        this.helpOverlay = document.createElement('div');
        this.helpOverlay.className = 'help-overlay';
        if (this.helpVisible) this.helpOverlay.classList.add('open');

        this.helpOverlay.innerHTML = `
            <div class="help-header">CONTROLS</div>
            <div class="help-grid">
                <div class="help-item"><span class="key">Wheel</span> Zoom in/out</div>
                <div class="help-item"><span class="key">Middle Click</span> Pan graph</div>
                <div class="help-item"><span class="key">Alt+LClick</span> Pan graph</div>
                <div class="help-item"><span class="key">Click Port</span> Start wire</div>
                <div class="help-item"><span class="key">Click Port</span> Connect / cancel</div>
                <div class="help-item"><span class="key">Escape</span> Cancel wire</div>
                <div class="help-item"><span class="key">DblClick Wire</span> Disconnect</div>
                <div class="help-item"><span class="key">RClick Wire</span> Insert node</div>
                <div class="help-item"><span class="key">RClick BG</span> Add module</div>
            </div>
            <button class="help-close">Got it</button>
        `;

        this.helpOverlay.querySelector('.help-close')?.addEventListener('click', () => this.toggleHelp());
        document.body.appendChild(this.helpOverlay);
    }

    public toggleHelp() {
        this.helpVisible = !this.helpVisible;
        this.helpOverlay.classList.toggle('open', this.helpVisible);
    }

    public tidyNodes() {
        const mods = Array.from(this.graph.modules.values());
        const levels = new Map<string, number>();

        // Simple topological sort for leveling
        const getLevel = (id: string): number => {
            if (levels.has(id)) return levels.get(id)!;
            const inputs = this.graph.connections.filter(c => c.toId === id);
            if (inputs.length === 0) {
                levels.set(id, 0);
                return 0;
            }
            const level = Math.max(...inputs.map(c => getLevel(c.fromId))) + 1;
            levels.set(id, level);
            return level;
        };

        mods.forEach(m => getLevel(m.id));

        const layerMap: Record<number, string[]> = {};
        mods.forEach(m => {
            const l = levels.get(m.id) || 0;
            if (!layerMap[l]) layerMap[l] = [];
            layerMap[l].push(m.id);
        });

        Object.keys(layerMap).forEach(levelStr => {
            const level = parseInt(levelStr);
            const ids = layerMap[level];

            // Sort ids by their primary input's Y position to minimize wire crossing
            ids.sort((a, b) => {
                const aInputs = this.graph.connections.filter(c => c.toId === a);
                const bInputs = this.graph.connections.filter(c => c.toId === b);
                const aAvgY = aInputs.length > 0 ? aInputs.reduce((sum, c) => sum + (this.graph.getModule(c.fromId)?.position.y || 0), 0) / aInputs.length : 0;
                const bAvgY = bInputs.length > 0 ? bInputs.reduce((sum, c) => sum + (this.graph.getModule(c.fromId)?.position.y || 0), 0) / bInputs.length : 0;
                return aAvgY - bAvgY;
            });

            const totalNodes = ids.length;
            const columnHeight = (totalNodes - 1) * 280;
            const startY = 150 - columnHeight / 2; // Center column roughly at Y=150

            ids.forEach((id, i) => {
                const mod = this.graph.getModule(id)!;
                mod.position.x = 50 + level * 280;

                // Try to center node between its inputs if possible
                const inputs = this.graph.connections.filter(c => c.toId === id);
                if (inputs.length > 0) {
                    const avgInputY = inputs.reduce((sum, c) => {
                        const fromMod = this.graph.getModule(c.fromId);
                        return sum + (fromMod ? fromMod.position.y : 0);
                    }, 0) / inputs.length;
                    mod.position.y = avgInputY;
                } else {
                    mod.position.y = startY + i * 280;
                }
            });

            // Adjust nodes in this layer that might overlap
            ids.sort((a, b) => this.graph.getModule(a)!.position.y - this.graph.getModule(b)!.position.y);
            for (let i = 1; i < ids.length; i++) {
                const prevMod = this.graph.getModule(ids[i - 1])!;
                const currMod = this.graph.getModule(ids[i])!;
                const minDist = 200;
                if (currMod.position.y < prevMod.position.y + minDist) {
                    currMod.position.y = prevMod.position.y + minDist;
                }
            }
        });

        this.render();
        this.onChange();
    }

    private createMenu() {
        // Trigger button — fixed bottom-left
        this.triggerEl = document.createElement('button');
        this.triggerEl.className = 'menu-trigger';
        this.triggerEl.innerHTML = `<span class="menu-trigger-icon">+</span> Add Module`;
        this.triggerEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.menuOpen) {
                this.closeMenu();
            } else {
                const r = this.triggerEl.getBoundingClientRect();
                this.openMenuAt(r.left, r.top);
            }
        });
        this.container.appendChild(this.triggerEl);

        // Popup panel
        this.menuEl = document.createElement('div');
        this.menuEl.className = 'module-menu';

        MENU_GROUPS.forEach(group => {
            const sec = document.createElement('div');
            sec.className = 'menu-section';

            const lbl = document.createElement('div');
            lbl.className = 'menu-section-label';
            lbl.textContent = group.label;
            sec.appendChild(lbl);

            const grid = document.createElement('div');
            grid.className = 'menu-grid';

            group.types.forEach(type => {
                const btn = document.createElement('button');
                btn.className = 'menu-module-btn';
                btn.style.setProperty('--accent', MODULE_COLOR[type]);
                btn.textContent = type;
                btn.addEventListener('click', () => {
                    this.addModule(type);
                    // Keep menu open so you can chain adds
                });
                grid.appendChild(btn);
            });

            sec.appendChild(grid);
            this.menuEl.appendChild(sec);
        });

        this.container.appendChild(this.menuEl);

        // Close on outside click
        document.addEventListener('mousedown', (e) => {
            if (this.menuOpen
                && !this.menuEl.contains(e.target as Node)
                && e.target !== this.triggerEl
                && !(this.triggerEl as HTMLElement).contains(e.target as Node)) {
                this.closeMenu();
            }
        });
    }

    private openMenuAt(x: number, y: number) {
        const mw = 272;
        // Temporarily open off-screen to measure height
        this.menuEl.style.visibility = 'hidden';
        this.menuEl.classList.add('open');
        const mh = this.menuEl.offsetHeight || 340;
        this.menuEl.style.visibility = '';

        // Open above cursor by default, flip below if no room
        let left = x;
        let top = y - mh - 8;
        if (top < 8) top = y + 16;
        if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
        if (left < 8) left = 8;
        if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;

        this.menuEl.style.left = left + 'px';
        this.menuEl.style.top = top + 'px';
        this.menuSpawnPos = { x, y };
        this.menuOpen = true;
        this.triggerEl.classList.add('active');
    }

    private closeMenu() {
        this.menuOpen = false;
        this.menuEl.classList.remove('open');
        this.triggerEl.classList.remove('active');
        this.menuSpawnPos = null;
    }

    render() {
        this.nodeLayer.querySelectorAll('.node-card').forEach(n => n.remove());
        this.graph.modules.forEach(mod => this.nodeLayer.appendChild(this.createNodeEl(mod)));
        requestAnimationFrame(() => this.drawConnections());
    }

    private createNodeEl(mod: ModuleState): HTMLElement {
        const ports = PORT_DEFS[mod.type] ?? { inputs: [], outputs: [] };
        const color = MODULE_COLOR[mod.type] ?? '#888';

        const node = document.createElement('div');
        node.className = 'node-card';
        node.dataset.id = mod.id;
        node.style.left = mod.position.x + 'px';
        node.style.top = mod.position.y + 'px';
        node.style.setProperty('--node-color', color);

        const header = document.createElement('div');
        header.className = 'node-header';
        header.textContent = mod.type;
        header.addEventListener('mousedown', e => { e.preventDefault(); this.startDrag(e, mod.id); });
        node.appendChild(header);

        const body = document.createElement('div');
        body.className = 'node-body';
        ports.inputs.forEach(p => body.appendChild(this.makePortRow(mod.id, p, false)));
        const params = this.makeParamsEl(mod);
        if (params) body.appendChild(params);
        ports.outputs.forEach(p => body.appendChild(this.makePortRow(mod.id, p, true)));
        node.appendChild(body);

        if (mod.type !== 'OUTPUT') {
            const del = document.createElement('button');
            del.className = 'node-delete';
            del.textContent = '×';
            del.addEventListener('click', () => { this.graph.removeModule(mod.id); this.render(); this.onChange(); });
            node.appendChild(del);
        }
        return node;
    }

    private makePortRow(id: string, portName: string, isOutput: boolean): HTMLElement {
        const row = document.createElement('div');
        row.className = `port-row ${isOutput ? 'port-row-out' : 'port-row-in'}`;

        const isUv = portName === UV_PORT;
        const isConnected = isOutput
            ? this.graph.connections.some(c => c.fromId === id) // Note: this is simple, might need to match port name if there were multiple outputs
            : this.graph.connections.some(c => c.toId === id && c.inputName === portName);

        const dot = document.createElement('div');
        dot.className = `port-dot ${isOutput ? 'port-dot-out' : 'port-dot-in'} ${isUv ? 'port-uv' : ''} ${isConnected ? 'connected' : ''}`;
        dot.dataset.id = id;
        dot.dataset.port = portName;
        dot.dataset.portType = isOutput ? 'output' : 'input';
        dot.addEventListener('click', e => {
            e.stopPropagation();
            if (this.connecting) {
                // Second click — try to complete the connection
                const targetIsOutput = dot.dataset.portType === 'output';
                if (this.connecting.isOutput && !targetIsOutput) {
                    this.graph.connect(this.connecting.fromId, id, portName);
                    this.cancelConnect();
                    this.render(); this.onChange();
                } else if (!this.connecting.isOutput && targetIsOutput) {
                    this.graph.connect(id, this.connecting.fromId, this.connecting.fromPort);
                    this.cancelConnect();
                    this.render(); this.onChange();
                } else {
                    // Same polarity — start fresh from this port
                    this.startConnect(id, portName, isOutput);
                }
            } else {
                // First click — start connecting
                this.startConnect(id, portName, isOutput);
            }
        });

        const label = document.createElement('span');
        label.className = `port-label ${isUv ? 'port-label-uv' : ''}`;
        label.textContent = portName;

        if (isOutput) { row.appendChild(label); row.appendChild(dot); }
        else { row.appendChild(dot); row.appendChild(label); }
        return row;
    }

    private makeParamsEl(mod: ModuleState): HTMLElement | null {
        const wrap = document.createElement('div');
        wrap.className = 'node-params';

        const row = (label: string, el: HTMLElement) => {
            const r = document.createElement('div');
            r.className = 'node-param-row';
            const lbl = document.createElement('span');
            lbl.className = 'param-label';
            lbl.textContent = label;
            r.appendChild(lbl);
            // Sliders get zero-tick + value readout automatically
            if (el instanceof HTMLInputElement && el.type === 'range') {
                r.appendChild(this.wrapSlider(el));
            } else {
                r.appendChild(el);
            }
            wrap.appendChild(r);
        };

        switch (mod.type) {
            case 'OSC': {
                const d = this.makeSelect([['0', 'H'], ['1', 'V'], ['2', 'Radial'], ['3', 'Diag']], mod.params.dir ?? 0);
                d.addEventListener('change', () => { mod.params.dir = parseInt(d.value); this.onChange(); });
                row('Dir', d);
                const w = this.makeSelect([['0', 'Sine'], ['1', 'Square'], ['2', 'Tri'], ['3', 'Saw']], mod.params.type ?? 0);
                w.addEventListener('change', () => { mod.params.type = parseInt(w.value); this.onChange(); });
                row('Wave', w);
                const f = this.makeSlider(0.1, 30, 0.1, mod.params.freq ?? 5);
                f.addEventListener('input', () => { mod.params.freq = parseFloat(f.value); this.onChange(); });
                row('Freq', f);
                const s = this.makeSlider(-8, 8, 0.05, mod.params.speed ?? 1);
                s.addEventListener('input', () => { mod.params.speed = parseFloat(s.value); this.onChange(); });
                row('Speed', s);
                const c = this.makeSlider(0, 0.2, 0.001, mod.params.chromaOffset ?? 0);
                c.addEventListener('input', () => { mod.params.chromaOffset = parseFloat(c.value); this.onChange(); });
                row('Chroma', c);
                const an = this.makeSlider(0, 1, 0.01, mod.params.analog ?? 0);
                an.addEventListener('input', () => { mod.params.analog = parseFloat(an.value); this.onChange(); });
                row('Analog', an);
                break;
            }
            case 'NOISE': {
                const sc = this.makeSlider(0.5, 20, 0.1, mod.params.scale ?? 4);
                sc.addEventListener('input', () => { mod.params.scale = parseFloat(sc.value); this.onChange(); });
                row('Scale', sc);
                const sp = this.makeSlider(-4, 4, 0.05, mod.params.speed ?? 0.5);
                sp.addEventListener('input', () => { mod.params.speed = parseFloat(sp.value); this.onChange(); });
                row('Speed', sp);
                const an = this.makeSlider(0, 1, 0.01, mod.params.analog ?? 0);
                an.addEventListener('input', () => { mod.params.analog = parseFloat(an.value); this.onChange(); });
                row('Analog', an);
                break;
            }
            case 'SHAPE': {
                const t = this.makeSelect([['0', 'Circle'], ['1', 'Rect'], ['2', 'Cross'], ['3', 'Diamond']], mod.params.type ?? 0);
                t.addEventListener('change', () => { mod.params.type = parseInt(t.value); this.onChange(); });
                row('Type', t);
                const r2 = this.makeSlider(0.01, 0.99, 0.01, mod.params.radius ?? 0.4);
                r2.addEventListener('input', () => { mod.params.radius = parseFloat(r2.value); this.onChange(); });
                row('Size', r2);
                const sm = this.makeSlider(0.001, 0.2, 0.001, mod.params.smooth ?? 0.02);
                sm.addEventListener('input', () => { mod.params.smooth = parseFloat(sm.value); this.onChange(); });
                row('Edge', sm);
                const ch = this.makeSlider(0, 0.12, 0.001, mod.params.chroma ?? 0);
                ch.addEventListener('input', () => { mod.params.chroma = parseFloat(ch.value); this.onChange(); });
                row('Chroma', ch);
                const an = this.makeSlider(0, 1, 0.01, mod.params.analog ?? 0);
                an.addEventListener('input', () => { mod.params.analog = parseFloat(an.value); this.onChange(); });
                row('Analog', an);
                break;
            }

            case 'HATCH': {
                const f = this.makeSlider(2, 40, 0.5, mod.params.freq ?? 10);
                f.addEventListener('input', () => { mod.params.freq = parseFloat(f.value); this.onChange(); });
                row('Freq', f);
                const th = this.makeSlider(0.01, 0.99, 0.01, mod.params.thickH ?? 0.3);
                th.addEventListener('input', () => { mod.params.thickH = parseFloat(th.value); this.onChange(); });
                row('ThickH', th);
                const tv = this.makeSlider(0.01, 0.99, 0.01, mod.params.thickV ?? 0.3);
                tv.addEventListener('input', () => { mod.params.thickV = parseFloat(tv.value); this.onChange(); });
                row('ThickV', tv);
                const ed = this.makeSlider(0.001, 0.3, 0.001, mod.params.edge ?? 0.01);
                ed.addEventListener('input', () => { mod.params.edge = parseFloat(ed.value); this.onChange(); });
                row('Edge', ed);
                const ch2 = this.makeSlider(0, 0.12, 0.001, mod.params.chroma ?? 0);
                ch2.addEventListener('input', () => { mod.params.chroma = parseFloat(ch2.value); this.onChange(); });
                row('Chroma', ch2);
                const an = this.makeSlider(0, 1, 0.01, mod.params.analog ?? 0);
                an.addEventListener('input', () => { mod.params.analog = parseFloat(an.value); this.onChange(); });
                row('Analog', an);
                break;
            }
            case 'COLOR': {
                const h = this.makeSlider(0, 1, 0.005, mod.params.hue ?? 0);
                h.addEventListener('input', () => { mod.params.hue = parseFloat(h.value); this.onChange(); });
                row('Hue', h);
                const sa = this.makeSlider(0, 3, 0.05, mod.params.saturation ?? 1);
                sa.addEventListener('input', () => { mod.params.saturation = parseFloat(sa.value); this.onChange(); });
                row('Sat', sa);
                const b = this.makeSlider(0, 3, 0.05, mod.params.brightness ?? 1);
                b.addEventListener('input', () => { mod.params.brightness = parseFloat(b.value); this.onChange(); });
                row('Bright', b);
                const co = this.makeSlider(0, 4, 0.05, mod.params.contrast ?? 1);
                co.addEventListener('input', () => { mod.params.contrast = parseFloat(co.value); this.onChange(); });
                row('Contrast', co);
                break;
            }
            case 'BLEND': {
                const m = this.makeSelect([['0', 'Mix'], ['1', 'Add'], ['2', 'Mult'], ['3', 'Diff'], ['4', 'Screen']], mod.params.mode ?? 0);
                m.addEventListener('change', () => { mod.params.mode = parseInt(m.value); this.onChange(); });
                row('Mode', m);
                const a = this.makeSlider(0, 1, 0.01, mod.params.amount ?? 0.5);
                a.addEventListener('input', () => { mod.params.amount = parseFloat(a.value); this.onChange(); });
                row('Mix', a);
                break;
            }
            case 'FEEDBACK': {
                const d = this.makeSlider(0, 0.99, 0.005, mod.params.decay ?? 0.8);
                d.addEventListener('input', () => { mod.params.decay = parseFloat(d.value); this.onChange(); });
                row('Decay', d);
                break;
            }
            case 'ROTATE': {
                const a = this.makeSlider(-3.14159, 3.14159, 0.01, mod.params.angle ?? 0);
                a.addEventListener('input', () => { mod.params.angle = parseFloat(a.value); this.onChange(); });
                row('Angle', a);
                const s = this.makeSlider(-2, 2, 0.01, mod.params.speed ?? 0);
                s.addEventListener('input', () => { mod.params.speed = parseFloat(s.value); this.onChange(); });
                row('Speed', s);
                break;
            }
            case 'SCALE': {
                const x = this.makeSlider(0.1, 4, 0.01, mod.params.sx ?? 1);
                x.addEventListener('input', () => { mod.params.sx = parseFloat(x.value); this.onChange(); });
                row('X', x);
                const y = this.makeSlider(0.1, 4, 0.01, mod.params.sy ?? 1);
                y.addEventListener('input', () => { mod.params.sy = parseFloat(y.value); this.onChange(); });
                row('Y', y);
                break;
            }
            case 'SCROLL': {
                const sx = this.makeSlider(-1, 1, 0.005, mod.params.speedX ?? 0.1);
                sx.addEventListener('input', () => { mod.params.speedX = parseFloat(sx.value); this.onChange(); });
                row('SpeedX', sx);
                const sy = this.makeSlider(-1, 1, 0.005, mod.params.speedY ?? 0);
                sy.addEventListener('input', () => { mod.params.speedY = parseFloat(sy.value); this.onChange(); });
                row('SpeedY', sy);
                const tx = this.makeSlider(-1, 1, 0.005, mod.params.tx ?? 0);
                tx.addEventListener('input', () => { mod.params.tx = parseFloat(tx.value); this.onChange(); });
                row('OffX', tx);
                const ty = this.makeSlider(-1, 1, 0.005, mod.params.ty ?? 0);
                ty.addEventListener('input', () => { mod.params.ty = parseFloat(ty.value); this.onChange(); });
                row('OffY', ty);
                break;
            }
            case 'KALEID': {
                const s = this.makeSelect([['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['8', '8'], ['12', '12']], mod.params.sides ?? 4);
                s.addEventListener('change', () => { mod.params.sides = parseInt(s.value); this.onChange(); });
                row('Sides', s);
                break;
            }
            case 'PIXELATE': {
                const p = this.makeSlider(4, 256, 1, mod.params.pixels ?? 32);
                p.addEventListener('input', () => { mod.params.pixels = parseFloat(p.value); this.onChange(); });
                row('Pixels', p);
                break;
            }
            case 'WARP': {
                const a = this.makeSlider(0, 1, 0.005, mod.params.amount ?? 0.2);
                a.addEventListener('input', () => { mod.params.amount = parseFloat(a.value); this.onChange(); });
                row('Amount', a);
                break;
            }
            case 'MIRROR': {
                const mx = this.makeSelect([['0', 'Off'], ['1', 'On']], mod.params.mirrorX ?? 1);
                mx.addEventListener('change', () => { mod.params.mirrorX = parseInt(mx.value); this.onChange(); });
                row('X', mx);
                const my = this.makeSelect([['0', 'Off'], ['1', 'On']], mod.params.mirrorY ?? 0);
                my.addEventListener('change', () => { mod.params.mirrorY = parseInt(my.value); this.onChange(); });
                row('Y', my);
                break;
            }
            case 'CAMERA': {
                const fl = this.makeSelect([['1', 'Mirror'], ['0', 'Normal']], mod.params.flip ?? 1);
                fl.addEventListener('change', () => { mod.params.flip = parseInt(fl.value); this.onChange(); });
                row('Flip', fl);
                break;
            }
            case 'OUTPUT': {
                const gr = this.makeSlider(0, 0.3, 0.002, mod.params.noiseAmount ?? 0);
                gr.addEventListener('input', () => { mod.params.noiseAmount = parseFloat(gr.value); this.onChange(); });
                row('Grain', gr);
                const sc = this.makeSlider(0, 1, 0.01, mod.params.scanlineIntensity ?? 0);
                sc.addEventListener('input', () => { mod.params.scanlineIntensity = parseFloat(sc.value); this.onChange(); });
                row('Scanlines', sc);
                const crt = this.makeSlider(0, 0.5, 0.005, mod.params.crtWarp ?? 0);
                crt.addEventListener('input', () => { mod.params.crtWarp = parseFloat(crt.value); this.onChange(); });
                row('CRT Warp', crt);
                break;
            }
            default:
                return null;
        }
        return wrap;
    }

    // Wraps a range input with: zero-tick (if bipolar) + live value readout
    private wrapSlider(input: HTMLInputElement): HTMLElement {
        const min = parseFloat(input.min);
        const max = parseFloat(input.max);

        const outer = document.createElement('div');
        outer.className = 'slider-outer';

        const sliderWrap = document.createElement('div');
        sliderWrap.className = 'slider-wrap';

        if (min < 0 && max > 0) {
            const tick = document.createElement('div');
            tick.className = 'slider-zero-tick';
            tick.style.left = `${((-min / (max - min)) * 100).toFixed(1)}%`;
            sliderWrap.appendChild(tick);
        }
        sliderWrap.appendChild(input);
        outer.appendChild(sliderWrap);

        const valEl = document.createElement('span');
        valEl.className = 'slider-val';
        const fmt = () => this.fmtVal(input.value, input.step);
        valEl.textContent = fmt();
        input.addEventListener('input', () => { valEl.textContent = fmt(); });
        outer.appendChild(valEl);

        return outer;
    }

    private fmtVal(val: string, step: string): string {
        const v = parseFloat(val);
        const s = parseFloat(step);
        if (s >= 1) return String(Math.round(v));
        if (s >= 0.1) return v.toFixed(1);
        if (s >= 0.01) return v.toFixed(2);
        return v.toFixed(3);
    }

    private makeSelect(options: [string, string][], value: any): HTMLSelectElement {
        const sel = document.createElement('select');
        sel.className = 'ns-select';
        options.forEach(([v, l]) => {
            const o = document.createElement('option');
            o.value = v; o.textContent = l;
            if (parseInt(v) === parseInt(String(value))) o.selected = true;
            sel.appendChild(o);
        });
        return sel;
    }

    private makeSlider(min: number, max: number, step: number, value: number): HTMLInputElement {
        const s = document.createElement('input');
        s.type = 'range'; s.className = 'ns-slider';
        s.min = String(min); s.max = String(max);
        s.step = String(step); s.value = String(value);
        return s;
    }

    // --- Drag ---
    private startDrag(e: MouseEvent, id: string) {
        const mod = this.graph.modules.get(id)!;
        this.dragging = { id, startX: mod.position.x, startY: mod.position.y, startMX: e.clientX, startMY: e.clientY };
    }

    // --- Connect ---
    private startConnect(id: string, port: string, isOutput: boolean) {
        // If already connecting from same port, cancel (toggle off)
        if (this.connecting && this.connecting.fromId === id && this.connecting.fromPort === port) {
            this.cancelConnect();
            return;
        }
        if (this.connecting) this.cancelConnect();

        const tmpLine = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
        tmpLine.classList.add('conn-temp', port === UV_PORT ? 'conn-temp-uv' : 'conn-temp-sig');
        this.svg.appendChild(tmpLine);
        this.connecting = { fromId: id, fromPort: port, isOutput, tmpLine };
        this.container.classList.add('pending-connect');
    }

    private cancelConnect() {
        if (!this.connecting) return;
        this.container.querySelectorAll('.port-dot').forEach(p => p.classList.remove('snap-target'));
        this.connecting.tmpLine.remove();
        this.connecting = null;
        this.container.classList.remove('pending-connect');
    }

    private onWindowClick = (e: MouseEvent) => {
        if (!this.connecting) return;
        const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        if (el?.classList.contains('port-dot')) {
            // Handled directly by the port's own click listener — do nothing here
            return;
        }
        // Clicked on empty space — cancel
        this.cancelConnect();
    };

    private onMouseMove = (e: MouseEvent) => {
        if (this.isPanning) {
            this.pan.x = e.clientX - this.panStart.x;
            this.pan.y = e.clientY - this.panStart.y;
            this.applyTransform();
            this.drawConnections();
            return;
        }
        if (this.dragging) {
            const mod = this.graph.modules.get(this.dragging.id)!;
            mod.position = {
                x: this.dragging.startX + (e.clientX - this.dragging.startMX) / this.zoom,
                y: this.dragging.startY + (e.clientY - this.dragging.startMY) / this.zoom,
            };
            const el = this.nodeLayer.querySelector(`.node-card[data-id="${this.dragging.id}"]`) as HTMLElement;
            if (el) { el.style.left = mod.position.x + 'px'; el.style.top = mod.position.y + 'px'; }
            this.drawConnections();
        }
        if (this.connecting) {
            const canvasPos = this.screenToCanvas(e.clientX, e.clientY);
            let mx = canvasPos.x;
            let my = canvasPos.y;

            // Wire Snapping
            this.container.querySelectorAll('.port-dot').forEach(p => p.classList.remove('snap-target'));
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            if (el?.classList.contains('port-dot')) {
                const targetIsOutput = el.dataset.portType === 'output';
                if (this.connecting!.isOutput !== targetIsOutput) {
                    const portPos = this.getPortCenter(el.dataset.id!, el.dataset.port!, targetIsOutput);
                    mx = portPos.x;
                    my = portPos.y;
                    el.classList.add('snap-target');
                }
            }

            const from = this.getPortCenter(this.connecting.fromId, this.connecting.fromPort, this.connecting.isOutput);
            const d = this.connecting.isOutput ? this.bezier(from.x, from.y, mx, my) : this.bezier(mx, my, from.x, from.y);
            this.connecting.tmpLine.setAttribute('d', d);
        }
    };

    private onMouseUp = (_e: MouseEvent) => {
        this.isPanning = false;
        this.dragging = null;
    };

    private getPortCenter(nodeId: string, portName: string, isOutput: boolean): { x: number; y: number } {
        const cls = isOutput ? 'port-dot-out' : 'port-dot-in';
        const el = this.container.querySelector(`.${cls}[data-id="${nodeId}"][data-port="${portName}"]`) as HTMLElement | null;
        if (!el) return { x: 0, y: 0 };
        const er = el.getBoundingClientRect();
        return this.screenToCanvas(er.left + er.width / 2, er.top + er.height / 2);
    }

    private bezier(x1: number, y1: number, x2: number, y2: number): string {
        const cx = Math.max(Math.abs(x2 - x1) * 0.55, 40);
        return `M${x1},${y1} C${x1 + cx},${y1} ${x2 - cx},${y2} ${x2},${y2}`;
    }

    drawConnections() {
        this.svg.innerHTML = ''; // Safer than manual removal
        this.graph.connections.forEach(conn => {
            const fromMod = this.graph.modules.get(conn.fromId);
            const fromPort = PORT_DEFS[fromMod?.type ?? '']?.outputs[0] ?? 'out';
            const from = this.getPortCenter(conn.fromId, fromPort, true);
            const to = this.getPortCenter(conn.toId, conn.inputName, false);
            if (from.x === 0 && from.y === 0) return;
            const isUv = conn.inputName === UV_PORT || fromPort === UV_PORT;

            // Transparent hit area for easier clicking
            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
            hit.classList.add('conn-line');
            hit.setAttribute('d', this.bezier(from.x, from.y, to.x, to.y));
            hit.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.contextConn = { fromId: conn.fromId, toId: conn.toId, inputName: conn.inputName };
                if (this.menuOpen) this.closeMenu();
                this.openMenuAt(e.clientX, e.clientY);
            });
            hit.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.graph.disconnect(conn.toId, conn.inputName);
                this.render();
                this.onChange();
            });
            this.svg.appendChild(hit);

            // Visible line
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
            path.classList.add('conn-line-visible', isUv ? 'conn-uv-visible' : 'conn-sig-visible');
            path.setAttribute('d', this.bezier(from.x, from.y, to.x, to.y));
            this.svg.appendChild(path);
        });
    }

    addModule(type: ModuleType) {
        const count = this.graph.modules.size;
        let pos;
        if (this.menuSpawnPos) {
            const cp = this.screenToCanvas(this.menuSpawnPos.x, this.menuSpawnPos.y);
            pos = { x: cp.x - 96, y: cp.y - 60 };
        } else {
            pos = { x: 80 + (count % 4) * 240, y: 80 + Math.floor(count / 4) * 260 };
        }

        const newId = this.graph.addModule(type, {}, pos);

        if (this.contextConn) {
            const { fromId, toId, inputName } = this.contextConn;
            const fromMod = this.graph.getModule(fromId);
            const toMod = this.graph.getModule(toId);
            const newMod = this.graph.getModule(newId);

            if (fromMod && toMod && newMod) {
                const fromOutputs = PORT_DEFS[fromMod.type].outputs;
                const newInputs = PORT_DEFS[newMod.type].inputs;
                const newOutputs = PORT_DEFS[newMod.type].outputs;

                const sourcePort = fromOutputs[0];
                const isSourceUv = sourcePort === UV_PORT;
                const compatibleInput = newInputs.find(i => isSourceUv ? i === UV_PORT : i !== UV_PORT);

                const isTargetUv = inputName === UV_PORT;
                const compatibleOutput = newOutputs.find(o => isTargetUv ? o === UV_PORT : o !== UV_PORT);

                if (compatibleInput && compatibleOutput) {
                    this.graph.disconnect(toId, inputName);
                    this.graph.connect(fromId, newId, compatibleInput);
                    this.graph.connect(newId, toId, inputName);
                }
            }
            this.contextConn = null;
        }

        this.render();
        this.onChange();
    }

    destroy() {
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('click', this.onWindowClick);
    }
}
