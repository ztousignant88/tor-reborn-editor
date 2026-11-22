"""Local server for the Tactics Ogre: Reborn battle editor.

Serves the web UI and a minimal file API scoped to the game's Data folder.
All game-format work (decryption, zip, pakd, tables) happens in the browser;
this server only reads files, and writes them after backing up the original.

Projects (editor/projects/<name>/: project.json plus files/<path in Data>)
hold edited game files apart from the game. While one is open, reads see its
files over the game data from before project apply. The file index reflects
those files and saves go
into it, not the game. Applying a project copies its files into the game
(backing up originals and patching FileTable.bin); the project applied last
is remembered, so applying another can put the first one's other files back.

Usage:
    python serve.py [--data "<path to Tactics Ogre Reborn/Data>"] [--port 8642]
                    [--projects <folder>] [--readonly] [--no-browser]
"""
import argparse
import art_registry
import icon_import
from apply_progress import ApplyProgress
import project_merge
import ai_validation
import ai_choices_data
import class_change
import dorgalua_xl
import integrated_content
import battle_encounters
import weapon_mods
import modprep_groups
import modprep_sets
import modprep_equipperms
import modprep_spellsets
import importlib.util
import base64
import uuid
import hashlib
import json
import math
import os
import re
import save_editor
import versus
import versus_tournaments
import shutil
import socket
import stat
import sys
import tempfile
import threading
import time
import webbrowser
import zipfile
from io import BytesIO
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tools.menu_mods.compiler import level_cap_99
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
WEB_ROOT = HERE / "web"
_menu_spec = importlib.util.spec_from_file_location("tor_menu_runtime", HERE / "menu_runtime.py")
menu_runtime = importlib.util.module_from_spec(_menu_spec)
_menu_spec.loader.exec_module(menu_runtime)
WRITABLE_SUFFIXES = {".dat", ".bin"}
API_HEADER = "X-TOR-Editor"  # custom header: blocks cross-site form posts
TABLE_NAME = "FileTable.bin"
PROJECT_FILE = "project.json"
STATE_FILE = ".state.json"  # in the projects folder: {"open": name, "applied": {...}}
PROJECT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _\-().']{0,59}")


