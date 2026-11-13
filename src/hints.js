import * as THREE from 'three';
import HINTS from '../ai-patient-voice/hints.json';
import { ROOM } from './config.js';

/**
 * Hints session (consult.html?…&hints=1): when the patient starts a difficult behaviour, a light bulb with
 * the strategies for it from ai-patient-voice/hints.json (one line each) pops up behind her.
 *
 *   const trigger = new HintTrigger({ conversation, modeWatcher });
 *   trigger.trigger   // state flag: 'distracted' | 'aggressive' | null
 *   trigger.level     // 1..3 how far it has escalated (0 when no trigger); informational, the board shows all levels
 *   trigger.on('change', ({ trigger, level, reason }) => ...);
 *
 * The trigger is the orchestrator's session mode (server/orchestrator.js, polled by ModeWatcher): distracted or
 * aggressive. Level 1 when the mode starts, then one level up for every 2 answers it lasts. The session mode is
 * used, not the mode of a single answer, so a risk question (answered directly) does not make the hint flicker.
 * Triggers are only active while a conversation is live.
 */

/** Trigger flag (= orchestrator mode) -> key in hints.json. */
export const HINT_KEYS = { distracted: 'distraction', aggressive: 'aggressive' };

const ANSWERS_PER_LEVEL = 2;

export class HintTrigger {
  constructor({ conversation, modeWatcher }) {
    this.listeners = {};
    this.trigger = null;
    this.level = 0;
    this.live = false;
    this.mode = 'normal';
    this.answersInMode = 0;
    conversation.on('status', (s) => { this.live = s === 'live'; if (s !== 'live') this.mode = 'normal'; this._eval('conversation ' + s); });
    modeWatcher.on('state', (s) => {
      if (!s.active || s.mode === this.mode) return;
      this.mode = s.mode; this.answersInMode = 0;
      this._eval(s.reason || 'mode change');
    });
    conversation.on('patient', () => { if (this.mode !== 'normal') this.answersInMode++; this._eval('patient answered'); });
  }

  on(name, fn) { (this.listeners[name] ||= new Set()).add(fn); return () => this.listeners[name].delete(fn); }
  emit(name, data) { this.listeners[name]?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }

  _eval(reason) {
    let trigger = null, level = 0;
    if (this.live && HINT_KEYS[this.mode]) {
      trigger = this.mode;
      level = Math.min(3, 1 + Math.floor(this.answersInMode / ANSWERS_PER_LEVEL));
    }
    if (trigger === this.trigger && level === this.level) return;
    this.trigger = trigger; this.level = level;
    this.emit('change', { trigger, level, reason });
  }
}

const HEADINGS = { distracted: 'The patient is drifting off', aggressive: 'The patient is getting aggressive' };

/** All strategies for a trigger: { trigger, heading, cards: [{ level, title, text }] } (links and citations removed). */
export function hintsFor(trigger) {
  const h = HINTS[HINT_KEYS[trigger]];
  if (!h) return null;
  return {
    trigger,
    heading: HEADINGS[trigger] ?? 'Hint',
    cards: [...h.strategies].sort((a, b) => a.level - b.level)
      .map((s) => ({ level: s.level, title: s.short_hint, text: cardText(plain(s.long_explanation)) }))
  };
}

/**
 * What to do, in a few lines: the explanation's practical "In the SCID setting: …" / "In the simulation: …"
 * sentence if it has one (without that lead-in), otherwise its first two sentences.
 */
function cardText(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const lead = /^(In the (SCID setting|simulation):|For the SCID setting this means)\s*/;
  const practical = sentences.find((s) => lead.test(s));
  if (!practical) return sentences.slice(0, 2).join(' ');
  const rest = practical.replace(lead, '');
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

const plain = (md) => md
  .replace(/\s*\((?:\[[^\]]*\]\([^)]*\)[,;\s]*)+\)/g, '')     // "([Book, p. 63](url), [Worksheet 13](url))"
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')                  // other links -> their text
  .replace(/\s+/g, ' ').trim();

// ---- bulb + one-line hints behind the patient ----------------------------------------------------------

const BOARD = {
  px: [1200, 400],
  width: 1.0,        // m (height follows the canvas aspect: 0.33 m); small enough to stay in view next to the notes
  behind: 0.9,       // m behind the patient
  y: 1.76            // centre; low enough that the top stays in view when the student looks at the notes, and the
                     // bottom edge (1.59 m) still clears her hair in the student's line of sight (about 1.45 m there)
};
const ACCENT = { distracted: '#4f7df3', aggressive: '#e0563f' };
const FADE_MS = 350;
const POP_MS = 450;

