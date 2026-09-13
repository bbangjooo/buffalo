/* Native recording transport: deterministic media events, no browser/device dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const fixture = { title: 'Recording fixture', duration: 2, notes: [
  { time: 0, duration: .5, midi: 60, velocity: .75 },
  { time: 0, duration: .2, midi: 64, velocity: .7 },
  { time: .1, duration: .1, midi: 48, velocity: .5 },
  { time: .3, duration: .5, midi: 60, velocity: .7, soundDuration: 1 },
  { time: 1.5, duration: .2, midi: 72, velocity: .6 },
] };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const flush = async () => { for(let i=0;i<24;i++) await Promise.resolve(); };
function createHarness(options={}) {
  const states=[], keyChanges=[], repeated=[], events=[], subscriptions=new Map(), visibility=new Set();
  const mediaListeners=new Map();
  const pending=[];
  const media={ src:'', dataset:{}, paused:true, ended:false, readyState:0, duration:2.1, currentTime:0, muted:false, error:null,
    playCalls:0, loadCalls:0, removed:false, ranges:[],
    buffered:{ get length(){return media.ranges.length;}, start(i){return media.ranges[i][0];}, end(i){return media.ranges[i][1];} },
    setAttribute(){}, removeAttribute(key){if(key==='src')this.src='';}, remove(){this.removed=true;},
    addEventListener(type,fn){if(!mediaListeners.has(type))mediaListeners.set(type,new Set());mediaListeners.get(type).add(fn);},
    removeEventListener(type,fn){mediaListeners.get(type)?.delete(fn);},
    emit(type){for(const fn of mediaListeners.get(type)||[])fn();},
    load(){this.loadCalls++;this.error=null;this.readyState=0;},
    play(){this.playCalls++;this.paused=false;
      if(options.pendingPlay){const d=deferred();pending.push(d);return d.promise;}
      if(options.rejectPlay)return Promise.reject(new Error('Blocked'));
      this.readyState=3;this.emit('playing');return Promise.resolve();},
    pause(){const was=this.paused;this.paused=true;if(!was)this.emit('pause');},
  };
  const audio={muted:false, canceled:0, stopInteractiveNotes(){this.canceled++;},
    unlock(){throw Error('A recording must not unlock the sample instrument');},
    scheduleNote(){throw Error('A recording must not schedule sample voices');},
    preload(){throw Error('A recording must not load samples');},
  };
  const document={hidden:false,body:{appendChild(){}},createElement(type){assert.equal(type,'audio');return media;},
    addEventListener(type,fn){assert.equal(type,'visibilitychange');visibility.add(fn);},removeEventListener(type,fn){visibility.delete(fn);}};
  let fetches=0;
  const sandbox={exports:{}, AbortController, document,
    require(name){if(name.endsWith('piano-performance'))return {PIANO_PERFORMANCE:{title:fixture.title,scoreUrl:'/score.json',audioUrl:'/recording.mp3'}};
      if(name.endsWith('EventBus'))return {EventBus:{on(type,fn){if(!subscriptions.has(type))subscriptions.set(type,new Set());subscriptions.get(type).add(fn);return()=>subscriptions.get(type).delete(fn);},dispatch(type,state){events.push({type,state});}}};
      throw Error('Unexpected dependency '+name);},
    fetch:async(url,request)=>{assert.equal(url,'/score.json');fetches++;return options.fetch?options.fetch(request):{ok:true,json:async()=>fixture};},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/Application/World/PianoPerformance.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,sandbox);
  const performance=new sandbox.exports.default(audio,{onState:s=>states.push(s),onKeys:k=>keyChanges.push([...k]),onRepeatedAttack:k=>repeated.push([...k])});
  return {performance,media,audio,states,keyChanges,repeated,events,pending,visibility,mediaListeners,subscriptions,readScore:sandbox.exports.readScore,
    get fetches(){return fetches;},get keys(){return keyChanges.at(-1)||[];},
    seek(time){media.currentTime=time;performance.update();},
    hide(){document.hidden=true;visibility.forEach(fn=>fn());},
    show(){document.hidden=false;visibility.forEach(fn=>fn());},
    event(type,data){subscriptions.get(type)?.forEach(fn=>fn(data));},
  };
}
async function main(){
 let failures=0;
 async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+': '+e.stack);}}
 await check('silent native preload and partial buffering readiness never require sample downloads',async()=>{
  const h=createHarness();await flush();assert.equal(h.media.src,'/recording.mp3');assert.equal(h.media.preload,'auto');assert.equal(h.media.playCalls,0);assert.equal(h.fetches,1);
  h.media.ranges=[[0,.3]];h.media.readyState=3;h.media.emit('canplay');
  assert.equal(h.events.at(-1).state.phase,'ready');assert.equal(h.events.at(-1).state.received,.3);
  await h.performance.play();assert.equal(h.performance.getSnapshot().status,'playing');assert.equal(h.audio.canceled,1);h.performance.dispose();
 });
 await check('score validation and original visible keyboard pitches remain intact',async()=>{
  const h=createHarness();await flush();assert.throws(()=>h.readScore({...fixture,duration:-1}));assert.throws(()=>h.readScore({...fixture,notes:[{...fixture.notes[0],midi:128}]}));
  await h.performance.play();h.seek(.15);assert.deepEqual(h.keys.sort(),[60,64]);assert(!h.keys.includes(48));h.seek(.25);assert.deepEqual(h.keys,[60]);h.performance.dispose();
 });
 await check('media time controls chords, repeated strikes, and buffering without wall-clock drift',async()=>{
  const h=createHarness();await flush();await h.performance.play();h.seek(.29);h.seek(.31);assert.equal(h.repeated.length,1);assert.deepEqual(h.repeated[0],[60]);
  h.media.emit('waiting');assert.equal(h.performance.getSnapshot().status,'buffering');for(let i=0;i<100;i++)h.performance.update();assert.equal(h.performance.getSnapshot().elapsed,.31);assert.equal(h.repeated.length,1);
  h.media.emit('playing');h.seek(.81);assert.deepEqual(h.keys,[],'pedal tail must not hold physical keys');h.performance.dispose();
 });
 await check('pause/resume preserves recording position and does not re-attack held notes',async()=>{
  const h=createHarness();await flush();await h.performance.play();h.seek(.4);h.performance.pause();assert.equal(h.performance.getSnapshot().status,'paused');assert(h.media.paused);assert.deepEqual(h.keys,[]);
  const repeated=h.repeated.length;await h.performance.play();assert.equal(h.media.currentTime,.4);assert.deepEqual(h.keys,[60]);assert.equal(h.repeated.length,repeated);h.performance.stop();assert.equal(h.media.currentTime,0);h.performance.dispose();
 });
 await check('stop and hidden tabs cancel a pending play and cannot cause a surprise restart',async()=>{
  for(const action of ['stop','pause','hide','dispose']){
   const h=createHarness({pendingPlay:true});await flush();const play=h.performance.play();assert.equal(h.media.playCalls,1);assert.equal(h.performance.getSnapshot().status,'buffering');
   action==='hide'?h.hide():h.performance[action]();h.pending[0].resolve();await play;assert(h.media.paused);assert.notEqual(h.performance.getSnapshot().status,'playing');h.show();assert(h.media.paused);h.performance.dispose();
  }
 });
 await check('stale play resolution cannot pause a newer play request',async()=>{
  const h=createHarness({pendingPlay:true});await flush();const old=h.performance.play();h.performance.pause();const latest=h.performance.play();h.pending[1].resolve();await latest;
  h.pending[0].resolve();await old;assert.equal(h.performance.getSnapshot().status,'playing');assert(!h.media.paused);h.performance.dispose();
 });
 await check('play rejection and media errors are retryable and report no false playing state',async()=>{
  const h=createHarness({rejectPlay:true});await flush();await h.performance.play();assert.equal(h.performance.getSnapshot().status,'error');assert(h.media.paused);h.performance.dispose();
  const good=createHarness();await flush();await good.performance.play();good.media.error={code:2};good.media.emit('error');assert.equal(good.performance.getSnapshot().status,'error');assert.equal(good.events.at(-1).state.phase,'error');
  good.event('piano-assets-retry',{id:'keys'});assert.equal(good.media.loadCalls,1);good.event('piano-assets-retry',{id:'performance'});assert.equal(good.media.loadCalls,2);await good.performance.play();assert.equal(good.performance.getSnapshot().status,'playing');good.performance.dispose();
 });
 await check('mute applies to the recording, and its reverb tail completes before replay resets time',async()=>{
  const h=createHarness();await flush();h.event('world-state',{muted:true});assert(h.media.muted);h.event('world-state',{muted:false});assert(!h.media.muted);
  await h.performance.play();h.seek(2.01);assert.equal(h.performance.getSnapshot().status,'playing');h.media.currentTime=2.1;h.media.ended=true;h.media.emit('ended');assert.equal(h.performance.getSnapshot().status,'finished');assert.deepEqual(h.keys,[]);
  h.media.ended=false;await h.performance.play();assert.equal(h.media.currentTime,0);h.performance.dispose();
 });
 await check('dispose releases the media source, listeners, and outstanding score fetch',async()=>{
  const gate=deferred();let signal;const h=createHarness({fetch:request=>{signal=request.signal;return gate.promise;}});h.performance.dispose();const count=h.states.length;
  assert(signal.aborted);assert(h.media.removed);assert.equal(h.media.src,'');assert.equal(h.visibility.size,0);assert([...h.mediaListeners.values()].every(s=>s.size===0));assert([...h.subscriptions.values()].every(s=>s.size===0));
  gate.resolve({ok:true,json:async()=>fixture});await flush();assert.equal(h.states.length,count);
 });
 await check('published recording matches its score, stereo provenance, and content-versioned checksum',async()=>{
  const crypto=require('node:crypto');
  const config=fs.readFileSync(path.join(root,'src/design/piano-performance.ts'),'utf8');
  const url=config.match(/audioUrl: '([^']+)'/)[1];
  const file=path.join(root,'public',url);const bytes=fs.readFileSync(file);
  const manifest=JSON.parse(fs.readFileSync(path.join(path.dirname(file),'manifest.json'),'utf8'));
  const scoreBytes=fs.readFileSync(path.join(root,'public/Piano/en-avril-a-paris.json'));
  const score=JSON.parse(scoreBytes);const sha=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha,manifest.sha256);assert(url.includes(sha.slice(0,12)));assert.equal(bytes.length,manifest.bytes);
  assert.equal(crypto.createHash('sha256').update(scoreBytes).digest('hex'),manifest.scoreSha256);
  assert.equal(manifest.notes,score.notes.length);assert.equal(manifest.channels,2);assert.equal(manifest.license,'CC-BY-3.0');
  assert(manifest.durationSeconds>=score.duration+.9&&manifest.durationSeconds<=score.duration+1.1);assert(manifest.peakPCM>0&&manifest.peakPCM<1);
 });
 if(failures)process.exitCode=1;else console.log('All pre-rendered piano transport checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
