import * as THREE from 'three';
import type { ArtTheme } from '../../design/art-themes';

type Visual = { mesh: THREE.Mesh; authoredVisible: boolean };

/** Swap authored mesh leaves while keeping every live interaction pivot in place. */
export default class ArtThemeMeshes {
  private readonly ink: Visual[] = [];
  private readonly classic: Visual[] = [];
  private readonly materials = new Set<THREE.Material>();
  private theme: ArtTheme = 'ink';
  private disposed = false;

  constructor(inkRoot: THREE.Object3D, classicRoot: THREE.Object3D, excludedRoots: string[] = []) {
    const excluded = new Set(excludedRoots);
    const isExcluded = (object: THREE.Object3D) => {
      for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent) {
        if (excluded.has(ancestor.name)) return true;
      }
      return false;
    };
    const parents = new Map<string, THREE.Object3D>();
    inkRoot.traverse(object => {
      parents.set(object.name, object);
      if (object instanceof THREE.Mesh && !isExcluded(object)) {
        this.ink.push({ mesh: object, authoredVisible: object.visible });
      }
    });
    // Source geometry remains resource-owned; only the graft's materials are owned here.
    classicRoot.traverse(object => {
      if (!(object instanceof THREE.Mesh) || isExcluded(object)) return;
      if (object.children.length) throw new Error(`Art theme visual must be a leaf: ${object.name}`);
      const parent = object.parent === classicRoot ? inkRoot : parents.get(object.parent?.name || '');
      if (!parent) throw new Error(`Missing art theme pivot: ${object.parent?.name}`);
      const clone = object.clone(false);
      clone.name = `Classic_${object.name}`;
      clone.userData = { ...object.userData, artTheme: 'classic' };
      const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(material => {
        const owned = material.clone();
        this.materials.add(owned);
        return owned;
      });
      clone.material = Array.isArray(object.material) ? materials : materials[0];
      clone.castShadow = true;
      clone.receiveShadow = true;
      this.classic.push({ mesh: clone, authoredVisible: object.visible });
      parent.add(clone);
    });
    this.setArtTheme('ink');
  }

  setArtTheme(theme: ArtTheme): void {
    if (this.disposed) return;
    this.theme = theme;
    this.ink.forEach(({ mesh, authoredVisible }) => { mesh.visible = theme === 'ink' && authoredVisible; });
    this.classic.forEach(({ mesh, authoredVisible }) => { mesh.visible = theme === 'classic' && authoredVisible; });
  }

  get stats() {
    return {
      theme: this.theme,
      inkMeshes: this.ink.length,
      classicMeshes: this.classic.length,
      visibleInkMeshes: this.ink.filter(({ mesh }) => mesh.visible).length,
      visibleClassicMeshes: this.classic.filter(({ mesh }) => mesh.visible).length,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.classic.forEach(({ mesh }) => mesh.removeFromParent());
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
    this.disposed = true;
  }
}
