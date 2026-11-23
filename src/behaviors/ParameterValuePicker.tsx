import { BehaviorParameterValueDescription } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import { HidUsagePicker } from "./HidUsagePicker";

export interface ParameterValuePickerProps {
  value?: number;
  values: BehaviorParameterValueDescription[];
  layers: { id: number; name: string }[];
  onValueChanged: (value?: number) => void;
  isDisabled?: boolean;
}

export const ParameterValuePicker = ({
  value,
  values,
  layers,
  onValueChanged,
  isDisabled = false,
}: ParameterValuePickerProps) => {
  if (values.length == 0) {
    return <></>;
  } else if (values.every((v) => v.constant !== undefined)) {
    return (
      <div className="flex items-center gap-1.5">
        <select
          value={value ?? ""}
          disabled={isDisabled}
          className="h-8 px-2 text-sm rounded bg-base-100 border border-base-300 disabled:opacity-50"
          onChange={(e) => onValueChanged(parseInt(e.target.value, 10))}
        >
          {values.map((v) => (
            <option key={v.constant} value={v.constant}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
    );
  } else if (values.length == 1) {
    if (values[0].range) {
      return (
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium opacity-80">{values[0].name}:</label>
          <input
            type="number"
            disabled={isDisabled}
            min={values[0].range.min}
            max={values[0].range.max}
            value={value ?? 0}
            className="h-8 w-24 px-2 text-sm rounded bg-base-100 border border-base-300 disabled:opacity-50"
            onChange={(e) => onValueChanged(parseInt(e.target.value, 10))}
          />
        </div>
      );
    } else if (values[0].hidUsage) {
      return (
        <HidUsagePicker
          isDisabled={isDisabled}
          onValueChanged={onValueChanged}
          label={values[0].name}
          value={value}
          usagePages={[
            { id: 7, min: 4, max: values[0].hidUsage.keyboardMax },
            { id: 12, max: values[0].hidUsage.consumerMax },
          ]}
        />
      );
    } else if (values[0].layerId) {
      return (
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium opacity-80">{values[0].name}:</label>
          <select
            value={value ?? 0}
            disabled={isDisabled}
            className="h-8 px-2 text-sm rounded bg-base-100 border border-base-300 disabled:opacity-50"
            onChange={(e) => onValueChanged(parseInt(e.target.value, 10))}
          >
            {layers.map(({ name, id }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      );
    }
  } else {
    return (
      <div className="text-xs px-2 py-1 rounded bg-amber-950/30 border border-amber-500/40 text-amber-200">
        Composite parameter set detected — use the Raw Inspector toggle to inspect or edit safely without data loss.
      </div>
    );
  }

  return <></>;
};
