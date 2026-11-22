"""Saved Versus matches and the companion's next-training handoff."""

import base64
import binascii
from datetime import datetime, timezone
import json
import re
import struct
from functools import lru_cache
from uuid import uuid4

import battle_encounters
import save_editor
import versus


MAGIC = b"TORVS1\0\0"
RELIC_MAGIC = b"TORVS2\0\0"
NAME_MAGIC = b"TORVS3\0\0"
STAT_MAGIC = b"TORVS4\0\0"
PACKET = struct.Struct("<8s16s4HI")
RELIC_ENTRY = struct.Struct(f"<HH{versus.RELIC_RECORD_SIZE}s")
NAME_ROW = 56
MATCH_ID = re.compile(r"[0-9a-f]{32}")
LOG_LINE = re.compile(rb"Versus: ([0-9a-f]{32}) (started|Team A wins|Team B wins|draw|some relics used base stats)\.")


def store(config):
    directory = config.project_root / ".versus"
    if directory.resolve().parent != config.project_root.resolve() or directory.is_symlink():
        raise PermissionError("The Versus match library must stay inside the editor's projects folder.")
    return directory


def match_record(game, arena, teams, positions, label):
    fighters, sprites, relics = versus.roster_payload(game, teams, positions)
    match_id = uuid4().hex
    size = len(positions[0])
    x, y = positions[2]
    payload = fighters + sprites + relics
    packet = PACKET.pack(RELIC_MAGIC if relics else MAGIC, bytes.fromhex(match_id), arena[0], size, x, y,
                         binascii.crc32(payload)) + payload
    details = {
        "id": match_id, "title": label or f'{teams[0]["title"] or "Team A"} vs {teams[1]["title"] or "Team B"}',
        "arena": arena[1], "size": size, "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "squads": [[unit["name"] for unit in team["lineup"]] for team in teams],
        "relics": len(relics) // RELIC_ENTRY.size,
        "omittedSnapshots": sum(unit["omittedSnapshots"] for team in teams for unit in team["lineup"]),
        "packet": base64.b64encode(packet).decode("ascii"),
        **game.revisions,
    }
    stats = b"".join(versus.permanent_stats(unit["raw"]) if "raw" in unit else bytes(versus.PERMANENT_STAT_ROW)
                     for team in teams for unit in team["lineup"])
    if any(stats):
        details["permanentStats"] = base64.b64encode(stats).decode("ascii")
    return details


def create(config, body, atomic_replace):
    game, arena, teams, positions = versus.prepare(config, body)
    label = body.get("title", "").strip() if isinstance(body.get("title", ""), str) else ""
    if len(label) > 96:
        raise ValueError("Use a match name of up to 96 characters.")
    details = match_record(game, arena, teams, positions, label)
    directory = store(config)
    directory.mkdir(exist_ok=True, parents=True)
    atomic_replace(directory / f"{details['id']}.json", json.dumps(details, indent=2, ensure_ascii=False).encode("utf-8"))
    return public_match(details)


def public_match(record):
    return ({key: record[key] for key in ("id", "title", "arena", "size", "created", "squads")} |
            {key: record.get(key, 0) for key in ("relics", "omittedSnapshots")})


def load_match(config, match_id):
    if not isinstance(match_id, str) or not MATCH_ID.fullmatch(match_id):
        raise ValueError("Choose a saved match.")
    path = store(config) / f"{match_id}.json"
    if path.is_symlink():
        raise PermissionError("Versus matches must be files inside the match library.")
    record = json.loads(path.read_bytes())
    if record.get("id") != match_id:
        raise ValueError("Saved Versus match ID changed.")
    return record, read_packet(record)


def read_packet(record):
    packet = base64.b64decode(record["packet"], validate=True)
    if len(packet) < PACKET.size:
        raise ValueError("The saved match is incomplete.")
    magic, ident, arena, size, x, y, crc = PACKET.unpack_from(packet)
    payload = packet[PACKET.size:]
    start = size * 2 * (196 + 8)
    extra = len(payload) - start
    if (magic not in (MAGIC, RELIC_MAGIC) or ident.hex() != record["id"] or size not in versus.TEAM_SIZES or record["size"] != size or
            arena not in {m[0] for m in versus.MAPS} or max(x, y) > 127 or
            extra < 0 or (magic == MAGIC and extra) or (magic == RELIC_MAGIC and not extra) or
            extra % RELIC_ENTRY.size or extra > size * 2 * versus.EQUIPMENT_SLOTS * RELIC_ENTRY.size or
            binascii.crc32(payload) != crc):
        raise ValueError("The saved match packet is invalid.")
    used = set()
    for fighter, slot, raw in RELIC_ENTRY.iter_unpack(payload[start:]):
        base = versus.u16(raw, 0)
        if (fighter >= size * 2 or slot >= versus.EQUIPMENT_SLOTS or (fighter, slot) in used or
                not 0 < base < 999 or base != versus.u16(payload, fighter * 196 + 0x4a + slot * 4)):
            raise ValueError("The saved match contains an invalid relic record.")
        used.add((fighter, slot))
    return packet


