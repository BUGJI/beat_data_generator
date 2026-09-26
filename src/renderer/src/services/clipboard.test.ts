import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  addMarker,
  addTrack,
  updateMarkerAttrs,
  useProjectStore,
} from "../stores/project";
import { selectSingleMarker } from "../stores/selection";
import { registerTrackType, typeKeyOf } from "../plugins/registry";
import { copyMarkerGroup, pasteMarkerGroup } from "./clipboard";

let seq = 0;

function typedTrackKey(): string {
  const id = `clip-test-${seq++}`;
  registerTrackType(id, {
    id: "flip",
    trackName: "Flip",
    pointName: "Flip",
    fields: [
      {
        key: "direction",
        label: "Direction",
        type: "enum",
        default: "up",
        options: [
          { value: "up", label: "Up" },
          { value: "down", label: "Down" },
        ],
      },
      { key: "power", label: "Power", type: "number", default: 1 },
    ],
  });
  return typeKeyOf(id, "flip");
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("copyMarkerGroup / pasteMarkerGroup", () => {
  it("copies plugin attribute values onto pasted markers", () => {
    const p = useProjectStore();
    const track = addTrack("T", false, typedTrackKey());
    const marker = addMarker(track.id, 1);
    expect(marker).not.toBeNull();
    updateMarkerAttrs(marker!.id, { direction: "down", power: 5 });

    selectSingleMarker(marker!.id);
    expect(copyMarkerGroup()).toBe(true);

    p.markers = [];
    expect(pasteMarkerGroup()).toBe(true);
    expect(p.markers[0]?.attrs).toEqual({ direction: "down", power: 5 });
  });
});
