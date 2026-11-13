import { TalkingHead } from './vendor/talkinghead/talkinghead.mjs';
import { AVATAR } from './config.js';

/**
 * Loads the TalkingHead avatar in `avatarOnly` mode so it lives inside OUR three.js scene
 * (needed for WebXR). TalkingHead owns face + skeleton; nothing else writes to them.
 */
export async function createPatient({ scene, camera, anchor, onProgress }) {
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
      baseline: {}
    },
    onProgress
  );

  anchor.add(head.armature);
  head.armature.position.set(AVATAR.seatOffset.x, AVATAR.seatOffset.y, AVATAR.seatOffset.z);
  return head;
}
