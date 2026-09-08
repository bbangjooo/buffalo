import * as THREE from 'three';
import { gsap } from 'gsap';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment';
import { COLORS, RoomId } from '../../design/rooms';
import { BaseObject } from './BaseObject';

export default class Environment extends BaseObject {
  sunLight = new THREE.DirectionalLight(COLORS.glow, 2.1);
  ambientLight = new THREE.HemisphereLight(COLORS.paper, COLORS.shadow, 0.9);
  fillLight = new THREE.DirectionalLight(COLORS.paper, 0.8);
  lamp = new THREE.PointLight(COLORS.glow, 0, 7, 2);
  private ground: THREE.Mesh;
  private environmentMap: THREE.WebGLRenderTarget;
  private night = false;

  constructor() {
    super();
    this.sunLight.position.set(6, 10, 7);
    this.fillLight.position.set(-6, 8, -7);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.left = -10;
    this.sunLight.shadow.camera.right = 10;
    this.sunLight.shadow.camera.top = 10;
    this.sunLight.shadow.camera.bottom = -10;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 36;
    this.sunLight.shadow.normalBias = 0.025;
    this.sunLight.shadow.bias = -0.00012;
    this.sunLight.shadow.radius = 4;
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.ShadowMaterial({ opacity: 0.13, color: COLORS.shadow }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.5;
    this.ground.receiveShadow = true;
    // Studio reflections let brass, wood and fabric have distinct responses to light.
    const studio = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.application.renderer.instance);
    this.environmentMap = pmrem.fromScene(studio, 0.04);
    this.scene.environment = this.environmentMap.texture;
    studio.dispose();
    pmrem.dispose();
  }

  add() { this.scene.add(this.sunLight, this.fillLight, this.ambientLight, this.lamp, this.ground); }

  setRoom(_room: RoomId, reduced: boolean) {
    // Navigation does not move the house or its lighting rig.
    this.applyLighting(this.night, reduced);
  }

  setLampPosition(position: THREE.Vector3) { this.lamp.position.copy(position); }

  setNight(night: boolean, reduced: boolean) {
    this.night = night;
    this.applyLighting(night, reduced);
  }

  private applyLighting(night: boolean, reduced: boolean) {
    const duration = reduced ? 0 : 0.65;
    gsap.to(this.sunLight, { intensity: night ? 0.65 : 2.1, duration, overwrite: true });
    gsap.to(this.ambientLight, { intensity: night ? 0.48 : 0.9, duration, overwrite: true });
    gsap.to(this.lamp, { intensity: night ? 6 : 0, duration, overwrite: true });
  }

  dispose() { this.environmentMap.dispose(); }
}
