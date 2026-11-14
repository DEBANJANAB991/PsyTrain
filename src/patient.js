import * as THREE from 'three';
import { TalkingHead } from './vendor/talkinghead/talkinghead.mjs';
import { AVATAR, PATIENT } from './config.js';
import { applyFacePaint, coverLogos } from './conditions.js';
import { precompile } from './precompile.js';

/**
 * Loads the TalkingHead avatar in `avatarOnly` mode so it lives inside OUR three.js scene
 * (needed for WebXR). TalkingHead owns face + skeleton; nothing else writes to them.
 * With `renderer`, her shaders are compiled before she is first drawn (see the end).
 */
export async function createPatient({ renderer, scene, camera, anchor, onProgress }) {
  const holder = document.createElement('div'); // TalkingHead wants a node; unused in avatarOnly
  const head = new TalkingHead(holder, {
    avatarOnly: true,
    avatarOnlyScene: null,        // we add the armature to the anchor ourselves
    hipFeetBalance: false,        // seated: the pose's Hips.position is authoritative (see vendor patch)
    avatarOnlyCamera: camera,
    lipsyncModules: ['en'],
    lipsyncLang: 'en',
    pcmSampleRate: 16000,         // ElevenLabs PCM 16 kHz (track B)
    avatarIdleEyeContact: 0.5,
    avatarIdleHeadMove: 0.5
  });

  await head.showAvatar(
    {
      url: AVATAR.url,
      body: AVATAR.body,
      avatarMood: 'neutral',
      lipsyncLang: 'en',
      ...(AVATAR.retarget ? { retarget: AVATAR.retarget } : {}),
      baseline: { ...AVATAR.baseline }
    },
    onProgress
  );

  anchor.add(head.armature);
  head.armature.traverse((o) => {
    if (o.isMesh) {
      for (const m of [o.material].flat()) if (isHair(o, m)) tuneHair(m);
      o.frustumCulled = false;
      const transparent = Array.isArray(o.material) ? o.material.some((m) => m.transparent) : o.material?.transparent;
      o.castShadow = !transparent;   // hair cards / lashes would cast rectangular shadows
      o.receiveShadow = true;
    }
  });
  head.armature.position.set(AVATAR.seatOffset.x, AVATAR.seatOffset.y, AVATAR.seatOffset.z);
  if (AVATAR.logoCovers) coverLogos(head, AVATAR.logoCovers);
  if (PATIENT.facePaint) applyFacePaint(head, PATIENT.facePaint);
  if (renderer) {
    // compiling her shaders on first use froze the page for about 3 s at the end of loading
    head.armature.visible = false;
    await precompile(renderer, head.armature, scene, camera);
    head.armature.visible = true;
  }
  return head;
}

const isHair = (mesh, m) => /hair|ponytail/i.test(mesh.name) || /hair|ponytail/i.test(m?.name ?? '');

/**
 * Hair cards come as alpha-MASK (hard, stair-stepped strand edges) or alpha-BLEND (no depth write,
 * so the cards sort wrongly and you see through the hair). Render both as opaque cards with
 * alpha-to-coverage: the MSAA buffer turns alpha into soft edges, depth stays correct, and it is
 * cheap enough for WebXR. Hair is also not metallic.
 */
function tuneHair(m) {
  const wasBlend = m.transparent;
  m.transparent = false;
  m.depthWrite = true;
  m.alphaToCoverage = true;
  m.alphaTest = wasBlend ? 0.25 : (m.alphaTest || 0.5);
  m.side = THREE.DoubleSide;
  m.metalness = 0;
  m.needsUpdate = true;
}