def runtime_path(config, runtime):
    root = config.data_root.parent
    key = runtime["versusQueue"]
    if not isinstance(key, str) or not re.fullmatch(r"[0-9a-f]{16}", key):
        raise PermissionError("The installed Versus runtime has an invalid match queue key.")
    path = root / f"versus-next-{key}.dat"
    if path.is_symlink() or path.resolve().parent != root:
        raise PermissionError("The Versus handoff must stay inside the selected game folder.")
    return path


def launch_path(handoff):
    path = handoff.with_name(handoff.name.replace("versus-next-", "versus-start-", 1))
    if path.is_symlink() or path.resolve().parent != handoff.parent:
        raise PermissionError("The Versus launch request must stay inside the selected game folder.")
    return path


def round_path(handoff):
    path = handoff.with_name(handoff.name.replace("versus-next-", "versus-round-", 1))
    if path.is_symlink() or path.resolve().parent != handoff.parent:
        raise PermissionError("The Versus round title must stay inside the selected game folder.")
    return path


def round_teams_path(handoff):
    # Keep the filename used by the first loader that read finalist names.
    path = handoff.with_name(handoff.name.replace("versus-next-", "versus-final-", 1))
    if path.is_symlink() or path.resolve().parent != handoff.parent:
        raise PermissionError("The Versus team names must stay inside the selected game folder.")
    return path


def applied_runtime(config):
    state = config.state()
    applied = state.get("applied") or {}
    runtime = state.get("menuRuntime") or {}
    name = applied.get("name")
    if not name or runtime.get("project") != name or not runtime.get("versusQueue"):
        return None
    return runtime


def with_fighter_data(record, packet):
    names = record["squads"]
    if (len(names) != 2 or any(not isinstance(team, list) or len(team) != record["size"] for team in names)):
        raise ValueError("The saved match has an invalid lineup.")
    encoded = []
    for team in names:
        for name in team:
            if not isinstance(name, str):
                raise ValueError("The saved match contains an invalid fighter name.")
            raw = name.partition("\0")[0].encode("utf-8", "replace")
            raw = raw[:NAME_ROW - 1].decode("utf-8", "ignore").encode("utf-8")
            encoded.append(raw.ljust(NAME_ROW, b"\0"))
    stats = base64.b64decode(record.get("permanentStats", ""), validate=True)
    if "permanentStats" in record and len(stats) != 2 * record["size"] * versus.PERMANENT_STAT_ROW:
        raise ValueError("The saved match contains an invalid permanent stat block.")
    payload = packet[PACKET.size:] + b"".join(encoded) + stats
    _, match_id, arena, size, x, y, _ = PACKET.unpack_from(packet)
    return PACKET.pack(STAT_MAGIC if stats else NAME_MAGIC, match_id, arena, size, x, y, binascii.crc32(payload)) + payload


