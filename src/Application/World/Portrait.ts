import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import Application from '../Application';

/** The original photograph sits in a modeled frame without entering the GLB. */
export default class Portrait {
  readonly container: HTMLDivElement;
  readonly image: HTMLImageElement;
  readonly object: CSS3DObject;
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly application = new Application();
  private readonly worldScale = new THREE.Vector3();
  private disposed = false;
  private added = false;

  constructor(private readonly anchor: THREE.Object3D) {
    this.container = document.createElement('div');
    this.container.className = 'portrait-surface';
    this.image = document.createElement('img');
    this.image.className = 'portrait-photo';
    this.image.alt = 'Portrait of Byeong-geun Jo';
    this.image.width = 900;
    this.image.height = 600;
    this.image.decoding = 'async';
    this.image.draggable = false;
    // The same photograph is accessible in the Summary document.
    this.image.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.image);
    // Keep the 3D transform on a normal element. A transformed replaced image
    // can disappear behind the composited WebGL canvas despite a clear aperture.
    this.object = new CSS3DObject(this.container);
    this.object.name = 'PortraitPhotoCSS';
    Object.assign(this.container.style, {
      display: 'block', width: '900px', height: '600px', objectFit: 'contain',
      pointerEvents: 'none', userSelect: 'none', backfaceVisibility: 'hidden',
    });
    Object.assign(this.image.style, {
      position: 'absolute', inset: '0', display: 'block', width: '100%', height: '100%',
      objectFit: 'contain', pointerEvents: 'none', userSelect: 'none',
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.2), new THREE.MeshBasicMaterial({
      color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending,
      depthWrite: true, depthTest: true, toneMapped: false, side: THREE.FrontSide,
    }));
    this.mesh.name = 'PortraitPhotoAperture';
    this.mesh.renderOrder = 100;
    this.object.visible = this.mesh.visible = false;
    this.update();
    this.image.addEventListener('load', this.onLoad);
    this.image.addEventListener('error', this.onError);
    this.image.src = '/images/bbangjo-portrait.jpg';
  }

  add(): void {
    if (this.added || this.disposed) return;
    this.application.scene.add(this.mesh);
    this.application.cssScene.add(this.object);
    this.added = true;
  }

  update(): void {
    if (this.disposed) return;
    this.anchor.updateWorldMatrix(true, false);
    this.anchor.matrixWorld.decompose(this.mesh.position, this.mesh.quaternion, this.worldScale);
    this.mesh.scale.copy(this.worldScale);
    this.object.position.copy(this.mesh.position);
    this.object.quaternion.copy(this.mesh.quaternion);
    this.object.scale.copy(this.worldScale).multiplyScalar(1.8 / 900);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.image.removeEventListener('load', this.onLoad);
    this.image.removeEventListener('error', this.onError);
    this.image.removeAttribute('src');
    this.object.removeFromParent();
    this.mesh.removeFromParent();
    this.container.remove();
    this.image.remove();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private readonly onLoad = async () => {
    try {
      await this.image.decode();
      if (!this.disposed) this.object.visible = this.mesh.visible = this.image.naturalWidth > 0;
    } catch { this.onError(); }
  };

  private readonly onError = () => {
    if (!this.disposed) this.object.visible = this.mesh.visible = false;
  };
}
