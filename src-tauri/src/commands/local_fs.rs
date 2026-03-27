use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::thread;
use tar::Archive;
use tar::Builder;
use tauri::{AppHandle, Emitter};

use crate::models::TransferProgress;

fn emit_stage_progress(
    app: &AppHandle,
    transfer_id: &str,
    display_name: &str,
    direction: &str,
    total: u64,
    transferred: u64,
    status: &str,
    target_path: Option<String>,
) {
    let _ = app.emit(
        "transfer-progress",
        TransferProgress {
            id: transfer_id.to_string(),
            file_name: display_name.to_string(),
            direction: direction.to_string(),
            total,
            transferred,
            status: status.to_string(),
            error: None,
            target_path,
            conflict_path: None,
            conflict_is_dir: None,
        },
    );
}

fn emit_stage_error(
    app: &AppHandle,
    transfer_id: &str,
    display_name: &str,
    direction: &str,
    total: u64,
    transferred: u64,
    error: String,
    target_path: Option<String>,
) {
    let _ = app.emit(
        "transfer-progress",
        TransferProgress {
            id: transfer_id.to_string(),
            file_name: display_name.to_string(),
            direction: direction.to_string(),
            total,
            transferred,
            status: "error".to_string(),
            error: Some(error),
            target_path,
            conflict_path: None,
            conflict_is_dir: None,
        },
    );
}

fn collect_pack_entries(source_path: &Path, archive_path: &Path, entries: &mut Vec<(PathBuf, PathBuf)>) -> Result<(), String> {
    entries.push((source_path.to_path_buf(), archive_path.to_path_buf()));

    if source_path.is_dir() {
        let mut children = fs::read_dir(source_path)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        children.sort_by_key(|entry| entry.path());

        for child in children {
            let child_source = child.path();
            let child_archive = archive_path.join(child.file_name());
            collect_pack_entries(&child_source, &child_archive, entries)?;
        }
    }

    Ok(())
}

fn map_stage_progress(index: usize, total_entries: usize, start: u64, span: u64) -> u64 {
    if total_entries == 0 || span == 0 {
        return start;
    }

    if span == 1 {
        return start;
    }

    start + ((index as u64) * (span - 1) / total_entries as u64).min(span - 1)
}

