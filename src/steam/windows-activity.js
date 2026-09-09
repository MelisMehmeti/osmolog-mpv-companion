"use strict";

// No hooks, key logging, process injection, or game-memory reads. Native input
// state is reduced to an idle duration; raw inputs are never persisted or sent.
class WindowsActivitySensor {
  constructor(options = {}) {
    this.available = false;
    this.focus = options.focus;
    this.now = options.now || (() => Number(process.hrtime.bigint() / 1000000n));
    this.controllerInputAt = -Infinity;
    this.controllerPackets = new Map();
    if (process.platform !== "win32") return;
    try {
      const koffi = require("koffi");
      const user32 = koffi.load("user32.dll"), kernel32 = koffi.load("kernel32.dll");
      this.getLastInput = user32.func("bool __stdcall GetLastInputInfo(_Inout_ void* info)");
      this.getTickCount = kernel32.func("uint32 __stdcall GetTickCount()");
      try {
        this.xinput = koffi.load("xinput1_4.dll").func("uint32 __stdcall XInputGetState(uint32 index, _Out_ void* state)");
      } catch { /* Keyboard and mouse remain usable; UI describes controller limitation. */ }
      this.available = this.focus?.available === true;
    } catch (error) { options.logger?.warn(`Steam activity detection is unavailable: ${error.message}`); }
  }

  sample() {
    if (!this.available) return { available: false, idleSeconds: null, foreground: null, controllerSupported: false };
    const input = Buffer.alloc(8);
    input.writeUInt32LE(8);
    const inputKnown = this.getLastInput(input);
    const keyboardIdle = inputKnown ? ((this.getTickCount() - input.readUInt32LE(4)) >>> 0) / 1000 : Infinity;
    const now = this.now();
    for (let index = 0; this.xinput && index < 4; index++) {
      const state = Buffer.alloc(16);
      if (this.xinput(index, state) !== 0) { this.controllerPackets.delete(index); continue; }
      const packet = state.readUInt32LE(0), previous = this.controllerPackets.get(index);
      this.controllerPackets.set(index, packet);
      // Ignore neutral packets and analog drift. A held button/stick is input
      // even when its packet number is unchanged (e.g. holding to walk).
      const active = state.readUInt16LE(4) !== 0 || state[6] > 30 || state[7] > 30 ||
        Math.abs(state.readInt16LE(8)) > 7849 || Math.abs(state.readInt16LE(10)) > 7849 ||
        Math.abs(state.readInt16LE(12)) > 8689 || Math.abs(state.readInt16LE(14)) > 8689;
      if (active && previous !== undefined) this.controllerInputAt = now;
    }
    const idleSeconds = Math.min(keyboardIdle, (now - this.controllerInputAt) / 1000);
    return { available: inputKnown, idleSeconds: Number.isFinite(idleSeconds) ? Math.max(0, idleSeconds) : null,
      foreground: this.focus.foregroundProcess(), controllerSupported: Boolean(this.xinput) };
  }
}

module.exports = { WindowsActivitySensor };
