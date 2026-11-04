import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from "vue";

const CARD_Y_OFFSET = 10;
const CARD_MARGIN = 8;

/**
 * Positions the floating property card inside the timeline and owns the
 * pointer-drag handle. The anchor is the screen point where the card should
 * open; the card flips above the anchor when there is no room below.
 */
export function usePropCardPosition(
  anchor: Ref<{ x: number; y: number }>,
  cardEl: Ref<HTMLElement | null>,
) {
  const cardPos = ref({ x: 0, y: 0 });
  const anchorPos = ref({ x: 0, y: 0 });

  function positionCard(): void {
    const el = cardEl.value;
    const root = el?.parentElement;
    if (!el || !root) return;
    const vw = root.clientWidth;
    const vh = root.clientHeight;
    if (vh <= 0) return;
    const avail = Math.max(0, vh - CARD_MARGIN * 2);
    el.style.maxHeight = `${avail}px`;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const a = anchorPos.value;
    const x = Math.max(CARD_MARGIN, Math.min(a.x, vw - w - CARD_MARGIN));
    let y = a.y + CARD_Y_OFFSET;
    if (y + h > vh - CARD_MARGIN) {
      const above = a.y - CARD_Y_OFFSET - h;
      y =
        above >= CARD_MARGIN
          ? above
          : Math.max(CARD_MARGIN, vh - h - CARD_MARGIN);
    }
    cardPos.value = { x, y };
  }

  watch(
    () => [anchor.value.x, anchor.value.y],
    ([x, y]) => {
      anchorPos.value = { x: x!, y: y! };
      cardPos.value = {
        x: Math.max(CARD_MARGIN, x!),
        y: Math.max(CARD_MARGIN, y! + CARD_Y_OFFSET),
      };
      void nextTick(positionCard);
    },
  );

  let cardRo: ResizeObserver | null = null;
  watch(cardEl, (el) => {
    cardRo?.disconnect();
    cardRo = null;
    if (!el) return;
    cardRo = new ResizeObserver(() => positionCard());
    cardRo.observe(el);
    void nextTick(positionCard);
  });

  let cardDragging = false;
  let cardDragOffset = { x: 0, y: 0 };

  function startCardDrag(e: PointerEvent): void {
    if (e.button !== 0) return;
    const el = cardEl.value;
    const root = el?.parentElement;
    if (!el || !root) return;
    if ((e.target as HTMLElement).closest(".pc-x")) return;
    const rect = root.getBoundingClientRect();
    cardDragging = true;
    cardDragOffset = {
      x: e.clientX - rect.left - cardPos.value.x,
      y: e.clientY - rect.top - cardPos.value.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onCardDrag(e: PointerEvent): void {
    if (!cardDragging) return;
    const el = cardEl.value;
    const root = el?.parentElement;
    if (!el || !root) return;
    const rect = root.getBoundingClientRect();
    const maxX = Math.max(
      CARD_MARGIN,
      root.clientWidth - el.offsetWidth - CARD_MARGIN,
    );
    const maxY = Math.max(
      CARD_MARGIN,
      root.clientHeight - el.offsetHeight - CARD_MARGIN,
    );
    const x = Math.min(
      Math.max(CARD_MARGIN, e.clientX - rect.left - cardDragOffset.x),
      maxX,
    );
    const y = Math.min(
      Math.max(CARD_MARGIN, e.clientY - rect.top - cardDragOffset.y),
      maxY,
    );
    cardPos.value = { x, y };
    // keep the anchor in sync so positionCard() (resize/reflow) won't snap back
    anchorPos.value = { x, y: y - CARD_Y_OFFSET };
  }

  function endCardDrag(e: PointerEvent): void {
    if (!cardDragging) return;
    cardDragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  function onResize(): void {
    positionCard();
  }

  onMounted(() => window.addEventListener("resize", onResize));
  onBeforeUnmount(() => {
    window.removeEventListener("resize", onResize);
    cardRo?.disconnect();
  });

  return {
    cardPos,
    startCardDrag,
    onCardDrag,
    endCardDrag,
  };
}
