import { LoadedModel } from "../../types";
import Application from "../Application";
import Resources from "../Utils/Resoures";

export abstract class BaseObject {
  application: Application = new Application();
  resources: Resources = this.application.resources;
  model: LoadedModel;
  scene: THREE.Scene = this.application.scene;

  // 실제 메서드 정의
  public add(): void {}
}
