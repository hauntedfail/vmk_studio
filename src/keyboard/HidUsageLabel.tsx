import { hid_usage_get_labels } from "../hid-usages";
import { decodeHidUsageWithMods } from "../vmk/customBehaviors";

export interface HidUsageLabelProps {
  hid_usage: number;
}

function remove_prefix(s?: string) {
  return s?.replace(/^Keyboard /, "");
}

export const HidUsageLabel = ({ hid_usage }: HidUsageLabelProps) => {
  const decoded = decodeHidUsageWithMods(hid_usage);
  const labels = hid_usage_get_labels(decoded.page, decoded.id);
  const modPrefix =
    decoded.modLabels.length > 0 ? `${decoded.modLabels.join("")}+` : "";

  const shortText = remove_prefix(labels.short);
  const medText = remove_prefix(labels.med || labels.short);
  const longText = remove_prefix(labels.long || labels.med || labels.short);

  if (!shortText && !medText && !longText) {
    return null;
  }

  return (
    <span
      className="text-xs leading-tight text-center px-0.5 truncate max-w-full @[10em]:before:content-[attr(data-long-content)] @[6em]:before:content-[attr(data-med-content)] before:content-[attr(aria-label)]"
      aria-label={`${modPrefix}${shortText ?? ""}`}
      data-med-content={`${modPrefix}${medText ?? ""}`}
      data-long-content={`${modPrefix}${longText ?? ""}`}
    />
  );
};
