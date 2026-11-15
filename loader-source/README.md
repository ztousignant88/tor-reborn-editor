# Windows runtime source

The editor includes three 64-bit Windows loaders. The `standard` and `throw` directories build the two profiles for the older PC executable. The `steam` directory builds the shared loader for Steam 1.0.8.0. The legacy profiles share code in the `legacy`, `legacy-equip-*` and `legacy-throw` directories.

From the editor folder, build with Python 3.10+ and [Zig 0.15.2](https://ziglang.org/download/).

```powershell
python loader-source/build.py --zig "C:\Tools\zig\zig.exe"
```

The build writes DLLs to `loader-source/build`. Use `--profile steam` to build one profile. Add `--install` to place the rebuilt DLLs in this editor's runtime bundle and refresh their checksums. Save and apply a project normally to install them into your game. No game files are needed for compilation.

Zig records build information in the DLL, so a rebuild in a different directory can have a different SHA-256 checksum.

The loader and build script are covered by [GPL-3.0](../LICENSE). The editor's Python and browser code runs directly from the source in this package.
