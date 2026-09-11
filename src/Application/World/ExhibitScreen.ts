import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type Application from '../Application';
import { COURTYARD } from '../../design/history';

/** One reusable HTML reading surface sits inside the selected physical exhibit frame. */
export default class ExhibitScreen {
  readonly container = document.createElement('div');
  readonly content = document.createElement('div');
  readonly object: CSS3DObject;
  readonly aperture: THREE.Mesh;
  private anchor?: THREE.Object3D;
  private pixels = 0;
  private readonly position = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  constructor(private application: Application) {
    this.container.id='exhibit-screen';
    this.content.id='exhibit-screen-content';
    Object.assign(this.container.style,{background:'#F1EDE3',backfaceVisibility:'hidden',pointerEvents:'none'});
    Object.assign(this.content.style,{width:'100%',height:'100%',overflow:'hidden'});
    this.container.appendChild(this.content);
    this.container.setAttribute('aria-hidden','true');
    this.object=new CSS3DObject(this.container);this.object.name='ExhibitReadingSurface';
    this.aperture=new THREE.Mesh(new THREE.PlaneGeometry(COURTYARD.reader.width,COURTYARD.reader.height),new THREE.MeshBasicMaterial({
      color:0x000000,opacity:0,transparent:false,blending:THREE.NoBlending,depthWrite:true,depthTest:true,toneMapped:false,fog:false,side:THREE.DoubleSide,
    }));
    this.aperture.name='ExhibitReadingAperture';this.aperture.renderOrder=100;
    this.application.cssScene.add(this.object);this.application.scene.add(this.aperture);
    this.application.renderer.cssInstance.domElement.appendChild(this.container);
    this.hide();
  }
  show(anchor: THREE.Object3D) {this.anchor=anchor;this.object.visible=true;this.aperture.visible=true;this.update();}
  hide() {this.object.visible=false;this.aperture.visible=false;this.setInteractive(false);}
  setInteractive(active: boolean) {
    this.container.style.pointerEvents=active?'auto':'none';
    this.container.setAttribute('aria-hidden',String(!active));
    // inert prevents off-camera links from entering the keyboard focus order.
    if(active)this.container.removeAttribute('inert');else this.container.setAttribute('inert','');
  }
  update() {
    this.container.style.background=this.application.world.night?'#243A32':'#F1EDE3';
    if(!this.anchor)return;
    this.anchor.updateWorldMatrix(true,false);
    this.anchor.matrixWorld.decompose(this.position,this.rotation,this.scale);
    this.aperture.position.copy(this.position);this.aperture.quaternion.copy(this.rotation);this.aperture.scale.copy(this.scale);
    this.object.position.copy(this.position);this.object.quaternion.copy(this.rotation);
    const {width,height}=this.application.sizes;
    // Preserve a readable document scale; camera fitting uses the same safe viewport.
    const fraction=width<700?.92:.82;
    const projected=Math.min(width*fraction,(height-110)*COURTYARD.reader.width/COURTYARD.reader.height*.88);
    const pixels=Math.max(280,Math.min(1120,Math.round(projected)));
    if(pixels!==this.pixels){this.pixels=pixels;this.container.style.width=pixels+'px';this.container.style.height=pixels*COURTYARD.reader.height/COURTYARD.reader.width+'px';}
    this.object.scale.copy(this.scale).multiplyScalar(COURTYARD.reader.width/pixels);
  }
  dispose(){this.container.remove();this.object.removeFromParent();this.aperture.removeFromParent();this.aperture.geometry.dispose();(this.aperture.material as THREE.Material).dispose();}
}
