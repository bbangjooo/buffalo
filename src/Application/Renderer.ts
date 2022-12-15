import Application from "./Application";
import Sizes from "./Utils/Sizes";
import * as THREE from "three";
import { CSS3DRenderer } from "three/examples/jsm/renderers/CSS3DRenderer";
import { Scene } from "three";
import Time from "./Utils/Time";
import Camera from "./Camera/Camera";
export default class Renderer {
  application: Application;
  sizes: Sizes;
  scene: Scene;
  time: Time;
  cssScene: THREE.Scene;
  camera: Camera;
  instance!: THREE.WebGLRenderer;
  cssInstance: CSS3DRenderer;
  constructor() {
    this.application = new Application();
    this.sizes = this.application.sizes;
    this.scene = this.application.scene;
    this.time = this.application.time;
    this.sizes = this.application.sizes;
    this.cssScene = this.application.cssScene;
    this.camera = this.application.camera;

    this.setInstance();
  }
  setInstance() {
    this.instance = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.instance.physicallyCorrectLights = true;
    this.instance.outputEncoding = THREE.sRGBEncoding;
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 0.9;
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFSoftShadowMap;
    this.instance.setSize(this.sizes.width, this.sizes.height);
    this.instance.setPixelRatio(Math.min(this.sizes.pixelRatio, 2));
    this.instance.setClearColor("#1D2E2F");

    // Style
    this.instance.domElement.style.position = "absolute";
    this.instance.domElement.style.zIndex = "1px";
    this.instance.domElement.style.top = "0px";

    document.querySelector("#webgl")?.appendChild(this.instance.domElement);

    this.cssInstance = new CSS3DRenderer();
    this.cssInstance.setSize(this.sizes.width, this.sizes.height);
    this.cssInstance.domElement.style.position = "absolute";
    this.cssInstance.domElement.style.top = "0px";

    document.querySelector("#css")?.appendChild(this.cssInstance.domElement);
  }
  resize() {
    this.instance.setSize(this.sizes.width, this.sizes.height);
    this.instance.setPixelRatio(Math.min(this.sizes.pixelRatio, 2));

    this.cssInstance.setSize(this.sizes.width, this.sizes.height);
  }
  update() {
    this.instance.render(
      this.application.scene,
      this.application.camera.instance
    );
    this.cssInstance.render(
      this.application.cssScene,
      this.application.camera.instance
    );
  }
}
