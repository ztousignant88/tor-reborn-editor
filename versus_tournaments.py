"""Saved single-elimination Versus brackets and their live queue handoff."""

import base64
import binascii
import json
from itertools import combinations
from random import Random
from uuid import NAMESPACE_URL, uuid4, uuid5

import menu_runtime
import versus
import versus_queue as queue


ROUND_TITLES = {"Semifinal 1": 2, "Semifinal 2": 3, "Final": 4,
                **{f"Quarterfinal {i}": 4 + i for i in range(1, 5)}}


def library(config):
    root = queue.store(config)
    path = root / "tournaments"
    if path.is_symlink() or path.resolve().parent != root.resolve():
        raise PermissionError("Tournaments must stay inside the Versus library.")
    return path


def tournament_path(config, ident):
    if not isinstance(ident, str) or not queue.MATCH_ID.fullmatch(ident):
        raise ValueError("Choose a saved tournament.")
    path = library(config) / f"{ident}.json"
    if path.is_symlink():
        raise PermissionError("Tournament entries must be regular files.")
    return path


def key(pair):
    return f"{pair[0]}-{pair[1]}"


def pair_teams(teams):
    return zip(teams[::2], teams[1::2], strict=True)


def team_profiles(tournament):
    count = tournament["size"]
    profiles = []
    for pair in pair_teams(range(len(tournament["teams"]))):
        packet = queue.read_packet(tournament["games"][key(pair)])
        for side in range(2):
            profiles.append([packet[queue.PACKET.size + (side * count + i) * 196 + 0x94]
                             for i in range(count)])
    return profiles


def describe(tournament, state):
    teams = [team | {"ai": ai} for team, ai in zip(tournament["teams"], team_profiles(tournament), strict=True)]

    def fight(label, pair):
        if None in pair:
            return {"label": label, "teams": list(pair), "phase": "waiting", "winner": None, "match": None}
        pair_key = key(pair)
        match_id = tournament["attempts"].get(pair_key)
        result = state["results"].get(match_id) or tournament.get("recordedResults", {}).get(match_id)
        winner = pair[0] if result == "Team A wins" else pair[1] if result == "Team B wins" else None
        phase = ("won" if winner is not None else "draw" if result == "draw"
                 else "battle" if match_id and match_id == state["active"]
                 else "queued" if match_id and match_id == state["queued"] else "ready")
        return {"label": label, "teams": list(pair), "match": match_id, "phase": phase, "winner": winner,
                "arena": tournament.get("attemptArenas", {}).get(pair_key, tournament["arena"]) if match_id else None,
                "notice": state["notices"].get(match_id)}

    fights = []
    contenders = list(range(len(teams)))
    for label, pairs_in_round in (("Quarterfinal", 4), ("Semifinal", 2), ("Final", 1)):
        if len(contenders) != 2 * pairs_in_round:
            continue
        matches = [fight(f"{label} {i}" if pairs_in_round > 1 else label, pair)
                   for i, pair in enumerate(pair_teams(contenders), 1)]
        fights.extend(matches)
        contenders = [match["winner"] for match in matches]
    next_fight = next((match for match in fights if match["phase"] != "won"), None)
    return {k: tournament[k] for k in ("id", "title", "arena", "size")} | {
        "teams": teams, "fights": fights, "champion": fights[-1]["winner"], "next": next_fight,
        "autoAdvance": bool(tournament.get("autoAdvance")),
        "autoLaunch": bool(tournament.get("autoLaunch")),
        "randomArena": bool(tournament.get("randomArenas")),
    }


def status(config):
    state = queue.queue_state(config, full_history=True)
    tournaments = []
    for path in sorted(library(config).glob("*.json")):
        if queue.MATCH_ID.fullmatch(path.stem) and not path.is_symlink():
            tournaments.append(describe(json.loads(path.read_bytes()), state))
    return {"tournaments": tournaments, "queued": state["queued"], "active": state["active"],
            "ready": state["ready"], "readOnly": state["readOnly"], "expanded": state["expanded"],
            "maxTeamSize": state["maxTeamSize"],
            "projectEnabled": versus.project_enabled(config),
            "launch": state["launch"], "autoLaunchSupported": state["autoLaunchSupported"],
            "autoError": getattr(config, "tournament_auto_error", None)}


