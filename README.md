# VMK Studio

A custom-firmware-aware fork of [ZMK Studio](https://github.com/zmkfirmware/zmk-studio), built for keyboards like the customised beekeeb **Toucan 2** where live keymap editing, custom devicetree behaviours, firmware parameter tuning, and safe UF2 updates all need to work together without clobbering custom bindings.

## What VMK Studio adds over upstream ZMK Studio

- **Custom Overwrite Guard**: Detects custom firmware behaviours (parsed from `dts/*.dtsi` and non-stock Studio behaviours) as well as safety keys (`Studio Unlock`, `Bootloader`, `Reset`) and locks them against accidental overwrite until explicitly unlocked per key.
- **2-Parameter & Implicit-Modifier Keycaps**: Displays both hold and tap keys on Mod-Tap / Layer-Tap, renders implicit HID modifiers (`L⌃`, `L⌘`, etc.), and fixes unsigned 32-bit modifier handling for `RightGUI`.
- **Raw Binding Inspector**: Inspect and apply raw `(behaviorId, param1, param2)` values safely for custom behaviours whose parameter schemas are not handled by stock pickers.
- **Snapshots, Diff & Selective Restore**: Capture live Studio keymap snapshots (compatible with `~/.local/share/toucan2/backups/`), compare against any saved snapshot visually, and restore individual keys or full layers without touching `Restore Stock Settings` (which is now gated behind an explicit `RESET` confirmation).
- **Offline Inspection Mode**: Browse saved Studio snapshots and `config/toucan.keymap` on the physical layout even when the keyboard is not plugged in.
- **Firmware Parameter Tuner**: Comment-preserving interactive sliders and toggles for:
  - Hold-Tap / Mod-Tap & Layer-Tap (`quick-tap-ms`, `tapping-term-ms`, `flavor`),
  - Azoteq TPS43 trackpad hardware (`sensitivity`, `scroll-sensitivity`, `scroll-angle`, `hold-time`, gestures, power management),
  - Trackpad input processors (`zip_xy_scaler`, `zip_scroll_scaler`, `zip_zoom_mapper`, `two_finger_double_tap`, 3-finger swipes),
  - Custom modules & power (`ZMK_CG_TOGGLE`, `TOUCAN_SPLIT_INPUT_RELAY`, idle/sleep timeouts, status screen style).
- **Custom Behaviours Registry & Repo Editor**: Browse custom DTS behaviours and directly edit `toucan.keymap`, `cg_toggle.dtsi`, overlays, `.conf`, and `Kconfig` with live `git diff` and per-file revert.
- **Test, Build & Half-Guarded Flash Pipeline**: Run host unit tests (`scripts/test-host.sh`), compile both halves via `scripts/build.sh` (`west`), verify SHA-256 checksums, and flash Left/Right UF2 images with `CURRENT.UF2` central-marker cross-flash protection.

## Development

```sh
npm install
npm test          # Run unit tests (Vitest)
npm run dev       # Start web UI + local VMK firmware/build/flash API bridge
npm run build     # Type-check and build production frontend
npm run tauri dev # Run native macOS Tauri desktop app
```

## Licensing

Apache-2.0, preserving upstream ZMK Studio's `LICENSE` and `NOTICE`.
