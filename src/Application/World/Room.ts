import * as THREE from "three";
import { LoadedModel, LoadedTexture } from "../../types";

import { SCALE } from "../Constants";
import { BaseObject } from "./BaseObject";

enum Lights {
  ROOM_LIGHT1 = "roomLight1",
  MOUSE_LIGHT = "mouseLight",
  ROOM_LIGHT2 = "roomLight2",
  SPEAKER_LIGHT1 = "speakLight1",
  SPEAKER_LIGHT2 = "speakLight2",
}

export default class Room extends BaseObject {
  model: LoadedModel;
  material: THREE.MeshBasicMaterial;
  texture: LoadedTexture;

  constructor() {
    super();
    this.model = this.resources.items.roomModel as LoadedModel;

    const speakLightMaterial = new THREE.MeshBasicMaterial({ color: 0xff575a });
    const mouseLightMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    this.model.scene.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child instanceof THREE.Mesh) {
        switch (child.name) {
          case Lights.SPEAKER_LIGHT1:
            child.material = speakLightMaterial;
            break;
          case Lights.SPEAKER_LIGHT2:
            child.material = speakLightMaterial;
            break;
          case Lights.MOUSE_LIGHT:
            child.material = mouseLightMaterial;
            break;
          default:
            child.material.polygonOffset = true;
            // child.material = material;
            break;
        }
      }
    });
    let scale = SCALE * 0.62; // 900 * 0.6

    this.model.scene.scale.set(scale, scale, scale);

    // this.setFloor();
  }
  setFloor() {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100),
      new THREE.MeshStandardMaterial({
        color: 0xffe6a2,
        side: THREE.BackSide,
      })
    );
    this.model.scene.add(plane);
    plane.rotation.x = Math.PI / 2;
    plane.position.y = -0.3;
    plane.receiveShadow = true;
  }
  add() {
    this.scene.add(this.model.scene);
  }
}
