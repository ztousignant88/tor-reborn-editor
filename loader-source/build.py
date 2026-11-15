"""Build the editor's three Windows runtimes with Zig 0.15.2."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
PROFILES = ('standard', 'throw', 'steam')
LEGACY_OBJECTS = (
    'equipment_bank.c', 'equipment_lifecycle.c', 'equipment_inventory_runtime.c',
    'equipment_ownership_runtime.c', 'equipment_autoequip_runtime.c',
    'equipment_manual_runtime.c', 'equipment_activation.c',
)


def inputs(profile):
    source = ROOT / profile
    sources = [source / 'dinput_proxy.c', source / 'psp_status.c']
    if profile == 'steam':
        expansion = source / 'expansion'
        sources += [source / 'rogue/steal_runtime.c', source / 'equip/equip_runtime.c',
                    source / 'throw/throw_reborn.c', *sorted(expansion.glob('*.c'))]
        return [expansion], sources
    legacy = ROOT / 'legacy'
    shared = legacy / 'build/shared-inventory'
    sources += [shared / 'rogue/steal_runtime.c', shared / 'equip_runtime.c',
                *(legacy / name for name in LEGACY_OBJECTS)]
    if profile == 'throw':
        sources.append(ROOT / 'legacy-throw/throw_reborn.c')
    return [ROOT / f'legacy-equip-{profile}', legacy, legacy], sources


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zig', default='zig', help='Path to the Zig executable')
    parser.add_argument('--profile', choices=PROFILES, action='append')
    parser.add_argument('--install', action='store_true',
                        help='Replace the bundled runtimes in this editor and update their checksums')
    args = parser.parse_args()
    out = ROOT / 'build'
    out.mkdir(exist_ok=True)
    editor = ROOT.parent / 'tools/menu_mods'
    path = editor / 'manifest.json'
    manifest = json.loads(path.read_bytes())
    steam = next(row for row in manifest['compatibleExecutables'].values()
                 if row['loader'] == 'steam-1.0.8.dll')
    profiles = {**manifest['pspLegacyLoaders'], 'steam': steam}
    replacements = {}
    for name in args.profile or PROFILES:
        profile = profiles[name]
        includes, sources = inputs(name)
        dll = out / profile['loader']
        subprocess.run([args.zig, 'cc', '-target', 'x86_64-windows-gnu', '-O2',
                        '-Wall', '-Wextra', '-Werror', '-shared',
                        *(f'-I{path}' for path in includes), *map(str, sources),
                        '-luser32', '-lbcrypt', '-o', str(dll)], check=True)
        replacements[name] = dll
        print(dll)
    if args.install:
        old_hashes = set(manifest.get('replaces', []))
        for name, dll in replacements.items():
            profile = profiles[name]
            data = dll.read_bytes()
            old_hashes.add(profile['dllSHA256'])
            profile['dllSHA256'] = sha256(data).hexdigest()
            (editor / dll.name).write_bytes(data)
        manifest['replaces'] = sorted(old_hashes)
        path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
