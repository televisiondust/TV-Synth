export type ModuleType =
    // Sources
    | 'OSC' | 'NOISE' | 'SHAPE' | 'HATCH'
    // Live inputs
    | 'CAMERA' | 'SCREEN'
    // Color / mix
    | 'COLOR' | 'BLEND' | 'FEEDBACK'
    // UV transforms
    | 'ROTATE' | 'SCALE' | 'SCROLL' | 'KALEID' | 'PIXELATE' | 'WARP' | 'MIRROR'
    // Sink
    | 'OUTPUT';

export interface ModuleConnection {
    fromId: string;
    toId: string;
    inputName: string;
}

export interface ModuleState {
    id: string;
    type: ModuleType;
    params: Record<string, any>;
    enabled: boolean;
    position: { x: number; y: number };
}

export class ModuleGraph {
    modules: Map<string, ModuleState> = new Map();
    connections: ModuleConnection[] = [];

    addModule(type: ModuleType, params: Record<string, any> = {}, position: { x: number; y: number } = { x: 100, y: 100 }): string {
        const id = `${type.toLowerCase()}_${Math.random().toString(36).slice(2, 11)}`;
        this.modules.set(id, {
            id,
            type,
            params,
            enabled: true,
            position,
        });
        return id;
    }

    removeModule(id: string) {
        this.modules.delete(id);
        this.connections = this.connections.filter(c => c.fromId !== id && c.toId !== id);
    }

    connect(fromId: string, toId: string, inputName: string) {
        this.disconnect(toId, inputName);
        this.connections.push({ fromId, toId, inputName });
    }

    disconnect(toId: string, inputName: string) {
        this.connections = this.connections.filter(c => !(c.toId === toId && c.inputName === inputName));
    }

    getModule(id: string): ModuleState | undefined {
        return this.modules.get(id);
    }

    toJSON(): string {
        return JSON.stringify({
            modules: Array.from(this.modules.values()),
            connections: this.connections
        }, null, 2);
    }

    fromJSON(json: string) {
        const data = JSON.parse(json);
        this.modules = new Map();
        data.modules.forEach((m: ModuleState) => {
            this.modules.set(m.id, m);
        });
        this.connections = data.connections;
    }
}