#[tauri::command]
pub fn pack_local_dir(
    source_dir: String,
    target_tar_path: String,
    transfer_id: Option<String>,
    display_name: Option<String>,
    direction: Option<String>,
    progress_total: Option<u64>,
    progress_start: Option<u64>,
    progress_span: Option<u64>,
    target_path: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let tar_file = File::create(&target_tar_path).map_err(|e| e.to_string())?;
            let mut builder = Builder::new(tar_file);
            let path = Path::new(&source_dir);
            let folder_name = path.file_name().ok_or("Invalid directory name")?;
            let display_name = display_name
                .clone()
                .unwrap_or_else(|| folder_name.to_str().unwrap_or("folder").to_string());
            let direction = direction.clone().unwrap_or_else(|| "upload".to_string());
            let total = progress_total.unwrap_or(100);
            let start = progress_start.unwrap_or(0);
            let span = progress_span.unwrap_or(20);

            let mut entries = Vec::new();
            collect_pack_entries(path, Path::new(folder_name), &mut entries)?;

            if let Some(transfer_id) = transfer_id.as_deref() {
                emit_stage_progress(
                    &app,
                    transfer_id,
                    &display_name,
                    &direction,
                    total,
                    start,
                    "transferring",
                    target_path.clone(),
                );
            }

            let total_entries = entries.len();
            for (index, (source_entry, archive_entry)) in entries.iter().enumerate() {
                if source_entry.is_dir() {
                    builder
                        .append_dir(archive_entry, source_entry)
                        .map_err(|e| e.to_string())?;
                } else {
                    let mut file = File::open(source_entry).map_err(|e| e.to_string())?;
                    builder
                        .append_file(archive_entry, &mut file)
                        .map_err(|e| e.to_string())?;
                }

                if let Some(transfer_id) = transfer_id.as_deref() {
                    emit_stage_progress(
                        &app,
                        transfer_id,
                        &display_name,
                        &direction,
                        total,
                        map_stage_progress(index + 1, total_entries, start, span),
                        "transferring",
                        target_path.clone(),
                    );
                }
            }

            builder.finish().map_err(|e| e.to_string())?;

            if let Some(transfer_id) = transfer_id.as_deref() {
                emit_stage_progress(
                    &app,
                    transfer_id,
                    &display_name,
                    &direction,
                    total,
                    start.saturating_add(span).min(total),
                    "transferring",
                    target_path.clone(),
                );
            }

            Ok(())
        })();

        if let Err(error) = result {
            if let Some(transfer_id) = transfer_id.as_deref() {
                emit_stage_error(
                    &app,
                    transfer_id,
                    display_name.as_deref().unwrap_or("folder"),
                    direction.as_deref().unwrap_or("upload"),
                    progress_total.unwrap_or(100),
                    progress_start.unwrap_or(0),
                    error,
                    target_path,
                );
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn unpack_local_dir(
    tar_path: String,
    target_dir: String,
    overwrite: bool,
    transfer_id: Option<String>,
    display_name: Option<String>,
    direction: Option<String>,
    progress_total: Option<u64>,
    progress_start: Option<u64>,
    progress_span: Option<u64>,
    target_path: Option<String>,
    app: AppHandle,
) -> Result<(), String> {
    thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            let display_name = display_name.clone().unwrap_or_else(|| "folder".to_string());
            let direction = direction.clone().unwrap_or_else(|| "download".to_string());
            let total = progress_total.unwrap_or(100);
            let start = progress_start.unwrap_or(0);
            let span = progress_span.unwrap_or(20);

            let count_file = File::open(&tar_path).map_err(|e| e.to_string())?;
            let mut count_archive = Archive::new(count_file);
            let total_entries = count_archive
                .entries()
                .map_err(|e| e.to_string())?
                .count();

            if let Some(transfer_id) = transfer_id.as_deref() {
                emit_stage_progress(
                    &app,
                    transfer_id,
                    &display_name,
                    &direction,
                    total,
                    start,
                    "transferring",
                    target_path.clone(),
                );
            }

            let tar_file = File::open(&tar_path).map_err(|e| e.to_string())?;
            let mut archive = Archive::new(tar_file);
            for (index, entry) in archive.entries().map_err(|e| e.to_string())?.enumerate() {
                let mut entry = entry.map_err(|e| e.to_string())?;
                let entry_path = entry.path().map_err(|e| e.to_string())?.into_owned();
                let destination = Path::new(&target_dir).join(&entry_path);

                if !overwrite && destination.exists() {
                    if let Some(transfer_id) = transfer_id.as_deref() {
                        emit_stage_progress(
                            &app,
                            transfer_id,
                            &display_name,
                            &direction,
                            total,
                            map_stage_progress(index + 1, total_entries, start, span),
                            "transferring",
                            target_path.clone(),
                        );
                    }
                    continue;
                }

                entry.unpack_in(&target_dir).map_err(|e| e.to_string())?;

                if let Some(transfer_id) = transfer_id.as_deref() {
                    emit_stage_progress(
                        &app,
                        transfer_id,
                        &display_name,
                        &direction,
                        total,
                        map_stage_progress(index + 1, total_entries, start, span),
                        "transferring",
                        target_path.clone(),
                    );
                }
            }

            if let Some(transfer_id) = transfer_id.as_deref() {
                emit_stage_progress(
                    &app,
                    transfer_id,
                    &display_name,
                    &direction,
                    total,
                    start.saturating_add(span).min(total),
                    "transferring",
                    target_path.clone(),
                );
            }

            Ok(())
        })();

        if let Err(error) = result {
            if let Some(transfer_id) = transfer_id.as_deref() {
                emit_stage_error(
                    &app,
                    transfer_id,
                    display_name.as_deref().unwrap_or("folder"),
                    direction.as_deref().unwrap_or("download"),
                    progress_total.unwrap_or(100),
                    progress_start.unwrap_or(0),
                    error,
                    target_path,
                );
            }
        }
    });


    Ok(())
}
