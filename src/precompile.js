import * as THREE from 'three';

// The shadow pass draws every caster with a depth material that copies a few settings from the caster's own
// material (three.js WebGLShadowMap.getDepthMaterial). Compiling the same variants up front, into a render
// target like the shadow map, means the first shadow frame finds those programs ready.
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const depthVariant = (m) => Object.assign(new THREE.MeshDepthMaterial(), {
  side: m.shadowSide ?? SHADOW_SIDE[m.side],
  map: m.map,
  alphaMap: m.alphaMap,
  alphaTest: m.alphaToCoverage ? 0.5 : m.alphaTest
});

/**
 * Compiles the shaders `object` needs in `scene` (its materials and its shadow-casting depth variants) before it is
 * first drawn. Compiling them on first use blocks the page; with KHR_parallel_shader_compile the browser compiles
 * them in the background while the page keeps rendering. Without that extension this resolves straight away and the
 * first frame compiles them, as before.
 */
export async function precompile(renderer, object, scene, camera = new THREE.PerspectiveCamera()) {
  const casters = [];
  object.traverse((o) => { if (o.isMesh && o.castShadow) casters.push(o); });
  const previous = renderer.getRenderTarget(), target = new THREE.WebGLRenderTarget(1, 1);
  renderer.setRenderTarget(target);   // like the shadow map: linear output, no tone mapping
  const shadows = casters.map((o) => {
    const own = o.material;
    o.material = Array.isArray(own) ? own.map(depthVariant) : depthVariant(own);
    const done = renderer.compileAsync(o, camera, scene);   // compiles synchronously, then only polls
    o.material = own;
    return done;
  });
  renderer.setRenderTarget(previous);
  target.dispose();
  await Promise.all([...shadows, renderer.compileAsync(object, camera, scene)]);
}
