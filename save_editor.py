"""Save editor endpoints served by the TO:R Editor's local server."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import struct
import subprocess
from datetime import datetime
from http import HTTPStatus
from pathlib import Path

from tools.menu_mods.compiler.save_archive import MAIN_TAG, SaveArchive
from tools.menu_mods.compiler.tor_formats import FormatError


API = "/api/save-editor/"
SAVE_NAME = re.compile(r"GAME-([0-9]{8})\.SAV", re.I)
BLOCK_LIMIT = 8 * 1024 * 1024
SUMMARY_TAG = 0x10000004
SUMMARY_NAME, NAME_SIZE = 0x1BD, 37
UNIT_START, UNIT_SIZE, UNIT_SLOTS = 0xC6, 0x7B5, 105
GOTH = 0x50


def save_path(folder, name):
    if not SAVE_NAME.fullmatch(name or ""):
        raise PermissionError("Choose a GAME-########.SAV file.")
    path = folder / name
    if path.is_symlink() or path.resolve().parent != folder or (path.exists() and not path.is_file()):
        raise PermissionError("Save files must be regular files inside the selected save folder.")
    return path


def save_files(folder):
    return sorted(
        (path for path in folder.iterdir()
         if SAVE_NAME.fullmatch(path.name) and not path.is_symlink() and path.is_file()),
        key=lambda path: path.name.casefold(),
    ) if folder.is_dir() else []


def save_profiles(override):
    if override is not None:
        return {"selected": override}
    root = (Path.home() / "Documents/My Games/Tactics Ogre Reborn").resolve()
    profiles = []
    for candidate in root.glob("*/*"):
        if not candidate.is_dir() or candidate.resolve() != candidate:
            continue
        stamps = [path.stat().st_mtime_ns for path in save_files(candidate)]
        if stamps:
            profiles.append((max(stamps), candidate.relative_to(root).as_posix(), candidate))
    return {name: folder for _, name, folder in sorted(profiles, reverse=True)}


def game_running():
    if os.name != "nt":
        return False
    command = "$ErrorActionPreference='Stop'; @(Get-Process | Where-Object ProcessName -eq 'Tactics Ogre Reborn').Count"
    try:
        report = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True, text=True, check=True, timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        return int(report.stdout.strip()) > 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        raise PermissionError("Could not check whether Tactics Ogre: Reborn is running.") from exc


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_archive(raw):
    archive = SaveArchive(raw, max_block_size=BLOCK_LIMIT)
    block = archive.blocks.get(MAIN_TAG)
    if block is None or len(block.payload) < UNIT_START + UNIT_SLOTS * UNIT_SIZE:
        raise FormatError("Save has an unsupported main block.")
    return archive, block.payload


def summarize(path):
    raw = path.read_bytes()
    info = {
        "name": path.name,
        "slot": int(SAVE_NAME.fullmatch(path.name)[1]),
        "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds"),
        "sha256": sha(raw),
    }
    try:
        _, main = load_archive(raw)
        leader = main[UNIT_START + 1:UNIT_START + 1 + NAME_SIZE].split(b"\0", 1)[0]
        count = sum(bool(main[UNIT_START + i * UNIT_SIZE]) for i in range(UNIT_SLOTS))
        info.update(ok=True, units=count, goth=struct.unpack_from("<I", main, GOTH)[0],
                    leader=leader.decode("utf-8", "replace"))
    except FormatError as exc:
        info.update(ok=False, error=str(exc))
    return info


def selected_profile(config, query):
    profiles = save_profiles(config.saves_root)
    key = query.get("profile") or next(iter(profiles), None)
    if key is not None and key not in profiles:
        raise FileNotFoundError("Save profile is no longer available. Reload the save list.")
    return key, profiles


def send_bytes(handler, data, **headers):
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", "application/octet-stream")
    handler.send_header("Content-Length", str(len(data)))
    for name, value in headers.items():
        handler.send_header(name.replace("_", "-"), value)
    handler.end_headers()
    handler.wfile.write(data)


def read_assets(handler, route, query):
    config = handler.config
    if route == "data/info":
        installed = config.state().get("applied") or {}
        return handler._json({
            "dataRoot": str(config.data_root), "readOnly": config.read_only,
            "customCharacters": installed.get("customCharacters", []),
            "customIcons": installed.get("customIcons", []),
        })
    if route == "data/list":
        folder = config.resolve(query.get("dir"))
        return handler._json({"files": [
            {"name": path.name, "size": path.stat().st_size}
            for path in sorted(folder.iterdir()) if path.is_file()
        ]})
    path = config.resolve(query.get("path"))
    size = path.stat().st_size
    limit = int(query.get("max", size))
    if limit < 0:
        raise ValueError("Invalid read size.")
    with path.open("rb") as file:
        data = file.read(min(limit, size))
    return send_bytes(handler, data, X_File_Size=str(size))


def get(handler, route):
    config, query = handler.config, handler._query()
    route = route[len(API):]
    if route in ("data/info", "data/list", "data/file"):
        return read_assets(handler, route, query)
    if route == "backups":
        backup_root = config.save_backup_root
        backups = []
        for meta in sorted(backup_root.glob("*/backup.json"), reverse=True):
            if meta.resolve().parent.parent != backup_root:
                continue
            backups.append(json.loads(meta.read_text(encoding="utf-8")) | {"folder": str(meta.parent)})
        return handler._json({"folder": str(backup_root), "backups": backups})
    if route not in ("saves", "slot"):
        return handler._error(HTTPStatus.NOT_FOUND, "Unknown save editor endpoint.")
    key, profiles = selected_profile(config, query)
    if route == "saves":
        write_error = "The editor is running in read-only mode." if config.read_only else ""
        running = False
        if not write_error:
            try:
                running = game_running()
            except PermissionError as exc:
                write_error = str(exc)
        return handler._json({
            "profiles": list(profiles), "profile": key,
            "folder": str(profiles[key]) if key is not None else "",
            "gameRunning": running, "writeError": write_error,
            "saves": [summarize(path) for path in save_files(profiles[key])] if key is not None else [],
        })
    if key is None:
        raise FileNotFoundError("No local save profile was found.")
    raw = save_path(profiles[key], query.get("name")).read_bytes()
    _, main = load_archive(raw)
    return send_bytes(handler, main, X_Save_Sha256=sha(raw))


def write(handler, atomic_replace):
    config = handler.config
    query = handler._query()
    if not query.get("profile"):
        raise ValueError("Choose a save profile before saving.")
    length = int(handler.headers.get("Content-Length", 0))
    if not 0 < length <= 12 * 1024 * 1024:
        raise ValueError("Invalid save editor request size.")
    body = json.loads(handler.rfile.read(length))
    if not isinstance(body, dict) or not isinstance(body.get("main"), str):
        raise ValueError("Missing decoded save data.")
    main = base64.b64decode(body["main"], validate=True)
    with config.write_lock:
        if game_running():
            return handler._error(HTTPStatus.CONFLICT, "Close Tactics Ogre: Reborn before saving.")
        key, profiles = selected_profile(config, query)
        folder = profiles[key]
        source = save_path(folder, query.get("name"))
        target = save_path(folder, query.get("target") or source.name)
        original = source.read_bytes()
        target_original = original if source == target else target.read_bytes() if target.is_file() else None
        original_hash = sha(original)
        if original_hash != body.get("expectSha256"):
            return handler._error(HTTPStatus.CONFLICT, "The open save changed on disk. Reload it before saving.")
        if target != source and (
            "expectTargetSha256" not in body or
            (sha(target_original) if target_original is not None else None) != body["expectTargetSha256"]
        ):
            return handler._error(HTTPStatus.CONFLICT, "The destination slot changed on disk. Reload the save list.")
        archive, old_main = load_archive(original)
        if len(main) != len(old_main) or main[:4] != old_main[:4]:
            raise FormatError("The save layout or version changed.")
        replacements = {MAIN_TAG: main}
        old_name = old_main[UNIT_START + 1:UNIT_START + 1 + NAME_SIZE]
        new_name = main[UNIT_START + 1:UNIT_START + 1 + NAME_SIZE]
        if (new_name != old_name or target != source) and SUMMARY_TAG in archive.blocks:
            summary = bytearray(archive.blocks[SUMMARY_TAG].payload)
            if len(summary) >= SUMMARY_NAME + NAME_SIZE:
                summary[SUMMARY_NAME:SUMMARY_NAME + NAME_SIZE] = new_name
                replacements[SUMMARY_TAG] = bytes(summary)
        rebuilt = archive.rebuild(replacements)
        if target == source and rebuilt == original:
            return handler._json({"written": False, "sha256": original_hash, "message": "No changes to save."})

        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        backup = config.save_backup_root / stamp
        backup.mkdir(parents=True)
        copies = {target: target_original, source: original}
        for path, data in copies.items():
            if data is None:
                continue
            copy = backup / path.name
            copy.write_bytes(data)
            if copy.read_bytes() != data:
                raise OSError("The save backup could not be verified.")
        (backup / "backup.json").write_text(json.dumps({
            "time": stamp, "savesFolder": str(folder),
            "files": [path.name for path, data in copies.items() if data is not None],
            "editedFrom": source.name, "writtenTo": target.name,
        }, indent=2), encoding="utf-8")
        if source.read_bytes() != original or (
            target != source and (target.read_bytes() if target.is_file() else None) != target_original
        ):
            return handler._error(HTTPStatus.CONFLICT, "A save changed during backup. Reload before saving.")
        if game_running():
            return handler._error(HTTPStatus.CONFLICT, "Close Tactics Ogre: Reborn before saving.")
        atomic_replace(target, rebuilt)
        if target.read_bytes() != rebuilt:
            if target_original is None:
                target.unlink()
            else:
                atomic_replace(target, target_original)
            raise OSError("The written save could not be verified.")
        return handler._json({"written": True, "target": target.name, "backup": str(backup),
                              "sha256": sha(rebuilt), "message": f"Saved {target.name}. Backup: {backup}"})
