import * as THREE from 'three';

export const INK_FIRE_LIMIT = 16;
export const inkNight = {
  amount: { value: 0 },
  time: { value: 0 },
  fires: { value: Array.from({ length: INK_FIRE_LIMIT }, () => new THREE.Vector4(0, -100, 0, 0)) },
};
export const ATLAS_PAPER = '#eadcc0';
export const ATLAS_OBJECT_PAPER = '#f2e6ce';
export const ATLAS_INK = '#5c422d';
export const ATLAS_NIGHT = '#050607';
const nightMaterials = new WeakSet<THREE.Material>();

/** Keep the authored marks, with cool moonlit paper and local warm torch pools. */
export function preparePenInkMaterial(material: THREE.Material): void {
  if (nightMaterials.has(material)) return;
  nightMaterials.add(material);
  material.toneMapped = false;
  (material as THREE.MeshBasicMaterial).fog = true;
  const previous = material.onBeforeCompile.bind(material);
  const previousKey = material.customProgramCacheKey.bind(material)();
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.inkNightAmount = inkNight.amount;
    shader.uniforms.inkNightTime = inkNight.time;
    shader.uniforms.inkFires = inkNight.fires;
    shader.uniforms.atlasPaper = { value:new THREE.Color(ATLAS_OBJECT_PAPER).convertSRGBToLinear() };
    shader.uniforms.atlasGround = { value:new THREE.Color(ATLAS_PAPER).convertSRGBToLinear() };
    shader.uniforms.atlasInk = { value:new THREE.Color(ATLAS_INK).convertSRGBToLinear() };
    shader.uniforms.atlasGroundSurface = { value:material.name==='PenPaperGround'?1:0 };
    shader.vertexShader = 'varying vec3 inkWorldPosition;\nvarying vec3 inkWorldNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 inkPoint = vec4(transformed, 1.0);
      vec3 inkNormal = normal;
      #ifdef USE_INSTANCING
        inkPoint = instanceMatrix * inkPoint;
        inkNormal = mat3(instanceMatrix) * inkNormal;
      #endif
      inkWorldPosition = (modelMatrix * inkPoint).xyz;
      inkWorldNormal = normalize(mat3(modelMatrix) * inkNormal);
      #include <project_vertex>
    `);
    shader.fragmentShader = `
      uniform float inkNightAmount;
      uniform float inkNightTime;
      uniform vec4 inkFires[${INK_FIRE_LIMIT}];
      uniform vec3 atlasPaper;
      uniform vec3 atlasGround;
      uniform vec3 atlasInk;
      uniform float atlasGroundSurface;
      varying vec3 inkWorldPosition;
      varying vec3 inkWorldNormal;
      float atlasHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float atlasNoise(vec2 p) {
        vec2 cell=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(atlasHash(cell),atlasHash(cell+vec2(1.0,0.0)),f.x),
          mix(atlasHash(cell+vec2(0.0,1.0)),atlasHash(cell+vec2(1.0,1.0)),f.x),f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphamap_fragment>', `
      float paper = pow(clamp(dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722)),0.0,1.0),0.8);
      float paperGrain = (atlasNoise(inkWorldPosition.xz*.7)-.5)*.028
        + (atlasNoise(inkWorldPosition.xz*7.0)-.5)*.018
        + (atlasHash(floor(gl_FragCoord.xy))-.5)*.021;
      vec3 paperColor = mix(atlasPaper,atlasGround,atlasGroundSurface) * (1.0+paperGrain);
      vec3 dayColor = mix(atlasInk,paperColor,paper);
      vec3 nightColor = dayColor;
      if (inkNightAmount > 0.001) {
        vec3 surfaceNormal = normalize(inkWorldNormal);
        float moon = max(0.0,dot(surfaceNormal,normalize(vec3(-0.4,0.8,-0.3))));
        vec3 moonPaper = mix(vec3(.003,.0033,.0038)+moon*.0015,vec3(.0015,.0018,.0021),atlasGroundSurface);
        nightColor = mix(vec3(.65,.63,.59),moonPaper,paper);
        float warmth = 0.0;
        for (int i = 0; i < ${INK_FIRE_LIMIT}; i++) {
          vec3 toFire = inkFires[i].xyz - inkWorldPosition;
          float falloff = max(0.0, 1.0 - dot(toFire, toFire) / 5.0);
          float facing = 0.3 + 0.7 * max(0.0, dot(surfaceNormal, normalize(toFire + vec3(0.0001))));
          warmth += falloff * falloff * facing * inkFires[i].w;
        }
        vec3 fireColor = mix(vec3(.72,.68,.59),vec3(.042,.038,.031),paper);
        nightColor = mix(nightColor,fireColor,clamp(warmth*.3,0.0,.25));
        if (atlasGroundSurface > .5) {
          vec2 starCell=floor(inkWorldPosition.xz*1.7), local=fract(inkWorldPosition.xz*1.7);
          float seed=atlasHash(starCell);
          vec2 centre=vec2(atlasHash(starCell+13.7),atlasHash(starCell+47.2))*.7+.15;
          float star=1.0-smoothstep(.014,.034,length(local-centre));
          star*=step(.78,seed)*smoothstep(8.0,10.0,length(inkWorldPosition.xz));
          nightColor += vec3(.76,.75,.72)*star;
        }
      }
      diffuseColor.rgb=mix(dayColor,nightColor,inkNightAmount);
      #include <alphamap_fragment>
    `);
  };
  material.customProgramCacheKey = () => `${previousKey}-atlas-paper-1`;
  material.needsUpdate = true;
}

/** Blender-authored ink is unlit: exposure must never turn the paper grey. */
export function preparePenInkModel(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material.name.startsWith('Pen') && !object.userData.penInkAuthored) continue;
      preparePenInkMaterial(material);
    }
  });
}

export function isPenInkObject(object: THREE.Mesh): boolean {
  return Boolean(object.userData.penInkAuthored) ||
    (Array.isArray(object.material) ? object.material : [object.material]).every(material => material.name.startsWith('Pen'));
}

/** Surface-space marks for the small live dance stage, whose pads still move. */
export function penMaterial(black = false): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: black ? '#202327' : '#ffffff', toneMapped: false });
  material.color.convertSRGBToLinear();
  material.name = black ? 'PenRuntimeInk' : 'PenRuntimePaper';
  if (black) { preparePenInkMaterial(material); return material; }
  (material as THREE.MeshBasicMaterial & { extensions: { derivatives: boolean } }).extensions = { derivatives: true };
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec3 penPosition;\nvarying vec3 penNormal;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      penPosition = position;
      penNormal = normal;
    `);
    shader.fragmentShader = `
      varying vec3 penPosition;
      varying vec3 penNormal;
      float inkHatch(vec2 p) {
        float stroke = (p.x + p.y * 0.7) * 29.0 + sin(p.y * 35.0) * 0.05;
        float distanceToLine = abs(fract(stroke) - 0.5);
        float width = max(fwidth(stroke), 0.025);
        return 1.0 - smoothstep(0.045, 0.045 + width, distanceToLine);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 n = normalize(penNormal);
      vec3 weight = pow(abs(n), vec3(8.0));
      weight /= max(weight.x + weight.y + weight.z, 0.001);
      float hatch = inkHatch(penPosition.yz) * weight.x
                  + inkHatch(penPosition.xz) * weight.y
                  + inkHatch(penPosition.xy) * weight.z;
      float shade = 1.0 - smoothstep(-0.35, 0.05, dot(n, normalize(vec3(0.6, 0.8, 0.3))));
      float inkPatch = smoothstep(-0.1, 0.45, sin(penPosition.x * 6.0 + penPosition.y * 4.0));
      diffuseColor.rgb *= 1.0 - hatch * shade * inkPatch * 0.78;
    `);
  };
  material.customProgramCacheKey = () => 'pen-stage-1';
  preparePenInkMaterial(material);
  return material;
}
