import { ModuleGraph, type ModuleType, type ModuleState } from '../core/ModuleGraph';

const UV_PORT = 'uv';

const PORT_DEFS: Record<string, { inputs: string[]; outputs: string[] }> = {
    OSC: { inputs: ['uv'], outputs: ['out'] },
    NOISE: { inputs: ['uv'], outputs: ['out'] },
    SHAPE: { inputs: ['uv'], outputs: ['out'] },
    CAMERA: { inputs: ['uv'], outputs: ['out'] },
    SCREEN: { inputs: ['uv'], outputs: ['out'] },
    COLOR: { inputs: ['src'], outputs: ['out'] },
    BLEND: { inputs: ['a', 'b'], outputs: ['out'] },
    FEEDBACK: { inputs: ['src'], outputs: ['out'] },
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
    { label: 'Sources', types: ['OSC', 'NOISE', 'SHAPE'] },
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

    constructor(container: HTMLElement, graph: ModuleGraph, onChange: () => void) {
        this.container = container;
        this.graph = graph;
        this.onChange = onChange;

        // Layer 1: SVG for connection lines
        this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
        this.svg.classList.add('node-svg');
        container.appendChild(this.svg);

        // Layer 2: node cards
        this.nodeLayer = document.createElement('div');
        this.nodeLayer.className = 'node-layer';
        container.appendChild(this.nodeLayer);

        // Layer 3: module menu + trigger (above everything)
        this.createMenu();

        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);

        window.addEventListener('contextmenu', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.node-card') || target.closest('#preview') || target.closest('.module-menu') || target.closest('.menu-trigger')) return;
            e.preventDefault();
            if (this.menuOpen) this.closeMenu();
            this.openMenuAt(e.clientX, e.clientY);
        });

        this.render();
        requestAnimationFrame(() => this.drawConnections());
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
        const dot = document.createElement('div');
        dot.className = `port-dot ${isOutput ? 'port-dot-out' : 'port-dot-in'} ${isUv ? 'port-uv' : ''}`;
        dot.dataset.id = id;
        dot.dataset.port = portName;
        dot.dataset.portType = isOutput ? 'output' : 'input';
        dot.addEventListener('mousedown', e => { e.stopPropagation(); e.preventDefault(); this.startConnect(e, id, portName, isOutput); });

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
                break;
            }
            case 'NOISE': {
                const sc = this.makeSlider(0.5, 20, 0.1, mod.params.scale ?? 4);
                sc.addEventListener('input', () => { mod.params.scale = parseFloat(sc.value); this.onChange(); });
                row('Scale', sc);
                const sp = this.makeSlider(-4, 4, 0.05, mod.params.speed ?? 0.5);
                sp.addEventListener('input', () => { mod.params.speed = parseFloat(sp.value); this.onChange(); });
                row('Speed', sp);
                break;
            }
            case 'SHAPE': {
                const t = this.makeSelect([['0', 'Circle'], ['1', 'Rect'], ['2', 'Cross']], mod.params.type ?? 0);
                t.addEventListener('change', () => { mod.params.type = parseInt(t.value); this.onChange(); });
                row('Type', t);
                const r2 = this.makeSlider(0.01, 0.99, 0.01, mod.params.radius ?? 0.4);
                r2.addEventListener('input', () => { mod.params.radius = parseFloat(r2.value); this.onChange(); });
                row('Size', r2);
                const sm = this.makeSlider(0.001, 0.2, 0.001, mod.params.smooth ?? 0.02);
                sm.addEventListener('input', () => { mod.params.smooth = parseFloat(sm.value); this.onChange(); });
                row('Edge', sm);
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
    private startConnect(_e: MouseEvent, id: string, port: string, isOutput: boolean) {
        const tmpLine = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement;
        tmpLine.classList.add('conn-temp', port === UV_PORT ? 'conn-temp-uv' : 'conn-temp-sig');
        this.svg.appendChild(tmpLine);
        this.connecting = { fromId: id, fromPort: port, isOutput, tmpLine };
    }

    private onMouseMove = (e: MouseEvent) => {
        if (this.dragging) {
            const mod = this.graph.modules.get(this.dragging.id)!;
            mod.position = {
                x: this.dragging.startX + e.clientX - this.dragging.startMX,
                y: this.dragging.startY + e.clientY - this.dragging.startMY,
            };
            const el = this.nodeLayer.querySelector(`.node-card[data-id="${this.dragging.id}"]`) as HTMLElement;
            if (el) { el.style.left = mod.position.x + 'px'; el.style.top = mod.position.y + 'px'; }
            this.drawConnections();
        }
        if (this.connecting) {
            const cr = this.container.getBoundingClientRect();
            let mx = e.clientX - cr.left;
            let my = e.clientY - cr.top;

            // Wire Snapping
            this.container.querySelectorAll('.port-dot').forEach(p => p.classList.remove('snap-target'));
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            if (el?.classList.contains('port-dot')) {
                const targetIsOutput = el.dataset.portType === 'output';
                // Only snap to compatible ports
                if (this.connecting!.isOutput !== targetIsOutput) {
                    const pr = el.getBoundingClientRect();
                    mx = pr.left - cr.left + pr.width / 2;
                    my = pr.top - cr.top + pr.height / 2;
                    el.classList.add('snap-target');
                }
            }

            const from = this.getPortCenter(this.connecting.fromId, this.connecting.fromPort, this.connecting.isOutput);
            const d = this.connecting.isOutput ? this.bezier(from.x, from.y, mx, my) : this.bezier(mx, my, from.x, from.y);
            this.connecting.tmpLine.setAttribute('d', d);
        }
    };

    private onMouseUp = (e: MouseEvent) => {
        this.dragging = null;
        if (this.connecting) {
            this.container.querySelectorAll('.port-dot').forEach(p => p.classList.remove('snap-target'));
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
            if (el?.classList.contains('port-dot')) {
                const targetId = el.dataset.id!;
                const targetPort = el.dataset.port!;
                const targetIsOutput = el.dataset.portType === 'output';
                if (this.connecting.isOutput && !targetIsOutput) {
                    this.graph.connect(this.connecting.fromId, targetId, targetPort);
                    this.render(); this.onChange();
                } else if (!this.connecting.isOutput && targetIsOutput) {
                    this.graph.connect(targetId, this.connecting.fromId, this.connecting.fromPort);
                    this.render(); this.onChange();
                }
            }
            this.connecting.tmpLine.remove();
            this.connecting = null;
        }
    };

    private getPortCenter(nodeId: string, portName: string, isOutput: boolean): { x: number; y: number } {
        const cls = isOutput ? 'port-dot-out' : 'port-dot-in';
        const el = this.container.querySelector(`.${cls}[data-id="${nodeId}"][data-port="${portName}"]`) as HTMLElement | null;
        if (!el) return { x: 0, y: 0 };
        const cr = this.container.getBoundingClientRect();
        const er = el.getBoundingClientRect();
        return { x: er.left - cr.left + er.width / 2, y: er.top - cr.top + er.height / 2 };
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
            hit.addEventListener('dblclick', (e) => {
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
        const pos = this.menuSpawnPos
            ? { x: this.menuSpawnPos.x - 96, y: this.menuSpawnPos.y - 60 }
            : { x: 80 + (count % 4) * 240, y: 80 + Math.floor(count / 4) * 260 };
        this.graph.addModule(type, {}, pos);
        this.render();
        this.onChange();
    }

    destroy() {
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('mouseup', this.onMouseUp);
    }
}
