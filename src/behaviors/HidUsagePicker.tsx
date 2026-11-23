import {
  Button,
  Checkbox,
  CheckboxGroup,
  Collection,
  ComboBox,
  Header,
  Input,
  Key,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Section,
} from "react-aria-components";
import {
  hid_usage_from_page_and_id,
  hid_usage_page_get_ids,
} from "../hid-usages";
import {
  decodeHidUsageWithMods,
  encodeHidUsageWithMods,
} from "../vmk/customBehaviors";
import { useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";

export interface HidUsagePage {
  id: number;
  min?: number;
  max?: number;
}

export interface HidUsagePickerProps {
  label?: string;
  value?: number;
  usagePages: HidUsagePage[];
  onValueChanged: (value?: number) => void;
  isDisabled?: boolean;
}

type UsageSectionProps = HidUsagePage;

const UsageSection = ({ id, min, max }: UsageSectionProps) => {
  const info = useMemo(() => hid_usage_page_get_ids(id), [id]);

  const usages = useMemo(() => {
    let list = info?.UsageIds || [];
    if (max || min) {
      list = list.filter(
        (i) =>
          (i.Id <= (max || Number.MAX_SAFE_INTEGER) && i.Id >= (min || 0)) ||
          (id === 7 && i.Id >= 0xe0 && i.Id <= 0xe7)
      );
    }

    return list;
  }, [id, min, max, info]);

  return (
    <Section id={id}>
      <Header className="text-base-content/50 text-xs font-semibold px-1 py-0.5">
        {info?.Name}
      </Header>
      <Collection items={usages}>
        {(i) => (
          <ListBoxItem
            className="rac-hover:bg-base-300 pl-4 pr-2 py-0.5 text-sm relative rac-focus:bg-base-300 cursor-default select-none rac-selected:before:content-['✔'] before:absolute before:left-[2px] before:top-[2px]"
            id={hid_usage_from_page_and_id(id, i.Id)}
          >
            {i.Name}
          </ListBoxItem>
        )}
      </Collection>
    </Section>
  );
};

enum Mods {
  LeftControl = 0x01,
  LeftShift = 0x02,
  LeftAlt = 0x04,
  LeftGUI = 0x08,
  RightControl = 0x10,
  RightShift = 0x20,
  RightAlt = 0x40,
  RightGUI = 0x80,
}

const mod_labels: Record<Mods, string> = {
  [Mods.LeftControl]: "L Ctrl",
  [Mods.LeftShift]: "L Shift",
  [Mods.LeftAlt]: "L Alt",
  [Mods.LeftGUI]: "L GUI",
  [Mods.RightControl]: "R Ctrl",
  [Mods.RightShift]: "R Shift",
  [Mods.RightAlt]: "R Alt",
  [Mods.RightGUI]: "R GUI",
};

const all_mods = [
  Mods.LeftControl,
  Mods.LeftShift,
  Mods.LeftAlt,
  Mods.LeftGUI,
  Mods.RightControl,
  Mods.RightShift,
  Mods.RightAlt,
  Mods.RightGUI,
];

function mods_to_flags(mods: Mods[]): number {
  return mods.reduce((a, v) => a | v, 0);
}

export const HidUsagePicker = ({
  label,
  value,
  usagePages,
  onValueChanged,
  isDisabled = false,
}: HidUsagePickerProps) => {
  const decoded = useMemo(
    () => (value !== undefined ? decodeHidUsageWithMods(value) : undefined),
    [value]
  );

  const mods = useMemo(() => {
    const flags = decoded?.modMask ?? 0;
    return all_mods.filter((m) => (m & flags) !== 0).map((m) => m.toString());
  }, [decoded]);

  const selectionChanged = useCallback(
    (e: Key | null) => {
      if (isDisabled) return;
      const base = typeof e === "number" ? e : undefined;
      if (base !== undefined) {
        const modFlags = mods_to_flags(mods.map((m) => parseInt(m, 10)));
        onValueChanged(encodeHidUsageWithMods(base, modFlags));
      } else {
        onValueChanged(undefined);
      }
    },
    [onValueChanged, mods, isDisabled]
  );

  const modifiersChanged = useCallback(
    (m: string[]) => {
      if (isDisabled || !value) {
        return;
      }
      const modFlags = mods_to_flags(m.map((v) => parseInt(v, 10)));
      const newVal = encodeHidUsageWithMods(value, modFlags);
      onValueChanged(newVal);
    },
    [value, onValueChanged, isDisabled]
  );

  return (
    <div className="flex flex-wrap items-center gap-2 relative">
      {label && (
        <Label id="hid-usage-picker" className="text-xs font-medium opacity-80">
          {label}:
        </Label>
      )}
      <ComboBox
        isDisabled={isDisabled}
        selectedKey={decoded && decoded.baseUsage !== 0 ? decoded.baseUsage : null}
        onSelectionChange={selectionChanged}
        aria-labelledby="hid-usage-picker"
      >
        <div className="flex">
          <Input className="px-2 py-1 text-sm rounded-l bg-base-100 border border-base-300 disabled:opacity-50" />
          <Button className="rounded-r bg-primary text-primary-content w-8 h-8 flex justify-center items-center disabled:opacity-50">
            <ChevronDown className="size-4" />
          </Button>
        </div>
        <Popover className="w-[max(var(--trigger-width),16rem)] shadow-xl text-base-content rounded border border-base-300 bg-base-100 z-50">
          <ListBox
            items={usagePages}
            className="block max-h-[30vh] min-h-[unset] overflow-auto p-2"
            selectionMode="single"
          >
            {({ id, min, max }) => <UsageSection id={id} min={min} max={max} />}
          </ListBox>
        </Popover>
      </ComboBox>
      <CheckboxGroup
        isDisabled={isDisabled}
        aria-label="Implicit Modifiers"
        className="grid grid-flow-col gap-x-px auto-cols-[minmax(min-content,1fr)] content-stretch divide-x divide-base-200 rounded-md overflow-hidden"
        value={mods}
        onChange={modifiersChanged}
      >
        {all_mods.map((m) => (
          <Checkbox
            key={m}
            value={m.toString()}
            className="text-xs text-nowrap cursor-pointer grid px-2 py-1 content-center justify-center rac-selected:bg-primary bg-base-300 hover:bg-base-100 rac-selected:text-primary-content rac-disabled:opacity-50 rac-disabled:cursor-not-allowed"
          >
            {mod_labels[m]}
          </Checkbox>
        ))}
      </CheckboxGroup>
    </div>
  );
};
