import { CubeTextureLoader, TextureLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
export type Source = TextureSource | CubeTextureSource | GltfModelSource;

export enum SourceType {
  TEXTURE = "texture",
  CUBE_TEXTURE = "cubeTexture",
  GLTF_MODEL = "gltfModel",
  DESK = "desk",
  ORBIT_CONTROLS_START = "orbitControlsStart",
}

export enum CameraKey {
  IDLE = "idle",
  MONITOR = "monitor",
  // LOADING = "loading",
  DESK = "desk",
}

export type CameraKeyFrame = {
  position: THREE.Vector3;
  focalPoint: THREE.Vector3;
};

export type TextureSource = {
  name: string;
  type: SourceType.TEXTURE;
  path: string;
};

export type CubeTextureSource = {
  name: string;
  type: SourceType.CUBE_TEXTURE;
  path: string[];
};

export type GltfModelSource = {
  name: string;
  type: SourceType.GLTF_MODEL;
  path: string;
};

export type Loaders = {
  gltfLoader: GLTFLoader;
  textureLoader: TextureLoader;
  cubeTextureLoader: CubeTextureLoader;
};

export type LoadedFile = LoadedTexture | LoadedCubeTexture | LoadedModel;

export type LoadedTexture = THREE.Texture;

export type LoadedModel = import("three/examples/jsm/loaders/GLTFLoader").GLTF;

export type LoadedCubeTexture = THREE.CubeTexture;
