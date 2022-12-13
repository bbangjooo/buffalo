import { CubeTextureLoader, TextureLoader } from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { Loaders, Source, SourceType, LoadedFile } from "../../types";
import sources from "../sources";
import EventEmitter from "./EventEmitter";

export default class Resources extends EventEmitter {
  loaders!: Loaders;
  items: { [name: string]: LoadedFile } = {};
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
    for (const source of sources) {
      switch (source?.type) {
        case SourceType.GLTF_MODEL:
          this.loaders.gltfLoader.load(source.path, (file) => {
            this.updateSources(source, file);
          });
          break;
        case SourceType.TEXTURE:
          this.loaders.textureLoader.load(source.path, (file) => {
            this.updateSources(source, file);
          });
          break;
        case SourceType.CUBE_TEXTURE:
          this.loaders.cubeTextureLoader.load(source.path, (file) => {
            this.updateSources(source, file);
          });
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
