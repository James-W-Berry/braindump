import { domToPng } from "modern-screenshot";
import { invoke } from "@tauri-apps/api/core";

/**
 * Scale factor used for DOM → PNG capture. Exported so the composite step
 * can convert DOM-pixel coordinates (e.g. traffic-light position) into
 * captured-canvas pixels.
 */
export const CAPTURE_SCALE = 2;

/**
 * Snapshot a DOM element to a PNG data URL. `modern-screenshot` handles
 * Tailwind v4 custom properties, gradients, and embedded fonts better than
 * older `html-to-image` / `dom-to-image` libs.
 */
export async function captureNode(node: HTMLElement): Promise<string> {
  return await domToPng(node, {
    scale: CAPTURE_SCALE,
    backgroundColor: null,
  });
}

export interface BackgroundSolid {
  kind: "solid";
  color: string; // CSS color
}

export interface BackgroundGradient {
  kind: "gradient";
  from: string; // CSS color
  to: string; // CSS color
  angle: number; // degrees, 0 = left→right
}

export type BackgroundConfig = BackgroundSolid | BackgroundGradient;

export interface MatConfig {
  padding: number; // pixels of background visible around the screenshot
  radius: number; // corner radius on the screenshot
  shadow: number; // shadow intensity 0–1
}

/**
 * Position (in DOM pixels) of the first traffic-light button's center.
 * When set, the composite draws fake stoplights there — needed because
 * macOS renders the real ones as native window chrome outside the DOM.
 */
export interface TrafficLightsConfig {
  x: number;
  y: number;
}

export interface CompositeInput {
  /** Data URL of the screenshot. */
  screenshot: string;
  background: BackgroundConfig;
  mat: MatConfig;
  trafficLights?: TrafficLightsConfig | null;
}

/**
 * Draw the captured screenshot onto a canvas over the chosen background.
 * Returns a PNG blob ready to copy or save.
 */
export async function composite(input: CompositeInput): Promise<Blob> {
  const img = await loadImage(input.screenshot);

  // Target canvas matches the screenshot's intrinsic size + padding on all sides.
  const pad = Math.max(0, Math.round(input.mat.padding));
  const width = img.naturalWidth + pad * 2;
  const height = img.naturalHeight + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");

  paintBackground(ctx, input.background, width, height);

  const radius = Math.max(0, Math.round(input.mat.radius));
  const shadow = Math.min(1, Math.max(0, input.mat.shadow));

  if (shadow > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(0, 0, 0, ${0.45 * shadow})`;
    ctx.shadowBlur = 60 * shadow;
    ctx.shadowOffsetY = 24 * shadow;
    ctx.fillStyle = "#000";
    roundRect(ctx, pad, pad, img.naturalWidth, img.naturalHeight, radius);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  roundRect(ctx, pad, pad, img.naturalWidth, img.naturalHeight, radius);
  ctx.clip();
  ctx.drawImage(img, pad, pad);
  if (input.trafficLights) {
    drawTrafficLights(
      ctx,
      pad + input.trafficLights.x * CAPTURE_SCALE,
      pad + input.trafficLights.y * CAPTURE_SCALE,
      CAPTURE_SCALE,
    );
  }
  ctx.restore();

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error("canvas.toBlob returned null"));
    }, "image/png");
  });
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  bg: BackgroundConfig,
  w: number,
  h: number,
) {
  if (bg.kind === "solid") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  // Compute gradient endpoints from the angle (CSS-style; 0deg points right).
  const rad = (bg.angle * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const dx = Math.cos(rad) * (w / 2);
  const dy = Math.sin(rad) * (h / 2);
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  grad.addColorStop(0, bg.from);
  grad.addColorStop(1, bg.to);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Draw three macOS-style traffic-light dots (close / minimize / zoom).
 * `cx`, `cy` are the CENTER of the first (close) button in canvas pixels.
 * `scale` matches the captured image scale so the dots visually line up
 * with the app's header at any DPR.
 */
function drawTrafficLights(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
) {
  const radius = 6 * scale; // 12px diameter — macOS standard
  const spacing = 20 * scale; // center-to-center
  const fills = ["#FF5F57", "#FEBC2E", "#28C840"];
  const strokes = ["#E0443E", "#DEA123", "#1AAB29"];

  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx + spacing * i, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = fills[i];
    ctx.fill();
    ctx.lineWidth = Math.max(1, scale * 0.5);
    ctx.strokeStyle = strokes[i];
    ctx.stroke();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to decode captured image"));
    img.src = src;
  });
}

export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  const item = new ClipboardItem({ "image/png": blob });
  await navigator.clipboard.write([item]);
}

export async function saveBlobToDesktop(
  blob: Blob,
  filename: string,
): Promise<string> {
  const base64 = await blobToBase64(blob);
  return await invoke<string>("save_png_to_desktop", {
    filename,
    base64Png: base64,
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = reader.result as string;
      // Strip the "data:image/png;base64," prefix.
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.readAsDataURL(blob);
  });
}

export function defaultFilename(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `braindump-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
}