/**
 * One canvas-texture plane. The canvas is drawn and uploaded once per trigger; while no hint shows, the mesh
 * is invisible and costs nothing. The pop-up is a scale + fade on the mesh, so it needs no redraws.
 * A WebGL mesh (not HTML), so it also shows in the headset.
 */
export function createHintBoard({ scene, patientZ }) {
  const [W, H] = BOARD.px;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.width, BOARD.width * H / W), mat);
  mesh.name = 'hint-board';
  mesh.position.set(0, BOARD.y, patientZ - BOARD.behind);
  mesh.lookAt(0, ROOM.eyeHeight, 0);
  mesh.visible = false;
  scene.add(mesh);

  let target = 0, current = null, pop = 1;

  function draw(h) {
    const accent = ACCENT[h.trigger] ?? '#4f7df3';
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';

    // one dark panel: bulb on the left, heading + one line per strategy on the right
    g.fillStyle = 'rgba(18, 22, 28, 0.88)';
    g.beginPath(); g.roundRect(16, 16, W - 32, H - 32, 28); g.fill();
    const bx = 120, by = 160;
    const glow = g.createRadialGradient(bx, by, 10, bx, by, 110);
    glow.addColorStop(0, 'rgba(255, 214, 90, 0.75)');
    glow.addColorStop(1, 'rgba(255, 214, 90, 0)');
    g.fillStyle = glow;
    g.beginPath(); g.arc(bx, by, 110, 0, Math.PI * 2); g.fill();
    bulb(g, bx, by);

    const x0 = 240, maxW = W - x0 - 48;
    g.textAlign = 'left';
    g.fillStyle = '#ffffff';
    g.font = '700 46px system-ui, sans-serif';
    g.fillText(h.heading, x0, 86, maxW);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = '30px system-ui, sans-serif';
    g.fillText('Hints on how to handle it', x0, 130, maxW);

    h.cards.forEach((c, i) => {
      const y = 200 + i * 66;
      g.fillStyle = accent;
      g.beginPath(); g.arc(x0 + 22, y - 14, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.font = '700 26px system-ui, sans-serif';
      g.textAlign = 'center'; g.fillText(String(c.level ?? i + 1), x0 + 22, y - 5); g.textAlign = 'left';
      g.font = '600 40px system-ui, sans-serif';
      g.fillText(c.title, x0 + 64, y, maxW - 64);
    });
    tex.needsUpdate = true;
  }

  return {
    mesh,
    get hints() { return current; },
    /** show(hintsFor(trigger)) or show(null) to fade out; the same trigger again does not redraw or pop */
    show(h) {
      if (h?.trigger === current?.trigger) return;
      current = h;
      if (!h) { target = 0; return; }
      draw(h);
      mesh.visible = true;
      target = 1;
      pop = 0;
    },
    update(dt) {
      if (mat.opacity === target && pop >= 1) return;
      const step = dt / FADE_MS;
      mat.opacity = target > mat.opacity ? Math.min(target, mat.opacity + step) : Math.max(target, mat.opacity - step);
      if (pop < 1) {
        pop = Math.min(1, pop + dt / POP_MS);
        mesh.scale.setScalar(0.7 + 0.3 * easeOutBack(pop));
      }
      if (mat.opacity === 0) mesh.visible = false;
    }
  };
}

function easeOutBack(t) {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

/** A light bulb icon centred at (x, y). */
function bulb(g, x, y) {
  g.fillStyle = '#ffd65a';
  g.beginPath();
  g.arc(x, y - 10, 48, Math.PI * 0.8, Math.PI * 2.2);   // glass
  g.lineTo(x + 20, y + 52);
  g.lineTo(x - 20, y + 52);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(140, 95, 0, 0.55)';               // filament
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(x - 12, y + 46); g.lineTo(x - 12, y + 6); g.lineTo(x, y + 18); g.lineTo(x + 12, y + 6); g.lineTo(x + 12, y + 46); g.stroke();
  g.fillStyle = '#c9ced6';                                 // screw base
  for (let i = 0; i < 3; i++) { g.beginPath(); g.roundRect(x - 22, y + 56 + i * 12, 44, 9, 4); g.fill(); }
  g.beginPath(); g.roundRect(x - 12, y + 92, 24, 8, 4); g.fill();
}

