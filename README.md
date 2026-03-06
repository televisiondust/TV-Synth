# TV synth

TV synth is a modular, node-based video synthesizer and feedback engine built with Three.js and Vite. It allows you to create complex visual patterns, process live camera feeds, and capture screen content through a dynamic shader generation system.

### 🖖 **Vibe Coded**
This project was **vibe coded** with Antigravity and Claude code, embracing a fast, iterative, and experimental development flow.

---

## 🚀 Features

- **Modular Node Graph**: Connect various modules (Oscillators, Noise, Shapes, Transforms) to build custom visual pipelines.
- **Dynamic Shader Compilation**: The engine topologically sorts your node graph and generates optimized GLSL code on the fly.
- **Live Input Support**:
    - **Webcam**: Integrate your camera feed with mirror and transform options.
    - **Screen Capture**: Use any window or screen as a source for video synthesis.
- **Advanced Feedback Engine**: Dedicated feedback module for classic video-synth trails and recursive growth patterns.
- **Interactive Preview**:
    - Move the preview window anywhere on the screen.
    - Resize the window to see your patches at any resolution; the renderer scales dynamically.
- **Connection Management**:
    - Snapping cables for easy port targeting.
    - Double-click to disconnect wires.
- **Patch Persistence**: Save your creations as JSON files and load them back later.
- **CRT Post-Processing**: Built-in scanlines, curvature, and chromatic aberration for that vintage analog aesthetic.

## 🛠 Tech Stack

- **Core**: [Three.js](https://threejs.org/)
- **Build System**: [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **UI**: Vanilla HTML/CSS/JS

## 📜 Credits & Inspiration

This project draws inspiration from and stands on the shoulders of these excellent libraries and concepts:

- **[Hydra Synth](https://hydra.ojack.xyz/)**: A huge inspiration for live-coding video synthesis and modular routing.
- **[Three.js](https://github.com/mrdoob/three.js/)**: Used for the WebGL rendering engine, textures, and shader management.
- **[Vite](https://github.com/vitejs/vite)**: Providing the blazing-fast development environment.
- **Shaders**:
    - Value Noise implementations inspired by [Inigo Quilez](https://iquilezles.org/articles/smoothsteps/).
    - Feedback and video synthesis techniques inspired by analog modular synthesizers like [LZX Industries](https://lzxindustries.net/).
- **UI Patterns**: Modular node UI patterns reminiscent of [Blender's Shader Editor](https://www.blender.org/) and [TouchDesigner](https://derivative.ca/).

## 🚦 Getting Started

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

---

*Happy synth-ing!* 🌈✨
