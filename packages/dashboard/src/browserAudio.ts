/**
 * Copyright (c) Regun Software SRL.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/** Playback of the selected CarapaBoard browser session's bounded PCM stream. */
export class BrowserAudio {
  private _context: AudioContext | undefined;
  private _sources = new Set<AudioBufferSourceNode>();
  private _nextTime = 0;

  async start() {
    const context = this._context ||= new AudioContext({ latencyHint: 'interactive' });
    // Called directly from the sound button's user gesture.
    await context.resume();
    if (context.state !== 'running')
      throw new Error('Click Enable sound to allow browser audio.');
  }

  clear() {
    for (const source of this._sources) {
      source.stop();
      source.disconnect();
    }
    this._sources.clear();
    this._nextTime = 0;
  }

  stop() {
    this.clear();
    const context = this._context;
    this._context = undefined;
    void context?.close().catch(() => {});
  }

  receive(packet: { data: string; sampleRate: number; channels: number }) {
    const context = this._context;
    if (!context || context.state !== 'running' || document.hidden)
      return;
    // The transport carries 40 ms of stereo signed 16-bit little-endian PCM.
    if (packet.sampleRate !== 48000 || packet.channels !== 2 || typeof packet.data !== 'string' || packet.data.length !== 10240)
      return;
    let raw: string;
    try {
      raw = atob(packet.data);
    } catch {
      return;
    }
    if (raw.length !== 7680)
      return;
    const samples = 1920;
    const buffer = context.createBuffer(2, samples, 48000);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let frame = 0; frame < samples; frame++) {
        const offset = (frame * 2 + channel) * 2;
        const value = raw.charCodeAt(offset) | (raw.charCodeAt(offset + 1) << 8);
        data[frame] = (value >= 0x8000 ? value - 0x10000 : value) / 32768;
      }
    }
    // Rebase after a stalled connection instead of accumulating delayed sound.
    if (this._nextTime > context.currentTime + 0.24)
      this.clear();
    this._nextTime = Math.max(this._nextTime, context.currentTime + 0.04);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this._sources.add(source);
    source.onended = () => {
      this._sources.delete(source);
      source.disconnect();
    };
    source.start(this._nextTime);
    this._nextTime += buffer.duration;
  }
}