def _sha1(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _restriction_settings(value):
    if not isinstance(value, dict) or type(value.get("version")) is not int or value.get("version") != 1 or not isinstance(value.get("groups"), dict):
        raise ValueError("invalid restriction group settings")
    groups = {}
    if len(value["groups"]) > 256:
        raise ValueError("too many restriction groups")
    for key, name in value["groups"].items():
        if not isinstance(key, str) or not re.fullmatch(r"0|[1-9][0-9]{0,2}", key) or int(key) > 255 or not isinstance(name, str) or len(name) > 80:
            raise ValueError("invalid restriction group ID or name")
        groups[key] = name
    return {"version": 1, "groups": groups}


class EditorConfig:
    def __init__(self, data_root: Path, backup_root: Path, project_root: Path, read_only: bool,
                 saves_root: Path | None = None):
        self.data_root = data_root
        self.backup_root = backup_root
        self.project_root = project_root
        self.read_only = read_only
        self.saves_root = saves_root
        self.save_backup_root = (backup_root.parent / "saves").resolve()
        self.write_lock = threading.Lock()
        self.apply_progress = ApplyProgress()

    def resolve(self, rel: str) -> Path:
        """Map a client path (relative to Data/) to a real path inside the data root."""
        rel = (rel or "").replace("\\", "/").lstrip("/")
        target = (self.data_root / rel).resolve()
        if target != self.data_root and self.data_root not in target.parents:
            raise PermissionError("path escapes data root")
        return target

    def rel(self, path: Path) -> str:
        return path.relative_to(self.data_root).as_posix()

    # ---- projects ------------------------------------------------------
    def state(self) -> dict:
        # read on every file request while a project is open: kept until the file changes
        path = self.project_root / STATE_FILE
        try:
            stamp = path.stat().st_mtime_ns
            if getattr(self, "_state_cache", (None,))[0] != stamp:
                self._state_cache = (stamp, json.loads(path.read_text(encoding="utf-8")))
            return json.loads(json.dumps(self._state_cache[1]))  # a copy callers may change
        except (OSError, ValueError):
            return {}

    def save_state(self, state: dict):
        self.project_root.mkdir(parents=True, exist_ok=True)
        _atomic_replace(self.project_root / STATE_FILE, json.dumps(state, indent=1).encode("utf-8"))

    def project_dir(self, name: str) -> Path:
        name = (name or "").strip()
        if not PROJECT_NAME.fullmatch(name):
            raise PermissionError("project names use letters, digits, spaces and - _ ( ) ' (up to 60)")
        return self.project_root / name

    def project(self, name: str) -> dict:
        return json.loads((self.project_dir(name) / PROJECT_FILE).read_text(encoding="utf-8"))

    def save_project(self, name: str, meta: dict):
        meta["saved"] = _now()
        _atomic_replace(self.project_dir(name) / PROJECT_FILE, json.dumps(meta, indent=1).encode("utf-8"))

    def open_project(self):
        """The open project's name, or None (edits then go straight to the game)."""
        name = self.state().get("open")
        try:
            return name if name and (self.project_dir(name) / PROJECT_FILE).is_file() else None
        except PermissionError:
            return None

    def applied_base(self, rel, applied):
        """The file from before a project changed it. None for project-only files."""
        digest = applied.get("baseFiles", {}).get(rel)
        if digest:
            if not re.fullmatch(r"[0-9a-f]{40}", digest):
                raise ValueError("Invalid project baseline for " + rel)
            path = self.project_root / ".merge-bases" / digest
            if not path.is_file():
                raise FileNotFoundError("Missing saved project baseline for " + rel)
            return path
        if rel in applied.get("newFiles", []):
            return None
        backup = self.backup_root / rel
        return backup if backup.is_file() else self.resolve(rel)

    def project_path(self, path: Path, name: str, applied):
        rel = self.rel(path)
        copy = self.project_dir(name) / "files" / rel
        if copy.is_file():
            return copy
        return self.applied_base(rel, applied) if rel in applied.get("files", {}) else path

    def editable_path(self, path: Path):
        """The open project's source or the live file in direct-edit mode."""
        state = self.state()
        name = state.get("open")
        if name and (self.project_dir(name) / PROJECT_FILE).is_file():
            return self.project_path(path, name, state.get("applied") or {})
        return path

    def read_editable(self, path: Path):
        source = self.editable_path(path)
        if source is None:
            raise FileNotFoundError(self.rel(path) + " is not in this project")
        return source.read_bytes()

    def restriction_groups(self):
        name = self.open_project()
        if name:
            value = self.project(name).get("editor", {}).get("restrictionGroups")
        else:
            path = self.project_root / ".restriction-groups.json"
            saved = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
            value = saved.get(str(self.data_root.resolve()).casefold())
        return {"exists": value is not None, "settings": _restriction_settings(value) if value is not None else {"version": 1, "groups": {}}, "project": name}

    def save_restriction_groups(self, value):
        settings = _restriction_settings(value)
        name = self.open_project()
        if name:
            meta = self.project(name)
            meta.setdefault("editor", {})["restrictionGroups"] = settings
            self.save_project(name, meta)
        else:
            path = self.project_root / ".restriction-groups.json"
            saved = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
            saved[str(self.data_root.resolve()).casefold()] = settings
            self.project_root.mkdir(parents=True, exist_ok=True)
            _atomic_replace(path, json.dumps(saved, indent=2).encode("utf-8"))
        return settings

    def custom_characters(self):
        name = self.open_project()
        meta = self.project(name) if name else self.state().get("applied") or {}
        return art_registry.characters(meta.get("editor", {}).get("customCharacters", meta.get("customCharacters")))

    def custom_icons(self):
        name = self.open_project()
        meta = self.project(name) if name else self.state().get("applied") or {}
        return icon_import.catalog(meta.get("editor", {}).get("customIcons", meta.get("customIcons")))

    def virtual_table(self, content=None) -> bytes:
        """FileTable.bin as the open project sees it: the game's, with the project's file sizes."""
        table = (self.data_root / TABLE_NAME).read_bytes()
        name = self.open_project()
        if name:
            meta = self.project(name)
            applied = self.state().get("applied") or {}
            sizes = {}
            for rel in applied.get("files", {}):
                base = self.applied_base(rel, applied)
                if base is not None and base.is_file():
                    sizes[rel] = base.stat().st_size
            sizes.update({rel: entry["size"] for rel, entry in meta.get("files", {}).items()})
            sizes.update({rel: len(data) for rel, data in (content or {}).items()})
            encounters = [entry for entry in battle_encounters.registrations(menu_runtime.project_settings(meta))
                          if entry['path'] in (content or {})]
            registrations = art_registry.registrations(meta.get("editor", {}).get("artEntries")) + encounters
            table = art_registry.reconcile(table, registrations, sizes, applied.get("artEntries", []))
        return table


class Handler(SimpleHTTPRequestHandler):
    config: EditorConfig = None  # set in main()
    protocol_version = "HTTP/1.1"  # keep-alive: the editor makes hundreds of small reads

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def log_message(self, fmt, *args):  # keep the console quiet except for errors
        if args and isinstance(args[1], str) and args[1].startswith(("4", "5")):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---- helpers -------------------------------------------------------
    def _json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, status, message):
        self._json({"error": message}, status)

    def _query(self):
        return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

    def _require_api_header(self):
        if self.headers.get(API_HEADER) != "1":
            self._error(HTTPStatus.FORBIDDEN, "missing editor header")
            return False
        return True

    # ---- routing -------------------------------------------------------
    def do_GET(self):
        route = urlparse(self.path).path
        if not route.startswith("/api/"):
            return super().do_GET()
        if not self._require_api_header():
            return
        try:
            if route.startswith(save_editor.API):
                return save_editor.get(self, route)
            if route.startswith(versus.API):
                return versus.get(self, route)
            if route == "/api/info":
                state = self.config.state()
                project = self.config.open_project()
                try:
                    menu_options = menu_runtime.selected(self.config, project)
                except ValueError:
                    menu_options = menu_runtime.settings()
                # never wait for the open project's generated content here: it can take
                # half a minute. Use it if it is ready, else build it in the background.
                preview = self._integrated_ready() if project else None
                return self._json({
                    "dataRoot": str(self.config.data_root),
                    "readOnly": self.config.read_only,
                    "artImportVersion": 2,
                    "customCharacterVersion": 1,
                    "customCharacters": self.config.custom_characters(),
                    "customIconVersion": 1,
                    "customIcons": self.config.custom_icons(),
                    "menuModsVersion": 1,
                    "dorgaluaXLFixVersion": 1,
                    "projectMergeVersion": 1,
                    "applyProgressVersion": 1,
                    "specialClassChangeVersion": 2,
                    "specialClassChangeEnabled": menu_options["specialClassChange"],
                    "weaponModsVersion": 2,
                    "integratedContentVersion": 1,
                    "integratedContentError": preview[2] if preview else None,
                    "integratedContentPending": bool(project) and preview is None,
                    "hardModeVersion": 10,
                    "expandedBattlesSupported": menu_runtime.battle_capacity_supported(self.config),
                    "versusModsVersion": 1,
                    "versusEnabled": bool(project and menu_options[versus.MOD_KEY]),
                    "expandedBattleUnitLimit": battle_encounters.CAPACITY,
                    "battleUnitLimit": battle_encounters.CAPACITY if menu_options[battle_encounters.KEY] else battle_encounters.STOCK_CAPACITY,
                    "encounterLinks": battle_encounters.links(menu_options if project else (state.get('menuRuntime') or {}).get('settings', {})),
                    "enemyLevelsVersion": 1,
                    "levelCap99Version": 1,
                    "levelCap99Enabled": menu_options["levelCap99"],
                    "startingCardsVersion": 1,
                    "startingStatusVersion": 1,
                    "trapAiVersion": 1,
                    "trapAiProfile": menu_options["trapAiProfile"],
                    "backupRoot": str(self.config.backup_root),
                    "projectRoot": str(self.config.project_root),
                    "project": project,
                    "applied": (state.get("applied") or {}).get("name"),
                })
            if route == "/api/project/apply-status":
                return self._json(self.config.apply_progress.status(self._query().get("id")))
            if route == "/api/menu-mods":
                return self._json(menu_runtime.info(self.config))
            if route == "/api/project/export-class-change":
                return self._export_class_change()
            if route == "/api/restriction-groups":
                return self._json(self.config.restriction_groups())
            if route == "/api/preview-alignment":
                path = self.config.project_root / ".preview-alignment.json"
                return self._json(json.loads(path.read_text(encoding="utf-8")) if path.exists() else {})
            if route == "/api/list":
                return self._list()
            if route == "/api/file":
                return self._read_file()
            if route == "/api/maps":
                return self._maps_list()
            if route == "/api/map":
                return self._map_read()
            if route == "/api/backups":
                return self._json({"files": self._backed_up_files()})
            if route == "/api/projects":
                return self._projects()
            if route == "/api/project/characters":
                return self._project_characters()
            if route == "/api/project/file":
                return self._project_file()
            return self._error(HTTPStatus.NOT_FOUND, "unknown endpoint")
        except PermissionError as e:
            return self._error(HTTPStatus.FORBIDDEN, str(e))
        except FileNotFoundError:
            return self._error(HTTPStatus.NOT_FOUND, "file not found")
        except (OSError, ValueError) as e:
            if route.startswith((save_editor.API, versus.API)) and isinstance(e, ValueError):
                return self._error(HTTPStatus.UNPROCESSABLE_ENTITY, str(e))
            return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, str(e))

    def do_POST(self):
        route = urlparse(self.path).path
        if not self._require_api_header():
            return
        try:
            if route.startswith(versus.API):
                return versus.post(self, route, _atomic_replace)
            if self.config.read_only:
                return self._error(HTTPStatus.FORBIDDEN, "server started with --readonly")
            if route == save_editor.API + "slot":
                return save_editor.write(self, _atomic_replace)
            if route == "/api/menu-mods":
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 512*1024:
                    raise ValueError("Invalid menu settings size")
                body = json.loads(self.rfile.read(length))
                with self.config.write_lock:
                    result = menu_runtime.save(self.config, body, _atomic_replace)
                return self._json(result)
            if route == "/api/restriction-groups":
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 65536:
                    raise ValueError("invalid restriction settings size")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("invalid restriction settings body")
                with self.config.write_lock:
                    if body.get("project") != self.config.open_project() or body.get("dataRoot") != str(self.config.data_root):
                        raise ValueError("Game/project changed; reload before saving restriction group names")
                    self.config.save_restriction_groups(body.get("settings"))
                return self._json({"saved": True, "project": self.config.open_project()})
            if route == "/api/preview-alignment":
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2048:
                    raise ValueError("invalid alignment size")
                body = json.loads(self.rfile.read(length))
                name = body.get("map", "")
                if not re.fullmatch(r"bg[0-9A-Za-z_]{1,80}", name):
                    raise ValueError("invalid map name")
                version = body.get("version", 2)
                if type(version) is not int or version not in (2, 3):
                    raise ValueError("invalid alignment version")
                adjust = body.get("adjust", {})
                limits = {"dx": (-8192, 8192), "dy": (-8192, 8192), "scale": (0.05, 20), "pitch": (-1.4, 1.4)}
                if set(adjust) != set(limits):
                    raise ValueError("invalid alignment fields")
                for key, (lo, hi) in limits.items():
                    value = adjust[key]
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
                        raise ValueError("invalid alignment value")
                with self.config.write_lock:
                    path = self.config.project_root / ".preview-alignment.json"
                    saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
                    saved[name] = {"version": version, "adjust": adjust}
                    self.config.project_root.mkdir(parents=True, exist_ok=True)
                    _atomic_replace(path, json.dumps(saved, indent=2).encode("utf-8"))
                return self._json({"saved": True})
            if route == "/api/file":
                return self._write_file()
            if route == "/api/save/check":
                return self._check_save()
            if route == "/api/map":
                return self._map_write()
            if route == "/api/map/delete":
                return self._map_delete()
            if route == "/api/restore":
                return self._restore()
            if route == "/api/art/stage":
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 96 * 1024 * 1024:
                    raise ValueError("art import request is too large")
                return self._json(_stage_art_project(self.config, json.loads(self.rfile.read(length)), self._integrated_view))
            if route == "/api/project/new":
                return self._project_new()
            if route == "/api/project/open":
                return self._project_open()
            if route == "/api/project/saveas":
                return self._project_save_as()
            if route == "/api/project/merge":
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 2 * 1024 * 1024:
                    raise ValueError("Invalid project merge request size")
                return self._json(project_merge.handle(self, self._body(), menu_runtime, _now, _atomic_replace))
            if route == "/api/project/apply":
                return self._project_apply()
            return self._error(HTTPStatus.NOT_FOUND, "unknown endpoint")
        except PermissionError as e:
            return self._error(HTTPStatus.FORBIDDEN, str(e))
        except FileExistsError as e:
            return self._error(HTTPStatus.CONFLICT, str(e))
        except FileNotFoundError as e:
            return self._error(HTTPStatus.NOT_FOUND, str(e))
        except (OSError, ValueError) as e:
            if (route == save_editor.API + "slot" or route.startswith(versus.API)) and isinstance(e, ValueError):
                return self._error(HTTPStatus.UNPROCESSABLE_ENTITY, str(e))
            return self._error(HTTPStatus.INTERNAL_SERVER_ERROR, str(e))

    # ---- endpoints -----------------------------------------------------
    def _list(self):
        folder = self.config.resolve(self._query().get("dir", ""))
        entries = []
        name = self.config.open_project()
        applied = (self.config.state().get("applied") or {}) if name else {}
        for entry in sorted(os.scandir(folder), key=lambda e: e.name.lower()):
            if entry.is_file():
                path = Path(entry.path)
                visible = self.config.project_path(path, name, applied) if name else path
                if visible is not None:
                    entries.append({"name": entry.name, "size": visible.stat().st_size})
        known = {entry["name"].casefold() for entry in entries}
        if name:
            for rel, info in self.config.project(name).get("files", {}).items():
                path = self.config.resolve(rel)
                if path.parent == folder and path.name.casefold() not in known:
                    entries.append({"name": path.name, "size": info["size"]})
                    known.add(path.name.casefold())
            if self.config.rel(folder) in ('battle/entry', 'event/scene'):
                encounters = battle_encounters.registrations(menu_runtime.selected(self.config, name))
                if encounters:
                    content, _, _ = self._integrated_view()
                    for entry in encounters:
                        path = self.config.resolve(entry['path'])
                        if path.parent == folder and path.name.casefold() not in known and entry['path'] in content:
                            entries.append({"name": path.name, "size": len(content[entry['path']])})
        self._json({"files": sorted(entries, key=lambda entry: entry["name"].lower())})

    # ---- map library: whole maps saved under their own names, apart from projects ----
    # editor/maps/<name>.dat is a map file exactly as the game stores one (the
    # editor's encoded bytes); <name>.json says which map it was made from and its
    # size. Nothing here is read by the game: the editor places a saved map over a
    # game map through the normal save path.
    def _maps_dir(self) -> Path:
        return self.config.project_root.parent / "maps"

    def _map_file(self, name: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _.()\-]{0,59}", name or "") or name.endswith("."):
            raise ValueError("Map names use letters, numbers, spaces and _ . ( ) -, up to 60 characters")
        return self._maps_dir() / (name + ".dat")

    def _maps_list(self):
        folder, maps = self._maps_dir(), []
        if folder.is_dir():
            for entry in sorted(folder.glob("*.dat"), key=lambda p: p.name.lower()):
                meta_path = entry.with_suffix(".json")
                try:
                    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.is_file() else {}
                except (OSError, ValueError):
                    meta = {}
                maps.append({"name": entry.stem, "size": entry.stat().st_size, "saved": meta.get("saved"),
                             "source": meta.get("source"), "width": meta.get("width"), "depth": meta.get("depth")})
        self._json({"maps": maps})

    def _map_read(self):
        path = self._map_file(self._query().get("name", ""))
        if not path.is_file():
            return self._error(HTTPStatus.NOT_FOUND, "no saved map with that name")
        data = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _map_write(self):
        q = self._query()
        path = self._map_file(q.get("name", ""))
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length)
        if len(data) != length or length == 0:
            return self._error(HTTPStatus.BAD_REQUEST, "incomplete upload")
        if path.is_file() and q.get("replace") != "1":
            return self._error(HTTPStatus.CONFLICT, "a saved map with that name exists")
        meta = {"name": path.stem, "saved": _now(), "source": q.get("source", "")[:40],
                "width": int(q.get("width", "0") or 0), "depth": int(q.get("depth", "0") or 0)}
        with self.config.write_lock:
            path.parent.mkdir(parents=True, exist_ok=True)
            _atomic_replace(path, data)
            _atomic_replace(path.with_suffix(".json"), json.dumps(meta, indent=1).encode("utf-8"))
        self._json({"ok": True, **meta, "size": len(data)})

    def _map_delete(self):
        path = self._map_file(self._query().get("name", ""))
        with self.config.write_lock:
            for p in (path, path.with_suffix(".json")):
                if p.is_file():
                    p.unlink()
        self._json({"ok": True})

    def _read_file(self):
        q = self._query()
        path = self.config.resolve(q.get("path", ""))
        rel = self.config.rel(path)
        revision = None
        tracked = self.headers.get("X-TOR-Track-File") == "1"
        if tracked or rel == TABLE_NAME or integrated_content.preview_path(rel):
            with self.config.write_lock:
                content, _, _ = self._integrated_view() if rel == TABLE_NAME or integrated_content.preview_path(rel) else ({}, {}, None)
                if rel == TABLE_NAME:
                    whole = self.config.virtual_table(content)
                else:
                    whole = content.get(rel)
                    if whole is not None:
                        revision = _sha1(whole)
                    elif tracked:
                        whole = self.config.read_editable(path)
                if tracked:
                    scope = self._file_scope(self.config.open_project())
                    token = self._file_revision(rel, whole, content)
        else:
            whole = None
        if whole is None:
            visible = self.config.editable_path(path)
            if visible is None:
                raise FileNotFoundError(rel + " is not in this project")
            path = visible
        size = len(whole) if whole is not None else path.stat().st_size
        limit = int(q["max"]) if "max" in q else size
        if whole is not None:
            data = whole[:limit]
        else:
            with open(path, "rb") as f:
                data = f.read(min(limit, size))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-File-Size", str(size))
        if revision is not None:
            self.send_header("X-TOR-Content-View", revision)
        if tracked:
            self.send_header("X-TOR-File-Scope", scope)
            self.send_header("X-TOR-File-Revision", token)
        self.end_headers()
        self.wfile.write(data)

    def _write_file(self):
        rel = self._query().get("path", "")
        path = self.config.resolve(rel)
        if path.suffix.lower() not in WRITABLE_SUFFIXES:
            raise PermissionError("only .dat and .bin files can be written")
        length = int(self.headers.get("Content-Length", "0"))
        data = self.rfile.read(length)
        if len(data) != length or length == 0:
            return self._error(HTTPStatus.BAD_REQUEST, "incomplete upload")
        with self.config.write_lock:
            name = self.config.open_project()
            original = self.config.editable_path(path)
            if self.headers.get("X-TOR-File-Scope"):
                return self._write_tracked_file(name, path, data)
            if name:
                view = self.headers.get("X-TOR-Content-View")
                content, defaults, read = self._integrated_view() if integrated_content.preview_path(rel) else ({}, {}, None)
                if view or rel in content:
                    if rel not in content or view != _sha1(content[rel]):
                        raise ValueError("The integrated mod view changed. Reload before saving "+rel)
                    return self._json({"ok": True, "project": name,
                                       **self._save_integrated_edit(name, path, read, defaults[rel], content[rel], data,
                                           self._integrated_text_keys(defaults, read) if rel.startswith("localize/") else ())})
                if original is None or not original.is_file():
                    raise PermissionError("New files need a FileTable registration before saving")
                return self._json({"ok": True, "size": len(data), "project": name, **self._write_to_project(name, path, data)})
            if self.headers.get("X-TOR-Content-View"):
                raise ValueError("The project changed. Reload before saving integrated content")
            if original is None or not original.is_file():
                raise PermissionError("New files need a FileTable registration before saving")
            backed_up = self._backup(path)
            _atomic_replace(path, data)
        self._json({"ok": True, "size": len(data), "backedUp": backed_up})

    def _file_scope(self, name):
        return _sha1(json.dumps([str(self.config.data_root), name]).encode())

    def _file_revision(self, rel, data, content):
        if rel not in content:
            return "raw:" + _sha1(data)
        options = menu_runtime.selected(self.config)
        generation = json.dumps({key: options[key] for key in integrated_content.SETTINGS}, sort_keys=True).encode()
        return _sha1(generation) + ":" + _sha1(data)

    def _save_conflict(self, rel, current, revision, recorded, expected, original_size):
        if not expected or expected.split(":", 1)[0] != revision.split(":", 1)[0]:
            raise ValueError("Integrated Mod settings changed. Reload before editing " + rel)
        token = f"{revision}:{recorded}"
        changed = expected != revision or recorded != original_size or len(current) != original_size
        return token, changed

    def _check_file_scope(self, name, scope):
        valid = {self._file_scope(name)}
        # Save As keeps the current editor data and writes it to the new copy.
        clone = (self.config.state().get("saveAs") or {})
        if clone.get("target") == name:
            valid.add(self._file_scope(clone.get("source")))
        if scope not in valid:
            raise ValueError("The open project changed. Reopen the project before saving.")

    def _check_save(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 1024 * 1024:
            raise ValueError("Invalid save preview size.")
        request = self._body()
        files = request.get("files") if isinstance(request, dict) else None
        if not isinstance(files, list) or any(
            not isinstance(file, dict) or not all(isinstance(file.get(key), str) for key in ("path", "scope", "revision"))
            or type(file.get("originalSize")) is not int for file in files
        ):
            raise ValueError("Invalid file save preview.")
        with self.config.write_lock:
            name = self.config.open_project()
            content, _, _ = self._integrated_view()
            table = bytearray(self.config.virtual_table(content))
            conflicts = []
            for file in files:
                self._check_file_scope(name, file["scope"])
                path = self.config.resolve(file["path"])
                rel = self.config.rel(path)
                current = content[rel] if rel in content else self.config.read_editable(path)
                revision = self._file_revision(rel, current, content)
                recorded = _set_recorded_size(table, rel, len(current))
                token, changed = self._save_conflict(rel, current, revision, recorded,
                                                      file["revision"], file["originalSize"])
                if changed:
                    conflicts.append({"path": rel, "overwrite": token})
        self._json({"conflicts": conflicts})

    def _write_tracked_file(self, name, path, data):
        """Compare and replace under the same lock, updating the current file index."""
        self._check_file_scope(name, self.headers["X-TOR-File-Scope"])
        rel = self.config.rel(path)
        if rel == TABLE_NAME:
            raise ValueError("Save tracked game files individually to update FileTable.bin.")
        content, defaults, read = self._integrated_view() if integrated_content.preview_path(rel) else ({}, {}, None)
        current = content[rel] if rel in content else self.config.read_editable(path)
        revision = self._file_revision(rel, current, content)
        expected = self.headers.get("X-TOR-File-Revision", "")
        original_size = int(self.headers["X-TOR-Original-Size"])
        overwrite = self.headers.get("X-TOR-Overwrite")
        table_path = self.config.data_root / TABLE_NAME
        old_table = table_path.read_bytes() if name is None else None
        table = bytearray(old_table if old_table is not None else self.config.virtual_table(content))
        recorded = _set_recorded_size(table, rel, len(data))
        conflict, changed = self._save_conflict(rel, current, revision, recorded, expected, original_size)
        if overwrite != conflict and (overwrite or changed):
            return self._json({"error": rel + " changed since it was opened.",
                               "overwrite": conflict}, HTTPStatus.CONFLICT)
        if rel in content:
            result = self._save_integrated_edit(name, path, read, defaults[rel], current, data,
                                               self._integrated_text_keys(defaults, read) if rel.startswith("localize/") else ())
            return self._json({"ok": True, "project": name, **result,
                               "revision": revision.split(":", 1)[0] + ":" + result["view"], "scope": self._file_scope(name)})
        if name:
            result = self._write_to_project(name, path, data)
        else:
            result = {"backedUp": self._backup(path)}
            if table != old_table:
                self._backup(table_path)
            try:
                _atomic_replace(path, data)
                if table != old_table:
                    _atomic_replace(table_path, table)
            except OSError:
                _atomic_replace(path, current)
                if table_path.read_bytes() != old_table:
                    _atomic_replace(table_path, old_table)
                raise
        self._json({"ok": True, "project": name, "size": len(data),
                    "revision": "raw:" + _sha1(data), "scope": self._file_scope(name), **result})

    def _write_to_project(self, name: str, path: Path, data: bytes, meta=None) -> dict:
        """A save while a project is open: the file goes into the project, never the game.
        FileTable.bin isn't kept (the project's sizes are patched in when it is read or
        applied). A file saved back to what the project started from leaves the project."""
        rel = self.config.rel(path)
        if rel == TABLE_NAME:
            return {"virtual": True}
        if meta is None:
            meta = self.config.project(name)
        files = meta.setdefault("files", {})
        original = self.config.editable_path(path)
        entry = files.get(rel)
        if entry is None:
            baseline = original.read_bytes() if original is not None and original.is_file() else None
            entry = {"base": _sha1(baseline) if baseline is not None else None}
            if baseline is not None and baseline != data:
                project_merge.remember_base(self.config, baseline, _atomic_replace)
        copy = self.config.project_dir(name) / "files" / rel
        if _sha1(data) == entry["base"]:
            if copy.exists():
                copy.unlink()
            files.pop(rel, None)
            self.config.save_project(name, meta)
            return {"unchanged": True}
        copy.parent.mkdir(parents=True, exist_ok=True)
        _atomic_replace(copy, data)
        files[rel] = {**entry, "sha1": _sha1(data), "size": len(data), "saved": _now()}
        self.config.save_project(name, meta)
        return {}

    def _save_integrated_edit(self, name, path, read, generated, effective, data, text_keys=()):
        rel = self.config.rel(path)
        meta = self.config.project(name)
        if rel in battle_encounters.ROSTERS:
            key, = (key for key, fight in battle_encounters.selected(menu_runtime.project_settings(meta)).items()
                    if fight['path'] == rel)
            battle_encounters.roster_count(data)
            meta.setdefault('editor', {}).setdefault(battle_encounters.ROSTER_EDITS, {})[key] = data.hex()
            self.config.save_project(name, meta)
            self.config._integrated_cache = None
            return {"size": len(data), "view": _sha1(data)}
        if rel.startswith(('event/scene/', 'menu/mapname/')):
            raise ValueError('This built-in encounter archive is generated from its Hard Mode toggle')
        raw = read(rel)
        original_meta = json.loads(json.dumps(meta))
        edits = meta.setdefault("editor", {}).setdefault(integrated_content.KEY, {})
        base, overrides = integrated_content.split(rel, raw, generated, effective, data, edits.get(rel, {}), text_keys)
        if overrides:
            edits[rel] = overrides
        else:
            edits.pop(rel, None)
        copy = self.config.project_dir(name) / "files" / rel
        previous_file = copy.read_bytes() if copy.is_file() else None
        try:
            self._write_to_project(name, path, base, meta)
            content, _, _ = self._integrated_view(strict=True)
            saved = content[rel]
        except Exception:
            if previous_file is not None:
                _atomic_replace(copy, previous_file)
            elif copy.is_file():
                copy.unlink()
            self.config.save_project(name, original_meta)
            self.config._integrated_cache = None
            raise
        return {"size": len(saved), "view": _sha1(saved)}

    def _integrated_key(self, name):
        config = self.config
        files = (config.project_dir(name)/PROJECT_FILE, config.project_root/STATE_FILE,
                 *(config.data_root / rel for rel in (TABLE_NAME, class_change.BATTLE, class_change.MENU)),
                 *sorted(battle_encounters.ROOT.iterdir()))
        return (name, *(p.stat().st_mtime_ns if p.is_file() else None for p in files))

    def _integrated_ready(self):
        """The open project's cached (key, result, error) when it is current, else None
        (and it starts being built in the background). Never blocks."""
        name = self.config.open_project()
        cache = getattr(self.config, "_integrated_cache", None)
        if name and cache and cache[0] == self._integrated_key(name):
            return cache
        if name:
            _warm_integrated(self.config)
        return None

    def _integrated_view(self, strict=False):
        config = self.config
        name = config.open_project()
        if not name:
            return {}, {}, None
        key = self._integrated_key(name)
        cache = getattr(config, "_integrated_cache", None)
        if cache and cache[0] == key and (not strict or not cache[2]):
            return cache[1]
        meta = config.project(name)
        defaults = {}
        content = {}
        read = None
        error = None
        try:
            value = menu_runtime.project_settings(meta)
            if any(value[k] for k in integrated_content.SETTINGS):
                stored = _content_cache_load(self, name, key)
                if stored:
                    content, defaults = stored
                    read = self._project_payload(name, meta, config.state(), editor_view=True, reader_only=True)
                else:
                    touched = set()
                    _, defaults, _, _, _, _, _, read = self._project_payload(
                        name, meta, config.state(), editor_view=True, touched=touched)
                    content = self._integrated_edits(meta, defaults, read)
                    _content_cache_save(self, name, key, touched, content, defaults)
        except (ValueError, OSError) as exc:
            if strict:
                raise
            # Keep a conflicting project open so the user can edit or disable the mod.
            error = str(exc)
            defaults, content, read = {}, {}, None
        result = content, defaults, read
        config._integrated_cache = key, result, error
        return result

    @staticmethod
    def _integrated_text_keys(generated, read):
        battle = generated.get(class_change.BATTLE)
        return integrated_content.text_keys(read(class_change.BATTLE), battle) if battle else set()

    @staticmethod
    def _integrated_edits(meta, generated, read):
        saved = meta.get("editor", {}).get(integrated_content.KEY, {})
        text_keys = Handler._integrated_text_keys(generated, read) if any(rel.startswith("localize/") for rel in saved) else ()
        return {rel: integrated_content.replay(rel, read(rel), data, saved[rel], text_keys if rel.startswith("localize/") else ()) if rel in saved else data
                for rel, data in generated.items()}

    # ---- projects ------------------------------------------------------
    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        return json.loads(self.rfile.read(length) or b"{}") if length else {}

    # ---- read another project's characters and files (copying characters between projects) ----
    def _project_characters(self):
        name = self._query().get("name", "")
        meta = self.config.project(name)
        editor = meta.get("editor", {})
        self._json({"name": name, "characters": art_registry.characters(editor.get("customCharacters") or meta.get("customCharacters") or []),
                    "artEntries": art_registry.registrations(editor.get("artEntries") or [])})

    def _project_file(self):
        """A file as another project sees it, excluding generated content."""
        q = self._query()
        name, rel = q.get("name", ""), q.get("path", "")
        meta = self.config.project(name)
        path = self.config.resolve(rel)
        if self.config.rel(path) != rel:
            raise PermissionError("invalid path")
        info = meta.get("files", {}).get(rel)
        if info:
            source = (self.config.project_dir(name) / "files" / rel).resolve()
            if (self.config.project_dir(name) / "files").resolve() not in source.parents:
                raise PermissionError("project file escapes its folder")
            data = source.read_bytes()
            if _sha1(data) != info["sha1"]:
                raise ValueError("Project file changed: " + rel)
        else:
            source = self.config.project_path(path, name, self.config.state().get("applied") or {})
            if source is None:
                raise FileNotFoundError(rel + " is not in this project")
            data = source.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _projects(self):
        root = self.config.project_root
        out = []
        if root.is_dir():
            for d in sorted(root.iterdir(), key=lambda p: p.name.lower()):
                if (d / PROJECT_FILE).is_file():
                    meta = json.loads((d / PROJECT_FILE).read_text(encoding="utf-8"))
                    files = meta.get("files", {})
                    mods = menu_runtime.project_settings(meta)
                    out.append({"name": d.name, "created": meta.get("created"), "saved": meta.get("saved"),
                                "files": sorted(files), "size": sum(f["size"] for f in files.values()),
                                "menuMods": bool(mods["enemyItemPool"] or mods["enemyEquipmentOverrides"] or any(mods[key] for key in menu_runtime.FIELDS))})
        state = self.config.state()
        self._json({"projects": out, "open": self.config.open_project(), "applied": state.get("applied")})

    def _create(self, name: str) -> Path:
        d = self.config.project_dir(name)
        if d.exists():
            raise FileExistsError(f'a project called "{name.strip()}" already exists')
        (d / "files").mkdir(parents=True)
        self.config.save_project(name.strip(), {"name": name.strip(), "created": _now(), "files": {}})
        return d

    def _set_open(self, name, *, save_as=False):
        state = self.config.state()
        if save_as:
            state["saveAs"] = {"source": state.get("open"), "target": name}
        else:
            state.pop("saveAs", None)
        state["open"] = name
        self.config.save_state(state)

    def _project_new(self):
        name = self._body().get("name", "")
        with self.config.write_lock:
            self._create(name)
            self._set_open(name.strip())
        self._json({"ok": True, "project": name.strip()})

    def _project_open(self):
        name = self._body().get("name")
        if name and not (self.config.project_dir(name) / PROJECT_FILE).is_file():
            raise FileNotFoundError(f'no project called "{name}"')
        with self.config.write_lock:
            self._set_open(name.strip() if name else None)
        self._json({"ok": True, "project": self.config.open_project()})

    def _project_save_as(self):
        """A new project holding the open project's files, or (with none open and
        includeGame) the game files the editor has changed, each based on its original."""
        body = self._body()
        name = body.get("name", "").strip()
        with self.config.write_lock:
            current = self.config.open_project()
            d = self._create(name)
            meta = self.config.project(name)
            if current:
                src = self.config.project_dir(current)
                current_meta = self.config.project(current)
                meta["files"] = current_meta.get("files", {})
                if "editor" in current_meta:
                    meta["editor"] = current_meta["editor"]
                for rel in meta["files"]:
                    (d / "files" / rel).parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src / "files" / rel, d / "files" / rel)
            elif body.get("includeGame"):
                for rel in self._backed_up_files():
                    game = self.config.resolve(rel)
                    if rel == TABLE_NAME or not game.is_file():
                        continue
                    data, original = game.read_bytes(), (self.config.backup_root / rel).read_bytes()
                    if data == original:
                        continue
                    (d / "files" / rel).parent.mkdir(parents=True, exist_ok=True)
                    (d / "files" / rel).write_bytes(data)
                    project_merge.remember_base(self.config, original, _atomic_replace)
                    meta["files"][rel] = {"base": _sha1(original), "sha1": _sha1(data), "size": len(data), "saved": _now()}
            if not current:
                settings = self.config.restriction_groups()
                if settings["exists"]:
                    meta.setdefault("editor", {})["restrictionGroups"] = settings["settings"]
                meta.setdefault("editor", {})["menuMods"] = menu_runtime.selected(self.config)
            self.config.save_project(name, meta)
            self._set_open(name, save_as=True)
        self._json({"ok": True, "project": name, "files": sorted(meta["files"])})

    def _project_payload(self, name, meta, state, revert_others=False, progress=None, editor_view=False, touched=None, reader_only=False):
        if progress is None:
            progress = lambda percent, message: None
        files = meta.get("files", {})
        source = self.config.project_dir(name) / "files"
        value = menu_runtime.selected(self.config, name)
        applied = state.get("applied") or {}
        if value["specialClassChange"] and not (state.get("menuRuntime") or {}).get("files"):
            game = menu_runtime.game_root(self.config)
            if any((game / n).is_file() for n in class_change.SIDECARS):
                raise ValueError("This game folder has a standalone Class Change build. Choose a clean game copy to apply or export the editor project.")
        former_weapons = set(applied.get("weaponModFiles", []))
        former_sets = set(applied.get("spellSetFiles", [])) | set(applied.get("permissionSetFiles", []))
        former_cap = set(applied.get("levelCapFiles", []))
        former_xl = set(applied.get("dorgaluaXLFiles", []))
        former_encounters = set(applied.get('encounterFiles', []))
        if value[battle_encounters.KEY] and menu_runtime.battle_pilot_applied(self.config, applied):
            former_encounters.update(applied.get('files', {}))
        former = (set(applied.get("classChangeFiles", [])) | former_weapons | former_sets | former_cap
                  | former_xl | set(applied.get("aiChoiceFiles", [])) | former_encounters)
        removed = set(applied.get("files", {})) - set(files) if editor_view or revert_others else set()
        def read(rel):
            game = self.config.resolve(rel)
            if self.config.rel(game) != rel:
                raise ValueError("Invalid project path: " + rel)
            if touched is not None:
                touched.add(rel)  # the editor's content cache checks these files before reuse
            if rel in former_weapons and (not game.is_file() or _sha1(game.read_bytes()) != applied["files"][rel]):
                raise ValueError("Installed weapon mod data changed outside the editor: " + rel)
            if rel in former_sets and (not game.is_file() or _sha1(game.read_bytes()) != applied["files"][rel]):
                raise ValueError("Installed permission set data changed outside the editor: " + rel)
            if rel in former_cap and (not game.is_file() or _sha1(game.read_bytes()) != applied["files"][rel]):
                raise ValueError("Installed level cap data changed outside the editor: " + rel)
            if rel in former_xl and (not game.is_file() or _sha1(game.read_bytes()) != applied["files"][rel]):
                raise ValueError("Installed XL Dorgalua data changed outside the editor: " + rel)
            if rel in former_encounters and (not game.is_file() or _sha1(game.read_bytes()) != applied['files'][rel]):
                raise ValueError('Installed Hard Mode encounter data changed outside the editor: ' + rel)
            if rel in files:
                path = (source / rel).resolve()
                if source.resolve() not in path.parents:
                    raise ValueError("Project file escapes its folder: " + rel)
                data = path.read_bytes()
                if _sha1(data) != files[rel]["sha1"] or len(data) != files[rel]["size"]:
                    raise ValueError("Project file changed: " + rel)
                return data
            if rel in former:
                if not game.is_file() or _sha1(game.read_bytes()) != applied["files"][rel]:
                    raise ValueError("Installed Class Change data changed outside the editor: " + rel)
            if rel in former or rel in removed:
                base = self.config.applied_base(rel, applied)
                if base is None:
                    raise FileNotFoundError(rel + " is not in this project")
                return base.read_bytes()
            return game.read_bytes()

        if reader_only:
            return read
        progress(8, "Preparing project data and AI settings")
        ai_files = ai_choices_data.project(read) if value["aiChoices"] else {}
        generated = dict(ai_files)
        class_files = {}
        weapon_files = {}
        runtime_payload = None
        def effective(rel):
            return generated[rel] if rel in generated else read(rel)

        if value["rougesReborn"] and value["trapAiProfile"]:
            _, pack = weapon_mods.unpack(effective(class_change.BATTLE))
            if value["trapAiProfile"] >= weapon_mods.Xlce(pack.entry(27)).count:
                raise ValueError("Save the Trap AI profile with this project before applying it")

        if value["specialClassChange"]:
            progress(18, "Building class changes and checking battle rewards")
            class_files = class_change.build(effective)
            marks = {int(c): mark for c, mark in class_change.recipe()["marks"].items()}
            entries = ({self.config.rel(path): read(self.config.rel(path))
                        for path in sorted(self.config.resolve("battle/entry").glob("entry_unit_*.dat"))
                        if self.config.rel(path) not in battle_encounters.ROSTERS or self.config.rel(path) not in former_encounters}
                       if not editor_view or value["genericSpecialRecruitment"] else {})
            recruitment = ()
            if value["genericSpecialRecruitment"]:
                english = effective("localize/LocalizeText_en-us.dat")
                names = class_change.read_archive(english)
                characters = art_registry.characters(meta.get("editor", {}).get("customCharacters"))
                class_files[class_change.BATTLE], recruitment = class_change.generic_recruitment(
                    class_files[class_change.BATTLE], entries.values(), names, marks,
                    (character["template"] for character in characters))
            for rel, original in (() if editor_view else entries.items()):
                changed = class_change.mark_drops(original, marks, recruitment)
                if changed != original:
                    class_files[rel] = changed
            generated.update(class_files)
        if weapon_mods.active(value):
            progress(32, "Building Rogue, weapon and proficiency changes")
            weapon_files = weapon_mods.build(value, effective)
            if value["rougesReborn"] and not editor_view:
                recruitment = weapon_mods.rogue_recruitment(weapon_files[class_change.BATTLE])
                for path in sorted(self.config.resolve("battle/entry").glob("entry_unit_*.dat")):
                    rel = self.config.rel(path)
                    if rel in battle_encounters.ROSTERS and rel in former_encounters:
                        continue
                    original = effective(rel)
                    changed = class_change.mark_drops(original, {}, recruitment)
                    if changed != original:
                        weapon_files[rel] = changed
            generated.update(weapon_files)
        progress(45, "Preparing table changes")
        set_files = {}
        if value["dorgaluaXLFix"]:
            generated[class_change.BATTLE] = dorgalua_xl.build(effective(class_change.BATTLE))
        if any(value[key] for key in battle_encounters.FIGHTS):
            for entry in battle_encounters.registrations(value):
                rel = entry['path']
                try:
                    read(rel)
                except FileNotFoundError:
                    continue
                raise ValueError('A Hard Mode encounter needs this path, which the project already uses: ' + rel)
            def encounter_input(rel):
                # Some stock roster filenames have different case on disk.
                return effective(self.config.rel(self.config.resolve(rel)))

            generated.update(battle_encounters.build(encounter_input, value, meta.get('editor', {})))
        extra_text = {}
        if self._integrated_text_keys(generated, read):
            text_files = (self.config.rel(path) for path in self.config.resolve("localize").glob("LocalizeText_*.dat")) if editor_view else (
                rel for rel in meta.get("editor", {}).get(integrated_content.KEY, {}) if rel.startswith("localize/LocalizeText_"))
            for rel in text_files:
                if rel not in generated:
                    extra_text[rel] = generated[rel] = read(rel)
        if not editor_view:
            generated = self._integrated_edits(meta, generated, read)
            for rel, original in extra_text.items():
                if generated[rel] == original:
                    del generated[rel]
                else:
                    (weapon_files if weapon_mods.active(value) else class_files)[rel] = generated[rel]
        if value["modPreparation"] and not editor_view:
            options = meta.get("editor", {})
            spells = modprep_spellsets.settings(options.get("communitySpellSets"))
            skills = modprep_spellsets.settings(options.get("communitySkillSets"), "skill")
            if any(row["classes"] for row in spells + skills):
                set_files = modprep_spellsets.build(effective(class_change.BATTLE), spells, skills)
                generated.update(set_files)
                if value["dorgaluaXLFix"] and any(dorgalua_xl.CLASS in row["classes"] for row in skills):
                    generated[class_change.BATTLE] = dorgalua_xl.build(generated[class_change.BATTLE])
        if value["levelCap99"] and not editor_view:
            archive, _, _ = level_cap_99.build_archive(effective(class_change.BATTLE))
            generated[class_change.BATTLE] = archive
        if value[battle_encounters.KEY] and not editor_view:
            battle_encounters.validate_battle_limit(effective(class_change.BATTLE))
        if value["specialClassChange"] and not editor_view:
            groups = modprep_groups.settings(meta.get("editor", {}).get("communityClassGroups"))
            overrides = modprep_groups.override_settings(meta.get("editor", {}).get(modprep_groups.OVERRIDES))
            runtime_payload = class_change.runtime(value, generated[class_change.BATTLE], effective(class_change.MENU), groups, overrides)
            if value["rougesReborn"]:
                runtime_payload = weapon_mods.rebase_rogue_permissions(generated[class_change.BATTLE], runtime_payload, overrides)
        return value, generated, class_files, weapon_files, set_files, ai_files, runtime_payload, read

    def _export_class_change(self):
        name = self.config.open_project()
        if not name or name != self._query().get("project"):
            raise ValueError("Open the Class Change project to export it")
        with self.config.write_lock:
            meta = self.config.project(name)
            value, generated, _, _, _, _, payload, read = self._project_payload(name, meta, self.config.state(), True)
            if not value["specialClassChange"]:
                raise ValueError("Enable and save Special Class Change first")
            files = {rel: read(rel) for rel in meta.get("files", {})}
            files.update(generated)
            files.setdefault(class_change.MENU, read(class_change.MENU))
            executable = menu_runtime.game_root(self.config) / "Tactics Ogre Reborn.exe"
            if not executable.is_file():
                raise ValueError("The selected game folder is missing Tactics Ogre Reborn.exe")
            executable_hash = menu_runtime.sha(executable.read_bytes())
            table = self.config.backup_root / TABLE_NAME
            if not table.is_file():
                table = self.config.resolve(TABLE_NAME)
            registrations = art_registry.registrations(meta.get("editor", {}).get("artEntries")) + battle_encounters.registrations(value)
            files[TABLE_NAME] = art_registry.reconcile(table.read_bytes(), registrations, {n: len(b) for n,b in files.items()})
            section, sidecars = payload
            sets = modprep_sets.runtime(meta, value["equipmentSetBonuses"], value["equipmentSetFreeSkills"])
            permissions = modprep_equipperms.runtime(meta, value["modPreparation"])
            out = BytesIO()
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as package:
                for rel, data in files.items():
                    if self.config.rel(self.config.resolve(rel)) != rel:
                        raise ValueError("Invalid export path: " + rel)
                    package.writestr("Data/" + rel, data)
                for rel, data in sidecars.items():
                    package.writestr(rel, data)
                if value["dorgaluaXLFix"]:
                    sprite = files.get(dorgalua_xl.SPRITE) or read(dorgalua_xl.SPRITE)
                    package.writestr(dorgalua_xl.SIDECAR, dorgalua_xl.roster_sidecar(sprite))
                if sets:
                    package.writestr(modprep_sets.FILE, sets)
                if permissions:
                    package.writestr(modprep_equipperms.FILE, permissions)
                for rel, data in weapon_mods.rogue_files(value).items():
                    package.writestr(rel, data)
                custom_action_icons = any(row['bank'] != 'itemicon' for row in
                                          icon_import.catalog(meta.get('editor', {}).get('customIcons')))
                package.writestr("dinput8.dll", menu_runtime.select_loader(value, executable_hash,
                                                                         bool(sets or permissions)))
                package.writestr("menu-mods.ini", menu_runtime.ini(value)+b"\r\n"+section+modprep_sets.ini(sets,value["equipmentSetFreeSkills"])+modprep_equipperms.ini(permissions)+menu_runtime.custom_icon_ini(custom_action_icons))
                package.writestr("class-change-export.json", json.dumps({
                    "version": 1, "project": name, "settings": value,
                    "executableSHA256": executable_hash,
                    "itemTableRows": class_change.Xlce(class_change.Pakd(class_change.DatArchive.read(files[class_change.BATTLE]).pack).entry(13)).count,
                    "classChangeGroupCapacity": modprep_groups.GROUP_LIMIT,
                }, indent=2))
            data = out.getvalue()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", 'attachment; filename="Special-Class-Change.zip"')
        self.end_headers()
        self.wfile.write(data)

    def _project_apply(self):
        body = self._body()
        with self.config.apply_progress.track(body.get("progress")) as progress:
            result = self._apply_project(body, progress)
        self._json(result)

    def _apply_project(self, body, progress):
        name = body.get("name", "")
        with self.config.write_lock:
            progress(4, "Reading project settings")
            meta = self.config.project(name)
            project_files = meta.get("files", {})
            state = self.config.state()
            before = state.get("applied") or {}
            value, generated, class_files, weapon_files, set_files, ai_files, class_payload, read = self._project_payload(
                name, meta, state, bool(body.get("revertOthers")), progress)
            progress(53, "Comparing project and game files")
            files = dict(project_files)
            for rel, data in generated.items():
                original = self.config.resolve(rel)
                entry = files.get(rel) or {"base": _sha1(original.read_bytes()) if original.is_file() else None}
                files[rel] = {**entry, "sha1": _sha1(data), "size": len(data)}
            owned = set(before.get("newFiles", []))
            plan, changed = [], []
            for rel, entry in sorted(files.items()):
                game = self.config.resolve(rel)
                now = _sha1(game.read_bytes()) if game.is_file() else None
                status = "same" if now == entry["sha1"] else "write" if now in (entry["base"], (before.get("files") or {}).get(rel)) else "changed"
                if status == "changed":
                    changed.append(rel)
                plan.append({"path": rel, "status": status})
            base_files = dict(before.get("baseFiles", {}))
            others = [rel for rel in sorted(before.get("files") or {}) if rel not in files
                      and (rel in base_files or rel in owned or (self.config.backup_root / rel).is_file())]
            class_restore = set(others) & set(before.get("classChangeFiles", []))
            weapon_restore = set(others) & set(before.get("weaponModFiles", []))
            spell_restore = set(others) & (set(before.get("spellSetFiles", [])) | set(before.get("permissionSetFiles", [])))
            cap_restore = set(others) & set(before.get("levelCapFiles", []))
            ai_restore = set(others) & set(before.get("aiChoiceFiles", []))
            xl_restore = set(others) & set(before.get("dorgaluaXLFiles", []))
            encounter_restore = set(others) & set(before.get('encounterFiles', []))
            if value[battle_encounters.KEY] and menu_runtime.battle_pilot_applied(self.config, before):
                encounter_restore.update(others)
            forced_restore = class_restore | weapon_restore | spell_restore | cap_restore | ai_restore | xl_restore | encounter_restore
            if before.get("classChangeFiles") and not value["specialClassChange"]:
                class_change.assert_can_remove()
            weapon_mods.assert_can_remove((state.get("menuRuntime") or {}).get("settings", {}), value)
            progress(67, "Checking compatibility and runtime files")
            removed = set(others) if body.get("revertOthers") else forced_restore
            if not value[battle_encounters.KEY]:
                # Check the stage table that will remain installed when expansion is off.
                installed_battle = self.config.resolve(battle_encounters.BATTLE)
                rel = self.config.rel(installed_battle)
                if rel in files:
                    battle = generated[rel] if rel in generated else read(rel)
                elif rel in removed:
                    battle = read(rel)
                else:
                    battle = installed_battle.read_bytes()
                battle_encounters.validate_battle_limit(battle, battle_encounters.STOCK_CAPACITY)
            ai_validation.project(self.config, name, project_files, removed, generated)
            custom_action_icons = any(row['bank'] != 'itemicon' for row in
                                      icon_import.catalog(meta.get('editor', {}).get('customIcons')))
            if not body.get("revertOthers"):
                custom_action_icons |= any(row['bank'] != 'itemicon' and icon_import.archive_path(row['bank']) in others
                                           for row in icon_import.catalog(before.get('customIcons')))
            runtime = menu_runtime.prepare(self.config, value, name, class_payload, custom_action_icons, read=read)
            if body.get("dryRun"):
                return {"files": plan, "changed": changed, "others": others, "classRestore": sorted(class_restore), "weaponRestore": sorted(weapon_restore), "spellRestore": sorted(spell_restore), "levelCapRestore": sorted(cap_restore), "aiChoiceRestore": sorted(ai_restore), "dorgaluaXLRestore": sorted(xl_restore), "encounterRestore": sorted(encounter_restore), "appliedBefore": before.get("name"), "runtime": runtime["public"]}
            progress(74, "Checking files to write and restore")
            if not body.get("revertOthers") and "battle/battle_data_release.dat" in files and any(
                entry["path"].startswith("object/") and entry["path"] not in files
                for entry in before.get("artEntries", [])
            ):
                raise ValueError("This project replaces character tables but omits installed project characters. Take the previous project's other files out, or build from that project first.")
            table_path = self.config.data_root / TABLE_NAME
            old_table = table_path.read_bytes()
            registrations = art_registry.registrations(meta.get("editor", {}).get("artEntries")) + battle_encounters.registrations(value)
            drop = [entry for entry in before.get("artEntries", []) if entry["path"] in removed]
            sizes = {rel: entry["size"] for rel, entry in files.items()}
            changes, written, reverted = [], [], []
            src = self.config.project_dir(name) / "files"
            for item in plan:
                rel = item["path"]
                data = generated[rel] if rel in generated else (src / rel).read_bytes()
                if _sha1(data) != files[rel]["sha1"] or len(data) != files[rel]["size"]:
                    raise ValueError("Project file changed: " + rel)
                if item["status"] == "same":
                    continue
                game = self.config.resolve(rel)
                old = game.read_bytes() if game.is_file() else None
                if old is None:
                    owned.add(rel)
                changes.append((game, old, data))
                written.append(rel)
            for rel in sorted(removed):
                game = self.config.resolve(rel)
                old = game.read_bytes() if game.is_file() else None
                if rel in forced_restore and (old is None or _sha1(old) != before["files"][rel]):
                    raise ValueError("Installed mod data changed outside the editor: " + rel)
                base = self.config.applied_base(rel, before)
                data = base.read_bytes() if base is not None else None
                if rel in base_files and _sha1(data) != base_files[rel]:
                    raise ValueError("Saved project baseline changed: " + rel)
                if data is None and old is not None and _sha1(old) != before["files"][rel]:
                    raise ValueError("New art was changed outside the project; preserve it before switching: " + rel)
                changes.append((game, old, data))
                if data is not None:
                    sizes[rel] = len(data)
                reverted.append(rel)
            table = art_registry.reconcile(old_table, registrations, sizes, drop)
            if changes or table != old_table or runtime["entries"]:
                menu_runtime.assert_game_closed(self.config)
            progress(80, "Backing up original game files")
            for game, old, new in changes:
                rel = self.config.rel(game)
                if old is not None and rel not in owned:
                    self._backup(game)
                    if rel in files and rel not in (before.get("files") or {}):
                        project_merge.remember_base(self.config, old, _atomic_replace)
                        base_files[rel] = _sha1(old)
            if changes or table != old_table:
                self._backup(table_path)
            runtime_done = False
            try:
                for index, (game, old, new) in enumerate(changes, 1):
                    progress(84 + 9 * (index - 1) // len(changes), f"Writing game file {index} of {len(changes)}")
                    _write_change(game, new)
                progress(94, "Updating the game file index")
                if table != old_table:
                    _atomic_replace(table_path, table)
                progress(96, "Installing the selected runtime settings")
                receipt, runtime_files = menu_runtime.deploy(self.config, runtime, _atomic_replace)
                runtime_done = True
                kept = {rel: value for rel, value in (before.get("files") or {}).items() if rel not in files and rel not in removed}
                retained_registrations = [entry for entry in before.get("artEntries", []) if entry["path"] in kept]
                merged_registrations = {entry["path"]: entry for entry in retained_registrations + registrations}
                next_state = json.loads(json.dumps(state))
                next_state["menuRuntime"] = receipt
                character_map = {character["template"]: character for character in before.get("customCharacters", []) if "object/" + character["stem"] + ".dat" in kept}
                character_map.update({character["template"]: character for character in art_registry.characters(meta.get("editor", {}).get("customCharacters"))})
                next_state["applied"] = {"name": meta.get("name", name), "at": _now(), "files": {**kept, **{rel: entry["sha1"] for rel, entry in files.items()}}, "newFiles": sorted(owned - removed), "artEntries": list(merged_registrations.values()), "customCharacters": list(character_map.values())}
                next_state["applied"]["baseFiles"] = {rel: digest for rel, digest in base_files.items() if rel not in removed}
                icons = [row for row in icon_import.catalog(before.get("customIcons"))
                         if icon_import.archive_path(row["bank"]) in kept]
                icons.extend(icon_import.catalog(meta.get("editor", {}).get("customIcons")))
                next_state["applied"]["customIcons"] = icon_import.catalog(icons)
                if class_files:
                    next_state["applied"]["classChangeFiles"] = sorted(class_files)
                if weapon_files:
                    next_state["applied"]["weaponModFiles"] = sorted(weapon_files)
                if value["levelCap99"]:
                    next_state["applied"]["levelCapFiles"] = [class_change.BATTLE]
                if value["dorgaluaXLFix"]:
                    next_state["applied"]["dorgaluaXLFiles"] = [class_change.BATTLE]
                if set_files:
                    next_state["applied"]["permissionSetFiles"] = sorted(set_files)
                if ai_files:
                    next_state["applied"]["aiChoiceFiles"] = sorted(ai_files)
                if encounter_paths := battle_encounters.owned_paths(value):
                    next_state['applied']['encounterFiles'] = sorted(encounter_paths)
                progress(99, "Recording the applied project")
                self.config.save_state(next_state)
            except Exception:
                progress(99, "Restoring the previous game files")
                for game, old, new in changes:
                    _write_change(game, old)
                _atomic_replace(table_path, old_table)
                if runtime_done:
                    menu_runtime.snapshot_restore(self.config, runtime, _atomic_replace)
                self.config.save_state(state)
                raise
        return {"ok": True, "written": written, "reverted": reverted, "same": [p["path"] for p in plan if p["status"] == "same"], "runtimeFiles": runtime_files}

    def _backup(self, path: Path) -> bool:
        """Copy the file into the backup folder the first time the editor touches it."""
        rel = path.relative_to(self.config.data_root)
        dest = self.config.backup_root / rel
        if dest.exists():
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
        os.chmod(dest, dest.stat().st_mode | stat.S_IWRITE)  # game files are read-only; backups must be removable
        return True

    def _backed_up_files(self):
        root = self.config.backup_root
        if not root.is_dir():
            return []
        files = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
        files.update((self.config.state().get("applied") or {}).get("newFiles", []))
        return sorted(files)

    def _restore(self):
        restored = []
        with self.config.write_lock:
            state = self.config.state()
            if (state.get("applied") or {}).get("classChangeFiles"):
                class_change.assert_can_remove()
            weapon_mods.assert_can_remove((state.get("menuRuntime") or {}).get("settings", {}), menu_runtime.settings())
            runtime = menu_runtime.prepare(self.config, menu_runtime.settings())
            files = self._backed_up_files()
            table_path = self.config.data_root / TABLE_NAME
            old_table = table_path.read_bytes()
            table = bytearray(old_table)
            changes = []
            for rel in files:
                if rel == TABLE_NAME:
                    continue
                game = self.config.resolve(rel)
                backup = self.config.backup_root / rel
                old = game.read_bytes() if game.is_file() else None
                data = backup.read_bytes() if backup.is_file() else None
                if data is None and old is not None and _sha1(old) != ((state.get("applied") or {}).get("files") or {}).get(rel):
                    raise ValueError("New art changed outside the project; preserve it before restoring: " + rel)
                changes.append((game, old, data))
                if data is not None:
                    _set_recorded_size(table, rel, len(data))
                restored.append(rel)
            table = art_registry.reconcile(table, removals=(state.get("applied") or {}).get("artEntries", []))
            if changes or runtime["entries"]:
                menu_runtime.assert_game_closed(self.config)
            runtime_done = False
            try:
                for game, old, new in changes:
                    _write_change(game, new)
                if changes:
                    _atomic_replace(table_path, bytes(table))
                receipt, runtime_files = menu_runtime.deploy(self.config, runtime, _atomic_replace)
                runtime_done = True
                next_state = json.loads(json.dumps(state))
                next_state["applied"] = None
                next_state["menuRuntime"] = receipt
                self.config.save_state(next_state)
            except Exception:
                for game, old, new in changes:
                    _write_change(game, old)
                if changes:
                    _atomic_replace(table_path, old_table)
                if runtime_done:
                    menu_runtime.snapshot_restore(self.config, runtime, _atomic_replace)
                self.config.save_state(state)
                raise
            for rel in files:
                backup = self.config.backup_root / rel
                if backup.is_file():
                    os.chmod(backup, backup.stat().st_mode | stat.S_IWRITE)
                    backup.unlink()
        self._json({"ok": True, "restored": restored, "runtimeFiles": runtime_files})


def _stage_art_project(config, body, project_view=None):
    """Commit verified art to a new or open project without activating game files."""
    if config.read_only:
        raise PermissionError("read-only mode does not allow staging imports")
    if not isinstance(body, dict) or not isinstance(body.get("name"), str):
        raise ValueError("invalid art import")
    into_open = body.get("intoOpen") is True
    name = (config.open_project() or "") if into_open else body["name"].strip()
    if into_open and not name:
        raise ValueError("Open a project to add art to it")
    target = config.project_dir(name)
    if body.get("dataRoot") != str(config.data_root):
        raise ValueError("Game folder changed; reload before importing")
    entries = body.get("files")
    new_icon = body.get("icon")
    if not isinstance(entries, list) or len(entries) > 128 or (not entries) != (new_icon is not None):
        raise ValueError("Choose one new icon or 1 to 128 rebuilt art files")
    title = body.get("title", "Art import")
    if not isinstance(title, str) or len(title) > 200:
        raise ValueError("invalid art import title")
    with config.write_lock:
        base_project = config.open_project()
        if body.get("baseProject") != base_project:
            raise ValueError("Project changed; rebuild the import preview")
        if target.exists() and not into_open:
            raise FileExistsError("Choose a new project name; existing projects are preserved")
        content, defaults, read = {}, {}, None
        if project_view:
            content, defaults, read = project_view(strict=True) if new_icon is not None else project_view()
        table = bytearray(config.virtual_table(content))
        icon = None
        if new_icon is not None:
            icon = icon_import.icon_record(new_icon)
            rel = icon_import.archive_path(icon['bank'])
            path = config.resolve(rel)
            raw = config.read_editable(path)
            visible = content.get(rel, raw)
            if hashlib.sha256(visible).hexdigest() != new_icon.get('expectedSHA256'):
                raise ValueError('Icon archive changed since preview. Rebuild the preview.')
            for language in icon_import.LANGUAGES:
                localized = config.resolve(f"menu/texture_x4/{language}/{icon['bank']}.dat")
                current = config.editable_path(localized)
                if current is not None and current.is_file():
                    arc = icon_import.texture_arc(current.read_bytes())[2]
                    if any(icon_import.occupied(icon['bank'], icon['id'], r.name) for r in arc.resources):
                        raise ValueError(f"Icon slot {icon['id']} is already used in {language}. Choose another slot.")
            encoded = new_icon.get('texture')
            if not isinstance(encoded, str) or len(encoded) > 5600:
                raise ValueError('Invalid icon texture payload')
            btx = base64.b64decode(encoded, validate=True)
            rebuilt = icon_import.append(raw, visible, icon, btx)
            entries = [{'path': rel, 'expectedSHA256': hashlib.sha256(visible).hexdigest(),
                        'data': base64.b64encode(rebuilt).decode('ascii')}]
        added_registrations = art_registry.registrations(body.get("registrations"))
        added_characters = art_registry.characters(body.get("characters"))
        registered_new = {entry["path"] for entry in added_registrations}
        changes = []
        seen = set()
        total = 0
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("path"), str):
                raise ValueError("invalid art file")
            rel = entry["path"]
            path = config.resolve(rel)
            if config.rel(path) != rel or rel in seen or path.suffix.lower() != ".dat":
                raise ValueError("Art imports need unique .dat paths inside the game folder")
            seen.add(rel)
            current_path = config.editable_path(path)
            if current_path is not None and current_path.is_file():
                current = content[rel] if rel in content else current_path.read_bytes()
                if hashlib.sha256(current).hexdigest() != entry.get("expectedSHA256"):
                    raise ValueError(rel + " changed since preview; rebuild before importing")
                needle = rel.encode("ascii") + b"\0"
                pos = table.find(needle)
                if pos < 0 or pos + len(needle) + 4 > len(table) or int.from_bytes(table[pos + len(needle):pos + len(needle) + 4], "little") != len(current):
                    raise ValueError(rel + " does not match its FileTable size; repair that before importing")
            elif rel not in registered_new or entry.get("expectedSHA256") is not None:
                raise ValueError("New art files require an unused explicit registration: " + rel)
            encoded = entry.get("data")
            if not isinstance(encoded, str) or len(encoded) > 48 * 1024 * 1024:
                raise ValueError("invalid art file payload")
            data = base64.b64decode(encoded, validate=True)
            total += len(data)
            if not data or total > 64 * 1024 * 1024:
                raise ValueError("art import batch is too large")
            changes.append((rel, path, data))
        if registered_new - seen:
            raise ValueError("A new art registration is missing its rebuilt file")
        art_registry.reconcile(table, added_registrations, {rel: len(data) for rel, _, data in changes})
        config.project_root.mkdir(parents=True, exist_ok=True)
        stage = config.project_root / (".art-stage-" + uuid.uuid4().hex)
        stage.mkdir()
        try:
            if base_project:
                meta = config.project(base_project)
                meta["name"] = name
                for rel, info in meta.get("files", {}).items():
                    if config.rel(config.resolve(rel)) != rel:
                        raise ValueError("Invalid source project path")
                    data = (config.project_dir(base_project) / "files" / rel).read_bytes()
                    if _sha1(data) != info["sha1"]:
                        raise ValueError("Source project changed: " + rel)
                    copy = stage / "files" / rel
                    copy.parent.mkdir(parents=True, exist_ok=True)
                    copy.write_bytes(data)
            else:
                meta = {"name": name, "created": _now(), "files": {}}
            meta["saved"] = _now()
            for rel, path, data in changes:
                copy = stage / "files" / rel
                base_data = None
                if icon is not None and rel in content:
                    base_data = read(rel)
                elif rel in content:
                    base_data = read(rel)
                    edits = meta.setdefault("editor", {}).setdefault(integrated_content.KEY, {})
                    text_keys = Handler._integrated_text_keys(defaults, read) if rel.startswith("localize/") else ()
                    data, overrides = integrated_content.split(rel, base_data, defaults[rel], content[rel], data, edits.get(rel, {}), text_keys)
                    if overrides:
                        edits[rel] = overrides
                    else:
                        edits.pop(rel, None)
                    if data == base_data:
                        continue
                copy.parent.mkdir(parents=True, exist_ok=True)
                copy.write_bytes(data)
                old = meta["files"].get(rel, {})
                original_path = config.editable_path(path)
                original = (base_data if base_data is not None else original_path.read_bytes()
                            if original_path is not None and original_path.is_file() else None) if not old else None
                if original is not None:
                    project_merge.remember_base(config, original, _atomic_replace)
                base = old["base"] if old else _sha1(original) if original is not None else None
                meta["files"][rel] = {"base": base, "sha1": _sha1(data), "size": len(data), "saved": _now()}
                if _sha1(copy.read_bytes()) != meta["files"][rel]["sha1"]:
                    raise OSError("Staged art verification failed")
            editor = meta.setdefault("editor", {})
            editor["artEntries"] = art_registry.registrations(editor.get("artEntries", []) + added_registrations)
            editor["customCharacters"] = art_registry.characters(editor.get("customCharacters", []) + added_characters)
            if icon is not None:
                inherited = config.custom_icons() if not base_project else []
                icon_archive = icon_import.archive_path(icon["bank"])
                editor["customIcons"] = icon_import.catalog(editor.get("customIcons", []) +
                    [row for row in inherited if icon_import.archive_path(row["bank"]) == icon_archive] + [icon])
            for character in added_characters:
                required = {(20, character["actor"], "object/" + character["stem"] + ".dat"), (30, character["appearance"], "object/" + character["stem"] + "00.dat")}
                available = {(entry["directory"], entry["id"], entry["path"]) for entry in editor["artEntries"]}
                if not required <= available or "battle/battle_data_release.dat" not in meta["files"]:
                    raise ValueError("Project character is missing its art or character sheet")
            meta.setdefault("editor", {}).setdefault("artImports", []).append({"title": title, "at": _now(), "files": [r for r, _, _ in changes]})
            (stage / PROJECT_FILE).write_text(json.dumps(meta, indent=1), encoding="utf-8")
            if into_open:
                # swap the rebuilt copy in for the open project; its old folder is kept until the swap succeeds
                old = config.project_root / (".art-replaced-" + uuid.uuid4().hex)
                os.rename(target, old)
                try:
                    os.rename(stage, target)
                except Exception:
                    os.rename(old, target)
                    raise
                shutil.rmtree(old, ignore_errors=True)
                config._integrated_cache = None
            else:
                os.rename(stage, target)
        except Exception:
            if stage.exists() and stage.resolve().parent == config.project_root.resolve() and stage.name.startswith(".art-stage-"):
                shutil.rmtree(stage)
            raise
    return {"ok": True, "project": name, "files": len(changes), "gameChanged": False, "intoOpen": into_open}


