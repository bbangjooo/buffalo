import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import palette from './design/jo-colors.json';
import './guide-preview.css';

const stage = document.getElementById('preview-stage')!;
const panels = Array.from(stage.querySelectorAll<HTMLElement>('[data-variant]'));
const viewButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-view]'));
const nightButton = document.getElementById('preview-night') as HTMLButtonElement;

function disposeMeshes(root: THREE.Object3D) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => material.dispose());
  });
}

function studio(panel: HTMLElement) {
  const scene = new THREE.Scene();
  const ambient = new THREE.HemisphereLight(0xffffff, palette.colors.slate, 1.25);
  const key = new THREE.DirectionalLight(0xffefdc, 3.2);
  key.position.set(-3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -3;
  key.shadow.camera.right = key.shadow.camera.top = 3;
  key.shadow.camera.near = .1;
  key.shadow.camera.far = 15;
  key.shadow.normalBias = .018;
  key.shadow.bias = -.0001;
  key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xdce9ed, 1.2);
  fill.position.set(4, 2, 1);
  const rim = new THREE.DirectionalLight(0xffffff, 1.6);
  rim.position.set(0, 3, -4);
  scene.add(ambient, key, fill, rim, key.target);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: palette.colors.paper, roughness: 1, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.006;
  floor.receiveShadow = true;
  scene.add(floor);
  return {
    panel, scene, ambient, key, fill, rim, floor, floorMaterial,
    viewport: panel.querySelector<HTMLElement>('.preview-viewport')!,
    status: panel.querySelector<HTMLElement>('.preview-status')!,
    bounds: new THREE.Box3(),
    ready: false,
    shadowsDirty: true,
  };
}

