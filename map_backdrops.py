"""The outdoor backdrop profiles share the order of the native map list."""

from collections import defaultdict
from pathlib import PurePosixPath
import re
import struct

from ai_choices_data import cstr, rebuild_pakd
from art_registry import parse
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd, Xlce, u32

KEY = 'mapBackdrops'
ARCHIVE = 'bg/bg_common.dat'
SYSTEM = 'system/system_data.dat'
PROFILE_ID = 206
PROFILE_SIZE = 56


def settings(value, *, allow_reset=False):
    if value is None:
        return {}
    if not isinstance(value, dict) or len(value) > 1024:
        raise ValueError('Invalid map backdrop settings.')
    for name, ident in value.items():
        if not re.fullmatch(r'bg[0-9a-z_]{1,80}', name):
            raise ValueError('Invalid map or backdrop ID.')
        if allow_reset and ident is None:
            continue
        if type(ident) is not int or not 0 <= ident <= 65535:
            raise ValueError('Invalid map or backdrop ID.')
    return value


def map_names(data):
    table = Pakd(DatArchive.read(data).pack).entry(5)
    _, count, header, pool = struct.unpack_from('<4I', table)
    if header != 16 or pool != header + count * 32 or pool > len(table):
        raise ValueError('Unsupported battlefield list layout.')
    return [PurePosixPath(cstr(table, pool + struct.unpack_from('<Q', table, header + i * 32 + 16)[0])
                          .decode('ascii')).stem.lower()
            for i in range(count)]


def read_profiles(data):
    dat = DatArchive.read(data)
    pack = Pakd(dat.pack)
    count = len(pack)
    ids = struct.unpack_from(f'<{count}I', pack.data, 12 + count * 4)
    index = ids.index(PROFILE_ID)
    table = Xlce(pack.entry(index))
    if table.row_size != PROFILE_SIZE:
        raise ValueError('Unsupported map backdrop profile layout.')
    return dat, pack, index, table


def backdrop_assets(file_table):
    directories = parse(file_table).directories
    return {
        entry.id: entry.path for directory in directories if directory.id == 150
        for entry in directory.entries
        if entry.id and re.fullmatch(r'bg/back/back\d{3}_\d{3}_\d{3}\.dat', entry.path)
    }


def available_profiles(table, assets):
    profiles = {}
    for i in range(table.count):
        row = table.row(i)
        ident = u32(row, 0)
        if ident == 0 or ident in assets:
            profiles.setdefault(ident, row)
    if 0 not in profiles:
        raise ValueError('The map backdrop table has no empty profile.')
    return profiles


def view(data, system, file_table, templates):
    _, _, _, table = read_profiles(data)
    names = map_names(system)
    assets = backdrop_assets(file_table)
    profiles = available_profiles(table, assets)
    baseline = {}
    maps = defaultdict(list)
    for i, name in enumerate(names):
        ident = u32(table.row(i), 0) if i < table.count else 0
        baseline.setdefault(name, ident)
        if name.startswith('bg'):
            maps[ident].append(name)
    for name, source in templates.items():
        if source not in baseline:
            raise ValueError(f'No backdrop template was found for {name}.')
        baseline[name] = baseline[source]
    return {
        'defaults': baseline,
        'templates': templates,
        'choices': [
            {'id': ident, 'path': assets.get(ident), 'sampleMaps': list(dict.fromkeys(maps[ident]))[:8]}
            for ident in sorted(profiles)
        ],
    }


def build(data, system, file_table, templates, overrides):
    dat, pack, index, table = read_profiles(data)
    names = map_names(system)
    available = available_profiles(table, backdrop_assets(file_table))
    rows = [table.row(i) for i in range(table.count)]
    original_defaults = {}
    for i, name in enumerate(names[:table.count]):
        if name not in templates:
            original_defaults.setdefault(name, rows[i])
    if templates.keys() - set(names) or set(templates.values()) - original_defaults.keys():
        raise ValueError('A custom battlefield has no matching backdrop template.')
    for name in set(names) & overrides.keys():
        if overrides[name] not in available:
            raise ValueError(f'Backdrop {overrides[name]} is unavailable for {name}.')
    # The native renderer indexes the profile by map-list row, including variants.
    # Carry the entire donor profile so the picture keeps its scale and tint.
    rows.extend([available[0]] * max(0, len(names) - len(rows)))
    for i, name in enumerate(names):
        if name in templates:
            donor = templates[name]
            default = original_defaults[donor]
            inherited = overrides.get(donor, u32(default, 0))
            rows[i] = default if inherited == u32(default, 0) else available[inherited]
        ident = overrides.get(name)
        if ident is not None and ident != u32(rows[i], 0):
            rows[i] = available[ident]
    end = table.header + table.row_size * table.count
    if any(table.data[end:]):
        raise ValueError('Unsupported data after the backdrop profiles.')
    extra_padding = len(table.data) - end - (-end % 16)
    payload = bytearray(table.data[:table.header])
    struct.pack_into('<I', payload, 4, len(rows))
    payload.extend(b''.join(rows))
    payload.extend(bytes(-len(payload) % 16 + extra_padding))
    if payload == table.data:
        return data
    return dat.rebuild(rebuild_pakd(pack, {index: bytes(payload)}))