def _set_recorded_size(table: bytearray, rel: str, size: int):
    """Patch one file's size in FileTable.bin: its path, NUL, then a u32 size.
    A few paths are listed twice (event/scene/C4_ST_345.dat, C4_ST_346.dat):
    such entries must agree, and are patched together."""
    needle = rel.encode("ascii") + b"\0"
    hits, i = [], table.find(needle)
    while i >= 0:
        hits.append(i + len(needle))
        i = table.find(needle, i + 1)
    if not hits:
        raise OSError(f"FileTable.bin has no entry for {rel}")
    sizes = {bytes(table[h:h + 4]) for h in hits}
    if len(sizes) != 1:
        raise OSError(f"FileTable.bin has {len(hits)} entries for {rel} with different sizes")
    for h in hits:
        table[h:h + 4] = size.to_bytes(4, "little")
    return int.from_bytes(sizes.pop(), "little")


def _write_change(path: Path, data):
    if data is None:
        if path.is_file():
            os.chmod(path, path.stat().st_mode | stat.S_IWRITE)
            path.unlink()
    else:
        _atomic_replace(path, data)


def _atomic_replace(path: Path, data: bytes):
    """Write data to path via a temp file, preserving the original read-only flag."""
    original_mode = path.stat().st_mode if path.exists() else None
    if original_mode is not None and not original_mode & stat.S_IWRITE:
        os.chmod(path, original_mode | stat.S_IWRITE)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tor-editor-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    if original_mode is not None:
        os.chmod(path, original_mode)


