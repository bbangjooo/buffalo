import * as THREE from "three";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry";
import { LoadedTexture } from "../../types";
import { SCALE } from "../Constants";
import { Mesh } from "three";
import { BaseObject } from "./BaseObject";

export class DirectiveText extends BaseObject {
  mesh: Mesh;
  texture: LoadedTexture;
  geometry: TextGeometry;
  position: THREE.Vector3;
  fontLoader: FontLoader = new FontLoader();

  constructor() {
    super();
    this.position = new THREE.Vector3(-SCALE * 1.15, SCALE * 4.5, -SCALE);
    this.texture = this.resources.items.textTexture as LoadedTexture;
  }
  add() {
    this.fontLoader.load("/fonts/Rubik Vinyl_Regular.json", (font) => {
      this.geometry = new TextGeometry("blog.bbangjo.kr", {
        font,
        size: SCALE * 0.2,
        height: 2,
        curveSegments: 12,
        bevelEnabled: true,
        bevelThickness: 0.03,
        bevelSize: 0.02,
        bevelOffset: 0,
        bevelSegments: 5,
      });

      const material = new THREE.MeshMatcapMaterial({ matcap: this.texture });
      this.mesh = new THREE.Mesh(this.geometry, material);
      this.mesh.position.copy(this.position);
      this.scene.add(this.mesh);
    });
  }
}
