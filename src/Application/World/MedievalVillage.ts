import * as THREE from 'three';
import { gsap } from 'gsap';
import type Application from '../Application';
import type { LoadedModel } from '../../types';
import layout from '../../design/medieval-village-layout.json';
import { ATLAS_OBJECT_PAPER, INK_FIRE_LIMIT, inkNight, preparePenInkModel } from './PenInk';

/** Authored village + a bounded set of living fire, window and sky effects. */
export default class MedievalVillage {
  readonly root: THREE.Group;
  readonly effects = new THREE.Group();
  readonly firePositions: THREE.Vector3[] = [];
  private readonly fireScales: number[] = [];
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly flameMaterial: THREE.ShaderMaterial;
  private readonly flames: THREE.InstancedMesh;
  private readonly embers: THREE.Points;
  private readonly stars: THREE.Points;
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly glowTexture: THREE.CanvasTexture;
  private readonly glows: THREE.Sprite[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly windows: Array<{ material: THREE.MeshBasicMaterial; day: THREE.Color; phase: number }> = [];
  private readonly windowMeshes: Array<{ mesh: THREE.Mesh; original: THREE.Material | THREE.Material[] }> = [];
  private readonly amber = new THREE.Color('#d5cebd').convertSRGBToLinear();
  private elapsed = 0;
  private night = false;
  private disposed = false;
  private readonly onMotionChange = () => {
    if (this.reducedMotion.matches) {
      gsap.killTweensOf(inkNight.amount);
      inkNight.amount.value = this.night ? 1 : 0;
    }
  };

  constructor(private application: Application, room: THREE.Object3D) {
    this.root = (application.resources.items.medievalVillageModel as LoadedModel).scene;
    this.root.name = 'MedievalVillage';
    preparePenInkModel(this.root);
    application.scene.add(this.root);
    this.effects.name = 'VillageFireAndNightSky';
    application.scene.add(this.effects);
    application.world.courtyard!.walk.setVillageObstacles(layout.obstacles);
    inkNight.amount.value = 0;
    inkNight.fires.value.forEach(fire => fire.set(0, -100, 0, 0));

    const windowOwners = new Set<THREE.Object3D>();
    for (const source of [room, this.root]) {
      source.updateMatrixWorld(true);
      source.traverse(object => {
        if ((object.userData.torch || object.name.startsWith('TorchAnchor_')) && this.firePositions.length < INK_FIRE_LIMIT) {
          this.firePositions.push(object.getWorldPosition(new THREE.Vector3()));
          this.fireScales.push(Math.min(1, object.getWorldScale(new THREE.Vector3()).x));
        }
        if (object.userData.nightWindow || /^(VillageWindow_|RoomCandleWindow_)/.test(object.name)) windowOwners.add(object);
      });
    }
    const seenWindows = new Set<THREE.Mesh>();
    windowOwners.forEach(owner => owner.traverse(object => {
      if (!(object instanceof THREE.Mesh) || seenWindows.has(object)) return;
      seenWindows.add(object);
      this.windowMeshes.push({ mesh: object, original: object.material });
      // The pane owns its glow; mullions and unrelated paper stay ink-drawn.
      const originals = Array.isArray(object.material) ? object.material : [object.material];
      const replacements = originals.map(() => {
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(ATLAS_OBJECT_PAPER).convertSRGBToLinear(),
          side: THREE.DoubleSide, toneMapped: false, fog: true,
        });
        material.name = 'VillageWindowLight';
        this.windows.push({ material, day: material.color.clone(), phase: this.windows.length * 1.73 });
        return material;
      });
      object.material = Array.isArray(object.material) ? replacements : replacements[0];
    }));

