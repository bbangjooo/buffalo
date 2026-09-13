import * as THREE from 'three';
import { RHYTHM_KEYS } from '../../design/rhythm-game';
import { ATLAS_INK, inkNight, penMaterial } from './PenInk';

export const RHYTHM_PAD_POSITIONS = [[-.98, .34], [-.98, -.34], [.98, -.34], [.98, .34]] as const;

type Pad = {
  root: THREE.Group;
  face: THREE.MeshBasicMaterial;
  glyph: THREE.MeshBasicMaterial;
  restingY: number;
};

/** Carved game board; active inlays invert to keep timing cues unmistakable. */
export default class RhythmStage {
  readonly root = new THREE.Group();
  readonly dancerAnchor = new THREE.Object3D();
  readonly focusAnchor = new THREE.Object3D();
  private readonly pads: Pad[] = [];
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly outline = new THREE.LineBasicMaterial({ color: ATLAS_INK, toneMapped: false });
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.root.name = 'RhythmStage';
    this.root.visible = false;
    this.root.userData.room = 'ai';
    this.outline.color.convertSRGBToLinear();
    this.outline.onBeforeCompile = shader => {
      shader.uniforms.atlasNight = inkNight.amount;
      shader.fragmentShader = 'uniform float atlasNight;\n' + shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\n diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.65,.63,.59),atlasNight);');
    };
    this.outline.customProgramCacheKey = () => 'atlas-game-outline';
    this.materials.add(this.outline);
    const ink = this.material('#25343c', 0.63, 0.18);
    const ivory = this.material('#d6ceba', 0.79, 0.06);
    const brass = this.material('#aa8b51', 0.4, 0.6);
    const rubber = this.material('#172329', 0.94, 0.02);

    // Broad single-segment bevels read as crafted facets even at close range.
    this.slab('StagePlinth', 2.74, 1.84, 0.11, 0.11, 0.025, ink, 0.025);
    this.slab('BrassEdge', 2.67, 1.77, 0.016, 0.09, 0.007, brass, 0.14);
    this.slab('IvoryDeck', 2.61, 1.71, 0.012, 0.085, 0.009, ivory, 0.162);
    this.slab('DancerLanding', 1.13, 1.45, 0.01, 0.085, 0.007, ivory, 0.185);

    // One large pad at each corner leaves a clear central landing for the hamster.
    RHYTHM_PAD_POSITIONS.forEach(([x, z], lane) => {
      const frame = this.slab(`PadFrame${lane}`, 0.64, 0.555, 0.014, 0.035, 0.009, brass, 0.173);
      frame.position.x = x;
      frame.position.z = z;
      const padRoot = new THREE.Group();
      padRoot.name = `RhythmPad${lane}`;
      padRoot.position.set(x, 0.191, z);
      padRoot.userData = { rhythmLane: lane, index: lane, interactiveId: `rhythm-pad-${lane}`, room: 'ai' };
      this.root.add(padRoot);

      const face = this.material(RHYTHM_KEYS[lane].color, 0.57, 0.12);
      const tile = this.mesh(`PadSurface${lane}`, this.chamferedSlab(0.603, 0.514, 0.012, 0.028, 0.004), face, padRoot);
      tile.rotation.x = -Math.PI / 2;
      const glyph = this.material('#fbefce', 0.45, 0.12);
      const letter = this.mesh(`PadLetter${RHYTHM_KEYS[lane].label}`, this.letterGeometry(RHYTHM_KEYS[lane].label), glyph, padRoot);
      letter.rotation.x = -Math.PI / 2;
      letter.position.y = 0.018;
      this.pads.push({ root: padRoot, face, glyph, restingY: padRoot.position.y });
    });

    // Small forged corner pins and incised front marks finish the game board.
    for (const x of [-1.23, 1.23]) for (const z of [-0.735, 0.735]) {
      const bolt = this.mesh('DeckFastener', new THREE.CylinderGeometry(0.022, 0.022, 0.007, 6), ink);
      bolt.position.set(x, 0.187, z);
    }
    for (const x of [-0.18, -0.06, 0.06, 0.18]) {
      const groove = this.mesh('FrontVent', new THREE.BoxGeometry(0.044, 0.026, 0.004), rubber);
      groove.position.set(x, 0.087, 0.946);
    }

    this.dancerAnchor.name = 'RhythmDancerAnchor';
    this.dancerAnchor.position.set(0, 0.2, 0);
    this.focusAnchor.name = 'RhythmFocusAnchor';
    this.focusAnchor.position.set(0, 0.9, 0);
    this.root.add(this.dancerAnchor, this.focusAnchor);
    scene.add(this.root);
  }

  setVisible(visible: boolean): void {
    if (this.disposed) return;
    this.root.visible = visible;
    if (!visible) this.pads.forEach((_, lane) => this.setPad(lane, false));
  }

  setPad(index: number, on: boolean): void {
    if (this.disposed || !Number.isInteger(index) || !this.pads[index]) return;
    const pad = this.pads[index];
    pad.root.position.y = pad.restingY - (on ? 0.009 : 0);
    pad.face.color.set(on ? '#202327' : '#ffffff').convertSRGBToLinear();
    pad.glyph.color.set(on ? '#ffffff' : '#202327').convertSRGBToLinear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.setVisible(false);
    this.root.removeFromParent();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.materials.forEach((material) => material.dispose());
    this.geometries.clear();
    this.materials.clear();
    this.root.clear();
    this.disposed = true;
  }

  private material(color: string, _roughness: number, _metalness: number): THREE.MeshBasicMaterial {
    const material = penMaterial(['#25343c', '#172329', '#fbefce'].includes(color));
    this.materials.add(material);
    return material;
  }

  private mesh(name: string, geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = this.root): THREE.Mesh {
    this.geometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    const edges = new THREE.EdgesGeometry(geometry, 28);
    this.geometries.add(edges);
    const strokes = new THREE.LineSegments(edges, this.outline);
    strokes.name = `${name}InkContour`;
    mesh.add(strokes);
    parent.add(mesh);
    return mesh;
  }

  private slab(name: string, width: number, depth: number, height: number, corner: number, bevel: number,
    material: THREE.Material, y: number): THREE.Mesh {
    const slab = this.mesh(name, this.chamferedSlab(width, depth, height, corner, bevel), material);
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = y;
    return slab;
  }

  private chamferedSlab(width: number, depth: number, height: number, corner: number, bevel: number): THREE.ExtrudeGeometry {
    const x = width / 2;
    const y = depth / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-x + corner, -y);
    shape.lineTo(x - corner, -y);
    shape.lineTo(x, -y + corner);
    shape.lineTo(x, y - corner);
    shape.lineTo(x - corner, y);
    shape.lineTo(-x + corner, y);
    shape.lineTo(-x, y - corner);
    shape.lineTo(-x, -y + corner);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, {
      depth: height, steps: 1, bevelEnabled: true,
      bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1,
    });
  }

  private letterGeometry(letter: string): THREE.ExtrudeGeometry {
    // Broad block letters share one reading direction and need no font texture.
    const outlines: Record<string, number[][]> = {
      D: [[-.11, -.14], [-.11, .14], [.02, .14], [.095, .08], [.11, .035],
        [.11, -.035], [.095, -.08], [.02, -.14]],
      F: [[-.10, -.14], [-.10, .14], [.11, .14], [.11, .09], [-.047, .09],
        [-.047, .026], [.072, .026], [.072, -.024], [-.047, -.024], [-.047, -.14]],
      J: [[-.11, .14], [.10, .14], [.10, -.064], [.08, -.11], [.035, -.14],
        [-.045, -.14], [-.09, -.115], [-.11, -.06], [-.058, -.06], [-.044, -.083],
        [.018, -.083], [.045, -.065], [.045, .087], [-.11, .087]],
      K: [[-.11, -.14], [-.11, .14], [-.055, .14], [-.055, .029], [.047, .14],
        [.114, .14], [.004, .009], [.12, -.14], [.052, -.14], [-.034, -.039],
        [-.055, -.061], [-.055, -.14]],
    };
    const shape = new THREE.Shape(outlines[letter].map(([x, y]) => new THREE.Vector2(x, y)));
    shape.closePath();
    if (letter === 'D') {
      const hole = new THREE.Path([[-.055, -.09], [.005, -.09], [.05, -.05],
        [.058, -.02], [.058, .02], [.05, .05], [.005, .09], [-.055, .09]]
        .map(([x, y]) => new THREE.Vector2(x, y)));
      hole.closePath();
      shape.holes.push(hole);
    }
    return new THREE.ExtrudeGeometry(shape, {
      depth: 0.003, steps: 1, bevelEnabled: true,
      bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1,
    });
  }
}
