<script setup lang="ts">
import {
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from "reka-ui";

withDefaults(
  defineProps<{
    content?: string;
    side?: "top" | "bottom" | "left" | "right";
    delay?: number;
  }>(),
  { side: "bottom", delay: 250 },
);
</script>

<template>
  <TooltipProvider :delay-duration="delay">
    <TooltipRoot>
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          :side="side"
          :side-offset="6"
          class="z-[200] rounded-ui border border-line-strong bg-menu px-2 py-1 text-[11px] whitespace-nowrap text-fg shadow-xl"
        >
          {{ content }}
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
