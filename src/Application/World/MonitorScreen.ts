import * as THREE from "three";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import Application from "../Application";

export type MonitorScreenConfig = {
  id?: string;
  src?: string;
  title?: string;
  width?: number;
  height?: number;
  pixels?: number;
  mobilePixels?: number;
};

/** A persistent document iframe anchored to its modeled reading surface. */
export default class MonitorScreen {
  readonly application: Application;
  readonly container: HTMLDivElement;
  readonly iframe: HTMLIFrameElement;
  readonly object: CSS3DObject;
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly anchor: THREE.Object3D;
  private readonly worldScale = new THREE.Vector3();
  private readonly leftEdge = new THREE.Vector3();
  private readonly rightEdge = new THREE.Vector3();
  private readonly width: number;
  private readonly height: number;
  private readonly desktopPixels: number;
  private readonly mobilePixels: number;
  private pixels = 0;
  private added = false;
  private interactive = false;

  constructor(anchor: THREE.Object3D, config: MonitorScreenConfig = {}) {
    this.application = new Application();
    this.anchor = anchor;
    this.width = config.width ?? 1.4;
    this.height = config.height ?? 0.84;
    this.desktopPixels = config.pixels ?? 1200;
    this.mobilePixels = config.mobilePixels ?? Math.min(420, this.desktopPixels);
    this.container = document.createElement("div");
    this.container.className = "monitor-surface";
    Object.assign(this.container.style, {
      background: "#fff",
      // Clipping this transformed parent prevents iframe pointer hit testing.
      overflow: "visible",
      pointerEvents: "none",
      backfaceVisibility: "hidden",
    });

    this.iframe = document.createElement("iframe");
    this.iframe.src = config.src ?? "https://blog.bbangjo.kr";
    this.iframe.id = config.id ?? "monitorScreen";
    this.iframe.title = config.title ?? (config.id === "resumeScreen" ? "조병근 이력서" : "bbangjo 블로그");
    this.iframe.tabIndex = -1;
    this.iframe.setAttribute("aria-hidden", "true");
    Object.assign(this.iframe.style, {
      display: "block",
      width: "100%",
      height: "100%",
      border: "0",
      padding: "0",
      background: "#fff",
      pointerEvents: "none",
    });
    this.container.appendChild(this.iframe);
    this.object = new CSS3DObject(this.container);
    this.object.name = config.id ? `${config.id}CSS` : "BlogScreenCSS";

    // The opaque draw writes alpha=0 into the WebGL canvas, exposing CSS behind it.
    // Depth testing preserves furniture occlusion without duplicating the iframe.
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.width, this.height),
      new THREE.MeshBasicMaterial({
        // The canvas uses premultiplied alpha: alpha=0 must also write RGB=0.
        color: 0x000000,
        side: THREE.DoubleSide,
        opacity: 0,
        transparent: false,
        blending: THREE.NoBlending,
        depthWrite: true,
        depthTest: true,
        toneMapped: false,
      })
    );
    this.mesh.name = config.id ? `${config.id}Aperture` : "BlogScreenAperture";
    this.mesh.renderOrder = 100;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.update();
  }

  add() {
    if (this.added) return;
    this.application.cssScene.add(this.object);
    this.application.scene.add(this.mesh);
    this.added = true;
  }

  setVisible(visible: boolean) {
    this.object.visible = visible;
    this.mesh.visible = visible;
    if (!visible) this.setInteractive(false);
  }

  setInteractive(enabled: boolean) {
    enabled = enabled && this.object.visible;
    if (this.interactive === enabled) return;
    this.interactive = enabled;
    this.container.style.pointerEvents = enabled ? "auto" : "none";
    this.iframe.style.pointerEvents = enabled ? "auto" : "none";
    this.iframe.tabIndex = enabled ? 0 : -1;
    this.iframe.setAttribute("aria-hidden", String(!enabled));
    if (!enabled && document.activeElement === this.iframe) this.iframe.blur();
  }

  update() {
    this.anchor.updateWorldMatrix(true, false);
    this.anchor.matrixWorld.decompose(this.mesh.position, this.mesh.quaternion, this.worldScale);
    this.mesh.scale.copy(this.worldScale);
    this.object.position.copy(this.mesh.position);
    this.object.quaternion.copy(this.mesh.quaternion);

    // Match a mobile page layout when viewed on a phone; preserve the world size.
    let pixels = this.pixels || (this.application.sizes.width < 700 ? this.mobilePixels : this.desktopPixels);
    if (this.interactive && !this.application.camera.transitioning) {
      // At the front-facing reading pose, one document pixel should map to one
      // screen pixel. Keep that resolution on return, avoiding a text reflow.
      this.mesh.updateMatrixWorld();
      this.leftEdge.set(-this.width / 2, 0, 0).applyMatrix4(this.mesh.matrixWorld).project(this.application.camera.instance);
      this.rightEdge.set(this.width / 2, 0, 0).applyMatrix4(this.mesh.matrixWorld).project(this.application.camera.instance);
      pixels = Math.max(240, Math.min(1800, Math.round(Math.abs(this.rightEdge.x - this.leftEdge.x) * this.application.sizes.width / 2)));
    }
    if (pixels !== this.pixels) {
      this.pixels = pixels;
      this.container.style.width = `${pixels}px`;
      this.container.style.height = `${pixels * this.height / this.width}px`;
    }
    this.object.scale.copy(this.worldScale).multiplyScalar(this.width / pixels);
  }

  dispose() {
    this.setInteractive(false);
    this.object.removeFromParent();
    this.mesh.removeFromParent();
    this.container.remove();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.added = false;
  }
}
