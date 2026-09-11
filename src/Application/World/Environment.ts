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
  private outdoors = false;

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

  add() { this.scene.add(this.sunLight, this.sunLight.target, this.fillLight, this.ambientLight, this.lamp, this.ground); }

  setRoom(_room: RoomId, reduced: boolean) {
    // Navigation does not move the house or its lighting rig.
    this.applyLighting(this.night, reduced);
  }

  setLampPosition(position: THREE.Vector3) { this.lamp.position.copy(position); }

  setCourtyard(active: boolean) {
    this.outdoors = active;
    if (!active) { this.sunLight.position.set(6,10,7);this.sunLight.target.position.set(0,0,0); }
    const camera = this.sunLight.shadow.camera;
    const extent = active ? 20 : 10;
    camera.left = camera.bottom = -extent;
    camera.right = camera.top = extent;
    camera.far = active ? 90 : 36;
    camera.updateProjectionMatrix();
    this.application.renderer.instance.shadowMap.needsUpdate = true;
  }

  followCourtyard(x: number, z: number) {
    if (!this.outdoors) return;
    const tx = Math.round(x / 2) * 2, tz = Math.round(z / 2) * 2;
    if (this.sunLight.target.position.x === tx && this.sunLight.target.position.z === tz) return;
    this.sunLight.position.set(tx + 6, 10, tz + 7);
    this.sunLight.target.position.set(tx, 0, tz);
    this.sunLight.target.updateMatrixWorld();
    this.application.renderer.instance.shadowMap.needsUpdate = true;
  }

  setNight(night: boolean, reduced: boolean) {
    this.night = night;
    this.applyLighting(night, reduced);
  }

  private applyLighting(night: boolean, reduced: boolean) {
    const duration = reduced ? 0 : 0.65;
    this.sunLight.color.set(night ? '#BCCCD8' : COLORS.glow);
    this.ambientLight.color.set(night ? '#8FA7BF' : COLORS.paper);
    gsap.to(this.sunLight, { intensity: night ? 0.32 : 2.1, duration, overwrite: true });
    gsap.to(this.ambientLight, { intensity: night ? 0.35 : 0.9, duration, overwrite: true });
    gsap.to(this.fillLight, { intensity: night ? 0.16 : 0.8, duration, overwrite: true });
    this.scene.environment = night ? null : this.environmentMap.texture;
    gsap.to(this.application.renderer.instance, { toneMappingExposure: night ? 0.9 : 1, duration, overwrite: true });
    gsap.to(this.lamp, { intensity: night ? 4 : 0, duration, overwrite: true });
  }

  dispose() { this.environmentMap.dispose(); }
}
