import Application from "../Application";
import Camera from "../Camera/Camera";
import Resources from "../Utils/Resoures";
import Sizes from "../Utils/Sizes";
import * as THREE from "three";
import {
  IFRAME_PADDING,
  IFRAME_SIZE,
  INNER_SITE_URL,
  SCALE,
  SCREEN_SIZE,
} from "../Constants";
import { CSS3DObject } from "three/examples/jsm/renderers/CSS3DRenderer.js";
import EventEmitter from "../Utils/Eventemitter";
import { Mesh } from "three";

// when event related to iframe occured, trigger evnt for camera
export default class MonitorScreen extends EventEmitter {
  application: Application;
  sizes: Sizes;
  camera: Camera;
  scene: THREE.Scene;
  cssScene: THREE.Scene;
  container: HTMLElement;
  resources: Resources;
  mesh: Mesh;
  screenSize = new THREE.Vector2(SCREEN_SIZE.w, SCREEN_SIZE.h);

  position = new THREE.Vector3(15, SCALE * 3.52, -SCALE * 0.95);
  prevInComputer: boolean;
  shouldLeaveMonitor: boolean;
  inComputer: boolean;
  mouseClickInProgress: boolean;
  constructor() {
    super();
    this.application = new Application();
    this.sizes = this.application.sizes;
    this.camera = this.application.camera;

    this.scene = this.application.scene;
    this.cssScene = this.application.cssScene;
    this.resources = this.application.resources;

    this.initializeScreenEvents();
    this.createIframe();
  }

  initializeScreenEvents() {
    document.addEventListener(
      "mousemove",
      (event) => {
        // @ts-ignore
        const id = event.target.id;

        if (id === "monitorScreen") {
          // @ts-ignore
          event.inComputer = true;
        }

        // @ts-ignore
        this.inComputer = event.inComputer;

        if (this.inComputer && !this.prevInComputer) {
          this.createCssPlane(this.container);
          this.camera.trigger("enterMonitor");
        }

        if (
          !this.inComputer &&
          this.prevInComputer &&
          !this.mouseClickInProgress
        ) {
          this.camera.trigger("leaveMonitor");
        }

        if (
          !this.inComputer &&
          this.mouseClickInProgress &&
          this.prevInComputer
        ) {
          this.shouldLeaveMonitor = true;
        } else {
          this.shouldLeaveMonitor = false;
        }

        this.application.mouse.trigger("mousemove", [event]);

        this.prevInComputer = this.inComputer;
      },
      false
    );
    document.addEventListener(
      "mousedown",
      (event) => {
        // @ts-ignore
        this.inComputer = event.inComputer;
        this.application.mouse.trigger("mousedown", [event]);

        this.mouseClickInProgress = true;
        this.prevInComputer = this.inComputer;
      },
      false
    );
    document.addEventListener(
      "mouseup",
      (event) => {
        // @ts-ignore
        this.inComputer = event.inComputer;
        this.application.mouse.trigger("mouseup", [event]);

        if (this.shouldLeaveMonitor) {
          this.camera.trigger("leaveMonitor");
          this.shouldLeaveMonitor = false;
        }

        this.mouseClickInProgress = false;
        this.prevInComputer = this.inComputer;
      },
      false
    );
  }

  createIframe() {
    // Create container
    const container = document.createElement("div");
    container.style.width = this.screenSize.width + "px";
    container.style.height = this.screenSize.height + "px";
    container.style.opacity = "1";
    container.style.background = "#1d2e2f";

    // Create iframe
    const iframe = document.createElement("iframe");

    // Bubble mouse move events to the main application, so we can affect the camera
    iframe.onload = () => {
      if (iframe.contentWindow) {
        window.addEventListener("message", (event) => {
          var evt = new CustomEvent(event.data.type, {
            bubbles: true,
            cancelable: false,
          });

          // @ts-ignore
          evt.inComputer = true;
          if (event.data.type === "mousemove") {
            var clRect = iframe.getBoundingClientRect();
            const { top, left, width, height } = clRect;
            const widthRatio = width / IFRAME_SIZE.w;
            const heightRatio = height / IFRAME_SIZE.h;

            // @ts-ignore
            evt.clientX = Math.round(event.data.clientX * widthRatio + left);
            //@ts-ignore
            evt.clientY = Math.round(event.data.clientY * heightRatio + top);
          } else if (event.data.type === "keydown") {
            // @ts-ignore
            evt.key = event.data.key;
          } else if (event.data.type === "keyup") {
            // @ts-ignore
            evt.key = event.data.key;
          }

          iframe.dispatchEvent(evt);
        });
      }
    };

    iframe.src = INNER_SITE_URL;

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has("dev")) {
      iframe.src = "http://localhost:3000/api";
    }
    iframe.style.width = this.screenSize.width + "px";
    iframe.style.height = this.screenSize.height + "px";
    iframe.style.padding = IFRAME_PADDING + "px";
    iframe.style.boxSizing = "border-box";
    iframe.style.opacity = "1";
    iframe.className = "jitter";
    iframe.id = "monitorScreen";
    iframe.title = "bbangjo";

    // Add iframe to container
    container.appendChild(iframe);
    this.createCssPlane(container);

    // Create CSS plan
  }

  createCssPlane(element: HTMLElement) {
    // Create CSS3D object
    const object = new CSS3DObject(element);
    // copy monitor position and rotation
    object.position.copy(this.position);

    // Add to CSS scene
    this.cssScene.add(object);

    // Create GL plane
    const material = new THREE.MeshLambertMaterial();
    material.side = THREE.DoubleSide;
    material.opacity = 0;
    material.transparent = false;
    // NoBlending allows the GL plane to occlude the CSS plane
    material.blending = THREE.NoBlending;

    // Create plane geometry
    const geometry = new THREE.PlaneGeometry(
      this.screenSize.width,
      this.screenSize.height
    );

    // Create the GL plane mesh
    this.mesh = new THREE.Mesh(geometry, material);

    // Copy the position, rotation and scale of the CSS plane to the GL plane
    this.mesh.position.copy(object.position);
    this.mesh.rotation.copy(object.rotation);
    this.mesh.scale.copy(object.scale);

    // Add to gl scene
  }

  add() {
    this.scene.add(this.mesh);
  }
}
