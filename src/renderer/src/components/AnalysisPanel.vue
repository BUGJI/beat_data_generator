<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { store } from "../store";
import {
  analysis,
  applyDetectedBpm,
  generateBeatMarkers,
  analyzeCurrent,
  startLiveBpm,
  stopLiveBpm,
} from "../analysis";

const { t } = useI18n();

const canvas = ref<HTMLCanvasElement | null>(null);
let cw = 0;
let ch = 0;

function fmtSec(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "--";
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(2);
  return `${m}:${sec.padStart(5, "0")}`;
}

const detected = computed(() =>
  analysis.bpm ? analysis.bpm.toFixed(1) : "--",
);
const live = computed(() =>
  analysis.liveBpm ? analysis.liveBpm.toFixed(1) : "--",
);
const hasAudio = computed(() => store.ui.hasAudio);
const showSpectrum = computed(
  () => store.ui.settings.audioSpectrum && !!analysis.spectrum,
);
const loopText = computed(() => {
  if (analysis.loopStart === null || analysis.loopEnd === null)
    return t("settings.audio.loopNone");
  const conf =
    analysis.loopConfidence === null
      ? ""
      : ` · ${t("settings.audio.confidence")} ${(
          analysis.loopConfidence * 100
        ).toFixed(0)}%`;
  return `${fmtSec(analysis.loopStart)} → ${fmtSec(analysis.loopEnd)}${conf}`;
});

let colors: string[] = [];
function buildRamp(): string[] {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [13, 17, 24]],
    [0.25, [15, 55, 106]],
    [0.5, [16, 141, 200]],
    [0.75, [56, 189, 248]],
    [1, [240, 249, 255]],
  ];
  const out: string[] = [];
  for (let i = 0; i < 96; i++) {
    const x = i / 95;
    let lo = stops[0]!;
    let hi = stops[stops.length - 1]!;
    for (let s = 0; s < stops.length - 1; s++) {
      if (x >= stops[s]![0] && x <= stops[s + 1]![0]) {
        lo = stops[s]!;
        hi = stops[s + 1]!;
        break;
      }
    }
    const f = (x - lo[0]) / (hi[0] - lo[0] || 1);
    const rgb: number[] = lo[1].map((c, k) =>
      Math.round(c + (hi[1][k] - c) * Math.max(0, Math.min(1, f))),
    );
    out.push(`rgb(${rgb.join(",")})`);
  }
  return out;
}

