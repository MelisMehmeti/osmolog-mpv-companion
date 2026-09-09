"use strict";

const childProcess = require("node:child_process");
const EventEmitter = require("node:events");

// A long-lived Windows Runtime reader is used because Manatan embeds libmpv
// inside its own process and does not expose an mpv IPC socket. The script is
// encoded on the command line so it also works from Electron's packaged ASAR.
const POWERSHELL_SENSOR = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$coreAudio = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace OsmologAudio {
  public enum AudioSessionState { Inactive = 0, Active = 1, Expired = 2 }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
  public class MMDeviceEnumerator { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionManager2 {
    [PreserveSig] int GetAudioSessionControl(ref Guid sessionGuid, uint flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(ref Guid sessionGuid, uint flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator enumerator);
    [PreserveSig] int RegisterSessionNotification(IntPtr notification);
    [PreserveSig] int UnregisterSessionNotification(IntPtr notification);
    [PreserveSig] int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr notification);
    [PreserveSig] int UnregisterDuckNotification(IntPtr notification);
  }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 control);
  }

  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioSessionControl2 {
    [PreserveSig] int GetState(out AudioSessionState state);
    [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid context);
    [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, ref Guid context);
    [PreserveSig] int GetGroupingParam(out Guid groupingId);
    [PreserveSig] int SetGroupingParam(ref Guid groupingId, ref Guid context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);
    [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint processId);
    [PreserveSig] int IsSystemSoundsSession();
    [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid context);
    [PreserveSig] int GetMasterVolume(out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }

  public class State {
    public bool Found { get; set; }
    public bool Active { get; set; }
    public bool Muted { get; set; }
    public float Volume { get; set; }
    public uint ProcessId { get; set; }
    public string ProcessName { get; set; }
    public int MatchCount { get; set; }
    public int ActiveCount { get; set; }
  }

  public static class Reader {
    public static State Read() {
      var result = new State { Volume = 1, ProcessName = "" };
      var bestScore = -1;
      var matchCount = 0;
      var activeCount = 0;
      IMMDevice device = null;
      object managerObject = null;
      IAudioSessionEnumerator sessions = null;
      try {
        var devices = (IMMDeviceEnumerator)(new MMDeviceEnumerator());
        if (devices.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device == null) return result;
        var iid = typeof(IAudioSessionManager2).GUID;
        if (device.Activate(ref iid, 23, IntPtr.Zero, out managerObject) != 0 || managerObject == null) return result;
        var manager = (IAudioSessionManager2)managerObject;
        if (manager.GetSessionEnumerator(out sessions) != 0 || sessions == null) return result;
        int count;
        sessions.GetCount(out count);
        for (var index = 0; index < count; index++) {
          IAudioSessionControl2 control = null;
          try {
            if (sessions.GetSession(index, out control) != 0 || control == null) continue;
            uint pid;
            if (control.GetProcessId(out pid) < 0 || pid == 0) continue;
            Process process;
            try { process = Process.GetProcessById((int)pid); } catch { continue; }
            var processName = process.ProcessName ?? "";
            if (!processName.StartsWith("Manatan", StringComparison.OrdinalIgnoreCase)) continue;
            AudioSessionState sessionState;
            control.GetState(out sessionState);
            var current = new State {
              Found = true,
              Active = sessionState == AudioSessionState.Active,
              ProcessId = pid,
              ProcessName = processName,
              Volume = 1
            };
            matchCount++;
            if (current.Active) activeCount++;
            try {
              var volume = (ISimpleAudioVolume)control;
              float level;
              bool muted;
              if (volume.GetMasterVolume(out level) >= 0) current.Volume = level;
              if (volume.GetMute(out muted) >= 0) current.Muted = muted;
            } catch { }
            var score = (current.Active ? 4 : 0) + (!current.Muted && current.Volume > 0 ? 2 : 0);
            if (score > bestScore) {
              result = current;
              bestScore = score;
            }
          } finally {
            if (control != null && Marshal.IsComObject(control)) Marshal.ReleaseComObject(control);
          }
        }
      } catch { }
      finally {
        if (sessions != null && Marshal.IsComObject(sessions)) Marshal.ReleaseComObject(sessions);
        if (managerObject != null && Marshal.IsComObject(managerObject)) Marshal.ReleaseComObject(managerObject);
        if (device != null && Marshal.IsComObject(device)) Marshal.ReleaseComObject(device);
      }
      result.MatchCount = matchCount;
      result.ActiveCount = activeCount;
      return result;
    }
  }
}
'@
Add-Type -TypeDefinition $coreAudio -Language CSharp
function Await-WinRt($Operation, $ResultType) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq "AsTask" -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
$manager = Await-WinRt ($managerType::RequestAsync()) $managerType
while ($true) {
  try {
    $appRunning = @(Get-Process -Name "Manatan" -ErrorAction SilentlyContinue).Count -gt 0
    $session = $manager.GetSessions() | Where-Object { $_.SourceAppUserModelId -match "(?i)manatan" } | Select-Object -First 1
    $audio = [OsmologAudio.Reader]::Read()
    if ($null -eq $session) {
      [pscustomobject]@{
        available = $true
        appRunning = $appRunning
        found = [bool]$audio.Found
        playing = ([bool]$audio.Active -and -not [bool]$audio.Muted -and [double]$audio.Volume -gt 0)
        source = if ($audio.Found) { "audio-session:$($audio.ProcessName)" } else { "" }
        status = if ($audio.Active) { "Playing" } else { "Paused" }
        title = if ($audio.Found) { "Manatan video" } else { "" }
        muted = [bool]$audio.Muted
        volume = [double]$audio.Volume * 100
        audioSessionCount = [int]$audio.MatchCount
        activeAudioSessionCount = [int]$audio.ActiveCount
      } | ConvertTo-Json -Compress
    } else {
      $playback = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      $properties = Await-WinRt ($session.TryGetMediaPropertiesAsync()) $propertiesType
      $rate = 1
      if ($null -ne $playback.PlaybackRate) { $rate = [double]$playback.PlaybackRate }
      [pscustomobject]@{
        available = $true
        appRunning = $appRunning
        found = $true
        source = [string]$session.SourceAppUserModelId
        status = [string]$playback.PlaybackStatus
        playing = ([string]$playback.PlaybackStatus -eq "Playing")
        title = [string]$properties.Title
        subtitle = [string]$properties.Subtitle
        artist = [string]$properties.Artist
        positionSeconds = [math]::Max(0, $timeline.Position.TotalSeconds)
        durationSeconds = [math]::Max(0, $timeline.EndTime.TotalSeconds)
        playbackRate = $rate
        muted = [bool]$audio.Muted
        volume = [double]$audio.Volume * 100
        audioSessionCount = [int]$audio.MatchCount
        activeAudioSessionCount = [int]$audio.ActiveCount
      } | ConvertTo-Json -Compress
    }
  } catch {
    [pscustomobject]@{ available = $false; appRunning = $false; found = $false; playing = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
  Start-Sleep -Milliseconds 1000
}
`;

function safeSensorState(value = {}) {
  return {
    available: value.available === true,
    appRunning: value.appRunning === true,
    found: value.found === true,
    playing: value.playing === true,
    source: String(value.source || "").slice(0, 200),
    status: String(value.status || "").slice(0, 40),
    title: String(value.title || "").replace(/[\r\n]+/g, " ").trim().slice(0, 240),
    subtitle: String(value.subtitle || "").replace(/[\r\n]+/g, " ").trim().slice(0, 160),
    artist: String(value.artist || "").replace(/[\r\n]+/g, " ").trim().slice(0, 160),
    positionSeconds: Math.max(0, Number(value.positionSeconds) || 0),
    durationSeconds: Math.max(0, Number(value.durationSeconds) || 0),
    playbackRate: Math.max(0.1, Math.min(10, Number(value.playbackRate) || 1)),
    muted: value.muted === true,
    volume: Math.max(0, Math.min(100, Number(value.volume) || 0)),
    audioSessionCount: Math.max(0, Math.trunc(Number(value.audioSessionCount) || 0)),
    activeAudioSessionCount: Math.max(0, Math.trunc(Number(value.activeAudioSessionCount) || 0)),
    error: String(value.error || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300)
  };
}

class ManatanMediaSessionSensor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.logger = options.logger || console;
    this.spawn = options.spawn || childProcess.spawn;
    this.platform = options.platform || process.platform;
    this.process = null;
    this.buffer = "";
    this.stopped = true;
    this.restartTimer = null;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    if (this.platform !== "win32") {
      this.emit("state", safeSensorState({ error: "Manatan app tracking requires Windows." }));
      return;
    }
    this.launch();
  }

  launch() {
    if (this.stopped || this.process) return;
    const encoded = Buffer.from(POWERSHELL_SENSOR, "utf16le").toString("base64");
    const processHandle = this.spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    this.process = processHandle;
    processHandle.stdout.setEncoding("utf8");
    processHandle.stdout.on("data", chunk => this.consume(chunk));
    let errorText = "";
    processHandle.stderr.setEncoding("utf8");
    processHandle.stderr.on("data", chunk => { errorText = `${errorText}${chunk}`.slice(-1000); });
    processHandle.once("error", error => this.onExit(error.message));
    processHandle.once("exit", () => this.onExit(errorText));
  }

  consume(chunk) {
    this.buffer += String(chunk || "");
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try { this.emit("state", safeSensorState(JSON.parse(trimmed))); }
      catch { /* Ignore PowerShell host noise and partial output. */ }
    }
  }

  onExit(detail = "") {
    if (!this.process) return;
    this.process = null;
    this.buffer = "";
    if (this.stopped) return;
    const message = String(detail || "").replace(/[\r\n]+/g, " ").trim();
    if (message) this.logger.warn(`Manatan media-session reader stopped: ${message.slice(0, 240)}`);
    this.emit("state", safeSensorState({ error: "Windows media-session reader is restarting." }));
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => this.launch(), 5000);
    this.restartTimer.unref?.();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const processHandle = this.process;
    this.process = null;
    if (processHandle) processHandle.kill();
  }
}

module.exports = { ManatanMediaSessionSensor, POWERSHELL_SENSOR, safeSensorState };
