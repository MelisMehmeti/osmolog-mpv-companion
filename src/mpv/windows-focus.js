"use strict";

const path = require("node:path");
let enumWindowsCallback;

class WindowsFocusDetector {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.available = false;
    this.GetForegroundWindow = null;
    this.GetWindowThreadProcessId = null;
    this.OpenProcess = null;
    this.QueryFullProcessImageNameW = null;
    this.CloseHandle = null;
    if (process.platform !== "win32") return;
    try {
      const koffi = require("koffi");
      const user32 = koffi.load("user32.dll");
      const kernel32 = koffi.load("kernel32.dll");
      this.koffi = koffi;
      this.GetForegroundWindow = user32.func("void* __stdcall GetForegroundWindow()");
      this.GetWindowThreadProcessId = user32.func("uint32 __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32* processId)");
      this.OpenProcess = kernel32.func("void* __stdcall OpenProcess(uint32 access, bool inheritHandle, uint32 processId)");
      this.QueryFullProcessImageNameW = kernel32.func("bool __stdcall QueryFullProcessImageNameW(void* process, uint32 flags, _Out_ wchar_t* name, _Inout_ uint32* size)");
      this.CloseHandle = kernel32.func("bool __stdcall CloseHandle(void* handle)");
      enumWindowsCallback ||= koffi.proto("bool __stdcall OsmologEnumWindowsCallback(void* window, intptr_t data)");
      this.EnumWindows = user32.func("bool __stdcall EnumWindows(OsmologEnumWindowsCallback* callback, intptr_t data)");
      this.IsWindowVisible = user32.func("bool __stdcall IsWindowVisible(void* window)");
      this.available = true;
    } catch (error) {
      this.logger.warn(`Windows focus fallback is unavailable: ${error.message}`);
    }
  }

  isMpvFocused() {
    return this.isProcessFocused(["mpv.exe", "mpv.com"]);
  }

  isProcessFocused(executableNames) {
    if (!this.available) return false;
    const expected = new Set((Array.isArray(executableNames) ? executableNames : [executableNames])
      .map(value => String(value || "").trim().toLowerCase()).filter(Boolean));
    if (!expected.size) return false;
    const foreground = this.foregroundProcess();
    return Boolean(foreground && expected.has(path.win32.basename(foreground.path).toLowerCase()));
  }

  foregroundProcess() {
    if (!this.available) return null;
    const window = this.GetForegroundWindow();
    if (!window) return null;
    const pid = [0];
    this.GetWindowThreadProcessId(window, pid);
    const executable = this.processImage(pid[0]);
    return executable ? { pid: pid[0], path: executable } : null;
  }

  windowProcesses() {
    if (!this.available || !this.EnumWindows) return [];
    const processes = new Map();
    let visited = 0;
    // Only inspect executable paths for visible top-level windows. This also
    // finds games behind Companion; it never reads titles or process memory.
    this.EnumWindows(window => {
      if (++visited > 1024) return false;
      if (!this.IsWindowVisible(window)) return true;
      const pid = [0];
      this.GetWindowThreadProcessId(window, pid);
      if (!pid[0] || processes.has(pid[0])) return true;
      processes.set(pid[0], this.processImage(pid[0]));
      return true;
    }, 0);
    return [...processes].filter(([, executable]) => executable).map(([pid, executable]) => ({ pid, path: executable }));
  }

  processImage(pid) {
    if (!this.available || !Number.isInteger(pid) || pid <= 0) return "";
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const processHandle = this.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (!processHandle) return "";
    try {
      const size = [1024];
      const buffer = Buffer.alloc(2048);
      if (!this.QueryFullProcessImageNameW(processHandle, 0, buffer, size)) return "";
      return buffer.toString("utf16le", 0, size[0] * 2).replace(/\0+$/, "");
    } finally {
      this.CloseHandle(processHandle);
    }
  }
}

module.exports = { WindowsFocusDetector };
