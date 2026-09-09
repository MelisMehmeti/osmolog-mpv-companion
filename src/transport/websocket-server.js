"use strict";

const EventEmitter = require("node:events");
const { WebSocketServer, WebSocket } = require("ws");

function validExtensionId(value) {
  return /^[a-p]{32}$/i.test(String(value || "").trim());
}

function extensionIdFromOrigin(origin) {
  const match = /^chrome-extension:\/\/([a-p]{32})$/i.exec(String(origin || ""));
  return match ? match[1].toLowerCase() : "";
}

class CompanionTransport extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = "127.0.0.1";
    this.startPort = options.port ?? 47823;
    this.extensionId = options.extensionId;
    this.logger = options.logger || console;
    this.server = null;
    this.port = 0;
    this.clients = new Set();
    this.pairingUntil = 0;
    this.hello = options.hello || { type: "hello", version: require("../../package.json").version, player: "mpv", players: ["mpv", "manatan", "steam"], schemaVersion: 1, capabilities: ["segments", "state", "todayTotals", "osd", "manatanMediaSession", "steamTracking"] };
  }

  expectedOrigin() {
    return `chrome-extension://${this.extensionId}`;
  }

  isPaired() {
    return validExtensionId(this.extensionId);
  }

  pairingRemaining(now = Date.now()) {
    return Math.max(0, Math.ceil((this.pairingUntil - now) / 1000));
  }

  startPairing(durationMs = 60000) {
    this.pairingUntil = Date.now() + Math.max(10000, Math.min(5 * 60 * 1000, Number(durationMs) || 60000));
    this.emit("pairing", this.pairingRemaining());
    return this.pairingUntil;
  }

  cancelPairing() {
    this.pairingUntil = 0;
    this.emit("pairing", 0);
  }

  updateExtensionId(extensionId) {
    if (!validExtensionId(extensionId)) return false;
    this.extensionId = String(extensionId).toLowerCase();
    return true;
  }

  acceptsOrigin(origin) {
    const extensionId = extensionIdFromOrigin(origin);
    if (!extensionId) return false;
    return (this.isPaired() && extensionId === String(this.extensionId).toLowerCase()) || this.pairingRemaining() > 0;
  }

  async start() {
    let lastError;
    const lastPort = this.startPort === 0 ? 0 : this.startPort + 4;
    for (let port = this.startPort; port <= lastPort; port += 1) {
      try {
        await this.listen(port);
        this.port = this.server.address().port;
        return this.port;
      } catch (error) {
        lastError = error;
        if (error.code !== "EADDRINUSE") throw error;
      }
    }
    throw lastError || new Error("No companion port is available.");
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const server = new WebSocketServer({
        host: this.host,
        port,
        verifyClient: info => this.acceptsOrigin(info.origin)
      });
      const onError = error => { server.close(); reject(error); };
      server.once("error", onError);
      server.once("listening", () => {
        server.off("error", onError);
        server.on("error", error => this.emit("warning", error.message));
        server.on("connection", (socket, request) => this.onConnection(socket, request));
        this.server = server;
        resolve();
      });
    });
  }

  onConnection(socket, request) {
    const extensionId = extensionIdFromOrigin(request?.headers?.origin);
    if (extensionId && this.pairingRemaining() > 0) {
      const changed = extensionId !== String(this.extensionId).toLowerCase();
      if (changed) this.extensionId = extensionId;
      this.pairingUntil = 0;
      if (changed) this.emit("paired", extensionId);
      else this.emit("pairing", 0);
    }
    this.clients.add(socket);
    this.emit("client-count", this.clients.size);
    this.send(socket, this.hello);
    this.emit("client", socket);
    socket.on("message", data => {
      try { this.emit("message", JSON.parse(String(data)), socket); }
      catch { this.send(socket, { type: "error", reason: "invalid-json" }); }
    });
    socket.on("close", () => {
      this.clients.delete(socket);
      this.emit("client-count", this.clients.size);
    });
  }

  send(socket, value) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(value));
    return true;
  }

  broadcast(value) {
    let sent = 0;
    for (const socket of this.clients) if (this.send(socket, value)) sent += 1;
    return sent;
  }

  close() {
    for (const socket of this.clients) socket.close();
    this.clients.clear();
    return new Promise(resolve => this.server ? this.server.close(resolve) : resolve());
  }
}

module.exports = { CompanionTransport, extensionIdFromOrigin, validExtensionId };
