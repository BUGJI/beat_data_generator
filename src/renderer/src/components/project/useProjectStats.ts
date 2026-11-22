import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  contentEndMs,
  formatTime,
  tempoMap,
  timeOfBeat,
} from "../../services/timeline";
import { markerCount, useProjectStore } from "../../stores/project";
import { useSettingsStore } from "../../stores/settings";
import { useTransportStore } from "../../stores/transport";
import { useViewStore } from "../../stores/view";

/**
 * Read-only labels shown in the project bar's stat chips and follow button.
 * Kept in one composable so the component template only binds values and the
 * formatting does not run inline on every render.
 */
export function useProjectStats() {
  const { t } = useI18n();
  const transport = useTransportStore();
  const settings = useSettingsStore();
  const view = useViewStore();

  const hasAudio = computed(() => transport.hasAudio);

  const durationLabel = computed(() =>
    hasAudio.value ? formatTime(contentEndMs()) : "--:--.---",
  );

  const sampleRateLabel = computed(() =>
    transport.wave
      ? `${(transport.wave.sampleRate / 1000).toFixed(1)} kHz`
      : "-",
  );

  const barMsLabel = computed(() => {
    const m = tempoMap();
    return `${(m.timeOfBeat(1) - m.timeOfBeat(0)).toFixed(1)} ms/${m.bpmAtBeat(0).toFixed(1)} BPM`;
  });

  const lastBeatLabel = computed(() => {
    // "Visible" markers are those on beat tracks that are not hidden. Each
    // track list is sorted, so only the last entry per track can be the latest;
    // this keeps the label cheap even with thousands of markers.
    const project = useProjectStore();
    let maxBeat = -Infinity;
    for (const track of project.tracks) {
      if (track.hidden) continue;
      if (track.type && track.type !== "beat") continue;
      const list = project.markersByTrack.get(track.id);
      const last = list?.[list.length - 1];
      if (last && last.beat > maxBeat) maxBeat = last.beat;
    }
    if (maxBeat === -Infinity) return "--:--.---";
    return formatTime(timeOfBeat(maxBeat));
  });

  const markersLabel = computed(() => String(markerCount()));
  const zoomLabel = computed(() => `${view.pxPerSec.toFixed(1)} px/s`);
  const followPctLabel = computed(() => `${settings.settings.followPercent}%`);

  const followOn = computed(() =>
    transport.playing ? transport.followActive : transport.followManual,
  );
  const followTip = computed(() => {
    if (transport.playing)
      return transport.followActive
        ? t("follow.onTip")
        : t("follow.offPlayTip");
    return t("follow.stopTip");
  });

  return {
    hasAudio,
    durationLabel,
    sampleRateLabel,
    barMsLabel,
    lastBeatLabel,
    markersLabel,
    zoomLabel,
    followPctLabel,
    followOn,
    followTip,
  };
}
