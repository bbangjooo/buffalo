import { CameraKey, CameraKeyFrame } from "../../types";
import * as THREE from "three";
import Time from "../Utils/Time";
import Sizes from "../Utils/Sizes";
import Application from "../Application";
import { SCALE } from "../Constants";
import Mouse from "../Utils/Mouse";

export class CameraActions {
  position: THREE.Vector3;
  focalPoint: THREE.Vector3;

  constructor(keyframe: CameraKeyFrame) {
    this.position = keyframe.position;
    this.focalPoint = keyframe.focalPoint;
  }

  update() {}
}

const keys: { [key in CameraKey]: CameraKeyFrame } = {
  idle: {
    position: new THREE.Vector3(-SCALE * 8, SCALE * 8, SCALE * 8),
    focalPoint: new THREE.Vector3(0, SCALE * 3, 0),
  },
  monitor: {
    position: new THREE.Vector3(0, SCALE * 3.5, SCALE),
    focalPoint: new THREE.Vector3(0, SCALE * 3.5, -SCALE * 0.9),
  },
  desk: {
    position: new THREE.Vector3(0, SCALE * 8, SCALE * 3),
    focalPoint: new THREE.Vector3(0, SCALE * 3, 0),
  },
  //   loading: {
  //     position: new THREE.Vector3(-35000, 35000, 35000),
  //     focalPoint: new THREE.Vector3(0, -5000, 0),
  //   },
};

export class MonitorCameraAction extends CameraActions {
  application: Application;
  originPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  private readonly sizes: Sizes;
  constructor() {
    // define keyFrame
    const keyframe = keys.monitor;
    super(keyframe);
    this.application = new Application();
    this.sizes = this.application.sizes;
    this.originPos = new THREE.Vector3().copy(keyframe.position);
    this.targetPos = new THREE.Vector3().copy(keyframe.position);
  }

  update() {
    const aspect = this.sizes.height / this.sizes.width;
    const additionalZoom = this.sizes.width < 768 ? 0 : 600;
    this.targetPos.z = this.originPos.z + aspect * 1200 - additionalZoom;

    this.position.copy(this.targetPos);
  }
}

export class IdleAction extends CameraActions {
  time: Time;
  origin: THREE.Vector3;

  constructor() {
    const keyframe = keys.idle;
    super(keyframe);
    this.origin = new THREE.Vector3().copy(keyframe.position);
    this.time = new Time();
  }

  update() {
    this.position.x =
      Math.sin((this.time.elapsed + 19000) * 0.00008) * this.origin.x;
    this.position.y =
      Math.sin((this.time.elapsed + 1000) * 0.000004) * 4000 +
      this.origin.y -
      3000;

    this.position.z = this.position.z;
  }
}

export class DeskAction extends CameraActions {
  application: Application;
  origin: THREE.Vector3;
  mouse: Mouse;
  sizes: Sizes;
  targetFoc: THREE.Vector3;
  targetPos: THREE.Vector3;

  constructor() {
    const keyframe = keys.desk;
    super(keyframe);
    this.application = new Application();
    this.mouse = this.application.mouse;
    this.sizes = this.application.sizes;
    this.origin = new THREE.Vector3().copy(keyframe.position);
    this.targetFoc = new THREE.Vector3().copy(keyframe.focalPoint);
    this.targetPos = new THREE.Vector3().copy(keyframe.position);
  }

  update() {
    const aspect = this.sizes.height / this.sizes.width;
    this.targetFoc.x +=
      (this.mouse.x - this.sizes.width / 2.5 - this.targetFoc.x) * 0.05;
    this.targetFoc.y +=
      (-(this.mouse.y - this.sizes.height * 4) - this.targetFoc.y) * 0.05;

    this.targetPos.x +=
      (this.mouse.x - this.sizes.width / 2.5 - this.targetPos.x) * 0.025;
    this.targetPos.y +=
      (-(this.mouse.y - this.sizes.height * 4) - this.targetPos.y) * 0.025;

    // this.targetPos.z = this.origin.z;
    // this.targetPos.z = this.origin.z + aspect;
    this.targetPos.z = this.origin.z + aspect * 3000 - 1800;

    this.focalPoint.copy(this.targetFoc);
    this.position.copy(this.targetPos);
  }
  //
}

// export class LoadingKeyframe extends CameraActions {
//   constructor() {
//     const keyframe = keys.loading;
//     super(keyframe);
//   }

//   update() {}
// }