_WARMING = threading.Lock()

# ---- the open project's generated content, kept on disk between server starts ----
# Building it (class names in every language, AI data...) takes 20-50 s, and the
# browser needs it for its first file reads. It is reused only when the project and
# game state key matches, every file the build read is unchanged (time and size, in
# the game, the backups and the project), and the editor's own Python code is unchanged.
_CACHE_VERSION = 1


def _code_fingerprint():
    roots = (HERE, HERE / "tools" / "menu_mods" / "compiler")
    return [(p.name, p.stat().st_mtime_ns, p.stat().st_size) for root in roots for p in sorted(root.glob("*.py"))]


def _file_signature(config, name, rel):
    places = (config.data_root / rel, config.backup_root / rel, config.project_dir(name) / "files" / rel)
    return [[p.stat().st_mtime_ns, p.stat().st_size] if p.is_file() else None for p in places]


def _content_cache_path(config, name):
    return config.project_root / ".cache" / f"content-{hashlib.sha1(name.encode('utf-8')).hexdigest()[:16]}.zip"


def _content_cache_load(handler, name, key):
    config = handler.config
    path = _content_cache_path(config, name)
    try:
        with zipfile.ZipFile(path) as z:
            manifest = json.loads(z.read("manifest.json"))
            if (manifest.get("version") != _CACHE_VERSION or manifest.get("key") != json.loads(json.dumps(list(key)))
                    or manifest.get("code") != json.loads(json.dumps(_code_fingerprint()))):
                return None
            if any(_file_signature(config, name, rel) != sig for rel, sig in manifest["files"].items()):
                return None
            content = {rel: z.read("content/" + rel) for rel in manifest["content"]}
            defaults = {rel: z.read("defaults/" + rel) for rel in manifest["defaults"]}
        print(f"  project content: reused the saved copy for {name!r}")
        return content, defaults
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return None