function preview() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', 'Synchronized Low-poly and Smooth character previews. Drag either model to orbit both; scroll or pinch to zoom. View buttons are below.');
  stage.prepend(renderer.domElement);

  const studios = panels.map(studio);
  // Separate scenes share one camera: no offset model can appear closer or larger.
  const camera = new THREE.PerspectiveCamera(34, 1, .01, 100);
  camera.position.set(2, 1.1, 2);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, .75, 0);
  controls.enablePan = false;
  // On-demand rendering stays still, including for reduced-motion preferences.
  controls.enableDamping = false;
  controls.autoRotate = false;
  controls.enabled = false;
  controls.rotateSpeed = .7;
  controls.zoomSpeed = .7;
  controls.minPolarAngle = .2;
  controls.maxPolarAngle = Math.PI / 2 + .05;
  controls.update();

  const bounds = new THREE.Box3();
  const target = new THREE.Vector3(0, .75, 0);
  const viewDirection = new THREE.Vector3(1, .25, 1).normalize();
  let disposed = false;
  let pending = studios.length;
  let viewportWidth = 1;
  let viewportHeight = 1;
  let viewports: { x: number; y: number }[] = [];

  function render() {
    if (disposed || viewports.length !== studios.length) return;
    renderer.setScissorTest(false);
    renderer.clear();
    renderer.setScissorTest(true);
    studios.forEach((item, index) => {
      const rectangle = viewports[index];
      renderer.setViewport(rectangle.x, rectangle.y, viewportWidth, viewportHeight);
      renderer.setScissor(rectangle.x, rectangle.y, viewportWidth, viewportHeight);
      // Each studio owns a different shadow map, even though rendering is shared.
      renderer.shadowMap.needsUpdate = item.shadowsDirty;
      renderer.render(item.scene, camera);
      item.shadowsDirty = false;
    });
    renderer.setScissorTest(false);
  }

  function fit() {
    if (bounds.isEmpty()) return;
    const right = new THREE.Vector3().crossVectors(camera.up, viewDirection).normalize();
    const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    let distance = 0;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(target);
          const depth = corner.dot(viewDirection);
          distance = Math.max(distance, depth + Math.abs(corner.dot(up)) / tanHalfFov,
            depth + Math.abs(corner.dot(right)) / (tanHalfFov * camera.aspect));
        }
      }
    }
    distance *= 1.16;
    camera.position.copy(target).addScaledVector(viewDirection, distance);
    controls.target.copy(target);
    controls.minDistance = Math.max(.35, bounds.getSize(new THREE.Vector3()).y * .55);
    controls.maxDistance = Math.max(8, distance * 3);
    controls.update();
    render();
  }

  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, width < 700 ? 1.5 : 2));
    renderer.setSize(width, height, false);
    const stageRectangle = stage.getBoundingClientRect();
    const rectangles = studios.map(item => item.viewport.getBoundingClientRect());
    // Identical pixel dimensions preserve scale, including odd CSS pixel splits.
    viewportWidth = Math.max(1, Math.floor(Math.min(...rectangles.map(rectangle => rectangle.width))));
    viewportHeight = Math.max(1, Math.floor(Math.min(...rectangles.map(rectangle => rectangle.height))));
    viewports = rectangles.map(rectangle => ({
      x: rectangle.left - stageRectangle.left + (rectangle.width - viewportWidth) / 2,
      y: height - (rectangle.top - stageRectangle.top) - (rectangle.height + viewportHeight) / 2,
    }));
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
    if (!bounds.isEmpty()) viewDirection.copy(camera.position).sub(controls.target).normalize();
    fit();
    render();
  }

  function lighting(night: boolean) {
    document.body.dataset.night = String(night);
    nightButton.setAttribute('aria-checked', String(night));
    const background = night ? '#172c31' : palette.colors.paper;
    renderer.setClearColor(background, 1);
    renderer.toneMappingExposure = night ? .88 : 1;
    studios.forEach(item => {
      item.scene.background = new THREE.Color(background);
      item.scene.fog = new THREE.Fog(background, 8, 22);
      item.floorMaterial.color.set(night ? '#243f42' : palette.colors.paper);
      item.ambient.intensity = night ? .75 : 1.25;
      item.key.intensity = night ? 2.2 : 3.2;
      item.fill.intensity = night ? .65 : 1.2;
      item.rim.intensity = night ? 1.1 : 1.6;
      item.shadowsDirty = true;
    });
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
    render();
  }

  function finishLoad(item: ReturnType<typeof studio>, error = false) {
    item.panel.dataset.state = error ? 'error' : 'ready';
    item.panel.setAttribute('aria-busy', 'false');
    if (error) {
      item.status.setAttribute('role', 'alert');
      item.status.textContent = `Could not load ${item.panel.dataset.variant === 'faceted' ? 'Low-poly' : 'Smooth'}. Please reload to try again.`;
    } else {
      item.ready = true;
      item.status.hidden = true;
      bounds.union(item.bounds);
      bounds.getCenter(target);
      studios.forEach(entry => {
        entry.key.target.position.copy(target);
        entry.floor.position.y = bounds.min.y - .006;
        entry.shadowsDirty = true;
      });
      fit();
    }
    pending -= 1;
    stage.setAttribute('aria-busy', String(pending > 0));
    // A failed variant does not prevent inspecting the successful one.
    const enabled = pending === 0 && studios.some(entry => entry.ready);
    controls.enabled = enabled;
    viewButtons.forEach(button => { button.disabled = !enabled; });
    nightButton.disabled = !enabled;
    render();
  }

  controls.addEventListener('change', render);
  controls.addEventListener('start', () => viewButtons.forEach(button => button.setAttribute('aria-pressed', 'false')));
  viewButtons.forEach(button => button.addEventListener('click', () => {
    const angle = button.dataset.view === 'front' ? 0 : button.dataset.view === 'side' ? Math.PI / 2 : button.dataset.view === 'back' ? Math.PI : Math.PI / 4;
    viewDirection.set(Math.sin(angle), .18, Math.cos(angle)).normalize();
    fit();
    viewButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  nightButton.addEventListener('click', () => lighting(nightButton.getAttribute('aria-checked') !== 'true'));
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  studios.forEach(item => observer.observe(item.viewport));
  lighting(false);
  resize();

  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  studios.forEach(item => {
    loader.load(`/Room/character-guide-${item.panel.dataset.variant}.glb`, gltf => {
      if (disposed) { disposeMeshes(gltf.scene); return; }
      const model = gltf.scene;
      model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      // Preserve both variants' authored origin, dimensions and transforms.
      // Independent centering or normalization would hide shape differences.
      item.bounds.setFromObject(model);
      if (item.bounds.isEmpty()) {
        disposeMeshes(model);
        finishLoad(item, true);
        return;
      }
      item.scene.add(model);
      finishLoad(item);
    }, undefined, () => {
      if (!disposed) finishLoad(item, true);
    });
  });

  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    observer.disconnect();
    controls.dispose();
    draco.dispose();
    studios.forEach(item => disposeMeshes(item.scene));
    renderer.dispose();
  });
}

try {
  preview();
} catch {
  stage.setAttribute('aria-busy', 'false');
  panels.forEach(panel => {
    panel.dataset.state = 'error';
    panel.setAttribute('aria-busy', 'false');
    const status = panel.querySelector<HTMLElement>('.preview-status')!;
    status.hidden = false;
    status.setAttribute('role', 'alert');
    status.textContent = 'This browser could not open the 3D preview. You can still try the rooms.';
  });
}
