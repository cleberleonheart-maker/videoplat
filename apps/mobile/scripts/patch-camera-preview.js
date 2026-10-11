#!/usr/bin/env node
/*
 * Corrige um bug do plugin @capacitor-community/camera-preview v8.0.2 no
 * Android: mCamera.cancelAutoFocus() pode lançar RuntimeException
 * ("cancelAutoFocus failed") em alguns aparelhos. Em setFocusArea() a chamada
 * fica fora do try/catch, então tocar para focar derruba o app.
 *
 * Envolve as chamadas soltas em try/catch. É idempotente: roda a cada build e
 * não altera o código já corrigido. Assim a correção sobrevive a reinstalações
 * de node_modules, pois o script roda antes do `cap sync`/gradle.
 */
const fs = require("fs");
const path = require("path");

const file = path.join(
  __dirname,
  "..",
  "node_modules",
  "@capacitor-community",
  "camera-preview",
  "android",
  "src",
  "main",
  "java",
  "com",
  "ahm",
  "capacitor",
  "camera",
  "preview",
  "CameraActivity.java"
);

if (!fs.existsSync(file)) {
  // Plugin ausente (build do site, por exemplo): nada a fazer.
  process.exit(0);
}

let src = fs.readFileSync(file, "utf8");
const before = src;

// Só casa linhas que sejam exatamente a chamada solta (sem try), mantendo a
// indentação. Depois de corrigida a linha deixa de casar => idempotente.
const re = /^([ \t]*)mCamera\.cancelAutoFocus\(\);[ \t]*$/gm;
src = src.replace(
  re,
  '$1try { mCamera.cancelAutoFocus(); } catch (RuntimeException e) { Log.d(TAG, "cancelAutoFocus failed: " + e.getMessage()); }'
);

if (src === before) {
  console.log("[patch-camera-preview] já aplicado");
} else {
  fs.writeFileSync(file, src);
  console.log("[patch-camera-preview] CameraActivity.java corrigido");
}
