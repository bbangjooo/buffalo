import { CubeTextureLoader, TextureLoader } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { Loaders, Source, SourceType, LoadedFile } from "../../types";
import EventEmitter from "./Eventemitter";

export default class Resources extends EventEmitter {
  loaders!: Loaders;
  items: { [name: string]: LoadedFile } = {};
  error: string | null = null;
  private loaded: number = 0;
  private readonly toLoad: number;
  constructor(private readonly sources: Source[]) {
    super();
    this.toLoad = this.sources.length;
    this.setLoaders();
    this.loadSources();
  }

  setLoaders() {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("/draco/");
    this.loaders = {
      gltfLoader: new GLTFLoader(),
      textureLoader: new TextureLoader(),
      cubeTextureLoader: new CubeTextureLoader(),
    };
    this.loaders.gltfLoader.setDRACOLoader(dracoLoader);
  }

  loadSources() {
    const failed = () => {
      this.error = "Check your connection and reload, or visit the blog.";
      this.trigger("error", [this.error]);
    };
    for (const source of this.sources) {
      switch (source?.type) {
        case SourceType.GLTF_MODEL:
          this.loaders.gltfLoader.load(source.path, (file) => {
            this.updateSources(source, file);
          }, undefined, failed);
          break;
        case SourceType.TEXTURE:
          this.loaders.textureLoader.load(source.path, (file) => {
            this.updateSources(source, file);
          }, undefined, failed);
          break;
        case SourceType.CUBE_TEXTURE:
          this.loaders.cubeTextureLoader.load(source.path, (file) => {
            this.updateSources(source, file);
          }, undefined, failed);
      }
    }
  }

  private updateSources(source: Source, file: LoadedFile) {
    this.items[source.name] = file;
    this.loaded++;
    if (this.toLoad === this.loaded) {
      this.trigger("ready");
    }
  }
}
