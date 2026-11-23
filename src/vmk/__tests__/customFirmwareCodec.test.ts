import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseLeftOverlayGates,
  updateLeftOverlayGates,
  parseCustomCFeatures,
  updateCustomCFeatures,
  parseHelperSmoother,
  updateHelperSmoother,
} from "../customFirmwareCodec";

const SAMPLE_LEFT_OV = `
&trackpad_listener {
    status = "okay";
};

&zip_zoom_mapper {
    status = "okay";
};

&two_finger_double_tap {
    status = "okay";
};
`;

const SAMPLE_CG_ZOOM = `
static uint32_t cg_zoom_standard_keycode(enum cg_zoom_direction direction) {
    return direction == CG_ZOOM_IN ? LC(EQUAL) : LC(MINUS);
}
static const uint32_t CG_ZOOM_MARKER = F20;
static const uint32_t CG_SMART_ZOOM_MARKER = F19;
`;

const SAMPLE_CG_NAV = `
static uint32_t cg_nav_encoded_keycode(enum cg_nav_direction direction) {
    bool mac_mode = cg_toggle_is_enabled();

    if (direction == CG_NAV_BACK) {
        return mac_mode ? APPLY_MODS(MOD_LCTL, LEFT_BRACKET) : APPLY_MODS(MOD_LALT, LEFT);
    }

    return mac_mode ? APPLY_MODS(MOD_LCTL, RIGHT_BRACKET) : APPLY_MODS(MOD_LALT, RIGHT);
}
`;

const SAMPLE_SMOOTHER = `
public enum Sensitivity: String, CaseIterable, Sendable {
    case low, medium, high

    public var stepMagnification: Double {
        switch self {
        case .low: return 0.05
        case .medium: return 0.08
        case .high: return 0.12
        }
    }
}

public struct ZoomSmoother: Sendable {
    public init(stepMagnification: Double = Sensitivity.medium.stepMagnification,
                easing: Double = 0.35, smallestFrame: Double = 0.002, endDelay: Double = 0.25) {
`;

describe("customFirmwareCodec", () => {
  it("parses and updates toucan_left.overlay feature gates", () => {
    const gates = parseLeftOverlayGates(SAMPLE_LEFT_OV);
    expect(gates).toEqual({
      trackpadListenerEnabled: true,
      zipZoomMapperEnabled: true,
      twoFingerDoubleTapEnabled: true,
    });

    const updated = updateLeftOverlayGates(SAMPLE_LEFT_OV, {
      trackpadListenerEnabled: true,
      zipZoomMapperEnabled: false,
      twoFingerDoubleTapEnabled: false,
    });
    expect(parseLeftOverlayGates(updated)).toEqual({
      trackpadListenerEnabled: true,
      zipZoomMapperEnabled: false,
      twoFingerDoubleTapEnabled: false,
    });
  });

  it("parses and surgically updates cg_zoom.c and cg_nav.c custom keycodes", () => {
    const parsed = parseCustomCFeatures(SAMPLE_CG_ZOOM, SAMPLE_CG_NAV);
    expect(parsed).toEqual({
      zoomMarkerKey: "F20",
      smartZoomMarkerKey: "F19",
      zoomInChord: "LC(EQUAL)",
      zoomOutChord: "LC(MINUS)",
      navMacBackMod: "MOD_LCTL",
      navMacBackKey: "LEFT_BRACKET",
      navMacForwardMod: "MOD_LCTL",
      navMacForwardKey: "RIGHT_BRACKET",
      navWinBackMod: "MOD_LALT",
      navWinBackKey: "LEFT",
      navWinForwardMod: "MOD_LALT",
      navWinForwardKey: "RIGHT",
    });

    const updated = updateCustomCFeatures(SAMPLE_CG_ZOOM, SAMPLE_CG_NAV, {
      ...parsed,
      zoomMarkerKey: "F21",
      smartZoomMarkerKey: "F18",
      zoomInChord: "LC(PLUS)",
      navMacBackKey: "LEFT",
    });

    const reparsed = parseCustomCFeatures(updated.cgZoomC, updated.cgNavC);
    expect(reparsed.zoomMarkerKey).toBe("F21");
    expect(reparsed.smartZoomMarkerKey).toBe("F18");
    expect(reparsed.zoomInChord).toBe("LC(PLUS)");
    expect(reparsed.navMacBackKey).toBe("LEFT");
  });

  it("parses and updates Toucan 2 Helper ZoomSmoother.swift tuning", () => {
    const parsed = parseHelperSmoother(SAMPLE_SMOOTHER);
    expect(parsed).toEqual({
      lowStep: 0.05,
      mediumStep: 0.08,
      highStep: 0.12,
      easing: 0.35,
      smallestFrame: 0.002,
      endDelay: 0.25,
    });

    const updated = updateHelperSmoother(SAMPLE_SMOOTHER, {
      ...parsed!,
      mediumStep: 0.1,
      easing: 0.42,
      endDelay: 0.2,
    });
    const reparsed = parseHelperSmoother(updated);
    expect(reparsed?.mediumStep).toBe(0.1);
    expect(reparsed?.easing).toBe(0.42);
    expect(reparsed?.endDelay).toBe(0.2);
  });

  it("round-trips real Toucan 2 firmware C & Swift files cleanly without drift", () => {
    const repo = "/Users/vvx/Documents/deepseek-harness/default-workspace/toucan2-cg-toggle";
    if (!fs.existsSync(repo)) return;

    const leftOv = fs.readFileSync(
      path.join(repo, "boards/shields/toucan/toucan_left.overlay"),
      "utf8"
    );
    const gates = parseLeftOverlayGates(leftOv);
    expect(gates.twoFingerDoubleTapEnabled).toBe(true);
    expect(updateLeftOverlayGates(leftOv, gates)).toBe(leftOv);

    const zoomC = fs.readFileSync(path.join(repo, "src/cg_zoom.c"), "utf8");
    const navC = fs.readFileSync(path.join(repo, "src/cg_nav.c"), "utf8");
    const feats = parseCustomCFeatures(zoomC, navC);
    expect(feats.zoomMarkerKey).toBe("F20");
    expect(feats.smartZoomMarkerKey).toBe("F19");
    const rt = updateCustomCFeatures(zoomC, navC, feats);
    expect(rt.cgZoomC).toBe(zoomC);
    expect(rt.cgNavC).toBe(navC);

    const smoother = fs.readFileSync(
      path.join(repo, "host/macos/Sources/Core/ZoomSmoother.swift"),
      "utf8"
    );
    const sm = parseHelperSmoother(smoother);
    expect(sm?.mediumStep).toBe(0.08);
    expect(parseHelperSmoother(updateHelperSmoother(smoother, sm!))).toEqual(sm);
  });
});
