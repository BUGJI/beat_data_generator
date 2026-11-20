import { hexToRgb } from "../../theme";

/**
 * Soft bloom for the marker playback flash.
 *
 * A radial-gradient sprite is rendered once per colour and reused, so the
 * per-frame cost is a single additive `drawImage` instead of building a
 * gradient for every flashing marker.
 */
const SPRITE_PX = 128;
const spriteCache = new Map<string, HTMLCanvasElement>();

function spriteFor(color: string): HTMLCanvasElement {
  const cached = spriteCache.get(color);
  if (cached) return cached;
  const cv = document.createElement("canvas");
  cv.width = SPRITE_PX;
  cv.height = SPRITE_PX;
  const ctx = cv.getContext("2d");
  if (ctx) {
    const mid = SPRITE_PX / 2;
    const { r, g, b } = hexToRgb(color);
    const rgba = (a: number): string => `rgba(${r},${g},${b},${a})`;
    const grad = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    grad.addColorStop(0, rgba(1));
    grad.addColorStop(0.18, rgba(0.85));
    grad.addColorStop(0.42, rgba(0.35));
    grad.addColorStop(0.7, rgba(0.1));
    grad.addColorStop(1, rgba(0));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
  }
  spriteCache.set(color, cv);
  return cv;
}

/** Additive bloom centred on (x, y); `size` is the drawn diameter in CSS px. */
export function drawMarkerBloom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
): void {
  const sprite = spriteFor(color);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}
