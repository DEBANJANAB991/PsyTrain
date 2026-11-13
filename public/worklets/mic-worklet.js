/**
 * Microphone -> 16-bit PCM at the rate the ElevenLabs agent expects (16 kHz by default), in ~100 ms chunks.
 * Runs on the audio thread; posts each chunk's ArrayBuffer to the main thread (conversation.js).
 * Downsampling: average of the input samples that fall into each output sample (a simple low-pass).
 */
class MicWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options?.processorOptions || {};
    this.ratio = sampleRate / (o.targetRate || 16000);
    this.size = Math.round((o.targetRate || 16000) * (o.chunkMs || 100) / 1000);
    this.out = new Int16Array(this.size);
    this.n = 0;
    this.acc = 0;
    this.cnt = 0;
    this.pos = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i]; this.cnt++; this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const s = Math.max(-1, Math.min(1, this.acc / this.cnt));
        this.acc = 0; this.cnt = 0;
        this.out[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.size) {
          const buf = this.out.buffer;
          this.port.postMessage(buf, [buf]);
          this.out = new Int16Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('psytrain-mic', MicWorklet);
