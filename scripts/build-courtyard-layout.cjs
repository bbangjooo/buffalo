/* Personal meadows: coffee, music, travel/reflections and guestbook. */
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function readModule(file){
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2016,esModuleInterop:true}}).outputText;
 const sandbox={exports:{},require:n=>n==='./courtyard-layout.json'?{}:n==='./profile'?readModule(path.join(path.dirname(file),'profile.ts')):require(path.join(path.dirname(file),n))};
 vm.runInNewContext(code,sandbox);return sandbox.exports;
}
const exhibitions=readModule(root+'/src/design/history.ts').EXHIBITIONS;
const quadrants=[
 {room:'developer',name:'Coffee',label:'Coffee',angle:0,color:'teal',spawn:[7,7],heading:Math.PI/4},
 {room:'piano',name:'Piano pieces',label:'Piano',angle:Math.PI/2,color:'brass',spawn:[7,-7]},
 {room:'blog',name:'Blog',label:'Blog',angle:Math.PI,color:'slate',spawn:[-7,-7]},
 {room:'ai',name:'Guestbook',label:'Play',angle:Math.PI*1.5,color:'sage',spawn:[-7,7]},
];
const roomFor={coffee:'developer',piano:'piano',writing:'blog',guestbook:'ai'};
const places={coffee:[[11,11]],piano:[[10,11],[14.8,17.2],[9.2,23.8],[18.2,28.4],[25.6,23.9]],writing:[[9.5,11],[15,16],[8.5,21],[23.5,10.5],[29.2,18],[23.5,25.5]],guestbook:[[10.5,12.5]]};
const round=n=>+n.toFixed(4);
const rotate=(a,b,q)=>[round(a*Math.cos(q.angle)+b*Math.sin(q.angle)),round(b*Math.cos(q.angle)-a*Math.sin(q.angle))];
const stations=[],yearMarkers=[],counts={developer:0,piano:0,blog:0,ai:0};
for(const exhibition of exhibitions){
 const room=roomFor[exhibition.id],q=quadrants.find(q=>q.room===room),points=places[exhibition.id];
 if(!q||!points||points.length!==exhibition.entries.length)throw new Error('Placement does not match '+exhibition.id);
 let previous=q.spawn;
 for(let entryIndex=0;entryIndex<exhibition.entries.length;entryIndex++){
  const entry=exhibition.entries[entryIndex],[a,b]=points[entryIndex],[x,z]=rotate(a,b,q);
  const yaw=round(Math.atan2(previous[0]-x,previous[1]-z));
  const label=entry.kind==='coffee'?'Coffee':entry.kind==='guestbook'?'Guestbook':q.label;
  const station={id:exhibition.id+'--'+entry.id,exhibitionId:exhibition.id,entryIndex,room,x,z,yaw,color:q.color,label,shape:entry.objectKind||'book',order:++counts[room]};
  if(entry.year)station.year=entry.year;
  stations.push(station);previous=[x,z];
 }
}
for(const [year,a,b] of [['2023',7,10],['2025',21,9]]){const q=quadrants.find(q=>q.room==='blog'),[x,z]=rotate(a,b,q);yearMarkers.push({year,room:'blog',x,z,yaw:round(q.angle+Math.PI/4)});}
for(let i=0;i<stations.length;i++)for(let j=i+1;j<stations.length;j++)if(Math.hypot(stations[i].x-stations[j].x,stations[i].z-stations[j].z)<5.5)throw new Error('Panels too close');
const obstacles=yearMarkers.map(m=>({x:m.x,z:m.z,radius:.6}));
fs.writeFileSync(root+'/src/design/courtyard-layout.json',JSON.stringify({groundY:-.16,houseHalfSize:5.6,reader:{width:2.6,height:1.7,y:2.1},entrance:[7,7],quadrants,stations,yearMarkers,obstacles},null,2)+'\n');
console.log('Personal meadow panels:',stations.length);
