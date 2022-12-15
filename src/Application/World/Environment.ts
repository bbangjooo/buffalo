import * as THREE from "three";
import { BaseObject } from "./BaseObject.js";

export default class Environment extends BaseObject {
  sunLight: THREE.DirectionalLight;
  ambientLight: THREE.AmbientLight;

  constructor() {
    super();
  }

  setSunlight(position: THREE.Vector3, target: THREE.Mesh) {
    this.sunLight = new THREE.DirectionalLight("#ffffff", 1);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.camera.far = 20;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.normalBias = 0.05;

    this.sunLight.position.copy(position);
    this.sunLight.target = target;
    this.scene.add(this.sunLight);
  }

  resize() {}

  update() {}
}
