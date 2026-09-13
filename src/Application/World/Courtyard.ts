import * as THREE from 'three';
import type Application from '../Application';
import type GuideRobot from './GuideRobot';
import { EventBus } from '../UI/EventBus';
import { isRoomId, RoomId } from '../../design/rooms';
import { COURTYARD, EXHIBITIONS } from '../../design/history';
import { LoadedModel } from '../../types';
import { CourtyardWalk, walkDirection, WalkDirection } from './CourtyardWalk';
import Meadow from './Meadow';
import ExhibitScreen from './ExhibitScreen';
import { isPenInkObject, preparePenInkModel } from './PenInk';

export interface CourtyardState { active: boolean; nearby: string | null; visited: string[]; x: number; z: number; room: RoomId; reading: string | null; }
interface ReadingActions { canInteract: () => boolean; open: (anchor: THREE.Object3D) => void; close: () => void; }

function coverLines(context: CanvasRenderingContext2D, text: string, y: number, lineHeight: number, maxLines: number) {
  let remaining = text.trim();
  let row = 0;
  while (remaining && row < maxLines) {
    let length = 1;
    while (length < remaining.length && context.measureText(remaining.slice(0, length + 1)).width <= 456) length++;
    if (length < remaining.length) {
      const space = remaining.lastIndexOf(' ', length);
      if (space > 0) length = space;
    }
    let line = remaining.slice(0, length).trim();
    remaining = remaining.slice(length).trim();
    if (row === maxLines - 1 && remaining) {
      while (context.measureText(line + '…').width > 456) line = line.slice(0, -1);
      line += '…';
    }
    context.fillText(line, 32, y + row * lineHeight);
    row++;
  }
  return y + Math.max(0, row - 1) * lineHeight;
}

/** Four continuous room quadrants, with one physical screen for every history record. */
export default class Courtyard {
  readonly root: THREE.Group;
  readonly walk = new CourtyardWalk();
  readonly screen: ExhibitScreen;
  readonly meadow: Meadow;
  active = false;
  private nearby: string | null = null;
  private reading: string | null = null;
  private closingRecord: string | null = null;
  private visited = new Set<string>();
  private lastPublish = 0;
  private readonly off: Array<() => void> = [];
  private readonly halos = new Map<string, THREE.Mesh>();
  private readonly anchors = new Map<string, THREE.Object3D>();
  private readonly covers: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private pointerDown: { id: number; x: number; y: number; moved: boolean } | null = null;
  private coverNight = false;
  private readonly onKeyUp = (event: KeyboardEvent) => {
    const code = event.code || event.key;
    this.walk.setInput(code, null);
    this.walk.setSprint(code, false);
  };
  private readonly stop = () => {
    this.walk.stop(); this.pointerDown = null;
    this.application.camera.followCourtyard(this.walk.x, this.walk.z, true);
  };
  private readonly onVisibility = () => { if (document.hidden) this.stop(); };

