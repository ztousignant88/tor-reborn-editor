# TO:R Editor

**November 25, 2026**

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
| **Integrated Mods** | Menu Controls, AI Plus, Versus Mode, Mod Preparation, restored spells and classes, and Hard Mode and Cheat options |
| **Files** | Projects, project merges, art imports and exports, Save Editor, and restore tools |

**Formulas:** Open **Stats & Values → Others → Formulas** to edit HP Damage, Accuracy, HP Healing, and MP Damage weights. Each profile lists its stock values and the equipment and effect records that currently reference it. Select a record from **Used by** to open it. Save and apply the project to use your changes in game.

**Import character helpers:** In **Files → Art importer/exporter**, choose **Import character** or **Create an independent character**. Beneath the body sheets, enable **Use my own aura and mask sheets** to supply PNGs at the displayed native sizes. Supplied sheets use their full RGBA channels and appear in the rebuild preview. Export with helper artwork enabled to obtain matching templates.

**Add an icon:** Use **Files → Art importer/exporter → Add new icon**. Choose the icon type and a 64 × 64 PNG, preview it, and add it to the project. Select its name in the record's **Custom icon** picker. For an active ability, use its linked effect. Save, then apply the project. Imported icons can be exported as PNGs from the art viewer.

**Share a project:** Zip the individual folder under `editor/projects` that contains `project.json` and `files`. The recipient extracts that folder under their own `editor/projects`, then loads and applies it. Use **Files → Merge Projects…** to review conflicts before combining edits. Review exported art packages and project files for third-party game assets before sharing them.

**Edit a game save:** Open **Files → Save Editor…** and choose a profile and slot. The save editor reads names and art from the installed game. It can edit your army, inventory, campaign records, faction reputation, shop level, and the Auto-battle and Chariot Tarot unlocks. See the [Save Editor guide](docs/Save%20Editor.md) for supported save layouts and backups.

## Shop Hiring

Open a project and choose **Stats & Values → Others → Shop hiring**. Choose **Fixed roster** to fill the shop's ten Hire slots, or **Random pool** to draw ten offers from a list you build. The random pool can include custom choices, recruitable large monsters, or both. You can reroll after a battle, when reopening Hire, or at both points.

The **Character or pool** picker accepts generic and special character sheets. A special character's sheet supplies its identity and appearance. Save and apply the project, then restart the game to see the new offers.

## Expand Skill & Spell Slots

On Steam **1.0.8.0**, open a project and enable **Integrated Mods → Expand Skill & Spell Slots**. It adds a second row of four slots to Spells and Skills in Unit Details. The Battles editor exposes the extra slots for roster assignments. The Save Editor uses the expanded slots after you apply the project.

Hard Mode's random enemy skills and spells can fill vacant slots in both rows. Save and apply the project, then restart the game. Proficiency II uses the same equipment hooks and cannot be enabled alongside this version.

## Large battles and overworld encounters

Open a project and go to **Integrated Mods → Hard Mode → Large battles**. **Expanded Battle Limit** raises the total from 30 to 62. The Battles editor uses that limit for roster edits and counts player deployment slots, allies including guests, and enemies together. Save and apply the project to use those slots in game. The mod works with Steam 1.0.8.0. Battles using the extra slots support Chariot and disable Battle Suspend.

Under **Overworld encounters**, enable **The Final Showdown**, **The Walking Dead**, or both. Each fight enables the larger limit and allows 12 players against 50 enemies. The two roads branch from Tynemouth Hill, and both fights can be replayed after Tynemouth Hill is unlocked. Save the project, apply it, and restart the game. To remove either encounter, clear its toggle, save, and apply again.

## World Map

Open a project and choose **Stats & Values → Others → World Map**. Drag a marker to move it and its roads, or select a location to change its name or enter coordinates. Use **Add battle event** to place a replayable encounter on an available branch from Tynemouth Hill, choose its battlefield, and set 1–12 player deployment slots. The event copies the template terrain and starting enemies. The event name appears on the linked battle roster, battlefield map and pre-battle cutscene. Save the world map to open those links. On the cutscene link, choose the chapter and use **Add cutscene** to author that chapter's opening scene. Save your cutscene and terrain edits from the main editor. The east and west locations share slots with the two Hard Mode encounters. The southern location is independent.

**Save map changes** stores the layout in the project. **Apply Project** writes it to your game. Remove an event or restore an original location in World Map, save, and apply again to take the change out of your game.

**Integrated Mods → Mod Preparation → World Map Event Expansion** raises the limit to 39 custom events on Steam 1.0.8.0. World Map offers to enable it when you run out of standard event sites. Each event’s details show its campaign unlock trigger and connecting road separately. The three standard sites unlock with Tynemouth Hill. Each expanded site inherits the unlock flag of its assigned stock location.

Select a custom event’s **Unlock condition** to choose a stock location opening, a campaign milestone, or one of 25 Warren Report Talk topics. A Warren Report trigger activates when you read the selected topic. Roads require both endpoints to be open. Select **Use event default** to restore the slot’s original trigger.

In **Maps → Backdrop**, choose and preview the scenery that appears behind the battlefield. New events inherit their template’s backdrop. Save the backdrop change with the map, then apply the project to use it in game.

## Versus Mode

Enable **Integrated Mods → Versus Mode** and save the project to unlock the top-bar **Versus** button. When you first open Versus, the editor offers to enable Expanded Battle Limit for 24 vs 24 and 30 vs 30 tournaments. You can decline and play 3 vs 3, 6 vs 6, or 12 vs 12. Apply the project and restart the game before queuing a fight.

Build teams from saves or generate themed squads, then queue a fight at **Almorica Castle → Versus**. Open **Match queue** to run a four-team or eight-team tournament, follow results, and enable automatic progression. See the [Versus Mode guide](docs/versus-runtime.md).

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
