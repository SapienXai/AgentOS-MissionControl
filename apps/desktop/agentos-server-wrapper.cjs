"use strict";

const path = require("node:path");
const readline = require("node:readline");

let shutdownRequested = false;

function requestShutdown() {
  if (shutdownRequested) return;

  if (process.listenerCount("SIGTERM") === 0) {
    const retry = setTimeout(requestShutdown, 25);
    retry.unref();
    return;
  }

  shutdownRequested = true;
  process.emit("SIGTERM", "SIGTERM");
}

const control = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

control.on("line", (line) => {
  if (line.trim() === "shutdown") requestShutdown();
});
control.on("close", requestShutdown);

require(path.join(__dirname, "server.js"));
