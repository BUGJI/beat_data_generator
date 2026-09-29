/**
 * Shared model for the declarative settings rows.
 *
 * Each category is described once as a list of `RowDef`s; the category section
 * renders them and the search index is derived from the same list, so the two
 * cannot drift.
 */

export type CatKey =
  | "general"
  | "edit"
  | "audio"
  | "display"
  | "theme"
  | "shortcuts"
  | "plugins"
  | "network"
  | "advanced"
  | "about";

export type ColOption = { value: string; label: string };
export type RefLike<T> = { value: T };

export type FieldControl =
  | {
      type: "switch";
      get: () => boolean;
      set: (v: boolean) => void;
      disabled?: () => boolean;
    }
  | {
      type: "radio";
      get: () => string;
      set: (v: string) => void;
      options: () => ColOption[];
    }
  | {
      type: "number";
      get: () => number;
      set: (v: number) => void;
      min?: () => number | undefined;
      max?: () => number | undefined;
      step?: number;
      unitKey?: string;
    }
  | {
      type: "slider";
      get: () => number;
      set: (v: number) => void;
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    };

export type RowDef =
  | { kind: "subhead"; key: string }
  | { kind: "custom"; id: string; searchKey?: string }
  | {
      kind: "field";
      key: string;
      col?: boolean;
      showIf?: () => boolean;
      /** Hidden while simple mode is on. */
      expert?: boolean;
      control: FieldControl;
    };

export type GroupDef = { key: string; rows: RowDef[]; expert?: boolean };

export const sw = (
  m: RefLike<boolean>,
  disabled?: () => boolean,
): FieldControl => ({
  type: "switch",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  disabled,
});

export const radio = (
  m: RefLike<string>,
  options: () => ColOption[],
): FieldControl => ({
  type: "radio",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  options,
});

export const num = (
  m: RefLike<number>,
  opts: {
    min?: () => number | undefined;
    max?: () => number | undefined;
    step?: number;
    unitKey?: string;
  } = {},
): FieldControl => ({
  type: "number",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  ...opts,
});

export const slider = (
  m: RefLike<number>,
  min: number,
  max: number,
  suffix?: string,
  step?: number,
): FieldControl => ({
  type: "slider",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  min,
  max,
  suffix,
  step,
});

// Typed setters: the discriminated union can't be narrowed inside a template
// event handler, so dispatch through these helpers.
export function setSwitch(c: FieldControl, v: boolean): void {
  if (c.type === "switch") c.set(v);
}
export function setRadio(c: FieldControl, v: string): void {
  if (c.type === "radio") c.set(v);
}
export function setNumber(c: FieldControl, v: number): void {
  if (c.type === "number" || c.type === "slider") c.set(v);
}