def _content_cache_save(handler, name, key, touched, content, defaults):
    config = handler.config
    if config.read_only:
        return  # a read-only editor writes nothing
    path = _content_cache_path(config, name)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        manifest = {"version": _CACHE_VERSION, "project": name, "key": list(key), "code": _code_fingerprint(),
                    "files": {rel: _file_signature(config, name, rel) for rel in sorted(touched)},
                    "content": sorted(content), "defaults": sorted(defaults)}
        tmp = path.with_suffix(".tmp")
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED) as z:
            z.writestr("manifest.json", json.dumps(manifest))
            for rel, data in content.items():
                z.writestr("content/" + rel, bytes(data))
            for rel, data in defaults.items():
                z.writestr("defaults/" + rel, bytes(data))
        os.replace(tmp, path)
    except (OSError, TypeError, ValueError) as exc:
        print(f"  project content: could not save a copy ({exc})")


def _warm_integrated(config):
    """Build the open project's generated content (class names in every language, AI
    data...) in the background, so the browser isn't kept waiting for it at start-up.
    The first file read that needs it waits on the write lock until it is done."""
    if not _WARMING.acquire(blocking=False):
        return  # already building

    def run():
        try:
            handler = Handler.__new__(Handler)
            handler.config = config
            started = time.time()
            with config.write_lock:
                handler._integrated_view()
            if config.open_project():
                print(f"  project content ready ({time.time() - started:.0f} s)")
        except Exception as exc:  # reported again when a request needs the view
            print(f"  project content: {exc}")
        finally:
            _WARMING.release()

    threading.Thread(target=run, daemon=True, name="project-content").start()


