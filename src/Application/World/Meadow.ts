import * as THREE from 'three';
import type Application from '../Application';
import { COURTYARD } from '../../design/history';

const TILE = 24;
const RADIUS = 2;
const GRASS = ['#A6BB86', '#B4C38D', '#97B48B', '#ADBF83'];
function random(seed: number) { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); }
function roomIndex(x: number, z: number) { return x >= 0 ? (z >= 0 ? 0 : 1) : (z < 0 ? 2 : 3); }

/** A bounded pool of tiles follows the visitor: the four grasslands have no outer wall. */
export default class Meadow {
  readonly root = new THREE.Group();
  private tiles: Array<{ root: THREE.Group; floor: THREE.Mesh; grass: THREE.InstancedMesh; flowers: THREE.InstancedMesh; rocks: THREE.InstancedMesh }> = [];
  private readonly floorGeometry: THREE.BufferGeometry;
  private readonly grassGeometry: THREE.BufferGeometry;
  private readonly flowerGeometry: THREE.BufferGeometry;
  private readonly rockGeometry: THREE.BufferGeometry;
  private readonly rockMaterial: THREE.Material;
  private readonly floorMaterials = GRASS.map(color => new THREE.MeshStandardMaterial({ color: new THREE.Color(color).convertSRGBToLinear(), roughness: 1, vertexColors: true }));
  private readonly grassMaterial: THREE.Material;
  private readonly flowerMaterial: THREE.Material;
  private readonly paths: THREE.Mesh[] = [];
  private cellX = Infinity;
  private cellZ = Infinity;
  private outdoor = false;
  private night = false;
  private reading = false;
  private readonly daySky = new THREE.Color('#CEDCE4').convertSRGBToLinear();
  private readonly nightSky = new THREE.Color('#111C2A').convertSRGBToLinear();
  private readonly atmosphere = new THREE.Fog(this.daySky, 18, 48);
  private readonly dummy = new THREE.Object3D();