def title(value, maximum, label):
    text = value.strip() if isinstance(value, str) else ""
    if not text or len(text) > maximum:
        raise ValueError(f"{label} must be 1–{maximum} characters.")
    return text


def encode(record):
    return json.dumps(record, ensure_ascii=False, indent=2).encode("utf-8")


def create(config, body, atomic_replace):
    count, arena, omit_snapshots = versus.prepare_format(body)
    versus.require_project(config, count)
    label = title(body.get("title"), 72, "Tournament name")
    selections = body.get("teams")
    if not isinstance(selections, list) or len(selections) not in (4, 8) or any(not isinstance(s, dict) for s in selections):
        raise ValueError("Choose four or eight squads.")
    names = [title(selection.get("label"), 28, "Team name") for selection in selections]
    if len({name.casefold() for name in names}) != len(selections):
        raise ValueError("Give each team a distinct name.")
    game, teams = versus.prepare_teams(config, selections, count, omit_snapshots)
    used = set()
    for team in teams:
        for unit in team["lineup"]:
            identity = team["sha256"], unit["slot"]
            if identity in used:
                raise ValueError(f'{unit["name"]} is already on another team from this save.')
            used.add(identity)
    formations = None
    if arena == versus.RANDOM_ARENA:
        formations = versus.random_formations(game, count)
        arena, formation = next(iter(formations.items()))
    else:
        formation = versus.map_formation(game, arena, count)
    # Store every possible matchup so later rounds use the original lineups.
    games = {
        key(pair): queue.match_record(game, arena, [teams[i] for i in pair], formation,
                                     f"{names[pair[0]]} vs {names[pair[1]]}")
        for pair in combinations(range(len(teams)), 2)
    }
    record = {"id": uuid4().hex, "title": label, "arena": arena[1], "size": count,
              "teams": [{"name": name, "fighters": [unit["name"] for unit in team["lineup"]],
                         "omittedSnapshots": sum(unit["omittedSnapshots"] for unit in team["lineup"])}
                        for name, team in zip(names, teams, strict=True)],
              "games": games, "attempts": {}}
    if formations:
        record["randomArenas"] = {str(m[0]): positions for m, positions in formations.items()}
    path = tournament_path(config, record["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_replace(path, encode(record))
    return describe(record, queue.queue_state(config, full_history=True))


def place_match(packet, attempt, arena_id, formation):
    magic, _, _, size, _, _, _ = queue.PACKET.unpack_from(packet)
    left, right, (x, y) = formation
    facing = versus.starting_facing(left, right)
    payload = bytearray(packet[queue.PACKET.size:])
    for i, tile in enumerate(left + right):
        offset = i * 196 + 10
        payload[offset:offset + 3] = bytes((*tile, (facing + 2 * (i >= size)) % 4))
    return queue.PACKET.pack(magic, attempt.bytes, arena_id, size, x, y, binascii.crc32(payload)) + payload


def round_ticket(match_id, label, record):
    auto_next = label != "Final" and record.get("autoAdvance") and record.get("autoLaunch")
    return match_id + bytes((ROUND_TITLES[label], bool(auto_next)))


def round_teams_ticket(match_id, fight, record):
    names = []
    for index, team in enumerate(fight["teams"]):
        name = " ".join(record["teams"][team]["name"].replace("\0", " ").split()) or f"Team {'AB'[index]}"
        names.append(name[:28].encode("utf-8").ljust(113, b"\0"))
    return match_id + b"".join(names)


def publish(config, path, before, record, state, fight, atomic_replace, attempt=None, launch_after=None):
    if not fight or fight["phase"] not in ("ready", "draw"):
        raise ValueError("There is no tournament fight to queue yet.")
    pair = key(fight["teams"])
    match = record["games"][pair]
    packet = queue.read_packet(match)
    attempt = attempt or uuid4()
    formations = record.get("randomArenas")
    if formations:
        # Companions observing the same result share an attempt ID and draw.
        arena_id = Random(attempt.int).choice(sorted(formations))
        arena = next(m[1] for m in versus.MAPS if m[0] == int(arena_id))
        packet = place_match(packet, attempt, int(arena_id), formations[arena_id])
    else:
        arena = match["arena"]
        packet = packet[:8] + attempt.bytes + packet[24:]
    handoff_path, handoff = queue.prepare_queue(config, match | {"id": attempt.hex}, packet)
    record["attempts"][pair] = attempt.hex
    record.setdefault("attemptArenas", {})[pair] = arena
    atomic_replace(path, encode(record))
    try:
        atomic_replace(queue.round_path(handoff_path), round_ticket(attempt.bytes, fight["label"], record))
        atomic_replace(queue.round_teams_path(handoff_path), round_teams_ticket(attempt.bytes, fight, record))
        if launch_after:
            # The game verifies both IDs. The request becomes eligible only
            # when the matching packet is published, and past results can't
            # start a battle in a new game session.
            atomic_replace(queue.launch_path(handoff_path), bytes.fromhex(launch_after) + attempt.bytes)
        atomic_replace(handoff_path, handoff)
    except Exception:
        atomic_replace(path, before)
        raise
    return describe(record, state | {"queued": attempt.hex})


def advance(config, ident, atomic_replace):
    path = tournament_path(config, ident)
    before = path.read_bytes()
    record = json.loads(before)
    state = queue.queue_state(config, full_history=True)
    return publish(config, path, before, record, state, describe(record, state)["next"], atomic_replace)


def set_auto_option(config, body, atomic_replace):
    enabled = body.get("enabled")
    if type(enabled) is not bool:
        raise ValueError("Choose whether to enable this tournament option.")
    path = tournament_path(config, body.get("id"))
    record = json.loads(path.read_bytes())
    option = body["action"]
    if enabled and option == "autoLaunch" and not record.get("autoAdvance"):
        raise ValueError("Enable Auto advance first.")
    state = queue.queue_state(config, full_history=True)
    if enabled and option == "autoLaunch" and not state["autoLaunchSupported"]:
        raise ValueError("Apply this editor's Versus runtime and restart the game to use Auto start.")
    if not enabled and state["launch"] and state["launch"] in record["attempts"].values():
        handoff = queue.runtime_path(config, queue.applied_runtime(config))
        atomic_replace(queue.launch_path(handoff), b"")
    record[option] = enabled
    if option == "autoAdvance" and not enabled:
        record["autoLaunch"] = False
    atomic_replace(path, encode(record))
    if state["queued"] in record["attempts"].values():
        fight = next((match for match in describe(record, state)["fights"] if match["match"] == state["queued"]), None)
        if fight:
            handoff = queue.runtime_path(config, queue.applied_runtime(config))
            atomic_replace(queue.round_path(handoff), round_ticket(bytes.fromhex(fight["match"]), fight["label"], record))
    return describe(record, queue.queue_state(config, full_history=True))


def set_random_arena(config, body, atomic_replace):
    enabled = body.get("enabled")
    if type(enabled) is not bool:
        raise ValueError("Choose whether to randomize the tournament arena.")
    path = tournament_path(config, body.get("id"))
    record = json.loads(path.read_bytes())
    if enabled:
        formations = versus.random_formations(versus.GameData(config), record["size"])
        record["randomArenas"] = {str(arena[0]): positions for arena, positions in formations.items()}
    else:
        record.pop("randomArenas", None)
    atomic_replace(path, encode(record))
    return describe(record, queue.queue_state(config, full_history=True))


def restart(config, ident, atomic_replace):
    path = tournament_path(config, ident)
    before = path.read_bytes()
    record = json.loads(before)
    state = queue.queue_state(config, full_history=True)
    bracket = describe(record, state)
    if any(fight["phase"] == "battle" for fight in bracket["fights"]):
        # Quitting mid-match leaves a started entry in the log.
        menu_runtime.assert_game_closed(config)
    if record["attempts"]:
        record.setdefault("previousRuns", []).append({
            "attempts": record["attempts"], "winners": [fight["winner"] for fight in bracket["fights"]],
            "arenas": record.get("attemptArenas", {}),
        })
    record["attempts"] = {}
    record.pop("attemptArenas", None)
    record.pop("recordedResults", None)
    return publish(config, path, before, record, state, describe(record, state)["next"], atomic_replace)


def auto_advance(config, atomic_replace):
    state = queue.queue_state(config, full_history=True)
    queued = state["queued"]
    if not state["ready"] or not queued or state["active"] not in (None, queued):
        return
    for path in library(config).glob("*.json"):
        if not queue.MATCH_ID.fullmatch(path.stem) or path.is_symlink():
            continue
        before = path.read_bytes()
        record = json.loads(before)
        if not record.get("autoAdvance") or queued not in record["attempts"].values():
            continue
        bracket = describe(record, state)
        fight = bracket["next"]
        if not fight or fight["phase"] != "ready":
            return
        index = bracket["fights"].index(fight)
        if index == 0:
            return
        previous = bracket["fights"][index - 1]
        if previous["phase"] == "won" and previous["match"] == queued:
            # Two companion servers observing the same result publish the same
            # attempt ID even if they both read the result before either writes.
            attempt = uuid5(NAMESPACE_URL, f"tactics-ogre-versus/{record['id']}/{queued}")
            launch_after = (queued if record.get("autoLaunch") and state["autoLaunchSupported"]
                            and state["results"].get(queued) in ("Team A wins", "Team B wins") else None)
            publish(config, path, before, record, state, fight, atomic_replace, attempt, launch_after)
        return


def assign_ai(config, body, atomic_replace):
    path = tournament_path(config, body.get("id"))
    record = json.loads(path.read_bytes())
    team, choices = body.get("team"), body.get("profiles")
    size = record["size"]
    if type(team) is not int or not 0 <= team < len(record["teams"]) or not isinstance(choices, list) or len(choices) != size:
        raise ValueError("Choose an AI profile for every fighter on the selected team.")
    available = {row["id"] for row in versus.GameData(config).profiles()}
    if any(type(ai) is not int or ai not in available for ai in choices):
        raise ValueError("An AI profile is unavailable. Apply the project that includes it first.")
    for pair, match in record["games"].items():
        sides = [int(i) for i in pair.split("-")]
        if team not in sides:
            continue
        packet = queue.read_packet(match)
        header = queue.PACKET.unpack_from(packet)
        data = bytearray(packet[queue.PACKET.size:])
        start = sides.index(team) * size
        for i, ai in enumerate(choices):
            data[(start + i) * 196 + 0x94] = ai
        match["packet"] = base64.b64encode(queue.PACKET.pack(*header[:-1], binascii.crc32(data)) + data).decode("ascii")
    atomic_replace(path, encode(record))
    return describe(record, queue.queue_state(config, full_history=True))


def record_result(config, body, atomic_replace):
    path = tournament_path(config, body.get("id"))
    record = json.loads(path.read_bytes())
    state = queue.queue_state(config, full_history=True)
    fight = describe(record, state)["next"]
    result = body.get("result")
    if (not fight or not fight["match"] or fight["match"] != body.get("match") or
            fight["phase"] not in ("ready", "battle") or result not in ("Team A wins", "Team B wins", "draw")):
        raise ValueError("The current fight has no result to record manually.")
    record.setdefault("recordedResults", {})[fight["match"]] = result
    atomic_replace(path, encode(record))
    return describe(record, state)


def update(config, body, atomic_replace):
    if not isinstance(body, dict):
        raise ValueError("Invalid tournament request.")
    if body.get("action") == "create":
        return create(config, body, atomic_replace)
    if body.get("action") == "queue":
        return advance(config, body.get("id"), atomic_replace)
    if body.get("action") in ("autoAdvance", "autoLaunch"):
        return set_auto_option(config, body, atomic_replace)
    if body.get("action") == "randomArena":
        return set_random_arena(config, body, atomic_replace)
    if body.get("action") == "restart":
        return restart(config, body.get("id"), atomic_replace)
    if body.get("action") == "assignAI":
        return assign_ai(config, body, atomic_replace)
    if body.get("action") == "recordResult":
        return record_result(config, body, atomic_replace)
    raise ValueError("Choose a tournament action.")