  constructor(private application: Application, private guide: GuideRobot, private actions: ReadingActions) {
    this.root = (application.resources.items.courtyardModel as LoadedModel).scene;
    preparePenInkModel(this.root);
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) { object.castShadow = !isPenInkObject(object); object.receiveShadow = false; }
    });
    application.scene.add(this.root);
    this.meadow = new Meadow(application, this.root);
    this.screen = new ExhibitScreen(application);
    for (const station of COURTYARD.stations) {
      const anchor = this.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`ScreenAnchor_${station.id}`));
      if (!anchor) throw new Error(`Missing outdoor screen: ${station.id}`);
      this.anchors.set(station.id, anchor);
      this.addCover(station, anchor);
      const model = this.root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(`Exhibit_${station.id}`));
      if (model) model.userData.exhibitId = station.id;
      const halo = new THREE.Mesh(new THREE.RingGeometry(1.91, 1.97, 32),
        new THREE.MeshBasicMaterial({ color: '#292b2e', toneMapped: false, side: THREE.DoubleSide }));
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(station.x, COURTYARD.groundY + .012, station.z);
      halo.visible = false;
      this.root.add(halo); this.halos.set(station.id, halo);
    }
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.stop);
    window.addEventListener('resize', this.stop);
    document.addEventListener('visibilitychange', this.onVisibility);
    const canvas = application.renderer.instance.domElement;
    const down = (event: PointerEvent) => {
      if (!this.canWalk() || event.button !== 0 || event.isPrimary === false) return;
      this.pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    };
    const up = (event: PointerEvent) => {
      const start = this.pointerDown; this.pointerDown = null;
      if (!start || start.moved || start.id !== event.pointerId || !this.canWalk() || Math.hypot(start.x-event.clientX,start.y-event.clientY)>8) return;
      const rect=canvas.getBoundingClientRect();
      this.pointer.set((event.clientX-rect.left)/rect.width*2-1, -(event.clientY-rect.top)/rect.height*2+1);
      this.raycaster.setFromCamera(this.pointer,application.camera.instance);
      const hit=this.raycaster.intersectObject(this.root,true).find(item=>{
        let object: THREE.Object3D | null=item.object;
        while(object){if(!object.visible)return false;object=object.parent;}return true;
      });
      let object: THREE.Object3D | null=hit?.object||null;
      while(object){if(object.userData.exhibitId){if(object.userData.exhibitId===this.nearby)this.open();break;}object=object.parent;}
    };
    const move = (event: PointerEvent) => {
      if (this.pointerDown?.id === event.pointerId && Math.hypot(event.clientX-this.pointerDown.x,event.clientY-this.pointerDown.y)>8) this.pointerDown.moved=true;
    };
    window.addEventListener('pointermove', move);
    const lostCapture = () => { this.pointerDown = null; };
    canvas.addEventListener('lostpointercapture', lostCapture);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', this.stop);
    this.off.push(()=>{window.removeEventListener('pointermove',move);canvas.removeEventListener('lostpointercapture',lostCapture);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',this.stop);});
    this.off.push(EventBus.on('courtyard-input', ({ source, direction }: { source: string; direction: WalkDirection | null }) => {
      if (direction === null) { this.walk.setInput(source,null); return; }
      if (!this.canWalk() || !['up','down','left','right'].includes(direction)) return;
      this.walk.setInput(source,direction);
    }));
    this.off.push(EventBus.on('courtyard-visit', ({ id }: { id: string }) => {
      if (this.canWalk() && this.anchors.has(id)) { this.walk.place(id); this.application.camera.setCourtyardHeading(this.walk.heading); this.sync(true); }
    }));
    this.off.push(EventBus.on('courtyard-room', ({ room }: { room: unknown }) => {
      if (this.canWalk() && isRoomId(room)) { this.walk.placeRoom(room); this.application.camera.setCourtyardHeading(this.walk.heading); this.nearby=null;this.sync(true); }
    }));
    this.off.push(EventBus.on('open-exhibit',()=>this.open()));
    this.off.push(EventBus.on('close-exhibit',()=>this.close()));
    this.off.push(EventBus.on('exhibit-step',({offset}:{offset:number})=>{
      if(!this.reading || application.camera.transitioning || (offset!==1&&offset!==-1))return;
      const current=COURTYARD.stations.find(station=>station.id===this.reading)!;
      const records=COURTYARD.stations.filter(station=>station.room===current.room);
      const next=records[records.findIndex(station=>station.id===current.id)+offset];
      if(next){this.walk.place(next.id);this.application.camera.setCourtyardHeading(this.walk.heading);this.showRecord(next.id);}
    }));
    this.off.push(EventBus.on('world-request-state',()=>this.publish()));
  }
  private addCover(station: typeof COURTYARD.stations[number], anchor: THREE.Object3D) {
    const record = EXHIBITIONS.find(item => item.id === station.exhibitionId)!.entries[station.entryIndex];
    const canvas = document.createElement('canvas');
    const resolution = record.qrCodeUrl ? 2 : 1;
    canvas.width = 520 * resolution; canvas.height = 340 * resolution;
    const context = canvas.getContext('2d');
    if (!context) return;
    this.paintCover(canvas, station, false);
    const texture = new THREE.CanvasTexture(canvas); texture.encoding = THREE.sRGBEncoding;
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(COURTYARD.reader.width, COURTYARD.reader.height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    cover.name = `Cover_${station.id}`; cover.userData.exhibitId = station.id; cover.userData.coverStation = station;
    anchor.updateWorldMatrix(true, false);
    anchor.getWorldPosition(cover.position); anchor.getWorldQuaternion(cover.quaternion);
    cover.translateZ(-.008); this.root.add(cover); this.covers.push(cover);
    if (record.qrCodeUrl) {
      const qrImage = new Image();
      cover.userData.qrImage = qrImage;
      qrImage.onload = () => {
        this.paintCover(canvas, station, this.coverNight, qrImage);
        texture.needsUpdate = true;
      };
      this.off.push(() => { qrImage.onload = null; });
      qrImage.src = record.qrCodeUrl;
    }
  }
  private paintCover(canvas: HTMLCanvasElement, station: typeof COURTYARD.stations[number], night: boolean, qrImage?: HTMLImageElement) {
    const context=canvas.getContext('2d');if(!context)return;
    context.setTransform(canvas.width / 520, 0, 0, canvas.height / 340, 0, 0);
    const exhibition=EXHIBITIONS.find(item=>item.id===station.exhibitionId)!;
    const record=exhibition.entries[station.entryIndex];
    context.fillStyle = night ? '#0E1011' : '#F2E6CE'; context.fillRect(0, 0, 520, 340);
    if(record.kind==='guestbook'){
      context.fillStyle=night?'#D8D4CA':'#5C422D';context.font='600 44px "Pretendard Variable", sans-serif';
      context.fillText('Guestbook',32,112);return;
    }
    if(record.kind==='coffee' && qrImage?.complete && qrImage.naturalWidth){
      context.fillStyle=night?'#D8D4CA':'#5C422D';context.font='600 30px "Pretendard Variable", sans-serif';
      context.fillText(record.title,32,64);
      context.fillStyle=night?'#C5C0B6':'#5C422D';context.font='600 20px "Pretendard Variable", sans-serif';
      context.fillText(record.actionLabel || 'Buy me a coffee',32,213);
      // Preserve the supplied QR's colors and a white quiet zone in both lighting modes.
      context.fillStyle='#FFFFFF';context.fillRect(272,92,224,224);
      context.drawImage(qrImage,292,112,184,184);
      return;
    }
    if(record.kind==='coffee'){
      context.fillStyle=night?'#D8D4CA':'#5C422D';context.font='600 32px "Pretendard Variable", sans-serif';
      const bottom=coverLines(context,record.title,88,40,2);
      context.fillStyle=night?'#A7A399':'#725B43';context.font='22px "Pretendard Variable", sans-serif';
      coverLines(context,record.text,bottom+55,32,3);
      context.fillStyle=night?'#C5C0B6':'#5C422D';context.font='600 20px "Pretendard Variable", sans-serif';
      context.fillText(record.actionUrl?record.actionLabel||'Open':'Link coming soon',32,294);return;
    }
    context.fillStyle = night ? '#D8D4CA' : '#5C422D'; context.font = '600 30px "Pretendard Variable", sans-serif';
    const bottom=coverLines(context,record.title,84,40,3);
    context.fillStyle = night ? '#A7A399' : '#725B43';
    if(station.room==='piano'){
      context.font = '22px "Pretendard Variable", sans-serif';
      coverLines(context,record.text,bottom+52,32,3);
    }else{
      context.font = '16px "Pretendard Variable", sans-serif';
      context.fillText(record.date, 32, 284, 456);
    }
  }
  enter(id?: string, room: RoomId = 'developer') {
    this.active=true;this.reading=null;this.closingRecord=null;this.nearby=null;
    const station=COURTYARD.stations.find(station=>station.id===id || station.exhibitionId===id);
    this.walk.placeRoom(station?.room as RoomId || room);
    this.application.camera.setCourtyardHeading(this.walk.heading);
    this.guide.setWalking(true);this.guide.root.visible=false;this.meadow.setOutdoor(true);this.sync(true);
  }
  leave() {
    this.active=false;this.stop();this.nearby=null;this.reading=null;this.closingRecord=null;
    this.halos.forEach(halo=>{halo.visible=false;});this.screen.hide();
    this.guide.setWalking(false);this.meadow.setOutdoor(false);this.publish();
  }
  open() {
    if(!this.canWalk() || !this.nearby)return;
    const station=COURTYARD.stations.find(station=>station.id===this.nearby)!;
    const entry=EXHIBITIONS.find(exhibition=>exhibition.id===station.exhibitionId)!.entries[station.entryIndex];
    if(entry.kind==='coffee'&&entry.actionUrl){
      this.stop();window.open(entry.actionUrl,'_blank','noopener,noreferrer');return;
    }
    this.showRecord(this.nearby);
  }
  private showRecord(id: string) {
    const anchor=this.anchors.get(id);if(!anchor)return;
    this.stop();this.closingRecord=null;this.reading=id;this.nearby=id;
    if(['piano','blog'].includes(COURTYARD.stations.find(station=>station.id===id)?.room || ''))this.visited.add(id);
    this.application.world.environment.followCourtyard(this.walk.x,this.walk.z);
    this.meadow.setReading(true);this.screen.show(anchor);this.screen.setInteractive(false);this.guide.setReading(true);
    this.actions.open(anchor);this.publish();
  }
  close() {
    if(!this.reading)return;
    this.meadow.setReading(true);this.stop();this.closingRecord=this.reading;this.reading=null;this.screen.setInteractive(false);
    this.guide.setWalking(true);this.guide.root.visible=false;
    this.application.camera.followCourtyard(this.walk.x,this.walk.z,true);
    this.actions.close();this.sync(true);
  }
  keydown(event: KeyboardEvent) {
    const code = event.code || event.key;
    if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'Shift') {
      if (this.canWalk()) this.walk.setSprint(code, true);
      return true;
    }
    if (code === 'Space' || event.key === ' ') {
      // Keep Space activation/typing intact when a visitor focuses a UI control.
      if (event.target instanceof Element && event.target.closest('button,a,input,textarea,select,[contenteditable]')) return false;
      event.preventDefault();
      if (!event.repeat && this.canWalk()) this.walk.jump();
      return true;
    }
    if((event.code==='KeyE'||event.key==='Enter')&&!event.repeat) {
      if(event.target instanceof Element && event.target.closest('button,a,input,textarea,select,[contenteditable]'))return false;
      event.preventDefault();this.open();return true;
    }
    const direction=walkDirection(code);if(!direction)return false;
    event.preventDefault();
    if(this.canWalk()){
      this.walk.setInput(code,direction);
      // Movement returns control to the scene so the next Space press jumps.
      if(event.target instanceof HTMLElement && event.target.closest('button,a'))event.target.blur();
    }
    return true;
  }
  private canWalk() {return this.active&&!this.reading&&!this.application.camera.transitioning&&this.actions.canInteract();}
  update() {
    this.meadow.setNight(this.application.world.night);
    if(this.coverNight!==this.application.world.night){
      this.coverNight=this.application.world.night;
      this.covers.forEach(cover=>{const texture=cover.material.map;
        if(texture){this.paintCover(texture.image as HTMLCanvasElement,cover.userData.coverStation,this.coverNight,cover.userData.qrImage);texture.needsUpdate=true;}
      });
    }
    this.screen.update();
    if(!this.active)return;
    this.screen.setInteractive(!!this.reading&&!this.application.camera.transitioning);
    if(this.reading){if(!this.application.camera.transitioning)this.meadow.setReading(false);return;}
    if(!this.application.camera.transitioning){this.screen.hide();this.meadow.setReading(false);if(this.closingRecord){this.closingRecord=null;this.publish();}}
    const moving=!this.application.camera.transitioning&&this.walk.update(this.application.time.delta,this.application.camera.getCourtyardYaw());
    this.guide.walkTo(this.walk.x,this.walk.z,this.walk.heading,moving);
    this.guide.root.visible=false;
    this.application.camera.followCourtyard(this.walk.x,this.walk.z,false,this.walk.y);
    this.meadow.update(this.walk.x,this.walk.z);
    this.application.world.environment.followCourtyard(this.walk.x,this.walk.z);this.sync();
  }
  private sync(force=false) {
    const nearby=this.walk.nearest(this.nearby),changed=nearby!==this.nearby;
    this.nearby=nearby;
    this.halos.forEach((halo,id)=>{halo.visible=id===nearby&&!this.reading;});
    if(force){this.guide.walkTo(this.walk.x,this.walk.z,this.walk.heading,false);this.application.camera.followCourtyard(this.walk.x,this.walk.z,true,this.walk.y);this.meadow.update(this.walk.x,this.walk.z);}
    if(changed||force||performance.now()-this.lastPublish>100)this.publish();
  }
  private publish() {
    this.lastPublish=performance.now();
    EventBus.dispatch('courtyard-state',{active:this.active,nearby:this.nearby,visited:[...this.visited],x:this.walk.x,z:this.walk.z,room:this.walk.getRoom(),reading:this.reading||this.closingRecord} as CourtyardState);
  }
  dispose() {
    this.stop();this.off.forEach(off=>off());this.screen.dispose();this.meadow.dispose();
    this.covers.forEach(cover=>{cover.material.map?.dispose();cover.material.dispose();cover.geometry.dispose();cover.removeFromParent();});
    window.removeEventListener('keyup',this.onKeyUp);window.removeEventListener('blur',this.stop);window.removeEventListener('resize',this.stop);document.removeEventListener('visibilitychange',this.onVisibility);
    this.halos.forEach(halo=>{halo.geometry.dispose();(halo.material as THREE.Material).dispose();halo.removeFromParent();});
  }
}
