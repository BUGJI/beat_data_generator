import type { InjectionKey } from "vue";

export type DropdownSelect = (value: string) => void;

export const DROPDOWN_SELECT: InjectionKey<DropdownSelect> =
  Symbol("bdg-dropdown-select");
