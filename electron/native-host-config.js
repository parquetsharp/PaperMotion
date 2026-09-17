"use strict";

const HOST_NAME = "com.papermotion.engine";
const HOST_EXECUTABLE = "PaperMotion.NativeHost.exe";
const EXTENSION_IDS = ["dnjgmbcbfbhomhaneaafdjikpinkhhkd"];

function nativeHostManifest() {
  return {
    name: HOST_NAME,
    description: "Starts the local PaperMotion learning engine",
    path: HOST_EXECUTABLE,
    type: "stdio",
    allowed_origins: EXTENSION_IDS.map(id => `chrome-extension://${id}/`),
  };
}

module.exports = { EXTENSION_IDS, HOST_EXECUTABLE, HOST_NAME, nativeHostManifest };