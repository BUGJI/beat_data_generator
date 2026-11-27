import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  contentEndMs,
  formatTime,
  tempoMap,
  timeOfBeat,
} from "../../services/timeline";
import { markerCount, visibleMarkers } from "../../stores/project";
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
    const markers = visibleMarkers();
    if (markers.length === 0) return "--:--.---";
    const last = markers.reduce(
      (max, m) => Math.max(max, timeOfBeat(m.beat)),
      Number.NEGATIVE_INFINITY,
    );
    return formatTime(last);
  });

  const markersLabel = computed(() => String(markerCount()));
  const zoomLabel = computed(() => `${view.pxPerSec.toFixed(1)} px/s`);
  const followPctLabel = computed(() => `${settings.settings.followPercent}%`);
  /** The readout chip shows the percent in smooth mode, the step size in step mode. */
  const followValueLabel = computed(() =>
    settings.settings.followMode === "step"
      ? t("follow.stepValue", { beats: settings.settings.followStepBeats })
      : followPctLabel.value,
  );
  const followValueTip = computed(() =>
    settings.settings.followMode === "step"
      ? t("follow.stepTip", { beats: settings.settings.followStepBeats })
      : settings.settings.followMode === "page"
        ? t("follow.pageTip")
        : t("follow.pctTip"),
  );

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
    followValueLabel,
    followValueTip,
    followOn,
    followTip,
  };
}