  constructor(private application: Application, model: THREE.Group) {
    this.root.name = 'InfiniteMeadow';
    const positions: number[] = [], colors: number[] = [];
    const steps = 8, step = TILE / steps;
    for (let z = 0; z < steps; z++) for (let x = 0; x < steps; x++) {
      for (const triangle of [[[0,0],[0,1],[1,0]],[[1,0],[0,1],[1,1]]]) {
        const shade = .96 + random(x * 11 + z * 3) * .04;
        for (const [dx,dz] of triangle) { positions.push((x + dx) * step, 0, (z + dz) * step); colors.push(shade,shade,shade); }
      }
    }
    this.floorGeometry = new THREE.BufferGeometry();
    this.floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.floorGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.floorGeometry.computeVertexNormals();
    const template = (name: string) => {
      const mesh = model.getObjectByName(name);
      if (!(mesh instanceof THREE.Mesh) || Array.isArray(mesh.material)) throw new Error(`Missing Blender meadow template: ${name}`);
      return { geometry: mesh.geometry.clone(), material: mesh.material.clone() };
    };
    const grassSource = template('MeadowGrassClump'), flowerSource = template('MeadowFlower'), rockSource = template('MeadowRock');
    this.grassGeometry = grassSource.geometry; this.grassMaterial = grassSource.material;
    this.flowerGeometry = flowerSource.geometry; this.flowerMaterial = flowerSource.material;
    this.rockGeometry = rockSource.geometry; this.rockMaterial = rockSource.material;
    const templates = model.getObjectByName('MeadowTemplates'); if (templates) templates.visible = false;
    for (let i=0;i<(RADIUS*2+1)**2;i++) {
      const root = new THREE.Group();
      const floor = new THREE.Mesh(this.floorGeometry, this.floorMaterials[0]);
      floor.receiveShadow = true;
      const grass = new THREE.InstancedMesh(this.grassGeometry, this.grassMaterial, 52);
      const flowers = new THREE.InstancedMesh(this.flowerGeometry, this.flowerMaterial, 12);
      const rocks = new THREE.InstancedMesh(this.rockGeometry, this.rockMaterial, 4);
      // The small fixed pool is repositioned, so do not retain stale instance bounds.
      grass.frustumCulled = false; flowers.frustumCulled = false; rocks.frustumCulled = false;
      root.add(floor,grass,flowers,rocks); this.root.add(root); this.tiles.push({root,floor,grass,flowers,rocks});
    }
    const pathMaterial = new THREE.MeshStandardMaterial({color: new THREE.Color('#CCD0A4').convertSRGBToLinear(),roughness:1});
    for (let i=0;i<2;i++) {
      const path = new THREE.Mesh(new THREE.PlaneGeometry(TILE*(RADIUS*2+1),.45),pathMaterial);
      path.rotation.x=-Math.PI/2; if(i===1)path.rotation.z=Math.PI/2;
      path.position.y=COURTYARD.groundY+.007; path.receiveShadow=true;
      this.paths.push(path);this.root.add(path);
    }
    application.scene.add(this.root);
    this.update(0,0);
  }
  setOutdoor(active: boolean) {
    this.outdoor = active;
    this.applyAtmosphere();
    if (!active) this.update(0,0);
  }
  setReading(reading: boolean) {if(this.reading===reading)return;this.reading=reading;this.applyAtmosphere();}
  setNight(night: boolean) { if(this.night===night)return; this.night=night;
    this.floorMaterials.forEach((material,index)=>material.color.set(GRASS[index]).convertSRGBToLinear().multiplyScalar(night?.4:1));
    this.applyAtmosphere(); }
  private applyAtmosphere() {
    const sky = this.night ? this.nightSky : this.daySky;
    const offset = this.application.camera.getAtmosphereDistanceOffset();
    this.atmosphere.color.copy(sky);
    // Keep nearby objects clear and dissolve only the outer edge of the tile
    // pool into a neutral horizon. A projection bridge adds no physical haze.
    this.atmosphere.near = 18 + offset;
    this.atmosphere.far = 48 + offset;
    this.application.scene.fog = this.outdoor && !this.reading ? this.atmosphere : null;
    this.application.scene.background = this.outdoor ? sky : null;
  }
  update(x: number, z: number) {
    // Camera transitions keep moving even when the visitor stays in one tile.
    this.applyAtmosphere();
    const cellX=Math.floor(x/TILE),cellZ=Math.floor(z/TILE);
    if(cellX===this.cellX&&cellZ===this.cellZ)return;
    this.cellX=cellX;this.cellZ=cellZ;
    let i=0;
    for(let dz=-RADIUS;dz<=RADIUS;dz++) for(let dx=-RADIUS;dx<=RADIUS;dx++) {
      const tx=(cellX+dx)*TILE,tz=(cellZ+dz)*TILE,tile=this.tiles[i++];
      tile.root.position.set(tx,COURTYARD.groundY,tz);
      tile.floor.material=this.floorMaterials[roomIndex(tx+TILE/2,tz+TILE/2)];
      for(const [mesh,count] of [[tile.grass,52],[tile.flowers,12],[tile.rocks,4]] as const) {
        for(let j=0;j<count;j++) {
          const seed=(cellX+dx)*4727+(cellZ+dz)*971+j*13+(mesh===tile.flowers?91:mesh===tile.rocks?211:0);
          const px=.5+random(seed)*(TILE-1),pz=.5+random(seed+1)*(TILE-1);
          const wx=tx+px,wz=tz+pz;
          const clear=Math.abs(wx)>.65 && Math.abs(wz)>.65 && (Math.abs(wx)>6.2||Math.abs(wz)>6.2)
            && COURTYARD.stations.every(station=>Math.hypot(station.x-wx,station.z-wz)>2.25);
          const size=clear ? .65+random(seed+2)*.65 : 0;
          this.dummy.position.set(px,0,pz);
          this.dummy.rotation.set(0,random(seed+3)*Math.PI*2,0);
          this.dummy.scale.setScalar(mesh===tile.rocks ? size*.4 : size);
          this.dummy.updateMatrix();mesh.setMatrixAt(j,this.dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate=true;
      }
    }
    this.paths[0].position.x=(cellX+.5)*TILE;
    this.paths[1].position.z=(cellZ+.5)*TILE;
    this.application.renderer.instance.shadowMap.needsUpdate=true;
  }
  dispose() {
    this.floorGeometry.dispose();this.grassGeometry.dispose();this.flowerGeometry.dispose();this.rockGeometry.dispose();this.rockMaterial.dispose();
    this.floorMaterials.forEach(material=>material.dispose());this.grassMaterial.dispose();this.flowerMaterial.dispose();
    this.paths.forEach(path=>path.geometry.dispose());(this.paths[0].material as THREE.Material).dispose();
    this.root.removeFromParent();
  }
}
