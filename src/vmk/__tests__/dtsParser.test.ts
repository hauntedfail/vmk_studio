import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  parseCustomBehaviors,
  parseHoldTapTuning,
  updateHoldTapTuning,
  parseTrackpadHardware,
  updateTrackpadHardware,
  parseTrackpadProcessors,
  updateTrackpadProcessors,
  parseConfTuning,
  updateConfTuning,
  parseKeymapLayers,
} from "../dtsParser";

const SAMPLE_CG_DTSI = `
/ {
    behaviors {
        cg_toggle: cg_toggle {
            compatible = "zmk,behavior-cg-toggle";
            #binding-cells = <0>;
            toggle-mode = "flip";
            display-name = "Toggle Ctrl GUI";
        };

        cg_smart_zoom: cg_smart_zoom {
            compatible = "zmk,behavior-cg-zoom";
            #binding-cells = <0>;
            direction = "smart";
            display-name = "Smart Zoom";
        };
    };
};
`;

const SAMPLE_KEYMAP = `
/ {
    keymap {
        compatible = "zmk,keymap";

        base {
            display-name = "BASE";
            bindings = <
                &kp TAB &kp Q &mt LGUI BSPC
                &cg_toggle &mo 1 &kp SPACE
            >;
        };

        extra_2 {
            status = "reserved";
        };
    };
};

/* Comment preserved */
&mt {
    quick-tap-ms = <200>;
};
`;

const SAMPLE_RIGHT_OVERLAY = `
&i2c0 {
    tps43_trackpad: trackpad@74 {
        compatible = "azoteq,tps43";
        reg = <0x74>;
        status = "okay";

        enable-power-management;
        report-rate-lp2 = <640>;
        scroll-angle = <30>;
        sensitivity = <100>;
        scroll-sensitivity = <100>;

        filter-settings=<0x0B>;
        hold-time = <500>;

        zoom;
        scroll;
        two-finger-tap;
        single-tap;
        press-and-hold;
        //swipes;
        three-finger-swipe;
        three-finger-swipe-throttle-ms = <1200>;
        switch-xy;
        invert-scroll-y;
    };
};
`;

const SAMPLE_TOUCAN_DTSI = `
/ {
    input_processors {
        zip_zoom_mapper: zip_zoom_mapper {
            compatible = "zmk,input-processor-zoom";
            #input-processor-cells = <0>;
            event-code = <INPUT_REL_MISC>;
            sensitivity = <10>;
            bindings = <&cg_zoom_out>, <&cg_zoom_in>;
            track-remainders;
        };

        is_touching_processor:is_touching_processor {
            compatible = "zmk,input-processor-behaviors";
            #input-processor-cells = <0>;
            codes = <INPUT_BTN_TOUCH>;
            bindings  = <&mo 4>;
        };

        two_finger_double_tap: two_finger_double_tap {
            compatible = "zmk,input-processor-double-tap";
            status = "disabled";
            #input-processor-cells = <0>;
            code = <INPUT_BTN_1>;
            window-ms = <250>;
            bindings = <&mkp RCLK>, <&cg_smart_zoom>;
            require-cg-swap;
        };

        swipe_button_mapper: swipe_button_mapper {
            compatible = "zmk,input-processor-behaviors";
            #input-processor-cells = <0>;
            codes = <INPUT_BTN_NORTH INPUT_BTN_EAST INPUT_BTN_SOUTH INPUT_BTN_WEST>;
#ifdef TOUCAN_WIN_MODE
            bindings = <&kp LG(TAB)>, <&kp LG(RIGHT)>, <&kp LG(D)>, <&kp LG(LEFT)>;
#else
            bindings = <&kp LC(LG(UP))>, <&kp LC(LG(RIGHT))>, <&kp LC(LG(DOWN))>, <&kp LC(LG(LEFT))>;
#endif
        };
    };

    trackpad_listener: trackpad_listener {
        compatible = "zmk,input-listener";
        status = "disabled";
        device = <&trackpad_split>;
        input-processors = <&zip_xy_scaler 100 100>, <&zip_scroll_scaler 1 20>, <&zip_zoom_mapper>, <&is_touching_processor>, <&two_finger_double_tap>, <&swipe_button_mapper>;
        scroller {
            layers = <1 2>;
            input-processors = <
                &zip_xy_to_scroll_mapper
                &zip_scroll_scaler 1 20
                &zip_scroll_transform INPUT_TRANSFORM_X_INVERT
            >;
        };
    };
};
`;