function drawSpectrum(): void {
  const el = canvas.value;
  const mel = analysis.spectrum;
  if (!el || !mel || mel.length === 0) return;
  const ctx = el.getContext("2d");
  if (!ctx) return;
  if (colors.length === 0) colors = buildRamp();
  const w = el.clientWidth || 300;
  const h = el.clientHeight || 160;
  if (w !== cw || h !== ch) {
    cw = w;
    ch = h;
    el.width = w;
    el.height = h;
  }
  const nMels = mel.length;
  const nFrames = mel[0]?.length ?? 0;
  if (nFrames === 0) {
    ctx.clearRect(0, 0, w, h);
    return;
  }
  const img = ctx.createImageData(w, h);
  // downsample columns/rows to canvas resolution
  for (let px = 0; px < w; px++) {
    const fi = Math.floor((px / w) * nFrames);
    for (let py = 0; py < h; py++) {
      const ri = Math.floor((1 - py / h) * (nMels - 1));
      const v = mel[ri]?.[fi] ?? 0;
      const db = 20 * Math.log10(v + 1e-6);
      const norm = Math.max(0, Math.min(1, (db + 80) / 90));
      const ci = Math.min(95, Math.floor(norm * 96));
      const [r, g, b] = colors[ci]!
        .match(/\d+/g)!
        .map((x) => Number(x));
      const idx = (py * w + px) * 4;
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

async function onReanalyze(): Promise<void> {
  await analyzeCurrent();
}

function onGenerateBeats(): void {
  generateBeatMarkers();
}

function onApplyBpm(): void {
  applyDetectedBpm();
}

function close(): void {
  store.ui.analysisOpen = false;
}

watch(
  () => [showSpectrum.value, analysis.spectrumKey] as const,
  () => {
    if (showSpectrum.value) drawSpectrum();
  },
);

function onResize(): void {
  if (showSpectrum.value) drawSpectrum();
}

onMounted(() => {
  startLiveBpm();
  window.addEventListener("resize", onResize);
});
onBeforeUnmount(() => {
  stopLiveBpm();
  window.removeEventListener("resize", onResize);
});
</script>

<template>
  <teleport to="body">
    <div v-if="store.ui.analysisOpen" class="ana-mask" @click.self="close">
      <div class="ana-win">
        <header class="ana-head">
          <span class="ana-title">{{ t("settings.cats.audio") }}</span>
          <button class="ana-x" @click="close">✕</button>
        </header>

        <div v-if="!hasAudio" class="ana-empty">
          {{ t("settings.audio.noAudio") }}
        </div>

        <div v-else class="ana-body">
          <div class="ana-row">
            <span class="ana-label">{{ t("settings.audio.detectedBpm") }}</span>
            <span class="ana-value num">{{ detected }}</span>
            <el-button size="small" :disabled="!analysis.bpm" @click="onApplyBpm">
              {{ t("settings.audio.applyBpm") }}
            </el-button>
          </div>

          <div class="ana-row">
            <span class="ana-label">{{ t("settings.audio.liveBpmTitle") }}</span>
            <span class="ana-value num live">{{ live }}</span>
          </div>

          <div class="ana-row">
            <span class="ana-label">{{ t("settings.audio.loopTitle") }}</span>
            <span class="ana-value num">{{ loopText }}</span>
          </div>

          <div class="ana-actions">
            <el-button size="small" :loading="analysis.analyzing" @click="onReanalyze">
              {{ t("settings.audio.reanalyze") }}
            </el-button>
            <el-button size="small" :disabled="!analysis.beats.length" @click="onGenerateBeats">
              {{ t("settings.audio.genBeats") }}
            </el-button>
          </div>

          <div class="ana-spectrum">
            <div class="ana-sub">{{ t("settings.audio.spectrumTitle") }}</div>
            <canvas
              v-if="showSpectrum"
              ref="canvas"
              class="ana-canvas"
            />
            <div v-else class="ana-spectrum-empty">
              {{ t("settings.audio.spectrumHint") }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.ana-mask {
  position: fixed;
  inset: 0;
  z-index: 45;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 56px 16px 16px;
  pointer-events: none;
}
.ana-win {
  pointer-events: auto;
  width: 360px;
  max-width: 92vw;
  background: #161b23;
  border: 1px solid var(--bdg-border-strong);
  border-radius: 12px;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.ana-head {
  flex: none;
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--bdg-border);
}
.ana-title {
  font-weight: 700;
  font-size: 13px;
}
.ana-x {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-size: 12px;
}
.ana-x:hover {
  color: var(--bdg-text);
}
.ana-empty {
  padding: 20px;
  color: var(--bdg-text-dim);
  font-size: 12px;
}
.ana-body {
  padding: 12px 14px 14px;
  max-height: 70vh;
  overflow: auto;
}
.ana-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--bdg-border);
}
.ana-label {
  flex: 1;
  font-size: 12px;
  color: var(--bdg-text-dim);
}
.ana-value {
  font-size: 13px;
  font-weight: 700;
  min-width: 76px;
  text-align: right;
}
.ana-value.live {
  color: var(--bdg-accent);
}
.ana-actions {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.ana-spectrum {
  border: 1px solid var(--bdg-border);
  border-radius: 8px;
  overflow: hidden;
}
.ana-sub {
  font-size: 11px;
  color: var(--bdg-text-dim);
  padding: 6px 8px;
  background: rgba(148, 163, 184, 0.05);
  border-bottom: 1px solid var(--bdg-border);
}
.ana-canvas {
  display: block;
  width: 100%;
  height: 168px;
}
.ana-spectrum-empty {
  padding: 16px;
  font-size: 12px;
  color: var(--bdg-text-dim);
}
</style>
