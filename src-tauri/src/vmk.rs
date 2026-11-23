use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{command, State};

const LEFT_MARKERS: [&str; 4] = [
    "Studio Unlock",
    "studio_rpc_thread",
    "usbworkq",
    "HID Over GATT Send Work",
];

const EDITABLE_FILES: [&str; 16] = [
    "config/toucan.keymap",
    "dts/cg_toggle.dtsi",
    "config/toucan_left.overlay",
    "config/toucan_right.overlay",
    "boards/shields/toucan/toucan.dtsi",
    "boards/shields/toucan/toucan_left.overlay",
    "boards/shields/toucan/toucan_right.overlay",
    "boards/shields/toucan/toucan_left.conf",
    "boards/shields/toucan/toucan_right.conf",
    "Kconfig",
    "src/cg_toggle.c",
    "src/cg_zoom.c",
    "src/cg_nav.c",
    "src/input_processor_double_tap.c",
    "src/split_input_relay.c",
    "host/macos/Sources/Core/ZoomSmoother.swift",
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PartialWorkspacePaths {
    pub firmware_repo_path: Option<String>,
    pub zmk_app_path: Option<String>,
    pub west_path: Option<String>,
    pub backups_dir: Option<String>,
    pub tools_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmkWorkspacePaths {
    pub firmware_repo_path: String,
    pub zmk_app_path: String,
    pub west_path: String,
    pub backups_dir: String,
    pub tools_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuiltArtifactInfo {
    pub name: String,
    pub half: String,
    pub path: String,
    pub exists: bool,
    pub bytes: Option<u64>,
    pub sha256: Option<String>,
    pub expected_sha256: Option<String>,
    pub checksum_matches: Option<bool>,
    pub mtime_iso: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootloaderStatus {
    pub mounted: bool,
    pub volume_path: String,
    pub board_id: Option<String>,
    pub is_xiao_nrf52840: bool,
    pub detected_half: String,
    pub detected_markers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactsPair {
    pub left: BuiltArtifactInfo,
    pub right: BuiltArtifactInfo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VmkWorkspaceStatus {
    pub paths: VmkWorkspacePaths,
    pub repo_exists: bool,
    pub zmk_app_exists: bool,
    pub west_exists: bool,
    pub git_branch: Option<String>,
    pub git_head: Option<String>,
    pub git_tag: Option<String>,
    pub dirty_files: Vec<String>,
    pub artifacts: ArtifactsPair,
    pub bootloader: BootloaderStatus,
    pub usb_keyboard_connected: bool,
    pub usb_products: Vec<String>,
    pub helper_installed: bool,
    pub helper_running: bool,
    pub available_scripts: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedFileContent {
    pub rel_path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingEditable {
    pub rel_path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareBundle {
    pub repo_path: String,
    pub keymap: String,
    pub left_overlay: String,
    pub right_overlay: String,
    pub toucan_dtsi: String,
    pub left_conf: String,
    pub right_conf: String,
    pub kconfig: String,
    pub cg_zoom_c: String,
    pub cg_nav_c: String,
    pub helper_smoother_swift: String,
    pub toucan_json: String,
    pub dts_files: Vec<NamedFileContent>,
    pub dirty_files: Vec<String>,
    pub existing_editable: Vec<ExistingEditable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSummary {
    pub path: String,
    pub rel_path: String,
    pub name: String,
    pub mtime_iso: String,
    pub device: Option<String>,
    pub layer_count: usize,
    pub keymap_sha256: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandJob {
    pub id: String,
    pub kind: String,
    pub command: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub exit_code: Option<i32>,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartJobOptions {
    pub kind: String,
    pub script_name: Option<String>,
    pub paths: Option<PartialWorkspacePaths>,
    pub wait_seconds: Option<u64>,
}

struct RunningJob {
    job: CommandJob,
    pid: Option<u32>,
}

#[derive(Default)]
pub struct VmkJobManager {
    jobs: Arc<Mutex<HashMap<String, RunningJob>>>,
}

fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

fn default_paths() -> VmkWorkspacePaths {
    let home = home_dir();
    VmkWorkspacePaths {
        firmware_repo_path: home
            .join("Documents/deepseek-harness/default-workspace/toucan2-cg-toggle")
            .to_string_lossy()
            .into_owned(),
        zmk_app_path: home
            .join("toucan2-zmk-build/build-ws/zmk/app")
            .to_string_lossy()
            .into_owned(),
        west_path: home
            .join("toucan2-zmk-build/.venv/bin/west")
            .to_string_lossy()
            .into_owned(),
        backups_dir: home
            .join(".local/share/toucan2/backups")
            .to_string_lossy()
            .into_owned(),
        tools_dir: home
            .join(".local/share/toucan2/tools")
            .to_string_lossy()
            .into_owned(),
    }
}

fn merge_paths(partial: Option<PartialWorkspacePaths>) -> VmkWorkspacePaths {
    let defs = default_paths();
    let p = partial.unwrap_or_default();
    let pick = |opt: Option<String>, def: String| match opt {
        Some(v) if !v.trim().is_empty() => v.trim().to_string(),
        _ => def,
    };
    VmkWorkspacePaths {
        firmware_repo_path: pick(p.firmware_repo_path, defs.firmware_repo_path),
        zmk_app_path: pick(p.zmk_app_path, defs.zmk_app_path),
        west_path: pick(p.west_path, defs.west_path),
        backups_dir: pick(p.backups_dir, defs.backups_dir),
        tools_dir: pick(p.tools_dir, defs.tools_dir),
    }
}

fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(format!("Absolute path not permitted: {rel}"));
    }
    let mut cleaned = PathBuf::new();
    for comp in rel_path.components() {
        match comp {
            Component::Normal(seg) => {
                if cleaned.as_os_str().is_empty() && seg == ".git" {
                    return Err("Modifying .git internals is not permitted.".into());
                }
                cleaned.push(seg);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Path escapes workspace root: {rel}"));
            }
        }
    }
    Ok(root.join(cleaned))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| format!("Failed reading {}: {e}", path.display()))?;
    let digest = Sha256::digest(&data);
    Ok(digest.iter().map(|b| format!("{b:02x}")).collect())
}

fn inspect_artifact(repo: &Path, name: &str, half: &str) -> BuiltArtifactInfo {
    let uf2 = repo.join("dist").join(format!("{name}.uf2"));
    let sha_file = repo.join("dist").join(format!("{name}.uf2.sha256"));
    if !uf2.exists() {
        return BuiltArtifactInfo {
            name: name.into(),
            half: half.into(),
            path: uf2.to_string_lossy().into_owned(),
            exists: false,
            bytes: None,
            sha256: None,
            expected_sha256: None,
            checksum_matches: None,
            mtime_iso: None,
        };
    }
    let meta = fs::metadata(&uf2).ok();
    let bytes = meta.as_ref().map(|m| m.len());
    let mtime_iso = meta
        .and_then(|m| m.modified().ok())
        .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339());
    let sha256 = sha256_file(&uf2).ok();
    let expected_sha256 = fs::read_to_string(&sha_file)
        .ok()
        .and_then(|s| s.split_whitespace().next().map(|v| v.to_string()));
    let checksum_matches = match (&sha256, &expected_sha256) {
        (Some(a), Some(b)) => Some(a == b),
        _ => None,
    };

    BuiltArtifactInfo {
        name: name.into(),
        half: half.into(),
        path: uf2.to_string_lossy().into_owned(),
        exists: true,
        bytes,
        sha256,
        expected_sha256,
        checksum_matches,
        mtime_iso,
    }
}

fn inspect_bootloader() -> BootloaderStatus {
    let volume_path =
        env::var("TOUCAN_BOOT_VOLUME").unwrap_or_else(|_| "/Volumes/XIAO-BOOT".into());
    let vol = Path::new(&volume_path);
    if !vol.exists() {
        return BootloaderStatus {
            mounted: false,
            volume_path,
            board_id: None,
            is_xiao_nrf52840: false,
            detected_half: "unknown".into(),
            detected_markers: vec![],
        };
    }

    let info_text = fs::read_to_string(vol.join("INFO_UF2.TXT")).unwrap_or_default();
    let board_id = info_text.lines().find_map(|l| {
        l.strip_prefix("Board-ID:")
            .map(|rest| rest.trim().to_string())
    });
    let is_xiao_nrf52840 = info_text.contains("Board-ID: nRF52840-SeeedXiao");

    let mut detected_markers = Vec::new();
    let mut detected_half = "unknown".to_string();
    if let Ok(raw) = fs::read(vol.join("CURRENT.UF2")) {
        let mut flat = Vec::with_capacity(raw.len() / 2);
        let mut off = 0;
        while off + 512 <= raw.len() {
            let m0 = u32::from_le_bytes(raw[off..off + 4].try_into().unwrap());
            let m1 = u32::from_le_bytes(raw[off + 4..off + 8].try_into().unwrap());
            let psize = u32::from_le_bytes(raw[off + 16..off + 20].try_into().unwrap()) as usize;
            if m0 == 0x0A324655 && m1 == 0x9E5D5157 && psize <= 476 {
                flat.extend_from_slice(&raw[off + 32..off + 32 + psize]);
            }
            off += 512;
        }
        for marker in LEFT_MARKERS {
            let needle = marker.as_bytes();
            if flat.windows(needle.len()).any(|w| w == needle) {
                detected_markers.push(marker.to_string());
            }
        }
        detected_half = if detected_markers.is_empty() {
            "right_or_other".into()
        } else {
            "left".into()
        };
    }

    BootloaderStatus {
        mounted: true,
        volume_path,
        board_id,
        is_xiao_nrf52840,
        detected_half,
        detected_markers,
    }
}

fn list_usb_products() -> Vec<String> {
    if !cfg!(target_os = "macos") {
        return vec![];
    }
    let out = Command::new("ioreg")
        .args(["-p", "IOUSB", "-l", "-w", "0"])
        .output();
    let Ok(out) = out else { return vec![] };
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .filter(|l| l.contains("\"USB Product Name\""))
        .filter_map(|l| {
            l.split_once('=')
                .map(|(_, v)| v.trim().trim_matches('"').to_string())
        })
        .filter(|s| !s.is_empty())
        .collect()
}

fn run_git_stdout(repo: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

#[command]
pub async fn vmk_get_workspace_status(
    paths: Option<PartialWorkspacePaths>,
) -> Result<VmkWorkspaceStatus, String> {
    let resolved = merge_paths(paths);
    let repo = PathBuf::from(&resolved.firmware_repo_path);
    let repo_exists = repo.exists();
    let zmk_app_exists = Path::new(&resolved.zmk_app_path).join("west.yml").exists();
    let west_exists = Path::new(&resolved.west_path).exists();

    let git_branch = if repo_exists {
        run_git_stdout(&repo, &["rev-parse", "--abbrev-ref", "HEAD"]).map(|s| s.trim().into())
    } else {
        None
    };
    let git_head = if repo_exists {
        run_git_stdout(&repo, &["rev-parse", "--short", "HEAD"]).map(|s| s.trim().into())
    } else {
        None
    };
    let git_tag = if repo_exists {
        run_git_stdout(&repo, &["describe", "--tags", "--abbrev=0"]).map(|s| s.trim().into())
    } else {
        None
    };
    let dirty_files = if repo_exists {
        run_git_stdout(&repo, &["status", "--porcelain"])
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    } else {
        vec![]
    };

    let mut available_scripts = Vec::new();
    if let Ok(entries) = fs::read_dir(repo.join("scripts")) {
        for ent in entries.flatten() {
            if let Some(name) = ent.file_name().to_str() {
                if name.ends_with(".sh") {
                    available_scripts.push(name.to_string());
                }
            }
        }
        available_scripts.sort();
    }

    let left = inspect_artifact(&repo, "toucan_left_zg_studio", "left");
    let right = inspect_artifact(&repo, "toucan_right", "right");
    let bootloader = inspect_bootloader();
    let usb_products = list_usb_products();
    let usb_keyboard_connected = usb_products
        .iter()
        .any(|p| p.to_lowercase().contains("toucan"));

    let helper_installed = home_dir().join("Applications/Toucan 2 Helper.app").exists();
    let helper_running = Command::new("pgrep")
        .args(["-f", "Toucan 2 Helper"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);

    Ok(VmkWorkspaceStatus {
        paths: resolved,
        repo_exists,
        zmk_app_exists,
        west_exists,
        git_branch,
        git_head,
        git_tag,
        dirty_files,
        artifacts: ArtifactsPair { left, right },
        bootloader,
        usb_keyboard_connected,
        usb_products,
        helper_installed,
        helper_running,
        available_scripts,
    })
}

#[command]
pub async fn vmk_read_firmware_bundle(repo_path: String) -> Result<FirmwareBundle, String> {
    let resolved = merge_paths(Some(PartialWorkspacePaths {
        firmware_repo_path: Some(repo_path),
        ..Default::default()
    }));
    let repo = PathBuf::from(&resolved.firmware_repo_path);
    let read_opt = |rel: &str| fs::read_to_string(repo.join(rel)).unwrap_or_default();

    let mut dts_files = Vec::new();
    if let Ok(entries) = fs::read_dir(repo.join("dts")) {
        let mut names: Vec<String> = entries
            .flatten()
            .filter_map(|e| e.file_name().to_str().map(|s| s.to_string()))
            .filter(|n| n.ends_with(".dtsi"))
            .collect();
        names.sort();
        for name in names {
            let rel = format!("dts/{name}");
            let content = read_opt(&rel);
            dts_files.push(NamedFileContent {
                rel_path: rel,
                content,
            });
        }
    }

    let dirty_files = run_git_stdout(&repo, &["status", "--porcelain"])
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.get(3..).map(|r| r.trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect();

    let existing_editable = EDITABLE_FILES
        .iter()
        .map(|rel| ExistingEditable {
            rel_path: (*rel).into(),
            exists: repo.join(rel).exists(),
        })
        .collect();

    Ok(FirmwareBundle {
        repo_path: resolved.firmware_repo_path,
        keymap: read_opt("config/toucan.keymap"),
        left_overlay: read_opt("boards/shields/toucan/toucan_left.overlay"),
        right_overlay: read_opt("boards/shields/toucan/toucan_right.overlay"),
        toucan_dtsi: read_opt("boards/shields/toucan/toucan.dtsi"),
        left_conf: read_opt("boards/shields/toucan/toucan_left.conf"),
        right_conf: read_opt("boards/shields/toucan/toucan_right.conf"),
        kconfig: read_opt("Kconfig"),
        cg_zoom_c: read_opt("src/cg_zoom.c"),
        cg_nav_c: read_opt("src/cg_nav.c"),
        helper_smoother_swift: read_opt("host/macos/Sources/Core/ZoomSmoother.swift"),
        toucan_json: read_opt("config/toucan.json"),
        dts_files,
        dirty_files,
        existing_editable,
    })
}

#[command]
pub async fn vmk_read_repo_file(repo_path: String, rel_path: String) -> Result<String, String> {
    let resolved = merge_paths(Some(PartialWorkspacePaths {
        firmware_repo_path: Some(repo_path),
        ..Default::default()
    }));
    let full = safe_join(Path::new(&resolved.firmware_repo_path), &rel_path)?;
    fs::read_to_string(&full).map_err(|e| format!("Failed reading {}: {e}", full.display()))
}

#[command]
pub async fn vmk_write_repo_file(
    repo_path: String,
    rel_path: String,
    content: String,
) -> Result<(), String> {
    let resolved = merge_paths(Some(PartialWorkspacePaths {
        firmware_repo_path: Some(repo_path),
        ..Default::default()
    }));
    let full = safe_join(Path::new(&resolved.firmware_repo_path), &rel_path)?;
    fs::write(&full, content).map_err(|e| format!("Failed writing {}: {e}", full.display()))
}

#[command]
pub async fn vmk_git_diff(repo_path: String, rel_path: Option<String>) -> Result<String, String> {
    let resolved = merge_paths(Some(PartialWorkspacePaths {
        firmware_repo_path: Some(repo_path),
        ..Default::default()
    }));
    let repo = PathBuf::from(&resolved.firmware_repo_path);
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&repo).arg("diff");
    if let Some(rel) = rel_path {
        let _ = safe_join(&repo, &rel)?;
        cmd.arg("--").arg(rel);
    }
    let out = cmd
        .output()
        .map_err(|e| format!("Failed running git diff: {e}"))?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[command]
pub async fn vmk_revert_repo_file(repo_path: String, rel_path: String) -> Result<(), String> {
    let resolved = merge_paths(Some(PartialWorkspacePaths {
        firmware_repo_path: Some(repo_path),
        ..Default::default()
    }));
    let repo = PathBuf::from(&resolved.firmware_repo_path);
    let _ = safe_join(&repo, &rel_path)?;
    let status = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["checkout", "--", &rel_path])
        .status()
        .map_err(|e| format!("Failed running git checkout: {e}"))?;
    if !status.success() {
        return Err(format!("git checkout failed for {rel_path}"));
    }
    Ok(())
}

fn walk_snapshots(root: &Path, dir: &Path, depth: usize, out: &mut Vec<SnapshotSummary>) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let path = ent.path();
        if path.is_dir() {
            walk_snapshots(root, &path, depth + 1, out);
        } else if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let Ok(raw) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            let Some(layers) = val.get("layers").and_then(|v| v.as_array()) else {
                continue;
            };
            let mtime_iso = val
                .get("saved_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    fs::metadata(&path)
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
                })
                .unwrap_or_default();
            let rel_path = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .into_owned();
            let name = path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            out.push(SnapshotSummary {
                path: path.to_string_lossy().into_owned(),
                rel_path,
                name,
                mtime_iso,
                device: val.get("device").and_then(|v| v.as_str()).map(Into::into),
                layer_count: layers.len(),
                keymap_sha256: val
                    .get("keymap_sha256")
                    .and_then(|v| v.as_str())
                    .map(Into::into),
                note: val.get("note").and_then(|v| v.as_str()).map(Into::into),
            });
        }
    }
}

#[command]
pub async fn vmk_list_snapshots(backups_dir: String) -> Result<Vec<SnapshotSummary>, String> {
    let resolved = merge_paths(Some(PartialWorkspacePaths {
        backups_dir: Some(backups_dir),
        ..Default::default()
    }));
    let root = PathBuf::from(&resolved.backups_dir);
    let mut results = Vec::new();
    if root.exists() {
        walk_snapshots(&root, &root, 0, &mut results);
    }
    results.sort_by(|a, b| b.mtime_iso.cmp(&a.mtime_iso));
    Ok(results)
}

#[command]
pub async fn vmk_read_snapshot(
    backups_dir: String,
    rel_path: String,
) -> Result<serde_json::Value, String> {
    let resolved = merge_paths(Some(PartialWorkspacePaths {
        backups_dir: Some(backups_dir),
        ..Default::default()
    }));
    let full = safe_join(Path::new(&resolved.backups_dir), &rel_path)?;
    let raw = fs::read_to_string(&full).map_err(|e| format!("Failed reading snapshot: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid snapshot JSON: {e}"))
}

#[command]
pub async fn vmk_save_snapshot(
    backups_dir: String,
    name: String,
    mut snapshot: serde_json::Value,
) -> Result<SnapshotSummary, String> {
    let resolved = merge_paths(Some(PartialWorkspacePaths {
        backups_dir: Some(backups_dir),
        ..Default::default()
    }));
    let root = PathBuf::from(&resolved.backups_dir);
    let out_dir = root.join("vmk-snapshots");
    fs::create_dir_all(&out_dir).map_err(|e| format!("Failed creating snapshot dir: {e}"))?;

    let safe_base: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let base = if safe_base.is_empty() {
        "snapshot".to_string()
    } else {
        safe_base
    };
    let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let file_name = format!("{stamp}-{base}.json");
    let out_path = out_dir.join(&file_name);

    let now_iso = Utc::now().to_rfc3339();
    if let Some(obj) = snapshot.as_object_mut() {
        obj.entry("saved_at".to_string())
            .or_insert_with(|| serde_json::Value::String(now_iso.clone()));
    }
    let pretty = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("Failed encoding snapshot: {e}"))?;
    fs::write(&out_path, format!("{pretty}\n"))
        .map_err(|e| format!("Failed writing snapshot: {e}"))?;

    let layer_count = snapshot
        .get("layers")
        .and_then(|v| v.as_array())
        .map(|a| a.len())
        .unwrap_or(0);

    Ok(SnapshotSummary {
        path: out_path.to_string_lossy().into_owned(),
        rel_path: format!("vmk-snapshots/{file_name}"),
        name: file_name,
        mtime_iso: now_iso,
        device: snapshot
            .get("device")
            .and_then(|v| v.as_str())
            .map(Into::into),
        layer_count,
        keymap_sha256: snapshot
            .get("keymap_sha256")
            .and_then(|v| v.as_str())
            .map(Into::into),
        note: snapshot
            .get("note")
            .and_then(|v| v.as_str())
            .map(Into::into),
    })
}

fn spawn_job_thread(
    jobs_map: Arc<Mutex<HashMap<String, RunningJob>>>,
    kind: String,
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
    extra_env: Vec<(String, String)>,
) -> Result<CommandJob, String> {
    let id = format!("job-{}", Utc::now().timestamp_millis());
    let command_str = std::iter::once(program.clone())
        .chain(args.iter().cloned())
        .collect::<Vec<_>>()
        .join(" ");

    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .current_dir(&cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in extra_env {
        cmd.env(k, v);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start {program}: {e}"))?;
    let pid = child.id();

    let job = CommandJob {
        id: id.clone(),
        kind,
        command: command_str,
        status: "running".into(),
        started_at: Utc::now().to_rfc3339(),
        finished_at: None,
        exit_code: None,
        output: String::new(),
    };

    {
        let mut map = jobs_map.lock().unwrap();
        map.insert(
            id.clone(),
            RunningJob {
                job: job.clone(),
                pid: Some(pid),
            },
        );
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let id_clone = id.clone();

    std::thread::spawn(move || {
        let map_out = Arc::clone(&jobs_map);
        let id_out = id_clone.clone();
        let t_out = stdout.map(|mut r| {
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n) = r.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    if let Ok(mut map) = map_out.lock() {
                        if let Some(rec) = map.get_mut(&id_out) {
                            rec.job.output.push_str(&chunk);
                        }
                    }
                }
            })
        });

        let map_err = Arc::clone(&jobs_map);
        let id_err = id_clone.clone();
        let t_err = stderr.map(|mut r| {
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                while let Ok(n) = r.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    let chunk = String::from_utf8_lossy(&buf[..n]);
                    if let Ok(mut map) = map_err.lock() {
                        if let Some(rec) = map.get_mut(&id_err) {
                            rec.job.output.push_str(&chunk);
                        }
                    }
                }
            })
        });

        let status = child.wait().ok();
        if let Some(t) = t_out {
            let _ = t.join();
        }
        if let Some(t) = t_err {
            let _ = t.join();
        }

        if let Ok(mut map) = jobs_map.lock() {
            if let Some(rec) = map.get_mut(&id_clone) {
                rec.pid = None;
                let code = status.and_then(|s| s.code());
                rec.job.exit_code = code;
                if rec.job.status == "running" {
                    rec.job.status = if code == Some(0) {
                        "succeeded".into()
                    } else {
                        "failed".into()
                    };
                }
                rec.job.finished_at = Some(Utc::now().to_rfc3339());
            }
        }
    });

    Ok(job)
}

#[command]
pub async fn vmk_start_job(
    options: StartJobOptions,
    state: State<'_, VmkJobManager>,
) -> Result<CommandJob, String> {
    let resolved = merge_paths(options.paths);
    let repo = PathBuf::from(&resolved.firmware_repo_path);
    let west_dir = Path::new(&resolved.west_path)
        .parent()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let cur_path = env::var("PATH").unwrap_or_default();
    let extra_env = vec![
        (
            "PATH".into(),
            format!("{west_dir}:/opt/homebrew/bin:/usr/local/bin:{cur_path}"),
        ),
        ("ZMK_APP".into(), resolved.zmk_app_path.clone()),
        ("WEST".into(), resolved.west_path.clone()),
    ];

    match options.kind.as_str() {
        "test-host" => spawn_job_thread(
            Arc::clone(&state.jobs),
            options.kind,
            "sh".into(),
            vec!["scripts/test-host.sh".into()],
            repo,
            extra_env,
        ),
        "test-single" => {
            let script = options.script_name.unwrap_or_else(|| "test-host.sh".into());
            let valid = script.starts_with("test-")
                && script.ends_with(".sh")
                && !script.contains('/')
                && !script.contains("..");
            if !valid {
                return Err(format!("Invalid test script name: {script}"));
            }
            spawn_job_thread(
                Arc::clone(&state.jobs),
                options.kind,
                "sh".into(),
                vec![format!("scripts/{script}")],
                repo,
                extra_env,
            )
        }
        "build-firmware" => spawn_job_thread(
            Arc::clone(&state.jobs),
            options.kind,
            "sh".into(),
            vec!["scripts/build.sh".into()],
            repo,
            extra_env,
        ),
        "verify-build" => spawn_job_thread(
            Arc::clone(&state.jobs),
            options.kind,
            "sh".into(),
            vec!["scripts/verify-build.sh".into()],
            repo,
            extra_env,
        ),
        "helper-build-install" => spawn_job_thread(
            Arc::clone(&state.jobs),
            options.kind,
            "sh".into(),
            vec!["host/macos/install.sh".into()],
            repo,
            extra_env,
        ),
        "flash-left" | "flash-right" => {
            let is_left = options.kind == "flash-left";
            let script = Path::new(&resolved.tools_dir).join(if is_left {
                "flash_left_once.py"
            } else {
                "flash_right_once.py"
            });
            if !script.exists() {
                return Err(format!("Flash helper not found: {}", script.display()));
            }
            let art = inspect_artifact(
                &repo,
                if is_left {
                    "toucan_left_zg_studio"
                } else {
                    "toucan_right"
                },
                if is_left { "left" } else { "right" },
            );
            let sha = art
                .sha256
                .ok_or_else(|| format!("UF2 image missing: {}", art.path))?;

            let flash_dir = Path::new(&resolved.backups_dir).join("vmk-flashes");
            fs::create_dir_all(&flash_dir)
                .map_err(|e| format!("Failed creating flash record dir: {e}"))?;
            let stamp = Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
            let record_path = flash_dir.join(format!(
                "flash-{}-{stamp}.json",
                if is_left { "left" } else { "right" }
            ));
            let wait_sec = options.wait_seconds.unwrap_or(300).clamp(30, 1800);

            let mut args = vec![
                script.to_string_lossy().into_owned(),
                art.path,
                sha,
                record_path.to_string_lossy().into_owned(),
                "--wait".into(),
                wait_sec.to_string(),
            ];
            if !is_left {
                let left_art = inspect_artifact(&repo, "toucan_left_zg_studio", "left");
                if left_art.exists {
                    args.push("--left-image".into());
                    args.push(left_art.path);
                }
                let backup_uf2 = flash_dir.join(format!("right-before-{stamp}.uf2"));
                args.push("--backup".into());
                args.push(backup_uf2.to_string_lossy().into_owned());
            }
            spawn_job_thread(
                Arc::clone(&state.jobs),
                options.kind,
                "python3".into(),
                args,
                repo,
                extra_env,
            )
        }
        other => Err(format!("Unknown job kind: {other}")),
    }
}

#[command]
pub async fn vmk_get_job_status(
    id: String,
    state: State<'_, VmkJobManager>,
) -> Result<CommandJob, String> {
    let map = state.jobs.lock().unwrap();
    map.get(&id)
        .map(|r| r.job.clone())
        .ok_or_else(|| format!("Job not found: {id}"))
}

#[command]
pub async fn vmk_cancel_job(id: String, state: State<'_, VmkJobManager>) -> Result<(), String> {
    let mut map = state.jobs.lock().unwrap();
    if let Some(rec) = map.get_mut(&id) {
        if let Some(pid) = rec.pid {
            let _ = Command::new("kill")
                .args(["-TERM", &pid.to_string()])
                .status();
            rec.job.output.push_str("\n[cancelled by user]\n");
            rec.job.status = "failed".into();
            rec.job.finished_at = Some(Utc::now().to_rfc3339());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_blocks_traversal_and_git_dir() {
        let root = Path::new("/tmp/vmk-repo");
        assert!(safe_join(root, "config/toucan.keymap").is_ok());
        assert!(safe_join(root, "../outside").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());
        assert!(safe_join(root, ".git/config").is_err());
    }
}