def prepare_queue(config, record, packet):
    runtime = applied_runtime(config)
    if runtime is None:
        raise ValueError("Enable Versus in a Steam project and apply it before queuing a match.")
    if packet.startswith(RELIC_MAGIC) and not runtime.get("versusRelics"):
        raise ValueError("Apply the project with this editor and restart the game to enable Versus relics.")
    if "permanentStats" in record and not runtime.get("versusStats"):
        raise ValueError("Apply the project with this editor and restart the game to import permanent stat boosts.")
    if record["size"] in (3, 6) and not runtime.get("versusSmallTeams"):
        raise ValueError("Apply the project with this editor and restart the game to play 3 vs 3 or 6 vs 6.")
    size = record["size"]
    if size > 12 and not (runtime.get("settings") or {}).get(battle_encounters.KEY):
        raise ValueError(f"Enable Expanded Battle Limit for {size} vs {size}.")
    if size > runtime.get("versusMaxTeamSize", 24):
        raise ValueError(f"Apply the updated Versus project and restart the game to play {size} vs {size}.")
    battle = config.resolve(battle_encounters.BATTLE).read_bytes()
    art = config.resolve("FileTable.bin").read_bytes()
    for data, field, compatible, fingerprint in (
        (battle, "battleRevision", "battleWithoutAI", versus.battle_without_ai),
        (art, "artRevision", "artWithoutAI", versus.art_without_ai),
    ):
        if save_editor.sha(data) != record[field] and (
            not record.get(compatible) or record[compatible] != fingerprint(data)
        ):
            raise ValueError("The installed game tables changed. Save this matchup again using the current game data.")
    _, pack = battle_encounters.archive(battle)
    profiles = versus.rows(pack, 27)
    for i in range(record["size"] * 2):
        ai = packet[PACKET.size + i * 196 + 0x94]
        if ai == 0 or ai >= profiles.count or not any(profiles.row(ai)):
            raise ValueError(f"AI {ai} is unavailable in the applied project. Apply its profile before queuing this fight.")
    if runtime.get("versusNames"):
        packet = with_fighter_data(record, packet)
    return runtime_path(config, runtime), packet


def select(config, match_id, atomic_replace):
    record, packet = load_match(config, match_id)
    path, handoff = prepare_queue(config, record, packet)
    atomic_replace(path, handoff)
    return public_match(record)


def clear(config, atomic_replace):
    runtime = applied_runtime(config)
    if runtime is None:
        raise ValueError("Apply a project with Versus enabled before changing the queue.")
    atomic_replace(runtime_path(config, runtime), b"")
    return {"queued": None}


def queue_state(config, full_history=False):
    next_match = None
    launch_match = None
    runtime = applied_runtime(config)
    if runtime:
        try:
            with runtime_path(config, runtime).open("rb") as ready:
                header = ready.read(PACKET.size)
                if len(header) == PACKET.size and header[:8] in (MAGIC, RELIC_MAGIC, NAME_MAGIC, STAT_MAGIC):
                    next_match = PACKET.unpack(header)[1].hex()
        except FileNotFoundError:
            pass
        if next_match and runtime.get("versusAutoLaunch"):
            try:
                with launch_path(runtime_path(config, runtime)).open("rb") as request:
                    pair = request.read(33)
                if len(pair) == 32 and pair[16:].hex() == next_match:
                    launch_match = next_match
            except FileNotFoundError:
                pass
    log = config.data_root.parent / "menu-mods.log"
    try:
        file = log.stat()
        results, notices, active = log_status(log, file.st_mtime_ns, file.st_size, full_history)
    except FileNotFoundError:
        results, notices, active = {}, {}, None
    return {"queued": next_match, "active": active, "results": results, "notices": notices,
            "launch": launch_match, "autoLaunchSupported": bool(runtime and runtime.get("versusAutoLaunch")),
            "expanded": bool(runtime and (runtime.get("settings") or {}).get(battle_encounters.KEY)),
            "maxTeamSize": runtime.get("versusMaxTeamSize", 24) if runtime else 0,
            "ready": runtime is not None, "readOnly": config.read_only}


@lru_cache(maxsize=8)
def log_status(path, _stamp, size, full_history):
    results, notices, active = {}, {}, None
    with path.open("rb") as log:
        if not full_history:
            log.seek(max(0, size - 131072))
        for raw in log:
            line = raw.rstrip(b"\r\n")
            if line in (b"Versus: match started.",
                        b"Versus: Almorica Training hooks ready. Both teams use combat knockout rules."):
                active = None
            elif match := LOG_LINE.fullmatch(line):
                match_id, state = (field.decode("ascii") for field in match.groups())
                if state == "started":
                    active = match_id
                    results.pop(match_id, None)
                    notices.pop(match_id, None)
                elif state == "some relics used base stats":
                    notices[match_id] = "Some relics used their base stats because the host ran out of free relic slots."
                else:
                    results[match_id] = state
                    if active == match_id:
                        active = None
    return results, notices, active


def status(config):
    matches = []
    for file in sorted(store(config).glob("*.json")):
        if not MATCH_ID.fullmatch(file.stem):
            continue
        record, _ = load_match(config, file.stem)
        matches.append(public_match(record))
    matches.sort(key=lambda match: (match["created"], match["id"]))
    return queue_state(config) | {"matches": matches}