    this.flameMaterial = new THREE.ShaderMaterial({
      uniforms: { fireTime: inkNight.time, nightAmount: inkNight.amount },
      vertexShader: `
        uniform float fireTime;
        varying float flameHeight;
        void main() {
          vec3 p = position;
          flameHeight = p.y;
          float phase = instanceMatrix[3].x * 1.7 + instanceMatrix[3].z * 0.8;
          p.x += sin(fireTime * 3.7 + p.y * 7.0 + phase) * p.y * p.y * 0.20;
          p.z += cos(fireTime * 2.9 + p.y * 5.0 + phase) * p.y * p.y * 0.12;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float nightAmount;
        varying float flameHeight;
        void main() {
          vec3 color = mix(vec3(.92,.89,.81),vec3(.46,.39,.29),smoothstep(0.0,.88,flameHeight));
          gl_FragColor = vec4(color, nightAmount);
          #include <encodings_fragment>
        }
      `,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const profile = [[0, 0], [.28, .08], [.34, .22], [.26, .42], [.14, .66], [0, 1]].map(([x,y]) => new THREE.Vector2(x,y));
    const geometry = new THREE.LatheGeometry(profile, 7);
    this.flames = new THREE.InstancedMesh(geometry, this.flameMaterial, this.firePositions.length);
    this.flames.name = 'AnimatedTorchFlames';
    this.flames.frustumCulled = false;
    const transform = new THREE.Object3D();
    this.firePositions.forEach((position, index) => {
      transform.position.copy(position).add(new THREE.Vector3(0, -.08, 0));
      const scale = this.fireScales[index];
      transform.scale.set(.47*scale, (.52 + index % 3 * .04)*scale, .47*scale);
      transform.updateMatrix();
      this.flames.setMatrixAt(index, transform.matrix);
    });
    this.flames.instanceMatrix.needsUpdate = true;
    this.effects.add(this.flames);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0, 'rgba(226,217,197,.30)');
    gradient.addColorStop(.22, 'rgba(210,195,169,.10)');
    gradient.addColorStop(1, 'rgba(210,195,169,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0,0,64,64);
    this.glowTexture = new THREE.CanvasTexture(canvas);
    this.glowTexture.encoding = THREE.sRGBEncoding;
    this.glowMaterial = new THREE.SpriteMaterial({ map:this.glowTexture, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false });
    this.firePositions.forEach((position,index) => {
      const glow = new THREE.Sprite(this.glowMaterial);
      glow.name = `TorchHalo${index}`;
      glow.position.copy(position); glow.position.y += .10; glow.scale.setScalar(1.8);
      this.glows.push(glow); this.effects.add(glow);
      if (index < 4) {
        const light = new THREE.PointLight('#d5cebd', 0, 4, 2);
        light.position.copy(position); this.lights.push(light); this.effects.add(light);
      }
    });

    const emberPositions = new Float32Array(this.firePositions.length * 5 * 3);
    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberPositions,3));
    this.embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({ color:'#ffc572', size:.035, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false }));
    this.embers.name = 'RisingTorchEmbers'; this.embers.frustumCulled = false;
    this.effects.add(this.embers);

    const starPositions: number[] = [];
    for (let i=0;i<140;i++) {
      const angle = i*2.39996, y = 14 + (Math.sin(i*73.71)*.5+.5)*34;
      const radius = Math.sqrt(68*68-y*y);
      starPositions.push(Math.cos(angle)*radius,y,Math.sin(angle)*radius);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position',new THREE.Float32BufferAttribute(starPositions,3));
    this.stars = new THREE.Points(starGeometry,new THREE.PointsMaterial({color:'#ddd9c7',size:.20,transparent:true,opacity:0,depthWrite:false,toneMapped:false,fog:false}));
    this.stars.name = 'VillageStars';this.stars.frustumCulled=false;
    this.effects.add(this.stars);
    this.reducedMotion.addEventListener('change', this.onMotionChange);
    this.update(0);
  }

  setNight(night: boolean): void {
    if (this.disposed) return;
    this.night = night;
    if (this.reducedMotion.matches) {
      gsap.killTweensOf(inkNight.amount);
      inkNight.amount.value = night ? 1 : 0;
    } else gsap.to(inkNight.amount, { value:night?1:0, duration:1.1, ease:'power2.inOut', overwrite:true });
  }

  update(deltaMs: number, interiorFocus = false): void {
    if (this.disposed) return;
    if (!this.reducedMotion.matches) this.elapsed += Math.min(deltaMs,50)/1000;
    inkNight.time.value = this.reducedMotion.matches ? 0 : this.elapsed;
    const amount = inkNight.amount.value;
    const worldVisible = this.application.world.view !== 'rhythm';
    // Mobile document fitting moves the camera outside the centre house.
    // Surrounding roofs must not stand between that camera and its document.
    this.root.visible = worldVisible && !interiorFocus;
    this.effects.visible = worldVisible && amount > .001;
    this.glowMaterial.opacity = amount * .35;
    const positions = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    this.firePositions.forEach((position,index) => {
      const flicker = this.reducedMotion.matches ? 1 : .94 + .07*Math.sin(this.elapsed*3.1+index*1.7)+.035*Math.sin(this.elapsed*6.3+index);
      inkNight.fires.value[index].set(position.x,position.y,position.z,flicker*this.fireScales[index]);
      if (this.lights[index]) this.lights[index].intensity = amount*flicker*1.8;
      this.glows[index].scale.setScalar((.78 + flicker*.06)*this.fireScales[index]);
      for (let j=0;j<5;j++) {
        const t = (this.elapsed*.28+j*.19+index*.071)%1;
        positions.setXYZ(index*5+j,position.x+Math.sin(t*9+index)*.15*t,position.y+t*1.5,position.z+Math.cos(t*6+j)*.12*t);
      }
    });
    positions.needsUpdate=true;
    this.embers.visible=!this.reducedMotion.matches;
    (this.embers.material as THREE.PointsMaterial).opacity=amount*.72;
    (this.stars.material as THREE.PointsMaterial).opacity=amount*.70;
    this.stars.position.x=this.application.camera.instance.position.x;
    this.stars.position.z=this.application.camera.instance.position.z;
    this.windows.forEach(({material,day,phase}) => {
      material.color.copy(this.amber).multiplyScalar(.26 + (this.reducedMotion.matches?0:.012*Math.sin(this.elapsed*.8+phase))).lerp(day,1-amount);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed=true;
    this.application.world.courtyard?.walk.setVillageObstacles([]);
    gsap.killTweensOf(inkNight.amount);
    this.reducedMotion.removeEventListener('change',this.onMotionChange);
    inkNight.amount.value=0;inkNight.fires.value.forEach(fire=>fire.w=0);
    this.flames.geometry.dispose();this.flameMaterial.dispose();
    this.embers.geometry.dispose();(this.embers.material as THREE.Material).dispose();
    this.stars.geometry.dispose();(this.stars.material as THREE.Material).dispose();
    this.glowMaterial.dispose();this.glowTexture.dispose();
    this.windowMeshes.forEach(({mesh,original}) => { mesh.material = original; });
    this.windows.forEach(window=>window.material.dispose());
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
    this.lights.forEach(light=>light.shadow.dispose());
    this.effects.removeFromParent();this.root.removeFromParent();
  }
}