const SAMPLE_LEFT_CONF = `
CONFIG_ZMK_SLEEP=y
CONFIG_ZMK_IDLE_SLEEP_TIMEOUT=3600000
CONFIG_ZMK_IDLE_TIMEOUT=30000
CONFIG_TOUCAN_STATUS_SCREEN=2
`;

const SAMPLE_RIGHT_CONF = `
CONFIG_ZMK_SLEEP=y
CONFIG_ZMK_IDLE_SLEEP_TIMEOUT=3600000
CONFIG_ZMK_IDLE_TIMEOUT=30000
`;

const SAMPLE_KCONFIG = `
menuconfig ZMK_CG_TOGGLE
    bool "Toggle Ctrl GUI"
    default y

config ZMK_CG_TOGGLE_SAVE_DELAY_MS
    int "Delay"
    default 1000

config TOUCAN_SPLIT_INPUT_RELAY
    bool "Relay"
    default y

config TOUCAN_SPLIT_INPUT_RELAY_QUEUE_SIZE
    int "Queue"
    default 32

config TOUCAN_SPLIT_INPUT_RELAY_STACK_SIZE
    int "Stack"
    default 1536
`;

describe("dtsParser", () => {
  it("parses custom behaviors from dtsi", () => {
    const defs = parseCustomBehaviors(SAMPLE_CG_DTSI, "dts/cg_toggle.dtsi");
    expect(defs).toHaveLength(2);
    expect(defs[0]).toMatchObject({
      label: "cg_toggle",
      compatible: "zmk,behavior-cg-toggle",
      bindingCells: 0,
      displayName: "Toggle Ctrl GUI",
      sourceFile: "dts/cg_toggle.dtsi",
    });
    expect(defs[1].displayName).toBe("Smart Zoom");
    expect(defs[1].properties["direction"]).toBe("smart");
  });

  it("parses and surgically updates hold-tap tuning while preserving comments", () => {
    const parsed = parseHoldTapTuning(SAMPLE_KEYMAP);
    expect(parsed.mtQuickTapMs).toBe(200);
    expect(parsed.ltQuickTapMs).toBeNull();

    const updated = updateHoldTapTuning(SAMPLE_KEYMAP, {
      ...parsed,
      mtQuickTapMs: 175,
      mtTappingTermMs: 220,
      mtFlavor: "balanced",
      ltQuickTapMs: 150,
    });

    expect(updated).toContain("/* Comment preserved */");
    const reparsed = parseHoldTapTuning(updated);
    expect(reparsed.mtQuickTapMs).toBe(175);
    expect(reparsed.mtTappingTermMs).toBe(220);
    expect(reparsed.mtFlavor).toBe("balanced");
    expect(reparsed.ltQuickTapMs).toBe(150);
  });

  it("parses and updates trackpad hardware overlay without corrupting comments", () => {
    const hw = parseTrackpadHardware(SAMPLE_RIGHT_OVERLAY);
    expect(hw.sensitivity).toBe(100);
    expect(hw.scrollAngle).toBe(30);
    expect(hw.invertScrollY).toBe(true);
    expect(hw.threeFingerSwipeThrottleMs).toBe(1200);

    const updated = updateTrackpadHardware(SAMPLE_RIGHT_OVERLAY, {
      ...hw,
      sensitivity: 125,
      scrollAngle: 35,
      invertScrollY: false,
      threeFingerSwipeThrottleMs: 900,
    });

    expect(updated).toContain("//swipes;");
    const reparsed = parseTrackpadHardware(updated);
    expect(reparsed.sensitivity).toBe(125);
    expect(reparsed.scrollAngle).toBe(35);
    expect(reparsed.invertScrollY).toBe(false);
    expect(reparsed.threeFingerSwipeThrottleMs).toBe(900);
  });

  it("parses and updates trackpad input processors", () => {
    const proc = parseTrackpadProcessors(SAMPLE_TOUCAN_DTSI);
    expect(proc.xyScaleMul).toBe(100);
    expect(proc.xyScaleDiv).toBe(100);
    expect(proc.scrollScaleMul).toBe(1);
    expect(proc.scrollScaleDiv).toBe(20);
    expect(proc.zoomSensitivity).toBe(10);
    expect(proc.doubleTapWindowMs).toBe(250);
    expect(proc.doubleTapRequireCgSwap).toBe(true);
    expect(proc.touchLayer).toBe(4);
    expect(proc.scrollerLayers).toEqual([1, 2]);
    expect(proc.swipeBindings).toHaveLength(4);

    const updated = updateTrackpadProcessors(SAMPLE_TOUCAN_DTSI, {
      ...proc,
      xyScaleMul: 120,
      xyScaleDiv: 100,
      doubleTapWindowMs: 220,
      doubleTapRequireCgSwap: false,
      zoomSensitivity: 8,
    });

    const reparsed = parseTrackpadProcessors(updated);
    expect(reparsed.xyScaleMul).toBe(120);
    expect(reparsed.doubleTapWindowMs).toBe(220);
    expect(reparsed.doubleTapRequireCgSwap).toBe(false);
    expect(reparsed.zoomSensitivity).toBe(8);
  });

  it("parses and updates Kconfig/conf settings", () => {
    const conf = parseConfTuning(SAMPLE_LEFT_CONF, SAMPLE_RIGHT_CONF, SAMPLE_KCONFIG);
    expect(conf.idleTimeoutMs).toBe(30000);
    expect(conf.statusScreenStyle).toBe(2);
    expect(conf.cgToggleEnabled).toBe(true);
    expect(conf.cgToggleSaveDelayMs).toBe(1000);
    expect(conf.splitInputRelayQueueSize).toBe(32);

    const updated = updateConfTuning(SAMPLE_LEFT_CONF, SAMPLE_RIGHT_CONF, {
      ...conf,
      statusScreenStyle: 1,
      cgToggleSaveDelayMs: 1500,
      splitInputRelayQueueSize: 48,
    });

    const reparsed = parseConfTuning(updated.leftConf, updated.rightConf, SAMPLE_KCONFIG);
    expect(reparsed.statusScreenStyle).toBe(1);
    expect(reparsed.cgToggleSaveDelayMs).toBe(1500);
    expect(reparsed.splitInputRelayQueueSize).toBe(48);
  });

  it("parses keymap layers from toucan.keymap", () => {
    const layers = parseKeymapLayers(SAMPLE_KEYMAP);
    expect(layers).toHaveLength(2);
    expect(layers[0].displayName).toBe("BASE");
    expect(layers[0].bindings).toEqual([
      "&kp TAB",
      "&kp Q",
      "&mt LGUI BSPC",
      "&cg_toggle",
      "&mo 1",
      "&kp SPACE",
    ]);
    expect(layers[1].reserved).toBe(true);
  });

  it("reads real Toucan 2 firmware repository accurately when present", () => {
    const repo = "/Users/vvx/Documents/deepseek-harness/default-workspace/toucan2-cg-toggle";
    if (!fs.existsSync(repo)) return;

    const cgDtsi = fs.readFileSync(path.join(repo, "dts/cg_toggle.dtsi"), "utf8");
    const behaviors = parseCustomBehaviors(cgDtsi, "dts/cg_toggle.dtsi");
    expect(behaviors.map((b) => b.label)).toEqual([
      "cg_toggle",
      "cg_toggle_on",
      "cg_toggle_off",
      "cg_zoom_in",
      "cg_zoom_out",
      "cg_smart_zoom",
      "cg_back",
      "cg_forward",
    ]);

    const keymap = fs.readFileSync(path.join(repo, "config/toucan.keymap"), "utf8");
    const ht = parseHoldTapTuning(keymap);
    expect(ht.mtQuickTapMs).toBe(200);
    expect(updateHoldTapTuning(keymap, ht)).toBe(keymap);

    const rightOv = fs.readFileSync(
      path.join(repo, "boards/shields/toucan/toucan_right.overlay"),
      "utf8"
    );
    const hw = parseTrackpadHardware(rightOv);
    expect(hw.sensitivity).toBe(100);
    expect(hw.scrollAngle).toBe(30);
    expect(hw.invertScrollY).toBe(true);
    expect(parseTrackpadHardware(updateTrackpadHardware(rightOv, hw))).toEqual(hw);

    const dtsi = fs.readFileSync(
      path.join(repo, "boards/shields/toucan/toucan.dtsi"),
      "utf8"
    );
    const proc = parseTrackpadProcessors(dtsi);
    expect(proc.doubleTapWindowMs).toBe(250);
    expect(proc.doubleTapRequireCgSwap).toBe(true);
    expect(parseTrackpadProcessors(updateTrackpadProcessors(dtsi, proc))).toEqual(proc);
  });
});
