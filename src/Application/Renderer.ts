import * as THREE from "three";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer";
import Application from "./Application";
import Camera, { isReadingView } from "./Camera/Camera";
import Sizes from "./Utils/Sizes";

export default class Renderer {
  readonly application: Application;
  readonly sizes: Sizes;
  readonly camera: Camera;
  readonly instance: THREE.WebGLRenderer;
  readonly cssInstance: CSS3DRenderer;
  private readonly cssWorldScale = 1000;
  private readonly cssOrthographic = new THREE.OrthographicCamera();
  private readonly cssPerspective = new THREE.PerspectiveCamera();

  constructor() {
    this.application = new Application();
    this.sizes = this.application.sizes;
    this.camera = this.application.camera;
    this.instance = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    this.instance.physicallyCorrectLights = true;
    this.instance.outputEncoding = THREE.sRGBEncoding;
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 1;
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFSoftShadowMap;
    this.instance.shadowMap.autoUpdate = false;
    this.instance.shadowMap.needsUpdate = true;
    this.instance.setClearColor(0x000000, 0);
    this.application.scene.background = null;
    Object.assign(this.instance.domElement.style, {
      position: "absolute", inset: "0", zIndex: "1", pointerEvents: "auto",
    });
    this.instance.domElement.setAttribute("aria-label", "Interactive 3D rooms");
    document.querySelector("#webgl")?.appendChild(this.instance.domElement);

    this.cssInstance = new CSS3DRenderer();
    // CSS hit testing is unreliable for iframe transforms around scale(.001).
    // Keep DOM geometry in pixel-sized units while WebGL stays in meters.
    this.application.cssScene.scale.setScalar(this.cssWorldScale);
    Object.assign(this.cssInstance.domElement.style, {
      position: "absolute", inset: "0", zIndex: "0", pointerEvents: "none",
      // Focus/scrollIntoView inside the iframe must never scroll its 3D viewport.
      overflow: "clip",
    });
    document.querySelector("#css")?.appendChild(this.cssInstance.domElement);
    this.resize();
  }

  resize() {
    this.instance.setPixelRatio(Math.min(this.sizes.pixelRatio, this.sizes.width < 700 ? 1.5 : 2));
    this.instance.setSize(this.sizes.width, this.sizes.height);
    this.cssInstance.setSize(this.sizes.width, this.sizes.height);
  }

  update() {
    this.instance.domElement.style.pointerEvents = (isReadingView(this.camera.view) || this.camera.view === "exhibit") && !this.camera.transitioning ? "none" : "auto";
    this.instance.render(this.application.scene, this.camera.instance);
    this.cssInstance.render(this.application.cssScene, this.cssCamera());
  }

  private cssCamera(): THREE.OrthographicCamera | THREE.PerspectiveCamera {
    const source = this.camera.instance;
    let camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
    if (source instanceof THREE.OrthographicCamera) {
      this.cssOrthographic.copy(source);
      this.cssOrthographic.left *= this.cssWorldScale;
      this.cssOrthographic.right *= this.cssWorldScale;
      this.cssOrthographic.top *= this.cssWorldScale;
      this.cssOrthographic.bottom *= this.cssWorldScale;
      camera = this.cssOrthographic;
    } else {
      this.cssPerspective.copy(source);
      camera = this.cssPerspective;
    }
    camera.position.multiplyScalar(this.cssWorldScale);
    camera.near *= this.cssWorldScale;
    camera.far *= this.cssWorldScale;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
  }
}
