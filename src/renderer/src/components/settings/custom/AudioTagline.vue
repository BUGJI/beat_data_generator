<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

<template>
  <p class="muted audio-tagline">{{ t("settings.audio.tagline") }}</p>
</template>

<style scoped>
.audio-tagline {
  margin: -6px 0 4px;
}
</style>
