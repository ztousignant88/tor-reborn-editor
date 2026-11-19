# Save Editor

## Install and open

1. Install the [TO:R Editor](../README.md) by extracting the ZIP so that `editor` sits beside `Tactics Ogre Reborn.exe` and `Data`.
2. Run **Start Editor.bat**. In the browser, choose **Files → Save Editor…** to open it in a new tab.
3. Choose a profile if the editor finds multiple accounts. Select a save slot. The status bar shows the active save folder.

The editor looks under `Documents\My Games\Tactics Ogre Reborn` for saves and reads names, sprites, and icons from the selected game's installed data. To use a different save folder, open PowerShell in the editor folder and run:

```powershell
& ".\Start Editor.bat" --saves "D:\My Saves"
```

## Edit a save

- **Units** lets you edit a unit’s class, level, stats, equipment, spells, skills, finishers, and carried items. **Duplicate** copies the selected unit to a free roster slot. **Remove** closes the gap in the roster and leaves the unit’s equipment in inventory.
- The **Portrait** field shows the unit’s current portrait. It is read-only because the game determines the portrait from the unit’s sprite.
- **Export** in the unit header creates a character file. Use **Import unit…** above the roster to add it as a new unit or replace the selected one. Equipped relics and snapshot weapons are recreated in the destination save if there is space for them.
- Under **Inventory & Goth → Army**, set the Union Level, shop level, Chariot rewind limit, and the story unlocks for **Auto-battle (AI control)** and **Chariot Tarot**. Shop level 15 is the highest story tier. Other shop requirements still apply.
- **Inventory & Goth** also includes item and equipment counts, relic copies, and snapshot weapons. Equipment counts include worn pieces. Edit individual relic copies in **Relics**. Use **+ New snapshot weapon** to build a cursed weapon or select an existing one to edit it.
- Beneath the stock lists, **Chaos Frame** lets you edit faction reputation. **Warren Report** lets you edit campaign totals such as battles, casualties, Goth earned and spent, and play time.
- Hover over controls and list entries for details. Campaign records, shop level, and battle unlocks require a supported save layout.

## Save and recover

Close the game and click **Reload**. Use **Save** to update the open slot or **Save to slot…** to write the edits to a different slot. The editor checks for changes to the original and destination files before writing. To test a change, choose an empty destination slot.

The **Backups** tab lists the copies made before each write. By default they are stored in `editor/backups/saves`. To restore one, close the game and copy the backed-up `GAME-########.SAV` file into its original save folder. Use **Undo all changes** to discard edits made since opening or last saving the slot.
