# TO:R Editor

**November 19, 2026**

A free, unofficial Windows editor for Tactics Ogre: Reborn. Edit battles, maps, cutscenes, game data, AI and art, and use Integrated Mods to configure gameplay changes per project.

## Install and start

1. Install Python 3.10 or newer and enable **Add python.exe to PATH** in the installer. Use a current desktop browser with WebGL 2 and BC7 texture support for 3D and texture previews. The editor uses Python's standard library, including when it builds Special Class Change artwork and the AI Plus buttons.
2. In Steam, right-click **Tactics Ogre: Reborn → Manage → Browse local files**. Extract this ZIP so the `editor` folder sits next to `Tactics Ogre Reborn.exe` and `Data`.
3. Double-click **Start Editor.bat**. Keep the console window open. The editor opens in your browser at `http://127.0.0.1:8642/` or the next available port. Check the **Game Data** path before editing. If the editor is outside the game folder, point it at your copy from a terminal in the editor folder:

   ```powershell
   python serve.py --data "D:\SteamLibrary\steamapps\common\Tactics Ogre Reborn\Data"
   ```

The editor runs locally and needs your own Windows game installation. Runtime mods are matched to supported executable versions, including Steam **1.0.8.0**. The Apply preview reports unsupported options for the selected executable. A game update may require an updated loader.

**Upgrading an existing editor:** Close the old editor and keep a copy of its entire folder. Extract the new editor and carry over `projects`, `backups`, and `maps` for the same game installation. Preserve the hidden state files in `projects` so the editor can recognize the files and loader it previously installed.

## Save, apply, and restore

1. Choose **Files → New project…** or **Load project…** before editing. Save your changes into that project. With no project open, saving writes directly to the selected game folder.
2. Close the game. Choose **Files → Apply project to the game…**, review the destination and proposed changes, then confirm. Wait until Apply finishes before launching the game. Runtime features take effect on the next launch.
3. To switch projects, use the Apply option to take out the previous project's other files. To return to the backed-up files, use **Files → Restore originals…**.

**New project** starts with the game data from before project changes, including edits saved directly to the game before the project was applied. Use **Save project as…** to copy the open project's edits. Opening either project leaves the installed game as it is until you apply a project.

Special Characters Can Change Class is a project setting. Use **Create project…** in its panel if you have no project open. **Enable Special Class Change** also enables Mod Preparation and unlocks the beast-family and recruitment options.

Keep a separate copy of important saves. The editor backs up game files it changes, and a save made while a mod is active can still depend on that mod's items, skills, or classes. For a read-only preview, start with `python serve.py --readonly`.

If a file changes while you’re editing it, Save lists the affected files and asks whether to replace them with your open edits. Cancel keeps your edits open. If the project or its generated mod layout changes, reload the project before editing those files.

Recruits added under **Cutscenes → After events** join your side at level 1 by default. Set a different joining level in the form. Existing recruitment entries with the wrong unit template, an enemy team or a zero level offer **Repair recruit…**. Save and apply the project after repairing. For item rewards, check that the item appears in **Events on the ending path** before saving.

When you add a unit in **Battles**, Save checks that the stage will load enough units for it to appear. An older project that shows a **Load N** warning can use that button to correct the stage count. Save and apply the project afterward.

## What to open

| Where | What you can edit |
| --- | --- |
| **Battles** | Formations, units, loadouts, loot, AI, finishers, objectives, and battle rules |
| **Cutscenes** | Cast, dialogue, movement, commands, linked battle scenes, and after-events |
| **Maps** | Terrain, elevation, block sides, objects, and the map library |
| **Stats & Values** | Classes, items, equipment, spells and abilities, character sheets, shops, spell and skill sets, crafting, and auto loadouts |
| **Stats & Values → Others** | Combat formulas, AI profiles, equipment sets, hiring rules, the Warren Report, and other tables |
| **Integrated Mods** | Menu Controls, AI Plus, Mod Preparation, restored spells and classes, and Hard Mode and Cheat options |
| **Files** | Projects, project merges, art imports and exports, Save Editor, and restore tools |

**Formulas:** Open **Stats & Values → Others → Formulas** to edit HP Damage, Accuracy, HP Healing, and MP Damage weights. Each profile lists its stock values and the equipment and effect records that currently reference it. Select a record from **Used by** to open it. Save and apply the project to use your changes in game.

**Import character helpers:** In **Files → Art importer/exporter**, choose **Import character** or **Create an independent character**. Beneath the body sheets, enable **Use my own aura and mask sheets** to supply PNGs at the displayed native sizes. Supplied sheets use their full RGBA channels and appear in the rebuild preview. Export with helper artwork enabled to obtain matching templates.

**Add an icon:** Use **Files → Art importer/exporter → Add new icon**. Choose the icon type and a 64 × 64 PNG, preview it, and add it to the project. Select its name in the record's **Custom icon** picker. For an active ability, use its linked effect. Save, then apply the project. Imported icons can be exported as PNGs from the art viewer.

**Share a project:** Zip the individual folder under `editor/projects` that contains `project.json` and `files`. The recipient extracts that folder under their own `editor/projects`, then loads and applies it. Use **Files → Merge Projects…** to review conflicts before combining edits. Review exported art packages and project files for third-party game assets before sharing them.

**Edit a game save:** Open **Files → Save Editor…** and choose a profile and slot. The save editor reads names and art from the installed game. It can edit your army, inventory, campaign records, faction reputation, shop level, and the Auto-battle and Chariot Tarot unlocks. See the [Save Editor guide](docs/Save%20Editor.md) for supported save layouts and backups.

## Troubleshooting

- **The browser says Connecting:** Keep the console window open and check the address printed there. The first load of a project may take longer while its Integrated Mods are prepared.
- **Changes are missing in game:** Check **Game Data** against Steam's local files, confirm that the intended project was saved and applied, then restart the game. Runtime options install `dinput8.dll` and `menu-mods.ini` beside the game executable. If the runtime initialized, look for `menu-mods.log` there.
- **Another loader is already installed:** The Apply message identifies the file it could not take over. Keep that message when reporting a problem.
- **Reporting an issue:** Include this ZIP's release date, your game version, the editor tab or mod, and the steps that reproduce it. Include the relevant error or log excerpt.

The [editor reference](docs/Editor%20reference.md) includes detailed workflows and development notes. Some entries describe older builds.

## Use, sharing, and credits

Copyright © 2026 TO:R Editor contributors.

TO:R Editor is free and its code is licensed under [GNU GPL version 3](LICENSE). You can use, modify, and redistribute it under that license. Keep the applicable notices, identify your changes when distributing modified versions, and make the corresponding source available when distributing a compiled build. The editor source and [Windows loader source and build instructions](loader-source/README.md) are included here. See [Third-party notices](THIRD-PARTY-NOTICES.md) for the upstream credits and terms.

TO:R Editor is an unofficial community project independent of Square Enix. Tactics Ogre: Reborn and its game assets belong to their respective rights holders. The GPL grant applies to the editor code. Integrated Mods can build textures using artwork from your local game installation.

**Warranty and liability.** The editor is provided as is, without warranty. See sections 15 and 16 of the [license](LICENSE).
