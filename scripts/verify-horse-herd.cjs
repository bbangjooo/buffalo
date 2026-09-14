/* Real GLBs + the real controller: route clearance, independent rigs and rhythm return. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const courtyard = require('../src/design/courtyard-layout.json');
const village = require('../src/design/medieval-village-layout.json');
const landscape = require('../src/design/atlas-landscape.json');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const near = (a, b, label = '', tolerance = 1e-7) => assert(Math.abs(a - b) <= tolerance, `${label}: ${a} != ${b}`);
function load(file, resolve, globals = {}) {
  const code = ts.transpileModule(read(file), { compilerOptions: {
    target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const scope = { exports: {}, require: resolve, ...globals };
  vm.runInNewContext(code, scope, { filename: file });
  return scope.exports;
}
let passed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { process.exitCode = 1; console.error(`FAIL ${name}: ${error.stack}`); }
}
function poseState(root) {
  const result = [];
  root.traverse(object => result.push([object.name, ...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()]));
  return JSON.stringify(result);
}

(async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  const assets = await Promise.all(['horses-ink', 'horses-low-poly'].map(async name => {
    const bytes = fs.readFileSync(path.join(ROOT, 'public/Room', `${name}.glb`));
    return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  }));
  const penInk = load('src/Application/World/PenInk.ts', name => { assert.equal(name, 'three'); return THREE; });
  function harness(reduced = false) {
    const motion = { matches: reduced };
    const mod = load('src/Application/World/HorseHerd.ts', name => {
      if (name === 'three') return THREE;
      if (name.endsWith('/courtyard-layout.json')) return courtyard;
      if (name === './PenInk') return penInk;
      throw new Error(`Unexpected dependency: ${name}`);
    }, { window: { matchMedia: () => motion } });
    const scene = new THREE.Scene();
    const application = { scene, resources: { items: { inkHorsesModel: assets[0], classicHorsesModel: assets[1] } },
      renderer: { instance: { shadowMap: { needsUpdate: false } } } };
    return { herd: new mod.default(application), scene, motion, routes: mod.HORSE_ROUTES };
  }

  check('both authored GLBs contain 3 compact articulated horses, with feet on the ground', () => {
    for (const asset of assets) for (const variant of ['HorseChestnut', 'HorseCream', 'HorseCharcoal']) {
      const model = asset.scene.getObjectByName(variant); assert(model, variant);
      const bounds = new THREE.Box3().setFromObject(model);
      near(bounds.min.y, 0, `${variant} hooves`, .025);
      assert(bounds.max.y > 1.7 && bounds.max.y < 2.4, `${variant} height ${bounds.max.y}`);
      let meshes = 0, radius = 0;
      model.updateWorldMatrix(true, true);
      model.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        const attribute = object.geometry.getAttribute('position'), point = new THREE.Vector3();
        for (let i = 0; i < attribute.count; i++) {
          point.fromBufferAttribute(attribute, i).applyMatrix4(object.matrixWorld);
          radius = Math.max(radius, Math.hypot(point.x, point.z));
        }
      });
      assert(meshes <= 19, `${variant} excessive draw calls: ${meshes}`);
      assert(radius <= 1.7, `${variant} exceeds the checked route envelope: ${radius}`);
      const names = []; model.traverse(object => names.push(object.name));
      for (const part of ['HeadPivot', 'TailPivot', 'LegFL', 'LegFR', 'LegBL', 'LegBR']) assert(names.some(name => name.includes(part)), part);
      for (const leg of ['LegFL', 'LegFR', 'LegBL', 'LegBR']) {
        assert(names.some(name => name.endsWith(`${leg}_${leg.includes('F') ? 'Knee' : 'Hock'}Pivot`)), `${leg} knee/hock`);
        assert(names.some(name => name.endsWith(`${leg}_HoofPivot`)), `${leg} hoof`);
      }
    }
  });

  check('ten minutes: eight horses, two per room, walk and graze clear of scenery and each other', () => {
    const { herd, routes } = harness(), counts = routes.map(() => ({ walk: 0, rest: 0, graze: 0 }));
    const obstacles = [...courtyard.obstacles, ...village.obstacles,
      ...courtyard.stations.map(station => ({ ...station, radius: 2 })),
      ...landscape.placements.filter(item => ['tree', 'shrub', 'rock'].includes(item.kind)).map(item => ({ ...item, radius: landscape.templates[item.kind].radius * item.scale }))];
    let previous = herd.state.horses;
    assert.equal(previous.length, 8);
    for (const room of ['developer', 'piano', 'blog', 'ai']) {
      const pair = previous.filter(horse => horse.room === room);
      assert.equal(pair.length, 2, `${room} must have two horses`);
      assert.equal(new Set(pair.map(horse => horse.region)).size, 2, 'each quadrant needs courtyard and meadow horses');
    }
    for (let frame = 0; frame < 6000; frame++) {
      herd.update(100);
      const horses = herd.state.horses;
      horses.forEach((horse, i) => {
        const radius = 1.7 * routes[i].scale;
        assert.equal(horse.room, horse.x > 0 ? horse.z > 0 ? 'developer' : 'piano' : horse.z > 0 ? 'ai' : 'blog');
        assert(Math.hypot(horse.x, horse.z) < 23, 'horses remain in the courtyard and middle meadows');
        assert(Math.abs(horse.x) - radius > courtyard.houseHalfSize || Math.abs(horse.z) - radius > courtyard.houseHalfSize, horse.id + ' house collision');
        for (const obstacle of obstacles) assert(Math.hypot(horse.x - obstacle.x, horse.z - obstacle.z) >= obstacle.radius + radius, `${horse.id} collision at ${obstacle.id || JSON.stringify(obstacle)}`);
        for (const quadrant of courtyard.quadrants) assert(Math.hypot(horse.x - quadrant.spawn[0], horse.z - quadrant.spawn[1]) >= 2.6, `${horse.id} obstructs the ${quadrant.room} arrival`);
        for (let j = i + 1; j < horses.length; j++) assert(Math.hypot(horse.x - horses[j].x, horse.z - horses[j].z) > radius + 1.7 * routes[j].scale, 'horses overlap');
        assert(Math.hypot(horse.x - previous[i].x, horse.z - previous[i].z) <= routes[i].speed * .1 + 1e-6, 'unbounded speed');
        assert(Math.abs(Math.atan2(Math.sin(horse.heading - previous[i].heading), Math.cos(horse.heading - previous[i].heading))) <= .21 + 1e-6, 'unbounded turn');
        counts[i][horse.moving ? 'walk' : 'rest']++;
        if (horse.grazing) counts[i].graze++;
      });
      previous = horses;
    }
    counts.forEach(count => { assert(count.walk > 500); assert(count.rest > 300); assert(count.graze > 500); });
    assert(new Set(counts.map(count => count.walk)).size > 3, 'schedules must remain independent');
  });

  check('visitor personal space, pause hysteresis and camera pauses preserve route state', () => {
    const { herd } = harness();
    for (let i = 0; i < 30; i++) herd.update(100);
    const before = herd.state.horses[0];
    for (let i = 0; i < 40; i++) herd.update(100, { x: before.x, z: before.z });
    near(herd.state.horses[0].x, before.x); near(herd.state.horses[0].z, before.z);
    assert(herd.state.horses[0].visitorPaused);
    herd.update(100, { x: before.x + 2.75, z: before.z });
    assert(herd.state.horses[0].visitorPaused);
    herd.update(100, { x: before.x + 3.2, z: before.z });
    assert(!herd.state.horses[0].visitorPaused);
    const paused = poseState(herd.root);
    for (let i = 0; i < 20; i++) herd.update(100, undefined, true);
    assert.equal(poseState(herd.root), paused);
  });

  function capturePose(horse, label) {
    const rig = horse.rigs.ink, jointQuaternions = {}, jointPositions = {};
    rig.model.traverse(object => {
      if (object instanceof THREE.Mesh) return;
      const key = object.name.replace(/^(ink|low_poly)_(Chestnut|Cream|Charcoal)_/, '');
      jointQuaternions[key] = object.quaternion.toArray(); jointPositions[key] = object.position.toArray();
    });
    return { phase: horse.phase % 1, label, activity: horse.activity,
      bodyY: (horse.root.position.y - courtyard.groundY) / horse.scale, jointQuaternions, jointPositions,
      muzzleY: rig.muzzle.getWorldPosition(new THREE.Vector3()).y - courtyard.groundY };
  }

  check('reference walk has tall fore support, distinct recovery, stable contacts and a level barrel', () => {
    const { herd, scene } = harness(), previous = new Map(), snapshots = [];
    const stats = { stanceSamples: 0, worstSlip: 0, minContacts: 4, maxForeSupportBend: 0,
      maxForeRecoveryBend: 0, highestSole: 0, deepestSole: 0, bodyMotion: 0, turnFrames: 0 };
    let captureStart;
    for (let frame = 0; frame < 3600; frame++) {
      herd.update(1000 / 60); scene.updateMatrixWorld(true);
      herd.horses.forEach(horse => {
        stats.bodyMotion = Math.max(stats.bodyMotion, Math.abs(courtyard.groundY - horse.root.position.y) / horse.scale);
        let contacts = 0;
        if (horse.activity === 'turn') stats.turnFrames++;
        horse.rigs.ink.legs.forEach((leg, index) => {
          const foot = horse.feet[index], key = horse.id + '-' + index;
          const point = leg.hoof.object.getWorldPosition(new THREE.Vector3());
          const sole = new THREE.Box3().setFromObject(leg.hoof.object).min.y - courtyard.groundY;
          if (sole <= .012 * horse.scale) contacts++;
          stats.deepestSole = Math.min(stats.deepestSole, sole);
          stats.highestSole = Math.max(stats.highestSole, sole / horse.scale);
          const prior = previous.get(key);
          if (horse.moving && prior?.moving && foot.mode === 'stance' && prior.mode === 'stance') {
            stats.worstSlip = Math.max(stats.worstSlip, Math.hypot(point.x - prior.point.x, point.z - prior.point.z)); stats.stanceSamples++;
          }
          if (leg.fore && horse.moving) {
            const elbow = leg.middle.object.getWorldPosition(new THREE.Vector3());
            const knee = leg.distal.object.getWorldPosition(new THREE.Vector3());
            const angle = knee.clone().sub(elbow).angleTo(point.clone().sub(knee)) * 180 / Math.PI;
            if (foot.mode === 'stance') stats.maxForeSupportBend = Math.max(stats.maxForeSupportBend, angle);
            else stats.maxForeRecoveryBend = Math.max(stats.maxForeRecoveryBend, angle);
          }
          previous.set(key, { point, mode: foot.mode, moving: horse.moving });
        });
        if (contacts < stats.minContacts) { stats.minContacts = contacts; stats.leastSupport = { frame, horse: horse.id, activity: horse.activity, phase: horse.phase % 1 }; }
        if (process.env.HORSE_GAIT_POSES && horse.id === 'Maple' && horse.moving && frame >= 180) {
          if (captureStart === undefined && horse.phase % 1 < .03) captureStart = Math.floor(horse.phase);
          if (captureStart !== undefined && snapshots.length < 16 && horse.phase >= captureStart + snapshots.length / 16)
            snapshots.push(capturePose(horse, 'Walk ' + (snapshots.length + 1)));
        }
      });
    }
    console.log('Reference gait measurements:', JSON.stringify(stats));
    if (process.env.HORSE_GAIT_POSES) fs.writeFileSync(process.env.HORSE_GAIT_POSES, JSON.stringify(snapshots, null, 2));
    assert(stats.stanceSamples > 10000 && stats.turnFrames > 100, 'sample repeated straight walks, stops, and endpoint turns');
    assert(stats.minContacts >= 2, 'a walk/settle/turn must retain two ground contacts');
    assert(stats.maxForeSupportBend < 10, 'the supporting fore radius/cannon must form a near-straight line');
    assert(stats.maxForeRecoveryBend > 50, 'the carpus must visibly fold during recovery');
    assert(stats.bodyMotion < .01, 'the horse must retain normal barrel height');
    assert(stats.deepestSole > -.004, 'hooves must remain clear of the soil');
    assert(stats.highestSole > .16 && stats.highestSole < .38, 'recovery must have a visible, unconstrained arc');
    assert(stats.worstSlip < .003, 'established stance should remain planted');
  });

  check('grazing settles, reaches grass, chews for several seconds, then raises before walking', () => {
    const { herd, scene } = harness(), horse = herd.horses[0], snapshots = [], activities = [], heights = [], jaws = [];
    herd.startGrazing(horse);
    const location = { ...horse.position };
    for (let frame = 0; frame < 720; frame++) {
      herd.update(1000 / 60); scene.updateMatrixWorld(true);
      if (activities.at(-1) !== horse.activity) activities.push(horse.activity);
      const rig = horse.rigs.ink;
      if (frame % 40 === 0 && snapshots.length < 18) snapshots.push(capturePose(horse, 'Graze ' + (snapshots.length + 1)));
      if (['lower', 'graze', 'raise'].includes(horse.activity)) {
        near(horse.position.x, location.x); near(horse.position.z, location.z);
        assert(!horse.moving, 'head lowering/chewing/raising happens after the walk stops');
        assert(new THREE.Box3().setFromObject(rig.head.object).min.y >= courtyard.groundY - .002, 'head/jaw must not enter the ground');
      }
      if (horse.activity === 'graze') { heights.push(rig.muzzle.getWorldPosition(new THREE.Vector3()).y - courtyard.groundY); jaws.push(rig.jaw.object.rotation.x); }
      if (horse.moving) near(horse.grazing, 0, 'head must fully rise before travel resumes');
    }
    console.log('Grazing measurements:', JSON.stringify({ activities, feedingSeconds: heights.length / 60,
      muzzleMin: Math.min(...heights), muzzleMax: Math.max(...heights), jawRange: Math.max(...jaws) - Math.min(...jaws) }));
    if (process.env.HORSE_GRAZE_POSES) fs.writeFileSync(process.env.HORSE_GRAZE_POSES, JSON.stringify(snapshots, null, 2));
    assert.deepEqual(Array.from(activities.slice(0, 5)), ['settle', 'lower', 'graze', 'raise', 'walk']);
    assert(heights.length / 60 >= 4 && heights.length / 60 <= 7);
    assert(Math.max(...heights) <= .12 && Math.min(...heights) >= .02, 'the muzzle reaches the actual grass height');
    assert(Math.max(...jaws) - Math.min(...jaws) > .08, 'feeding must include visible jaw movement');
  });

  check('reduced motion freezes routes and joints, including a live preference change', () => {
    const { herd, motion } = harness(true), initial = poseState(herd.root);
    for (let i = 0; i < 100; i++) herd.update(100);
    assert.equal(poseState(herd.root), initial);
    motion.matches = false;
    for (let i = 0; i < 50; i++) herd.update(100);
    assert.notEqual(poseState(herd.root), initial);
    motion.matches = true; herd.update(100);
    const stopped = poseState(herd.root);
    for (let i = 0; i < 50; i++) herd.update(100);
    assert.equal(poseState(herd.root), stopped);
  });

  check('yielding then restarting mid-recovery never snaps a raised hoof to the ground', () => {
    const { herd, scene } = harness(), horse = herd.horses[0];
    let leg;
    for (let frame = 0; frame < 300 && !leg; frame++) {
      herd.update(1000 / 60); scene.updateMatrixWorld(true);
      leg = horse.rigs.ink.legs.find((item, index) => horse.feet[index].mode === 'swing' &&
        item.hoof.object.getWorldPosition(new THREE.Vector3()).y - courtyard.groundY - item.restFoot.y * horse.scale > .065);
    }
    assert(leg, 'fixture reaches a naturally lifted hoof');
    herd.update(1000 / 60, { ...horse.position }); scene.updateMatrixWorld(true);
    const yielding = leg.hoof.object.getWorldPosition(new THREE.Vector3());
    herd.update(1000 / 60); scene.updateMatrixWorld(true);
    const resumed = leg.hoof.object.getWorldPosition(new THREE.Vector3());
    assert(Math.abs(resumed.y - yielding.y) < .015, 'restarting must preserve the raised hoof height');
    assert(resumed.y - courtyard.groundY - leg.restFoot.y * horse.scale > .035, 'the hoof must finish its recovery above ground');
    for (let frame = 0; frame < 90; frame++) {
      herd.update(1000 / 60); scene.updateMatrixWorld(true);
      const contacts = horse.rigs.ink.legs.filter(item => new THREE.Box3().setFromObject(item.hoof.object).min.y <= courtyard.groundY + .012 * horse.scale).length;
      assert(contacts >= 2, 'yield/restart must retain the walk contact pattern');
    }
  });

  check('theme swaps preserve positions and every joint, without duplicating scene objects', () => {
    const { herd } = harness(); for (let i = 0; i < 30; i++) herd.update(100);
    const original = poseState(herd.root);
    for (let i = 0; i < 30; i++) {
      const theme = i % 2 ? 'ink' : 'classic'; herd.setArtTheme(theme);
      assert.equal(herd.state.theme, theme); assert.equal(poseState(herd.root), original);
      assert.equal(herd.root.children.length, 8);
      herd.root.children.forEach(horse => { assert.equal(horse.children.length, 2); assert.equal(horse.children.filter(model => model.visible).length, 1); });
    }
  });

  check('rhythm uses one horse, retains articulated steps, and restores all saved outdoor routes', () => {
    const { herd, scene } = harness(); for (let i = 0; i < 40; i++) herd.update(100);
    const saved = herd.state.horses.map(horse => ({ ...horse }));
    const anchor = new THREE.Object3D(); anchor.position.set(-2, .2, 3); anchor.rotation.y = .9; scene.add(anchor);
    herd.setDancing(anchor); herd.setDanceBeat(1, true, 162); herd.danceStep(0); herd.update(50);
    assert(herd.state.dancing); assert.equal(herd.state.horses.filter(horse => horse.visible).length, 1);
    near(herd.state.horses[0].x, -2); near(herd.state.horses[0].z, 3);
    near(herd.state.horses[0].scale, .56);
    const articulated = []; herd.root.children[0].traverse(object => { if (object.name.includes('LegFL') && !object.name.endsWith('_Mesh')) articulated.push(object.rotation.x); });
    assert(articulated.some(angle => Math.abs(angle) > .05));
    herd.setDancing(null);
    herd.state.horses.forEach((horse, i) => {
      near(horse.x, saved[i].x); near(horse.z, saved[i].z); near(horse.heading, saved[i].heading); near(horse.scale, saved[i].scale); assert(horse.visible);
    });
    herd.dispose(); assert(!scene.getObjectByName('CourtyardHorseHerd')); assert.doesNotThrow(() => herd.dispose());
  });

  check('source registry and live World never request or instantiate the hamster', () => {
    const source = read('src/Application/sources.ts'), world = read('src/Application/World/World.ts');
    assert(source.includes('/Room/horses-ink.glb') && source.includes('/Room/horses-low-poly.glb'));
    assert(!source.includes('guideCharacterModel') && !source.includes('character-guide-smooth'));
    assert(!world.includes('hamster') && !world.includes('HamsterRoam'));
    assert(world.includes('this.guide = new GuideRobot(this.application, this.room.robot)'));
  });
  if (!process.exitCode) console.log(`Horse herd: ${passed} checks passed against both authored GLBs.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
