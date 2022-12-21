import Application from "../Application";
import EventEmitter from "../Utils/Eventemitter";
import Sizes from "../Utils/Sizes";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import TWEEN from "@tweenjs/tween.js";
import { CameraKey } from "../../types";
import BezierEasing from "bezier-easing";
import {
  CameraActions,
  DeskAction,
  IdleAction,
  MonitorCameraAction,
} from "./CamerActions";
import { Easing, Tween } from "@tweenjs/tween.js";
import { EventBus } from "../UI/EventBus";
export default class Camera extends EventEmitter {
  application: Application;
  private readonly sizes: Sizes;
  instance: THREE.PerspectiveCamera;
  controls!: OrbitControls;
  position: THREE.Vector3;
  keyframes: { [key in CameraKey]: CameraActions };
  currentKey: CameraKey | undefined;
  targetKey: CameraKey | undefined;
  focalPoint: THREE.Vector3;
  constructor() {
    super();
    this.application = new Application();
    this.sizes = this.application.sizes;
    this.position = new THREE.Vector3(0, 0, 0);
    this.focalPoint = new THREE.Vector3(0, 0, 0);
    this.keyframes = {
      monitor: new MonitorCameraAction(),
      idle: new IdleAction(),
      desk: new DeskAction(),
    };

    document.addEventListener("mousedown", (event) => {
      event.preventDefault();
      // @ts-ignore
      if (event.target.id === "prevent-click") return;
      // print target and current keyframe
      if (
        this.currentKey === CameraKey.IDLE ||
        this.targetKey === CameraKey.IDLE
      ) {
        this.transition(CameraKey.DESK);
      } else if (
        this.currentKey === CameraKey.DESK ||
        this.targetKey === CameraKey.DESK
      ) {
        this.transition(CameraKey.IDLE);
      }
    });

    this.setInstance();
    this.addMonitorListener();
  }

  private setInstance() {
    this.instance = new THREE.PerspectiveCamera(
      45,
      this.sizes.width / this.sizes.height,
      20,
      50000
    );
    this.currentKey = CameraKey.IDLE;
    // this.instance.position.copy(this.position);
    this.application.scene.add(this.instance);
  }

  setOrbitControls() {
    this.controls = new OrbitControls(
      this.instance,
      this.application.renderer.instance.domElement
    );
    this.controls.enableDamping = true;
    this.controls.enableZoom = false;
  }

  resize() {
    this.instance.aspect = this.sizes.width / this.sizes.height;
    this.instance.updateProjectionMatrix();
  }

  private addMonitorListener() {
    this.on("enterMonitor", () => {
      this.transition(CameraKey.MONITOR, 2000, BezierEasing(0.13, 0.99, 0, 1));
      EventBus.dispatch("enterMonitor", {});
      //  move( ToMonitor )
    });

    this.on("leaveMonitor", () => {
      this.transition(CameraKey.DESK);
      EventBus.dispatch("leaveMonitor", {});
    });
  }

  transition(
    key: CameraKey,
    duration: number = 1000,
    easing?: any,
    callback?: () => void
  ) {
    if (this.currentKey === key) return;

    if (this.targetKey) TWEEN.removeAll();
    this.currentKey = undefined;
    this.targetKey = key;
    const keyframe = this.keyframes[key];
    const posTween = new Tween(this.position)
      .to(keyframe.position, duration)
      .easing(easing || Easing.Quadratic.InOut)
      .onComplete(() => {
        this.targetKey = undefined;
        this.currentKey = key;
        if (callback) callback();
      });

    const focalTween = new Tween(this.focalPoint)
      .to(keyframe.focalPoint)
      .easing(easing || Easing.Quadratic.InOut);
    posTween.start();
    focalTween.start();
  }

  update() {
    TWEEN.update();
    for (const key in this.keyframes) {
      this.keyframes[key as CameraKey].update();
    }
    if (this.currentKey) {
      const keyframe = this.keyframes[this.currentKey];

      this.position.copy(keyframe.position);
      this.focalPoint.copy(keyframe.focalPoint);
    }
    this.instance.position.copy(this.position);
    this.instance.lookAt(this.focalPoint);

    this.instance.updateProjectionMatrix();
  }
}
