import * as THREE from "three";
import { LoadedModel, LoadedTexture } from "../../types";

import { SCALE } from "../Constants";
import { BaseObject } from "./BaseObject";
import Environment from "./Environment";

enum Lights {
  ROOM_LIGHT1 = "roomLight1",
  MOUSE_LIGHT = "mouseLight",
  ROOM_LIGHT2 = "roomLight2",
  SPEAKER_LIGHT1 = "speakLight1",
  SPEAKER_LIGHT2 = "speakLight2",
}

export default class Room extends BaseObject {
  deskModel: LoadedModel;
  deskTexture: LoadedTexture;
  othersModel: LoadedModel;
  othersTexture: LoadedTexture;
  material: THREE.MeshBasicMaterial;

  environment: Environment = new Environment();

  constructor() {
    super();
    this.deskModel = this.resources.items.deskModel as LoadedModel;
    this.deskTexture = this.resources.items.deskTexture as LoadedTexture;
    this.othersModel = this.resources.items.othersModel as LoadedModel;
    this.othersTexture = this.resources.items.othersTexture as LoadedTexture;
    this.deskTexture.flipY = false;

    this.initTexture([this.deskTexture, this.othersTexture]);

    const speakLightMaterial = new THREE.MeshBasicMaterial({ color: 0xff575a });
    const mouseLightMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });

    const deskMaterial = new THREE.MeshBasicMaterial({
      map: this.deskTexture,
    });

    const othersMaterial = new THREE.MeshBasicMaterial({
      map: this.othersTexture,
    });

    const keyboards = [
      "keyboard",
      "keyboard_1",
      "keyboard_2",
      "keyboard_3",
      "keyboard_4",
    ];
    this.deskModel.scene.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;

      if (child instanceof THREE.Mesh && keyboards.includes(child.name)) {
        this.environment.setSunlight(
          new THREE.Vector3(15, SCALE * 10, 0),
          child
        );
      }
      if (child instanceof THREE.Mesh && !keyboards.includes(child.name)) {
        child.material.polygonOffset = true;
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
            child.material = deskMaterial;
            break;
        }
      }
    });

    this.othersModel.scene.traverse((child) => {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child instanceof THREE.Mesh && !keyboards.includes(child.name)) {
        child.material = othersMaterial;
      }
    });

    this.setScale([this.deskModel.scene, this.othersModel.scene], SCALE * 0.62);
  }
  add() {
    this.scene.add(this.deskModel.scene);
    this.scene.add(this.othersModel.scene);
  }

  setScale(scenes: THREE.Group[], scale: number) {
    scenes.forEach((scene) => scene.scale.set(scale, scale, scale));
  }

  initTexture(textures: LoadedTexture[]) {
    textures.forEach((t) => {
      t.flipY = false;
      t.encoding = THREE.sRGBEncoding;
    });
  }
}
