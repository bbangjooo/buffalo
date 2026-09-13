import * as THREE from 'three';
import type Application from '../Application';
import { COURTYARD } from '../../design/history';
import landscape from '../../design/atlas-landscape.json';
import village from '../../design/medieval-village-layout.json';
import { ATLAS_NIGHT, ATLAS_PAPER, inkNight, preparePenInkMaterial } from './PenInk';

type PlantKind = keyof typeof landscape.templates;
type Placement = typeof landscape.placements[number];

/** Atlas paper follows the visitor; a few authored gardens stay in their places. */
export default class Meadow {
  readonly root = new THREE.Group();
  readonly planting = new THREE.Group();
  private readonly plants: THREE.InstancedMesh[] = [];
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial>;
  private readonly daySky = new THREE.Color(ATLAS_PAPER).convertSRGBToLinear();
  private readonly nightSky = new THREE.Color(ATLAS_NIGHT).convertSRGBToLinear();
  private readonly sky = new THREE.Color();
  private readonly skyBackground = new THREE.Color();
  private readonly atmosphere = new THREE.Fog(this.daySky,24,54);
  private outdoor = false;
  private reading = false;
  private cellX = Infinity;
  private cellZ = Infinity;

  constructor(private application: Application, model: THREE.Group) {
    this.root.name = 'AtlasPaperGround';
    this.root.userData.penInkAuthored = true;
    const material = new THREE.MeshBasicMaterial({color:'#ffffff',toneMapped:false});
    material.name='PenPaperGround';
    preparePenInkMaterial(material);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(160,160),material);
    this.ground.rotation.x=-Math.PI/2;
    this.ground.position.y=COURTYARD.groundY;
    this.ground.userData.penInkAuthored=true;
    this.root.add(this.ground);
    // Legacy border beds and source templates are never visible themselves.
    // Only the placements in atlas-landscape.json appear in this composition.
    for (const name of ['MeadowTemplates','PenInkGarden']) {
      const group=model.getObjectByName(name);
      if(group) group.visible=false;
    }
    this.planting.name='AtlasCuratedPlanting';
    this.planting.userData.penInkAuthored=true;
    this.planting.userData.curated=true;
    this.planting.userData.revision=landscape.revision;
    this.root.add(this.planting);
    this.createPlanting(model);
    application.scene.add(this.root);
    this.update(0,0);
  }
  private createPlanting(model: THREE.Group) {
    if(landscape.placements.length>landscape.limits.maxPlacements) throw new Error('Atlas garden placement budget exceeded');
    const dummy=new THREE.Object3D();
    let total=0;
    for(const kind of Object.keys(landscape.templates) as PlantKind[]) {
      const template=landscape.templates[kind];
      const source=model.getObjectByName(template.name);
      if(!(source instanceof THREE.Mesh)||Array.isArray(source.material)) throw new Error(`Missing atlas plant template: ${template.name}`);
      // Copy before adjusting ink weight. The source is also used by Blender
      // exports; changing its shared data once replicated an entire old bed.
      const geometry=source.geometry.clone();
      geometry.computeBoundingBox();
      const bounds=geometry.boundingBox!;
      const radius=Math.hypot(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)));
      if(radius>template.radius*1.05 || bounds.max.y>template.height*1.05) {
        geometry.dispose();
        throw new Error(`Atlas plant template exceeds authored bounds: ${template.name}`);
      }
      const colors=geometry.getAttribute('color');
      if(!colors) {geometry.dispose();throw new Error(`Atlas plant has no ink colors: ${template.name}`);}
      for(let i=0;i<colors.count;i++) {
        const r=colors.getX(i),g=colors.getY(i),b=colors.getZ(i);
        // White botanical surfaces stay paper. Only the marks are softened,
        // so both the sepia day and silver night keep the rooms dominant.
        if(Math.max(r,g,b)<.7) colors.setXYZ(i,r+(1-r)*template.inkMix,g+(1-g)*template.inkMix,b+(1-b)*template.inkMix);
      }
      colors.needsUpdate=true;
      const material=source.material.clone();
      material.name=`PenAtlasPlant_${kind}`;
      material.side=THREE.DoubleSide;
      preparePenInkMaterial(material);
      const placements=landscape.placements.filter(item=>item.kind===kind&&this.isClear(item,template.radius*item.scale));
      const mesh=new THREE.InstancedMesh(geometry,material,placements.length);
      mesh.name=`AtlasPlanting_${kind}`;
      mesh.userData.penInkAuthored=true;
      mesh.userData.templateName=template.name;
      mesh.userData.placementIds=placements.map(item=>item.id);
      mesh.frustumCulled=false;
      placements.forEach((item,index)=>{
        dummy.position.set(item.x,COURTYARD.groundY+landscape.groundOffset,item.z);
        dummy.rotation.set(0,item.yaw,0);
        dummy.scale.setScalar(item.scale);
        dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate=true;
      total+=placements.length;
      this.plants.push(mesh);this.planting.add(mesh);
    }
    this.planting.userData.placementCount=total;
    this.planting.userData.omittedPlacementCount=landscape.placements.length-total;
  }
  private isClear(item: Placement,radius:number) {
    const c=landscape.clearance;
    if(Math.abs(item.x)-radius<COURTYARD.houseHalfSize+c.housePadding&&Math.abs(item.z)-radius<COURTYARD.houseHalfSize+c.housePadding)return false;
    if(Math.abs(item.x)-radius<c.crossHalfWidth||Math.abs(item.z)-radius<c.crossHalfWidth)return false;
    const stationRadius=item.kind==='tree'?c.treeStationRadius:c.stationRadius;
    if(COURTYARD.stations.some(station=>{
      if(Math.hypot(station.x-item.x,station.z-item.z)<stationRadius+radius)return true;
      const x=station.x+Math.sin(station.yaw)*2.7,z=station.z+Math.cos(station.yaw)*2.7;
      return Math.hypot(x-item.x,z-item.z)<c.spawnPadding+radius;
    }))return false;
    if(COURTYARD.quadrants.some(q=>Math.hypot(q.spawn[0]-item.x,q.spawn[1]-item.z)<c.spawnPadding+radius))return false;
    return [...COURTYARD.obstacles,...village.obstacles].every(o=>Math.hypot(o.x-item.x,o.z-item.z)>=o.radius+radius+c.solidPadding);
  }
  setOutdoor(active:boolean) {this.outdoor=active;this.applyAtmosphere();if(!active)this.update(0,0);}
  setReading(reading:boolean) {this.reading=reading;this.applyAtmosphere();}
  setNight(_night:boolean) {this.applyAtmosphere();}
  private applyAtmosphere() {
    const sky=this.sky.copy(this.daySky).lerp(this.nightSky,inkNight.amount.value);
    const offset=this.application.camera.getAtmosphereDistanceOffset();
    this.atmosphere.color.copy(sky);
    this.atmosphere.near=24+offset;this.atmosphere.far=54+offset;
    this.application.scene.fog=this.outdoor&&!this.reading?this.atmosphere:null;
    // r147's legacy clear buffer is sRGB; fog is encoded by its shader.
    this.application.scene.background=this.outdoor?this.skyBackground.copy(sky).convertLinearToSRGB():null;
  }
  update(x:number,z:number) {
    this.applyAtmosphere();
    const cellX=Math.floor(x/24),cellZ=Math.floor(z/24);
    if(cellX===this.cellX&&cellZ===this.cellZ)return;
    this.cellX=cellX;this.cellZ=cellZ;
    // Only blank ground follows exploration. Garden instance matrices stay
    // fixed even after walking kilometres beyond the authored village.
    this.ground.position.x=(cellX+.5)*24;
    this.ground.position.z=(cellZ+.5)*24;
  }
  dispose() {
    this.ground.geometry.dispose();this.ground.material.dispose();
    this.plants.forEach(mesh=>{
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    });
    this.root.removeFromParent();
  }
}
