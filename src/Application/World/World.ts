import { Scene } from "three";
import Application from "../Application";
import Resources from "../Utils/Resoures";
import { DirectiveText } from "./DirectiveText";
import Environment from "./Environment";
import MonitorScreen from "./MonitorScreen";
import Room from "./Room";

export default class World {
  application: Application;
  scene: Scene;
  resources: Resources;
  room: Room;
  monitorScreen: MonitorScreen;
  environment: Environment;
  text: DirectiveText;

  constructor() {
    this.application = new Application();
    this.scene = this.application.scene;
    this.resources = this.application.resources;
    this.resources.on("ready", () => {
      this.text = new DirectiveText();
      this.room = new Room();
      this.monitorScreen = new MonitorScreen();
      this.environment = new Environment();

      this.add();
    });
  }

  add() {
    this.monitorScreen.add();
    this.text.add();
    this.room.add();
    this.environment.add();
  }
  update() {}
}