class EditorServer(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows SO_REUSEADDR lets two servers share a port, so a second editor
    # would silently land on the first one's port. Fail instead and move on.
    allow_reuse_address = False
    request_queue_size = 128  # the editor opens many parallel reads; the default backlog of 5 drops some
    _next_tournament_poll = 0.0

    def service_actions(self):
        # The IPv4 server owns the poll even when both loopback listeners run.
        config = self.RequestHandlerClass.config
        now = time.monotonic()
        if self.address_family != socket.AF_INET or config.read_only or now < self._next_tournament_poll:
            return
        self._next_tournament_poll = now + 2
        if not config.write_lock.acquire(blocking=False):
            return
        try:
            versus_tournaments.auto_advance(config, _atomic_replace)
        except (OSError, ValueError, KeyError, TypeError) as exc:
            config.tournament_auto_error = str(exc)
        else:
            config.tournament_auto_error = None
        finally:
            config.write_lock.release()


class IPv6Server(EditorServer):
    address_family = socket.AF_INET6


def find_default_data_root():
    """The game's Data folder: the editor folder placed in the game folder (beside
    "Tactics Ogre Reborn.exe"), or beside a "Tactics Ogre Reborn" game folder."""
    # editor folder inside the game folder; editor files loose beside the .exe; or beside the game folder
    for candidate in (HERE.parent / "Data", HERE / "Data", HERE.parent / "Tactics Ogre Reborn" / "Data"):
        if (candidate / "FileTable.bin").is_file():
            return candidate
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", help="path to the game's Data folder")
    parser.add_argument("--saves", type=Path, help="save editor folder containing GAME-*.SAV files")
    parser.add_argument("--backups", help="where original files are kept (default: editor/backups/<data folder name>)")
    parser.add_argument("--projects", help="where projects are kept (default: editor/projects)")
    parser.add_argument("--port", type=int, default=8642)
    parser.add_argument("--readonly", action="store_true", help="view game data and saves without editing")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    args = parser.parse_args()

    data_root = Path(args.data).resolve() if args.data else find_default_data_root()
    if not data_root or not (data_root / "FileTable.bin").is_file():
        sys.exit("Could not find the game's Data folder (it must contain FileTable.bin). Use --data.")
    backup_root = Path(args.backups).resolve() if args.backups else HERE / "backups" / "original"
    project_root = Path(args.projects).resolve() if args.projects else HERE / "projects"

    Handler.config = EditorConfig(data_root, backup_root, project_root, args.readonly,
                                  args.saves.resolve() if args.saves is not None else None)
    # If the port is taken (another editor, maybe a read-only one), use the next free one
    # rather than leaving the browser to open whatever is already listening there.
    server = None
    for port in range(args.port, args.port + 20):
        try:
            server = EditorServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            print(f"Port {port} is in use; trying {port + 1}")
    if server is None:
        sys.exit(f"No free port between {args.port} and {args.port + 19}.")
    args.port = port
    # Browsers resolve "localhost" to ::1 first; without an IPv6 listener every
    # new connection on Windows waits ~1s before falling back to IPv4.
    try:
        server6 = IPv6Server(("::1", args.port), Handler)
        threading.Thread(target=server6.serve_forever, daemon=True).start()
    except OSError:
        pass
    url = f"http://127.0.0.1:{args.port}/"
    print(f"TO:R Editor running at {url}")
    print(f"  game data : {data_root}")
    print(f"  backups   : {backup_root}" + ("  (read-only mode)" if args.readonly else ""))
    print(f"  projects  : {project_root}")
    print("Press Ctrl+C to stop.")
    if Handler.config.open_project():
        print(f"  preparing project {Handler.config.open_project()!r} in the background…")
        _warm_integrated(Handler.config)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
