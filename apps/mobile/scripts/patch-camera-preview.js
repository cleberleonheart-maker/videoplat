#!/usr/bin/env node
/*
 * Corrige bugs do plugin @capacitor-community/camera-preview v8.0.2 no Android.
 *
 * Em alguns aparelhos, chamadas como mCamera.cancelAutoFocus() e
 * mCamera.getParameters() lançam RuntimeException (ex.: "cancelAutoFocus failed",
 * "getParameters failed (empty parameters)"). Em setFocusArea()/handleZoom() elas
 * ficam fora de try/catch, então tocar para focar (ou dar pinch-zoom) derruba o app.
 *
 * Reimplementa esses dois métodos envolvendo tudo em try/catch. É idempotente:
 * substitui o método inteiro a cada build, então sobrevive a reinstalações de
 * node_modules, pois roda antes do `cap sync`/gradle.
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

// Substitui um método inteiro localizado pela assinatura, balanceando as chaves.
function replaceMethod(source, signature, newMethod) {
  const start = source.indexOf(signature);
  if (start === -1) return source;
  let open = source.indexOf("{", start);
  if (open === -1) return source;
  let depth = 0;
  let end = -1;
  for (let j = open; j < source.length; j++) {
    const c = source[j];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = j;
        break;
      }
    }
  }
  if (end === -1) return source;
  return source.slice(0, start) + newMethod + source.slice(end + 1);
}

const setFocusArea = `public void setFocusArea(final int pointX, final int pointY, final Camera.AutoFocusCallback callback) {
        if (mCamera == null) {
            return;
        }
        try {
            Camera.Parameters parameters = mCamera.getParameters();
            Rect focusRect = calculateTapArea(pointX, pointY, 1f);
            parameters.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
            parameters.setFocusAreas(Arrays.asList(new Camera.Area(focusRect, 1000)));
            if (parameters.getMaxNumMeteringAreas() > 0) {
                Rect meteringRect = calculateTapArea(pointX, pointY, 1.5f);
                parameters.setMeteringAreas(Arrays.asList(new Camera.Area(meteringRect, 1000)));
            }
            setCameraParameters(parameters);
            mCamera.autoFocus(callback);
        } catch (Exception e) {
            Log.d(TAG, "setFocusArea failed: " + e.getMessage());
            try {
                callback.onAutoFocus(false, mCamera);
            } catch (Exception ignored) {
            }
        }
    }`;

const handleZoom = `private void handleZoom(MotionEvent event, Camera.Parameters params) {
                    if (mCamera == null) {
                        return;
                    }
                    try {
                        int maxZoom = params.getMaxZoom();
                        int zoom = params.getZoom();
                        float newDist = getFingerSpacing(event);
                        if (newDist > mDist) {
                            if (zoom < maxZoom) zoom++;
                        } else if (newDist < mDist) {
                            if (zoom > 0) zoom--;
                        }
                        mDist = newDist;
                        params.setZoom(zoom);
                        mCamera.setParameters(params);
                    } catch (Exception e) {
                        Log.d(TAG, "handleZoom failed: " + e.getMessage());
                    }
                }`;

src = replaceMethod(src, "public void setFocusArea(", setFocusArea);
src = replaceMethod(src, "private void handleZoom(", handleZoom);

if (src === before) {
  console.log("[patch-camera-preview] já aplicado");
} else {
  fs.writeFileSync(file, src);
  console.log("[patch-camera-preview] CameraActivity.java corrigido");
}
