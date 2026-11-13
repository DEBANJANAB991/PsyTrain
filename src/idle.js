/**
 * Extra idle behaviour on top of the mood animations (breathing and eye wander live in the moods).
 * Adds occasional look-aways when the patient is uncomfortable. Everything goes through
 * TalkingHead's public API.
 */
export class Idle {
  constructor(head, affect) {
    this.head = head;
    this.affect = affect;
    this.timer = this._next();
  }

  _next() { return 6000 + Math.random() * 9000; }

  update(dtMs) {
    this.timer -= dtMs;
    if (this.timer > 0) return;
    this.timer = this._next();
    const { emotion, gaze } = this.affect.state;
    if (gaze === 'student' && (emotion === 'tense' || emotion === 'withdrawn')) {
      this.head.lookAhead(1500 + Math.random() * 1500); // uncomfortable -> look away briefly
    }
  }
}
