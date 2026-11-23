// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures::lock::Mutex;

mod transport;
mod vmk;

use transport::commands::{transport_close, transport_send_data, ActiveConnection};
use transport::gatt::{gatt_connect, gatt_list_devices};
use transport::serial::{serial_connect, serial_list_devices};
use vmk::{
    vmk_cancel_job, vmk_get_job_status, vmk_get_workspace_status, vmk_git_diff, vmk_list_snapshots,
    vmk_read_firmware_bundle, vmk_read_repo_file, vmk_read_snapshot, vmk_revert_repo_file,
    vmk_save_snapshot, vmk_start_job, vmk_write_repo_file, VmkJobManager,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_cli::init())
        .manage(ActiveConnection {
            conn: Mutex::new(None),
        })
        .manage(VmkJobManager::default())
        .invoke_handler(tauri::generate_handler![
            transport_send_data,
            transport_close,
            gatt_list_devices,
            gatt_connect,
            serial_list_devices,
            serial_connect,
            vmk_get_workspace_status,
            vmk_read_firmware_bundle,
            vmk_read_repo_file,
            vmk_write_repo_file,
            vmk_git_diff,
            vmk_revert_repo_file,
            vmk_list_snapshots,
            vmk_read_snapshot,
            vmk_save_snapshot,
            vmk_start_job,
            vmk_get_job_status,
            vmk_cancel_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
