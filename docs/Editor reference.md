# TO:R Editor

A free, local editor for Tactics Ogre: Reborn: battles, cutscenes, classes and items, maps,
AI, art and gameplay mods, kept in projects you can share and switch between.

## Install

**1. Put the editor in the game folder.** Copy the whole `editor` folder into the game's
folder, the one that holds `Tactics Ogre Reborn.exe` and `Data`:

```
Tactics Ogre Reborn\                 the game folder
├─ Tactics Ogre Reborn.exe
├─ Data\
└─ editor\                           this folder
   ├─ Start Editor.bat               double-click to start
   ├─ serve.py
   ├─ projects\                      projects (yours and downloaded ones)
   ├─ maps\                          maps saved on their own (Maps → Library)
   ├─ backups\                       originals of every game file the editor changes
   └─ web\, tools\ …
```

On Steam the game folder is usually
`C:\Program Files (x86)\Steam\steamapps\common\Tactics Ogre Reborn` (right-click the game in
Steam → Manage → Browse local files). The editor finds the game by itself from there. Keeping
the editor *beside* a folder named `Tactics Ogre Reborn` also works, and `--data` points it at
any other copy (see *Run it*).

**2. Requirements:** Python 3.9 or newer (from python.org; tick "Add python.exe to PATH" when
installing; no extra packages) and Chrome, Edge or Firefox.

**3. Start it:** double-click `Start Editor.bat`. The editor opens in your browser at
http://127.0.0.1:8642/. Keep the black window open while you use it; close it to stop.

**Downloaded projects.** A project is a folder with a `project.json` file and a `files`
folder inside. Unzip it so that folder sits directly in `editor\projects\`
(`editor\projects\<project name>\project.json`), then in the editor use
**Files → Load project…** and **Files → Apply project to the game…**. Close the game before
applying. To give someone your project, zip its folder from `editor\projects\`.

**Downloaded maps** (from Maps → Library) are a `<name>.dat` and a `<name>.json`; put both
in `editor\maps\`. They show in the Library tab, where *Place over this map* puts one into a
project or the game.

**Safety.** The first time the editor changes a game file it keeps the original in
`editor\backups\`, and **Files → Restore originals…** puts every original back. Your saves
are never edited. Make a copy of the game folder first if you want to be extra careful, and
close the game before saving or applying.

## What it does

It has four main modes, picked at the top left (Stats & Values was called "Classes & items"
before):

- **Battles**: the units placed in each battle (class, level, position, facing, team,
  equipment, drops, skills, spells, finishers, element, AI and more), shown on the real
  3D battle map with in-game sprites.
- **Cutscenes**: play story scenes step by step, rewind them, edit the dialogue and mute
  spoken lines.
- **Maps**: the battle maps themselves (tile heights, terrain, objects, looks), with the
  place each map is and the battles and cutscenes the story uses it for. Build up block by
  block, paint terrain, copy buildings from other maps with stamps, change single wall
  pieces from a right-click picker, and save maps on their own in a library.
- **Stats & Values**: the game's class, equipment, item and spell/ability tables, character
  sheets, shops, spell and skill sets, crafting recipes and finishers, with in-game sprites
  and icons.

Also:

- **Stats & Values → Others**: AI profiles and status values (the AI editor), automatic
  loadouts, equipment sets, shop hiring and other game tables.
- **Integrated Mods** (button in the top bar): ready-made changes you switch on per project,
  such as the Status-focused AI behaviours, PSP spell restoration, special characters
  changing class and class marks, plus **Menu controls**: runtime switches (fast-forward,
  early Chariot, AI status scoring and more) installed with a small loader beside the
  game's .exe.
- **Files → Art importer/exporter**: viewing, exporting and importing character art,
  portraits and icons.

Everything you change is kept in a **project** (Files menu) until you apply it to the game.

**⚙ Settings** (top right) holds the text language and **Hide unknown values**, on by
default. It hides fields nobody has worked out yet: names starting with "?" or marked
`<unused>` in Stats & Values (each group says how many it hid), and a unit's raw bytes in
Battles. Both settings are kept in this browser.

Hover over a field label or its control for a description of what changing it
does, including units, special values and shared-list effects. The first help
pass covers the six data tabs and battle presets, with additional help in Maps,
Cutscenes, Crafting, Races, Finishers and spell/skill sets. Settings whose exact
Reborn behavior is still unverified say so. These descriptions are maintained
in `web/js/app/fieldhelp.js`, separately from generated schemas; they do not
change game data or the meanings/widths of saved fields.

## Run it

Requires Python 3.9+ (no extra packages) and Chrome, Edge or Firefox.

1. Double-click `Start Editor.bat`, or run `python serve.py` in a terminal.
2. The editor opens at http://127.0.0.1:8642/ (the next free port if that one is taken).
   A popup shows each start-up step; the first start after opening a project can take
   about half a minute while its mod content is prepared (see *Start-up speed*).

By default it uses the `Data` folder of the game folder it sits in, or
`../Tactics Ogre Reborn/Data` when it sits beside the game folder. For another install:

```bash
python serve.py --data "D:/SteamLibrary/steamapps/common/Tactics Ogre Reborn/Data"
```

To look around without any risk of writing, add `--readonly`.

## Merge projects

Open the project you want to start from and choose **Files → Merge Projects…**.
Select the incoming project, review the changes, and choose how to resolve each
conflict. The result opens as a new saved project, ready for the usual Apply
Project workflow. The preview checks whether the result can apply to the
selected game installation.

With a matching original file, the editor can combine separate changes to
known table fields, records and localization keys. For other files it offers
the complete versions when both projects make edits. Keep both can assign a
free ID to project-defined groups and sets. The editor stores originals for new
edits so they remain available to future merges.

**New records with the same ID.** Projects made separately each give their new
items, spells and abilities, equipment, classes and character sheets the first
free ID of that project, so two projects often use the same number for different
things. The merge gives the incoming project's clashing records the next free
IDs (equipment and classes take an unused row, since the game can't add more)
and carries over what points at them in the incoming changes: their texts,
spells used by equipment, items and skills, units in battles (character sheet,
class, equipment, items, drops) and shop rows. The review lists each record that
moved under **Given new IDs**. If the incoming project changed something else
that might hold the old ID, where a rewrite would be a guess, the merge says so
and asks you to keep one project's linked files instead.

**Characters with the same IDs.** A character's art also has sprite and
appearance numbers. When those clash, the review offers **Copy characters from
… into …**: it copies the incoming characters' art, portrait, menu faces, actor
row and character sheet into the open project with new numbers (renaming files
if the name is taken). The merge then leaves those characters out of the
incoming side and points the incoming battles at the copies. Choose **Keep
current** for the character art files it still lists (actor table, menu faces,
menu portraits).

## 3D map view

Battle map links use the game's indexed file IDs and include the main story,
DLC/Coda and the epilogue records. **Battle use** appears when a unit file has
several recorded uses: select the story/map/stage combination you want to view.
The selected use also supplies the pre-battle scene for character additions.
Unit-file edits affect every use of that shared file; the selector changes the
preview and scene context. Epilogue records are labeled where their use in normal
play has not been confirmed.

Map names use the background's own native place name where it can be matched
to localized game text. This prevents a dungeon interior from inheriting the
name of the outside world-map node where its quest began.

The Map list separates **Recorded maps**, **Size matches (guesses, check in game)**
and the full map list. Files with no chapter association, such as entry 601,
stay unassigned until a map is chosen. **No map (flat grid)** now stays selected;
**Use recorded map** returns to the selected battle use.

Map choices, chosen battle uses, names and cached map headers are saved separately
for each game Data folder and open editor project. Earlier unscoped browser
choices are kept but do not override the new links automatically. If one exists,
**Use previous map choice** adopts it for the current game/project. An older
custom battle name is offered in the Rename dialog and can be saved there.

Once a battle has its map chosen, **3D map** shows that map rendered from the game's
own model and textures, with the baked lighting, and the units standing on it.
- Drag a unit to move it.
- Drag empty space to orbit; right-drag or shift-drag to pan; scroll to zoom.
- Q/E or the arrow buttons turn the view 90°. **Fit** resets the camera.
- **2D grid** switches back to the flat height view, which also works for battles
  with no map chosen.

- Cut-out texels (alpha 0: roof edges, fences, leaves) are dropped instead of drawn black.

The 3D view needs a GPU and browser with BC7 texture support (`EXT_texture_compression_bptc`),
which nearly every desktop PC has. Without it the editor falls back to the 2D grid.

Units are drawn with their in-game battle sprites, and trees, crates and other
destructible objects with the map's own object pictures. A coloured ring at each unit's
feet shows its team. Untick **Sprites** to see plain tokens instead.

Units are coloured with the game's own palettes, so Galgastan soldiers are tan/navy,
Bakram red/purple, undead and outlaws in their colours, and so on. The palette comes
from the unit's template if it sets one, otherwise its class, otherwise its union.

Limits of the sprites so far:
- Every unit uses its standing frame, mirrored to roughly follow its facing.
- Dorgalua XL, the giant final boss, is drawn from its own multi-cell frames (its sheet is
  laid out differently from ordinary units). An actor whose sprite file can't be read still
  shows as a large dashed marker.
- Animated water and the sky/backdrop aren't drawn.
- **Indoor maps** (bg200-218 and bg009_03: 39 files, such as the shack in Golyat the opening
  scene plays in) are drawn in game as one painted picture seen from a fixed camera
  (`bgNNN_KK_p00`, 2048×2048, stored after the map's mesh). Their own texture atlas is a
  checkerboard placeholder, and the mesh only gives the room's shape. The editor shows the
  painting from that camera: the room is seen from the diagonal its walls face (only the back
  walls are modelled), and the camera tilt, scale and position are fitted by matching the
  room's outline to the painting's lit pixels. The camera isn't stored in the map file, and
  the fit can be off by a tile or so (characters then seem to stand in the walls), so the
  **Painting** panel on the view lines it up by eye: tick **Outline** to draw the room's
  edges, then move (◀ ▶ ▲ ▼), resize (− +) and tilt (⤓ ⤒) the painting until those edges sit
  on the painted walls and floor (shift-click for fine steps). The adjustment is kept per map
  in this browser; **Reset** goes back to the automatic fit. Characters behind the room's
  walls are hidden as in game. Turn the view and the room shows as a plain grey model;
  **View** (or **Fit**) goes back to the painting.

Developer pages, served while the editor runs:
- `scene.html`: view any map by name.
- `sprites.html`: view the textures inside any `.dat` file.

## Adding and removing units

- **+ Add a character…** puts a story character into the battle, the way Deneb was put
  into Golyat: on your side (team 1), an AI-controlled guest with the AI of the battle's
  other guests, on the field, at the average level of the battle's enemies, with their
  class, gear and sprites from their own row in another battle file. The battle's ally
  count goes up by 1 (see below), and if the story plays a cutscene before this battle,
  the character stands on their tile from the start of it. Move or turn them, in the
  battle or in the cutscene, and the other follows; **Undo** takes back all of it.
  - The side is chosen to its left: *Your side, AI guest* (as Deneb's Golyat row: team 1,
    guest, the AI of the battle's other guests), *Your side, you control* (team 1, not a
    guest, as Denam's row) or *Enemy* (team 2, the AI of the battle's enemies, next to them).
  - **Tested in game** (Deneb cameo v28): at Golyat, Orba as an enemy, Sara as an AI guest and
    Cistina under the player's control all appear, added with this picker.
  - The cutscene before a battle is the part the story plays up to the battle's first step
    (`start` in `web/data/battle_links.json`; 240 of the linked battles have one). Most
    battle-map scenes have no cast table: their characters are the battle's units (named
    ones by character number, others by slot + 1), so the character is only placed at the
    start of that part. Later parts play during the battle and are left alone.
  - Stage unit counts: each battle's row in the stage table (battle data entry 17) says
    how many allied (+0x11) and other (+0x12) units it loads. Adding or removing a unit
    that is on the field (also with **Duplicate** and **Remove**) changes its side's count
    by one, and **Undo** changes it back. The counts are saved with the battle files
    (`battle/battle_data_release.dat`, shared with Stats & Values).
- **+ Duplicate unit** is the quick way to add enemies (or allies): it copies the selected unit
  into a new slot at the end of the battle, on the nearest free tile and on the field, and
  raises its side's unit count so it appears in battle. Its leader, defeat-target and event
  flags are cleared so it can't take over a story role. Then change its class, gear and so on.
  - A **generic** soldier (no character name) becomes a variant, a different soldier: it
    takes another character sheet of its family (sheets come in fours, e.g. *Human m 1–4*,
    templates 159–162; the one this battle uses least) and another random-name list of
    the same gender (lists 1, 3, 5 for men, 2, 4 for women; the game picks the name from
    it). Named characters are copied as they are.
- **Unit count warning:** a battle the editor has changed (it has a backup, is in the open
  project, or has unsaved edits) is checked against its stage's counts. If more units of a
  side are on the field than the stage loads, the warning says how many won't appear, and
  **Load N** raises the count (Save writes the battle data). Stock battles aren't checked:
  86 of them have more units on the field than their count and still play as made.
- **Remove** deletes the selected unit. Story scenes can refer to units by slot number,
  so removing an original unit renumbers the ones after it and may break scripted
  events. The editor asks first. Adding is the safer operation.
- Every battle file also lists which graphics to preload for each unit: a sprite set
  plus a colour variant. The editor keeps that list in step automatically. When you
  change a class or template, the unit gets the matching sprite set and keeps its
  colour slot. You can also pick another colour under *Graphics*.
  - The rule was checked against all 8,632 stock units.
- Story battles have at most 30 units. Beyond that the editor warns you, because the
  game has never been seen running more.

## Cutscenes

- The list on the left groups scenes (`event/scene/*_ST_*.dat`) by chapter. Pick one to load
  it. A file can hold several **parts**; pick one with the Part list. Each part is a main
  script plus helper scripts, usually one per character, that it starts to walk, turn and
  animate people while the main script carries on.
- Playback: **Start / Back / Play / Next / End**, the step slider, or the keyboard
  (Space plays/pauses, ←/→ step, Home goes to the start). Stepping back rebuilds the
  stage from the start, so rewinding is exact.
- Helper scripts are played too. Their steps are merged into the main script's using a
  rough frame clock (waits, time per line, walking time), and the step label names the
  helper. The order of steps that happen at the same moment is approximate.
- The stage shows the cast on the scene's own map. It is read from the game's data: the scene's
  story step gives a map number, and `system/system_data.dat` gives that number's file. You
  can still choose another map from the list; the choice is remembered per scene.
- Characters start at their cast rows' start positions.
- Supported characters use front/back standing sprites with mirroring for all four map directions.
  Turning the camera updates their visible facing. During playback, movement uses the game's
  walking frames and timing, faces along each path segment, and returns to standing when it ends.
  Frames share one anchor to avoid changes in the crop making the character jump. This applies
  to the cutscene preview; battle formation editing keeps its standing-frame display.
  Two civilian sheets only contain one view, so they keep their available art. Dorgalua XL
  stands in its own idle frame.
- **Scripted character actions** use each scene part's bundled animation resources and
  their own artwork: head turns, reactions, clapping, sitting, falling, and other poses.
  Native frame timing, loops, hide commands and explicit animation waits are read, and
  actions keep running during dialogue and waits. Step onto an animation command to see
  its name and choose another resource already bundled in that part; **Add → Animation**
  inserts the selected action and its wait. Display names are cleaned from original
  aura/mask texture names, with the original name and resource ID retained.
  Cast-table default animation resources are also drawn, including chairs and other
  scene props that have no ordinary unit sprite. Props use their own artwork without unit badges.
  Ordinary character actions are supported; full cinematic accuracy still needs work:
  3D offsets use the preview's current scale, dialogue/helper scheduling remains approximate,
  computed actor references in the pumpkin scene need more VM support, and separate scene
  effects/cameras are not added by this feature. These limits also apply when comparing
  playback with the game. Original scene positions are not rewritten for the preview.
- Characters have a team ring at the feet and a
  badge over the head. In battle-map scenes (no cast table) each actor is the battle's own unit
  (by character number, else slot + 1), with its class, palette and team; party members who
  aren't in the battle file use their row from another battle.
- The camera keeps its zoom and angle when you change part or step, and when the panel around
  it changes size: only zooming changes the size. **Fit** frames the map again.
- **Lines** lists every line of dialogue. Edit the text in place. Control codes are shown as
  `{tokens}` and must be kept. `{Leader}` is the player's name.
- **Voice**: untick it to stop the game playing the recorded line, so edited text doesn't
  clash with the old voice. Editing a voiced line unticks it for you. Muting removes the line's
  cue from both the English and Japanese voice indexes (`sound/sound_en.dat`, `sound/sound_ja.dat`).
  To bring a voice back, use **Restore originals**.
- **Cast** tab: each cast slot with its sprite. Choose another character for a slot and
  everything that slot does and says in the scene is now done by them: their name, portrait
  and sprite. Scripts refer to named characters by character ID, so a swap also renames the
  script's references to the old character. Revert puts them back. The character's portrait and sprite set are copied into the scene file from
  another scene that already has them (`web/data/cast_index.json`, built by
  `tools/build_cast_index.py`, lists 154 characters). Each copy adds about 1.2 MB. Copies
  no slot uses any more are dropped on save. **Revert** puts a slot back.
- A swap never changes what happens, only who does it. Generic soldiers can be replaced by a
  named character, but not the other way round. A character already in the scene can't be
  added a second time.
- **Positions:** drag a character on the map to change the command that put them where they
  stand at that moment: their placement, or the end of their last walk. When a step that places,
  walks or turns someone is showing, the bar under the playback controls has its X, Y and
  facing, plus the via points of a walk. **Revert this part** undoes position edits in the part.
  - Values are changed in place inside the script, so nothing else in the file moves. About 85%
    of placements, 90% of walk destinations, every via point and 98% of facings can be edited.
  - The rest use a fractional value such as 4.25 from a number table the script shares, so
    they are greyed out with the reason.
  - If the same command runs more than once in a part (a helper called twice), the bar says
    so, and an edit changes every run.
- **Adding and deleting commands:** the **Add** row in the bar under the playback controls
  inserts a command before or after the current step (or at the start of the part). The
  choices are Place, Walk to, Walk via, Turn, Line of dialogue, Wait, Fade in, Fade out and
  Hide at once. **Delete this step** removes the current command.
  - The edited script's code is moved to the end of its file, so nothing else in the file
    shifts. Its function starts and jump targets are adjusted.
- **New lines:** choose *Line of dialogue*, pick the speaker and text box, and type the text. A
  blank line starts a new page, and `{Leader}` is the player's name.
  - The line gets a new message in the chapter file and new text keys. On save, the keys are
    copied into every language's text file, so no language is missing them.
  - New lines have no recorded voice.
- **Adding a character to a battle:** in a battle-map scene (no cast table: its characters
  are the battle's units), the Cast tab shows the battle the open part starts and **Add a
  character to the battle**. The character goes into the battle (on your side, on the field,
  ally count +1, as Battles mode's *Add a character* does) and stands on their tile from the
  start of the part. Move them in the scene (the end of that part is where the battle starts
  them) or in the battle, and the other follows. A character added on that part of a scene
  that does have a cast table goes into the battle the same way.
- **Adding a character:** at the bottom of the Cast tab. Their portrait and sprites are copied
  in, and they are hidden at the start of each part. Add a Place and a Fade in to show them.
  Once placed, they stay for the rest of the scene: each later part starts with them
  where the previous part left them (placed and shown at once, or hidden if you hid them).
  Every edit keeps that start in step; the game's own cast is never changed this way.
- **After events:** a separate tab beside Dialogue and Cast, available for indoor scenes,
  battle scenes with inherited actors, and linked battles without a cutscene script.
  - **After this cutscene finishes** follows all linked parts and conditional branches.
    Added events go after the existing ending tasks, before the outgoing transition.
  - **After battle — return to map** uses the battle's recorded world-map or dungeon-map
    returns. Existing recruitment decisions remain in place, including Canopus's guest
    and permanent recruitment paths at Tynemouth Hill. If no recorded return exists,
    this timing is unavailable rather than guessed.
  - **Character joins** offers named battle characters and distinct special forms, including
    the large final boss. Choose permanent recruitment or a guest and optionally a level.
    The exact selected battle row is copied into the scene's embedded unit table. Unnamed
    special units use the game's direct, row-based permanent recruitment command.
  - **Give Goth** uses native chapter task 5. **Give item or equipment** uses native task
    20 once per awarded piece; a quantity of three emits three native item awards.
    Empty item records are excluded. Items and equipment share the game's item ID space.
  - **Reward notice box** (2026-11-13). Task 5 and task 20 give the Goth or item with no
    message. The game's own "You received a White Knight's Mark." boxes come from the scene
    script: native 268 with a message number, placed just before the scene part closes
    (usually after a 45-frame wait), and the message's row has speaker 0 and a text that
    opens with code `1A:03`. So a Goth or item reward now also adds that box (tick box
    **Show a "You received" box**, on by default; **Box text** overrides the wording) as the
    last step of the closing scene part of each ending route. Where an ending has no scene
    part in the open scene file, the reward stays silent and the panel says so. The box is
    an ordinary step: it shows in the Dialogue tab and can be edited, moved or deleted.
    Rewards added before this change have no box; add one by hand with the new step type.
    - Cutscenes mode has a new step type **Notice box ("You received…")** for placing such
      a box anywhere, and the game's own boxes (e.g. "Lanselot and his allies have joined you
      as GUESTS.") now show in the Dialogue tab as editable *Message* lines.
    - Step type 5 on a story step ("system message", the tutorial tips) was not used: its
      number does not index the chapter's message table, and the table it does index was
      not found.
  - **Guest leaves the party** (2026-11-13): adds the game's guest-removal step (step type
    4 with first value 1 and the character number, as Lanselot's company leaving after
    Almorica). Not yet tested in game.
  - Removing an event added in the same session now takes its whole step (and reward task
    and notice box) out again, instead of leaving an empty step behind.
  - In game (user, Steam 1.0.8.0, 2026-11-13): an After events join worked; Goth and item
    rewards arrived but silently, which led to the notice box above. The box itself, added
    by the editor, is not yet tested in game.
  - **Remove** disables a listed recruitment or removes only the selected reward commands.
    Unrelated story flags and conditions are retained. Shared task lists are copied before
    editing so another scene using the original list is unaffected.
  - New events edit chapter progression and embedded recruitment data, leaving scene
    dialogue, actors and animation bytecode unchanged. Adding an actor under **Cast**
    controls their appearance during the scene; recruitment is configured under **After events**.
  - Native scene-copy recruitment was established by the earlier Deneb in-game tests.
    The current ending-path implementation passes nine chapter round trips, all 2,251 task
    records, 157 battle contexts, saved-file reopening, and browser checks. Its new timing
    and reward combinations still require an in-game play test.
- See `../mods/deneb_cameo` for a complete example built with these tools.

## Stats & Values

- Tabs: **Classes**, **Equipment**, **Items**, **Spells & abilities**, all from
  `battle/battle_data_release.dat`.
- Each entry shows its in-game picture: class battle sprites (male and female), equipment
  and item icons, and spell icons (`menu/texture_x4/*.dat`).
- Fields are grouped and labelled. Lists are dropdowns, and fields that point at another
  entry show its name. Use **Find a field…** to filter them and **Revert this entry** to undo.
- **Named entries only** hides unused slots.
- **Name** and **Description** at the top of an entry edit the game text itself (for
  classes also the female name). Entries with no text yet (e.g. the unused classes) show empty
  boxes: typing creates the text, in all 8 languages, on save. By default the same text goes into all 8 languages; untick
  **same text in every language** to change only the current one. Entries that share a name
  ID share the text, and the editor says how many do. Saved into `localize/LocalizeText_*.dat`.
  - **Give this entry its own name** (equipment, spells, classes; shown when the name is
    shared, e.g. the ~95 unused equipment rows that all point at name 0): the entry gets a
    name ID nobody uses, starting from the texts it showed. A free ID whose texts already
    exist in every language (cut content) is used first; otherwise the next number past the
    highest in use, whose name and description are created in all 8 languages on save.
    Classes have no free ID (all 256 are in use). Entries using brand-new IDs still need
    checking in game.
- **New equipment / New entry from this one** copies the open entry into a new one with its
  own name and description ("… (new)", ready to rename):
  - **Equipment** can't grow: the game and its saves hold exactly 761 slots. A new piece takes
    one of the 95 rows the game never uses (no name, carried by no unit in any battle file).
  - **Items** (up to 1000, the number the save keeps) and **spells & abilities** get a row
    added at the end of their table, and the data file is rebuilt around it. Not yet tested
    in game: the game may expect the original counts.
  - The copy gets its own "found" flag (equipment, items) and, for items, its own text
    number; everything else, including the sort order, is copied. **Remove this new entry**
    takes an added row back out (the last one).
  - **Classes** can't grow either (256 rows; units store the class in one byte), but 92 class
    rows have no texts at all and no unit in any battle uses them. **New class from this one**
    copies the open class into the first of those: same stats, look, race permissions and
    icons, with its own name and description IDs (its row number, as the game's own classes
    have) and new texts in all 8 languages. Untested in game.
- **Class mark** (classes 0–79): the item the class-change screen asks for to change into
  the class. The list is `menu/menu_data.dat` entry 35, one item per class; marks are items
  of type 35, and which class a mark serves is only recorded there. Pick any mark, or
  **Make a class mark** for a class without one (the knight commanders, Lich, Revenant…): it
  copies an existing mark into an unused item row (else a new row at the end) named
  "<Class>'s Mark", and sets it as the class's mark. Untested in game.
- **Characters** tab: the character sheets (unit templates, battle data entry 23, 512 rows):
  base stats and growth per level (×10), gender, race, class set, sprite, portraits, voices,
  innate weapons and flags such as *Recruitable* or *Cannot Use Items*. A unit points at its
  sheet with "Unit template" in Battles mode.
- **Shops** tab (`menu/menu_data.dat` entry 26, 515 rows): what is sold and where. Each town's
  number is the shop level from which it sells the item (0 = not sold there); the shop level
  is a story flag (`0x46B`) the story raises step by step, 1-15. An item can also wait for a
  crafting recipe being obtained, a character recruited, or up to three flags (*Unlock flag
  1-3*; the hint lists the other items waiting for the same flag).
  - **Auction:** selling a monster at auction sets a counter flag, and shop rows wait for those
    flags: Deneb's orbs wait for 1910-1918, one flag each, and players report that auctioning
    a Hydra, or a dragon of each element, unlocks them. The order matches the game's element
    order (likely: the auctioned monster's element picks the flag). To make an item appear
    after an auction, put the same flag in its *Unlock flag 1*. Which monsters can be
    auctioned, and the flag each sets, isn't in the data files (probably in the .exe), so it
    can't be changed yet.
- **Spell sets** and **Skill sets** tabs: each class names one spell set (class +0x51) and one
  skill set (+0x53). Pick a set to see every spell or skill it allows and from what level
  (spells: battle data entry 51, a line per spell group; skills: the skill table's bytes
  0x10-0x4F). Change a level, **Use this set** to give it to a class, or **New set from this
  one** to copy it into an unused set and give that to a class. All finishers share one line
  of the spell set, so a set allows finishers as a whole, not one by one.
- **Crafting** tab: every craftable item and piece of equipment with its recipe book and up
  to four ingredients (the same fields as under "Acquisition" in Items and Equipment). Tick
  *All items and equipment* to give anything a recipe; **Not craftable** clears one.
- **Finishers** tab: weapon finishers (84) and their explicit battle assignments, with
  eight preset slots per unit. **Give** fills a free preset slot; **Take away** clears
  one. Automatic finisher generation also checks weapon family, proficiency and the
  effect's class restriction. For example, Demon Rose effect #496 names Ozma's playable
  Knight Commander class #70 and requires Whips rank 20. The class link is on the
  effect, exposed under **Spells & abilities → Restrict to Class?**, rather than a list
  on the class row. Scene copies of edited battle files are synchronized on save;
  an explicit preset alone does not guarantee availability after recruitment or
  class/equipment changes. See `../research/CLASS_FINISHER_FINDINGS.md`.
- **Races** tab: choose a race (Lizardman, Gremlin, Human…) or a unique character, then tick
  the classes they can change to. This is the game's own rule: each class lists which "class
  sets" may use it, and every unit belongs to one set through its unit template.
  - Ticking a class also gives that race a class-list icon for it, using the icon the race
    shows for its other classes. Unticking puts the original byte back.
  - Lizardmen, Gremlins and other non-human races keep their own sprite whatever their
    class. Humans take each class's sprite, so a human Hoplite looks like a lizardman.
  - The class's stats, equipment, spells and skills apply as they are. Unlocking a class
    (class marks, story progress) still works as normal; this only changes who may use it.
- **Integrated mods** tab: ready-made changes applied in one click, with **Undo**.
  - *Special characters can change class*: the 94 knight commanders and other special
    enemies (human, own sprite, class set "<Nothing>") join the "Human, Special" class set
    that Donnalto, Arycelle and the other recruitable specials use, and the story
    characters' own sets plus "Human, Special" also get the 17 generic human classes. Unique
    classes and sprites stay. Not yet tested in game.
  - *Special classes get class marks*: the 14 special enemy classes with no mark (the Knight
    Commanders, Death Templar, Dark Bishop, Assassin, Death Knight, the Dark Lords, Revenant)
    each get a new mark item, and the "Human, Special" set may use them. Lich and Divine
    Knight are left out: the game gives those through its own mechanics. With a mark, a special character who changed class can change back. Classes that
    share a name get the unit who uses them most in the mark's name ("Knight Commander's Mark
    (Balxephon)").
  - *Defeated special enemies drop their class mark*: every enemy unit in one of those classes
    gets its class's mark as a 100% drop in a free drop slot of its row in the battle files
    (`battle/entry/entry_unit_*.dat`). Units whose four drop slots are full are listed and
    left alone. Reload Battles mode after saving.
  - *Status-focused AI behaviours*: adds two AI behaviours after the game's own 113, so no
    existing AI changes. Pick them in Battles mode under **AI behaviour** (now a named list),
    for enemies or AI-controlled allies (guests); units you control ignore their AI.
    - **AI 113 Support**: the common cleric AI (53) with the weight for putting statuses on
      its own side raised from 85 to 300. It buffs allies first, still heals the hurt, and
      attacks when there's nothing to buff.
    - **AI 114 Ailments**: the common wizard AI (63) with the weight for putting statuses on
      enemies raised from 125 to 1500, and both damage weights cut (damage dealt 125 → 30,
      % of HP taken 100 → 30). It casts Sleep, Poison, Slow, Stun, Petrify and so on at
      enemies who don't already have them, even at a modest hit chance, and falls back to
      damage. (First in-game test, with 600/60 and the HP-% weight untouched: a wizard
      fireballed a higher-level target instead of a low-chance Sleep.)
    - The mod refuses to apply if another mod already changed the AI table's size.
    - **Needs the runtime switch.** The game's look-ahead scores every status effect as
      zero (see Menu controls → *AI status scoring*), so in the Almorica tests the units
      fireballed, meleed, hit their own side or did nothing whatever the weight. With the
      switch on, AI 114 rated Sleep on an enemy at ~43,000–49,000 against ~4,000–6,000 for
      damage. Tested in game 2026-11-08 with AI 114 (Almorica Castle gate: the enemy
      Wizard cast Sleep and Poison Cloud). AI 113 Support and the every-AI switch on
      stock casters are not tested yet.

## The AI (what the editor knows)

Found in the exe (PC 1.0.2.0, read-only static analysis; `game/aiprofiles.js` has the details):
- A unit's **AI behaviour** (+0x94 in its battle row) picks a row of the AI table, battle data
  entry 27 (113 rows of 49 signed 16-bit weights). Stock numbers come in role families:
  11-15 melee, 21-29 archers, 31-35 rune fencers and terror knights, 37-40 beast tamers,
  41-50 knights, 51-59 clerics, 61-70 wizards and warlocks, 74/75 AI guests, 76-97 one boss
  each. 0 = the player controls the unit. Charmed units and AI 0 use row 7.
- The AI simulates each action and scores every result with the row's weights: damage dealt
  (+0x02), the % of the target's HP it takes (+0x06), damage to its own side (+0x0A), statuses put on its own side (+0x12) or on enemies
  (+0x14), HP healed (+0x1A), and several positioning weights (+0x2A, +0x30, +0x3C, +0x40, +0x4C).
- A status scores (target max HP × the status's AI value × weight × hit chance × a per-status
  factor). The AI values are in the status table (entry 26, +0x70); +0x0B marks harmful
  statuses, which the AI never puts on its own side. The factor comes from a table in the exe
  (0x6942c0): 100% for the plain ailments (Sleep, Poison, Stun, Slow...), but conditional for
  some buffs (Spellcraft likely counts only on spellcasters). With the shipped weights, damage beats Sleep or Poison about 2:1, so
  enemy casters rarely use their status spells.
- Some skills (23) also carry usage rules: conditions checked by a small interpreter (106
  condition types: HP %, random chance, has status...), indexed from the skill table +0x50.
- Field names and layouts come from the community's tactics-ogre-tool modules (see Credits).
  Fields marked `?` or `<unused>` are not understood.

## Maps (stage 2)

- The list shows every map in `bg/` (394), grouped by file, with its place (in the current
  text language), its map number (`system/system_data.dat`), and how
  many battles and cutscenes the story uses it for (hover for the list). Cutscene-only maps
  (`_99_`) are marked.
- **Which map each battle uses** comes from the game's story steps
  (`web/data/battle_links.json`, built by `tools/build_battle_links.py`): a story step names
  its map number and battle stage, and the stage table (battle data entry 17) names the
  battle's unit file at +0x28 (+0xDA for a second one), as an index into `battle/entry`'s
  files in FileTable order (0 = none). The place is the stronghold the story is at
  ("CurrentStrongpoint" in the step's conditions). 459 battle files are linked; the rest
  (Palace of the Dead floors, random encounters...) aren't started by a story step, and get
  maps suggested by size. Battles mode uses these links unless you chose a map yourself or a
  hand-checked pairing (`known_battles.json`) says otherwise, and shows the battle's place,
  cutscene file and stage.
- **Selecting:** click a tile to select it. Shift- or Ctrl-click adds or removes tiles. **All**,
  **Same height** and **Same terrain** select groups of tiles. Drag to orbit, right-drag to pan,
  scroll to zoom, and Q/E to rotate.
- **Editing:** height (0–60; the game shows height + 1), the terrain code (the codes used on this
  map, with tile counts) and the destructible object (the object types this map has sprites
  for). Edits apply to every selected tile. `+` and `-` raise or lower the selection, and Esc
  clears it. **Revert selected** or **Revert map** puts tiles back.
- **Every edit shows as you make it:** heights rebuild the model, objects move with their tile,
  and a new terrain gives the tile the look of the nearest tile the map was made with that
  terrain (the *Look* field shows which; × gives the tile its own look back). Untick
  **A new terrain brings its look** to change only the tile data.
- **Blocks tab** (right panel): one picture of each tile look of this map, or of any other map
  (the *Blocks from* list), most used first. Drag one onto a tile, or select tiles and click
  it. Blocks from this map are free. One from another map copies its picture into this map's
  texture atlas (see *Look from another map*), so the tab shows the atlas room (free cells of
  1024), the cells each block takes, and about how many more blocks of that map fit. Using the
  same block again is free; a block that doesn't fit is greyed out.
- **Objects tab:** the object pictures of this map or another one, with how many tiles have
  each, plus **No object**. Drag one onto a tile or click it. An object from another map
  copies its picture (a pakd entry keyed by object type) into this map's file, saved while a
  tile uses it. Maps carry 0–25 object pictures (survey of all 395); the game's real limit is
  not known, so the tab stops at 25. Copied object pictures are **not tried in game yet**.
- **The 3D model is rebuilt as you edit** (phase 2), and the view shows it:
  - An edited tile's top, and anything standing on it, moves to the new height.
  - The walls on its edges are rebuilt one height step at a time. Each step copies a wall
    triangle pair from the same tile, or the nearest one with walls, at the same depth below
    the top and facing the same way. That way the textures and baked lighting match the map.
  - The old walls are collapsed in place. Fences and building walls above the terrain are
    left alone.
- **Terrain** codes are rows of the map's own material table. The list names each one (Earth, Grass,
  Road, Sea…, from the game's tile-info text) and shows the object that goes with it. Adding an
  object switches to the map's matching code (on Golyat, road + crate = 30), so the tile info stays right.
- **Look:** type another tile as `x, y` under *Look* and the selected tiles take its terrain and top surface
  (and anything standing on it), with that tile's walls as the first choice of wall texture.
  For example, a sea tile can become a cobblestone pillar.
- **Look from another map:** type `map x, y` (e.g. `bg001_01_c0_t00 16, 20`) to use a tile of
  any other map. Each map has its own 2048×1024 BC7 atlas cut into 64×32 cells, so the
  cells the source tile uses (its top and wall steps) are copied into unused, fully
  transparent cells of this map's atlas and its `_m` companion: BC7 stores 4×4-pixel blocks,
  so cells move as they are, with no re-encoding. The copied tops and walls take this map's
  lighting (its average for tops and for each wall facing), not the source's. The tile takes
  the same kind of terrain if this map has a code for it. Saving writes the atlas changes
  along with the model. A copy no tile uses any more (reverted, or given another look) gives
  its cells back, with their own pixels.
- **Saving:**
  - **Tile values:** edited in place, with the header's max height raised if needed.
  - **The model block:** rebuilt and grows by 36 + 8 bytes per new vertex.
  - **What moves:** everything stored after the model, plus the header fields that point to
    it (the total size, the section offsets, the +0x5C pointer and the mesh-header sizes).
    Nothing else in any of the 394 maps points past the model.
  - **Test save:** a Golyat save with a raised 2×2 block, a dug pit and a raised tile changed
    exactly those fields, the 6 tile heights and 88 old vertices, and added 234 vertices.
    Everything after the model was unchanged, just shifted.
- **Terrain outline:** 86 maps (Golyat included) keep a second, positions-only copy of the terrain,
  which the game seems to use for movement around raised ground. The editor rebuilds it along with the
  model, so it matches the edits.
- **Battles and unit counts:** each battle's row in the stage table (battle data entry 17) says how many
  ally and enemy units it loads (+0x11 / +0x12). A unit added to a battle file only appears if that
  count is raised too. Battles mode does this when it adds or removes a unit. The unit's **On the field**
  byte (`0x0D`) must also be 1: it's 1 for nearly every unit in a battle file and 0 in recruit
  files such as `entry_unit_001`, so a row copied from one never appears. The inspector warns
  when it's 0.
- **Not yet:** new walls aren't added to the tile records' own triangle lists, which the game
  may use for highlighting or culling. Maps can't be resized or created from nothing yet;
  building on an existing map (blocks, brush, stamps, wall pieces, the map library) is
  described below.

## Start-up speed

A popup shows each start-up step. When a project is open, the server builds that project's
generated mod content (class names in all eight languages, AI data...) before it can serve
the text files and FileTable. That used to happen inside `/api/info`, the editor's first
request, so the page sat on "Connecting to the editor server" for about 45 s.

- `/api/info` returns the project details while the build runs in the background. The status popup
  shows when the editor is waiting for the project data.
- The text parser (`tools/menu_mods/compiler/class_text.py`) parses each table once, reads all
  its strings in one pass and reuses parsed tables: the same build takes about half the time,
  with byte-identical results (checked on all 21 generated files and every text table).
- The result is kept in `projects/.cache/content-<id>.zip` and reused on the next start when
  the project, every game, backup and project file the build read, and the editor's own
  Python code are unchanged; anything else rebuilds it. A read-only editor never writes it.
  Deleting the folder is always safe.

- The editor reads battle rosters and map headers in batches. The browser still checks each
  roster and keeps its file revision for conflict checks when saving.
- Custom world-map title banners are encoded when a project is applied or a caller requests
  the native banner files. The editor uses the project's original artwork for its preview.

## Saving and safety

- **Save to game** re-packs each changed file and patches only that file's size entry in
  `FileTable.bin`. Entries written by other mods are left alone. The files written are:
  - battles: `battle/entry/entry_unit_*.dat`, and the scene files that carry a copy of a
    changed battle file (joins read those copies; see "Joining the army after the scene").
    A copy that matches the battle file as it was becomes the new one. Otherwise only the
    bytes your edit changed are carried over, so a copy's own changes (a joining unit's
    level) stay. A copy with no matching units is left alone and named after the save.
    Which scenes carry which file comes from `web/data/unit_copies.json` (built by
    `tools/build_unit_copy_index.py`: 72 copies of 34 files), plus copies added this
    session. Rebuild it to include copies added in earlier sessions. Cutscene edits are
    saved first, and a scene open in Cutscenes mode is reloaded after the save.
  - dialogue: `localize/LocalizeText_<lang>.dat`
  - muted voices: `sound/sound_en.dat` and `sound/sound_ja.dat`
  - classes, items, characters, sets, recipes: `battle/battle_data_release.dat`
  - shops and class marks: `menu/menu_data.dat` (written once when both change)
  - finishers given or taken away, and integrated mods' drops: `battle/entry/entry_unit_*.dat`,
    with the scene files that carry a copy of them
- Only the tables you changed are rebuilt. Everything else in a file is copied as-is,
  including changes made by other mods.
- The first time the editor changes a file, it copies the original to
  `editor/backups/original/`. **Files > Restore originals** puts every backed-up file back and
  patches their sizes into the current `FileTable.bin`. The table itself is never copied
  back: an old copy would undo the size entries of files that installers or other mods
  changed since.
- Before writing, the editor checks that each file still has the size `FileTable.bin`
  records. If another tool changed it in the meantime, the save is refused. Two files are
  listed twice (`event/scene/C4_ST_345.dat` and `C4_ST_346.dat`): their entries must agree,
  and are updated together.

## Projects (Files menu)

A project keeps your edited game files apart from the game, so you can keep several sets of
changes and put whichever you want into the game. Each is a folder in `editor/projects/`
(`project.json` plus `files/` laid out like `Data/`); `--projects` points elsewhere. The top
bar shows the open project.

- **New project…** starts an empty project and opens it.
- **Save project** (or the Save button) saves your edits into the open project. The game
  doesn't change. With no project open it asks for a name, like Save project as.
- **Save project as…** copies the open project under a new name and saves your unsaved edits
  into the copy. With no project open, it can start from the files the editor has already
  saved to the game.
- **Load project…** reloads the editor with that project's files read over the game's (or
  with no project, straight from the game). Unsaved edits are dropped, after asking.
- **Apply project to the game…** shows progress while preparing the preview and writing the project. Wait for 100% before launching the game. Originals are backed
  up the first time, and each file's size is patched into `FileTable.bin`. Before it writes, it
  lists the files, any that changed in the game since the project saved them (another mod,
  or a direct save), and, when another project was applied before, that project's other files.
  Those go back to their originals unless you untick **Take "…" out first**, so switching
  projects leaves only the chosen one in the game.
- **Restore originals…** puts every original back, as before. The game then holds no project.
- With no project open, Save writes straight to the game, as before.
- A file saved back to exactly what the project started from leaves the project. The project
  remembers what each file was based on; that's how Apply spots files changed in the game since.

## What is verified

- Decrypt, unzip and re-pack produce files with the same zip layout as the game's own.
  Only the edited bytes change. This was checked with a separate Python implementation.
- The editor rebuilds battle files from scratch. All 538 stock files rebuild byte for
  byte, and a file that wouldn't is skipped rather than risked.
- Unit record layout: all 8 Golyat units decode to the right names, classes, gear and
  tile positions.
- Map tiles: tile heights match a hand survey of Golyat (247/247 tiles) and of
  Almorica row Y=16 (23/23). In-game height = stored height + 1 (+2 more on a tile
  with a destructible object). All 394 battle maps parse.

- Dialogue: 10,778 of 10,784 story lines decode to editable text and encode back byte for
  byte. Every text table except one already changed by another mod rebuilds byte for byte.
- Muting a voice removes exactly that cue's rows (each cue is listed twice, in both en and
  ja) and nothing else.
- Classes and items: changing one class value and one equipment value in a test copy
  changed exactly those 2 bytes, and `FileTable.bin` matched.

**Verified in game:** edited battle files (added units, changed AI numbers, spells and levels,
unit counts), battle data tables (added AI profiles, the PSP spell restoration) and the menu
runtime loader with its AI status module all loaded and played as expected in game
(2026-11). **Not yet tried in game:** edited maps (heights, copied looks, stamps, maps placed
from the library), most cutscene edits and art imports. Test one small change first; the
Golyat opening battle is the quickest.

## Known gaps

- Battles the story doesn't start (Palace of the Dead, random encounters...) have no map link:
  choose the map once per battle (it is remembered), helped by size-based suggestions.
- Indoor backdrops are fitted, not read from the game: line them up with the Painting panel
  (kept per map in this browser only).
- Which monsters can be auctioned, and which flag each sets, isn't in the data files yet.
- About 25 bytes per unit are not understood yet. They are editable as raw hex under
  "Unknown bytes".
- Monster and unique-character colour variants come from what the stock battles use,
  since the full list of sprite files isn't parsed from FileTable.bin yet.
- Surface codes (terrain) are per-map numbers. Object types are shown by number only.
- Cutscenes: branches in scripts (choices, story flags) aren't evaluated, so every
  optional path plays. Helper timing is approximate. The meaning of a few commands is
  unknown. Helper names are the game's own
  Japanese script names.
- Cast swaps and position edits were checked byte for byte but not yet in game. Try one
  scene first. Facing names (east/south/west/north for 0–3) are a best guess.
- A muted voice can only be brought back with **Restore originals**, which also undoes
  every other change.

## Credits

The file formats build on Gibbed.LetUsClingTogether (zlib), Asvel's tacticsogre-datamining
(Unlicense) and the tactics-ogre-tool modules.

**Licence note:** `web/data/schemas/*.json` (including the character, shop and set labels in
`template.json`, `shop.json` and `sets.json`) are generated by `tools/build_schemas.py` from the
tactics-ogre-tool modules, which are GPL-3.0. Releasing the editor with these files probably
means releasing it under the GPL-3.0 too, or getting the authors' permission, or writing
the field lists from scratch.


### Cutscene pieces, undo, fallen-unit lines and in-battle events (2026-11-13)

**Pieces of a step.** Some steps hold several pieces. The bar under the playback controls
now adds and removes them:
- A **walk** lists its via points (the tiles it passes before its destination). Each has a
  **Remove** button, and **+ Add a via point** adds one after the others, placed between
  the walk's last point and its destination; then type its X and Y. A walk with no via
  points can be given some the same way. A via point is its own command queued before the
  walk (native 103, or 117 in a helper script that walks its own character), so adding or
  removing one uses the same code relocation as adding or deleting a step.
- A **line of dialogue** lists its pages (each page is one dialogue box). Each has a
  **Remove page** button, and **+ Add a page** adds one after the last; type its text in the
  new box. A new page gets a new text name (the next free page number of that line), is
  copied into every language on save, and has no recorded voice. A line keeps at least one
  page; delete the step to remove the whole line.
  - In the chapter's message table, a line's pages are consecutive rows that share its
    message number, and the third value of each row is the line's **page count** (true of
    every row of every chapter). Adding or removing a page rewrites that count on all of
    the line's rows. New lines made with *Line of dialogue* now write the count the same
    way (they used to write 1, 2, 3...).
- **Undo** (button at the bottom of that bar) takes back the last change made there: an
  edited value, an added or deleted step, a via point or a page, up to 50 changes back. It
  covers the open part's scripts, the cast start positions and the chapter's message rows.
  Changing the cast, reverting the part, saving, or a change coming from Battles mode
  empties it; **Revert this part** still goes back to the saved state.
- New lines in battle-map scenes now record their speaker the way the game's rows do: the
  unit's character number, or 255 (the leader) for Denam, so the right name shows with the
  line. Before, every new line in such a scene was recorded as the leader's.

**When a unit falls: shift stone and death lines.** These lines are not in any scene script,
which is why the Dialogue tab never showed them. The game picks them itself when a unit
drops to 0 HP. The Dialogue tab now ends with a section for them:
- For a scene linked to a battle, one card per character of that battle (guests first),
  with the line said when they **leave by shift stone** and the line said when they **die**.
  Edit either like any other line. Hover a card for who else uses the same lines.
- **All shift stone and death lines** lists all 67.
- The lines belong to the character (or kind of soldier), not to the scene: an edit shows
  in every battle. Texts: `SPEECH_LC_SPEECH_<row>_FLIGHT` and `_DEATH`, rows 1-67 (1-40
  story characters, 41-58 generic soldiers' character sheets, 59-67 monsters). A unit's row
  is byte +0x2F of its character sheet (unit template, battle data entry 23; the schema
  calls it "Dismiss Quote?"). Battle data entry 46 holds the 68 pairs of text names.
- These lines have no voice toggle and no per-battle version.

**Adding an in-battle event.** In a scene linked to a battle, the Dialogue tab has
**+ Add an in-battle event**: choose a named character of the battle and whether their turn
*starts* or *ends*. This makes a new, empty part that the game plays the first time that
happens; add its lines and other steps under the map as for any part. **Remove this added
event** (where *Revert this part* normally is) takes it out again before saving.
- It copies the game's own pattern (chapter 1 scene 6, Denam's first turn at Golyat): a
  story step with a script, an invocation in "Unit turn start" (group 1) or "Unit turn end"
  (group 5) with conditions *local flag f is 0* and *the unit whose turn it is = the
  character*, and a task that sets local flag f, so it plays once. The flag is one no
  battle of the chapter uses (1-63). The scene file gets the new script part, ending with
  native 1 as stock in-battle parts do, and an empty resource index (0x8000 + part number).
- Existing events' conditions are still shown, not edited, here; Battles mode's *Actual
  chapter rules* edits the victory and defeat checks.

**Checked in a sandbox copy of the data** (never the game folder): a save with an added and
a removed via point, an added and a removed page, an edited shift stone line and two added
events changed only those commands in the one script, only those message rows and page
counts, only those texts (the new ones in all eight languages), and the sizes of the saved
files in `FileTable.bin`. Adding an event and removing it again leaves the chapter file
byte for byte as it was. An added event's story step matches the stock one field for field.

**Not tested in game:** all of the above. In particular the added in-battle events (whether
the game needs anything more than the stock pattern) and added or removed pages.

**Still open:**
- Guests added with the editor are not removed from the field after their shift stone
  line. No difference was found in the data: their unit rows match stock guests', and
  neither the stage table nor the chapter steps hold anything per guest. The untested
  leading guess is that the game removes a retreating guest through the party's guest
  list, which only the story's "add guest" steps fill (After events can add such a step
  on the scene before the battle, which would test it).
- Where the player's own deployed units stand during in-battle parts is not mapped. The
  six-byte points in the stage table (+0x54) are scattered over the map and are not start
  tiles. Battle data entry 45 (306 rows of four x,y pairs) is an unchecked lead.

### Battle-linked cutscenes and tutorial dialogue

The Dialogue panel lists every part of the selected scene by default. Part headings and
the Part selector include speakers and the chapter's trigger category. Use a line's play
button to switch to that part and moment. Turn-triggered tutorials remain separate
conditional events; playing one part does not run the entire battle. Hover its heading
to inspect the stored condition expression and flags. These conditions are displayed,
not evaluated against a save.
The Battles tab has a **Battle dialogue** shortcut to that recorded use's scene file.

Scenes without a cast table now preview their exact chapter part's primary battle
formation. Only mode-1 starting units are seeded. Script commands then update that
preview; it is not the current battle, and later movement/deaths or a deployed player
army cannot be recovered from the static formation. Representative artwork for named
party members can still fall back to another battle template, without inventing a tile.
Inherited positions do not create scene commands or save edits. The Cast panel lists
inherited starting units; original cast scenes retain their own placement behavior.
The optional **Include conditional units** preview adds mode-2 candidates and labels
them as such; it does not evaluate the game's appearance rules. Story-only additions
are never seeded as starting units.

Cyan outlines in Battles and Cutscenes identify recorded friendly starting tiles,
including guests. They do not yet describe the full free-deployment boundary. A manual
preview on an unrelated map suppresses those outlines. No deployment rules are edited.


### Native map-object frames

Map objects now use battle-data entry 38's native SAS3 bank selection (byte
+0x1C, banks 14–18). Their sequence cells supply texture rectangles, aspect
ratio, anchor and frame timing. Braziers and other animated objects display one
frame at a time, instead of squeezing the full strip onto each tile. Ambient
animation continues while cutscene playback is paused; hidden viewers stop
redrawing. Static objects do not start an animation loop.

The Maps object palette and selected-object preview show the first native frame.
Copied object textures retain their entire original archive data when saved.
The existing common object world scale is retained; native animation phase and
separate effect emitters are not a complete simulation of the game's effects.
Extra atlases without a mapped native object type retain their existing preview.


### Sprite ratio and contact placement

Character art uses 1/64 world unit per native sprite pixel (12.5% smaller
than the former 1/56 preview), calibrated against supplied in-game screenshots.
Humanoid poses share reference (0,8); idle, walking and scene actions retain
one foot reference instead of recentering on a changing silhouette. Battles
now use these same directional poses. Small soft contact shadows sit on the
tile's floor plane with terrain depth testing; scene props have no unit shadow.
This is a screenshot-based preview calibration, not an exact native camera or
lighting simulation. Save no longer references an undefined document variable.


### Building with blocks, and stamps

**Blocks tab: build up one block at a time.** Click a block to pick it (it gets an outline),
then click tiles on the map. In *Place a block (+1 height)* each click raises the tile one
height step and gives it the block's top and sides; click again to keep building up.
Shift-click a tile, or *Take a block off (−1)*, lowers it a step. Ctrl-click still selects.
*Paint the top only* is the earlier behaviour: the look changes, the height stays. Dragging a
block onto a tile follows the same mode. The whole column takes the block's sides, not only
the new step; use the Sides tab for mixed walls.

**Stamp tab: copy a group of tiles from any map.** Select tiles (*Fill the box* selects the
rectangle around the selection) and *Copy the selected tiles as a stamp*. Open the map you
are building, pick the stamp and click a tile: the stamp's top-left corner goes there, built
up from that tile's height. Each tile takes the source tile's look, terrain kind, object and
relative height. Stamps are kept in the browser (localStorage) and only remember where their
tiles are, so the source map must still be in the game folder. Stamps are not rotated: the
game draws maps from a fixed view, and wall art is made for the side it faces. Limits: no
ghost preview yet; a stamp from another map needs atlas room for every tile look (checked
before anything changes). *Revert the last stamp's tiles* puts those tiles back as the map
was made. Checked in a sandbox editor only, not in game.

**Sloped roofs and other shaped tiles.** A roof tile is stored at its ridge height while its
roof slopes down to the eaves (Golyat 6,5: height 10, roof from 10 down to 7, with gable
pieces between). The editor used to count only what sat at or above a tile's height as its
top, so such tiles had "no top surface": they could not be copied, did not show in Blocks,
and their roof stayed behind when the tile moved. One shared rule now decides a tile's
surface (`tileSurfaces` in `game/meshedit.js`): every non-vertical triangle centred in the
tile that reaches the tile's height, plus the tile's upright pieces (inside it, or on an edge
it faces away from) that start no lower than that surface does. Looks, stamps, the Blocks
palette and height edits all use it. Each tile also gets a per-side *drop*: how many steps
below its height the surface meets that edge. Walls on that side start there instead of at
the ridge, so a copied roof gets walls up to its eaves and keeps its gables. On Golyat all
247 tiles now have a surface (the roof tiles had none) and the Blocks tab shows 189 looks
instead of 176. Upright pieces of a look from another map take this map's wall lighting for
their facing.

### Hover edges, the right-click look picker, and borrowed edge pieces

**Hover.** In Maps mode the tile under the mouse is filled lightly and drawn as a block
(its corner lines run down to its lowest neighbour), and the edges of the tiles up to two
steps around it are drawn faintly, so the grid reads where you point.

**Right-click a tile** (without dragging; right-drag still pans) for a visual picker: a
floating, scrollable grid of the same block pictures as the Blocks tab. Clicking one gives
that look to the selected tiles; heights stay. A right-clicked tile outside the selection
becomes the selection. The looks of that tile's own terrain come first; the list at the top
shows all looks or one terrain only; *Own look* puts the tiles' own look back; when a map is
chosen under Blocks → *Blocks from*, the picker can show that map's looks too (with their
atlas cost). Esc or a click elsewhere closes it. (`app/mappicker.js`)

**Sides can be pointed at too.** The wall face under the mouse (it belongs to the higher
tile) is outlined with a line between each of its height steps, and the one piece under the
mouse is highlighted. A right-click on a piece opens the picker in side mode: pictures of
every different wall piece of this map (one height step of one tile's wall), those for that
facing first, then the same terrain, then the same position (top, middle, bottom). With
*This piece only* (the default) a click changes just the piece you right-clicked: every
other piece of the wall keeps its art. *This whole face* and *All four faces* change the
selected tiles' sides top to bottom, as the Sides tab does. *Reset sides* returns the
selected tiles to automatic matching; *Top looks* switches to the look picker.
A piece override is stored with the tile's other side overrides as
`<facing>:d<steps from the top>` -> `{ tile, depth }` and used first by `rebuildModel`.
Sandbox check: on a 3-step south wall, overriding the middle step changed that step only.
Faces are found from tile heights, so sloped roof surfaces and fences are not separate
targets, and a piece is counted from the top of the wall: if the wall grows or shrinks, the
override stays with that count, not with the height.

**Brush: borrow missing edges from another map.** The planner matches each of a flat
tile's four edge pieces against this map's own examples and reports borders with no example
as approximate. With a map chosen under *Borrow missing edges from*, an edge with no exact
example here takes a piece with that border from the chosen map: its cells are copied into
this map's atlas (as for a copied look) and freed again when no tile uses them. Terrains the
chosen map has flat samples of, and this map has a code for, can be painted too. Sandbox
check on Golyat with bg002 as the donor: 10 pieces borrowed for a 6-tile stroke, approximate
borders 21 → 19. How good the result looks depends on how close the two maps' art is.

**More shaped pieces in a tile's surface** (after a survey of 14 maps): besides slopes that
reach the tile's height, a surface now also takes the roof pieces that stop short of the
ridge (lower courses, dormers, corner and valley pieces), and the posts and legs hanging
under it (platforms on stilts, piles). Golyat's roof tile 6,5 went from 7 to 8 pieces and no
roof triangle is left unowned there. Still not part of any tile: floors beneath an
overhang (they belong to the level below), and tiles with no artwork at all (off-map
filler: 855 of 6,190 tiles in the survey, all without a single triangle).

### Map library: saving maps on their own

**Library tab.** *Save to the library* stores the open map, unsaved edits included, as a
complete map file under a name you choose, in `editor/maps/` (`<name>.dat` plus a small
`<name>.json` with the map it came from, its size and the date). The library is apart from
projects and from the game; saving to it changes neither.

*Place over this map* writes a saved map over the map open in the editor, through the normal
save path: into the open project, or into the game with the original backed up (Restore
originals still works) and the size in FileTable.bin updated. Open the target map first. The
editor asks before writing and lists what the choice affects: a size change (battles and
cutscenes place units by tile, so check them in Battles mode afterwards), how many battles
and cutscenes use that map, and any unsaved edits that would be lost.

Every game map names itself and its textures after its own file (bg folder survey: scene
name = file id; textures `bgNNN_00_cC_tTT`, `_01_`, `_a00_`, `_a01_`, with `_m` and
`_ripple_mask` variants, and `bgNNN_VV_pNN` paintings). A map placed over another one has
those names rewritten for its new file. Ids all have the same length, so this is a same-size
edit. Sandbox check: Golyat (13×19) saved, then placed over bg001 (21×27): 11 names
rewritten, everything else byte-identical, backup made, FileTable size updated, and the map
opens in the editor. **Not tried in game yet**, and unit positions are not checked
automatically. Server: `/api/maps`, `/api/map` (GET, POST), `/api/map/delete`; restart the
editor server to get them.

### Terrain brush and independent block sides

Maps has a Brush tab with grouped terrain choices, stable variations, 1/3/5-tile brush sizes, optional height painting, neighboring edge repairs and stroke undo/redo. Left-drag paints when enabled; Shift/right-drag pans. Flat tiles commonly use four native edge triangles. The planner matches these pieces using the original map’s adjacency and relative heights, and reports unavailable patterns as approximate borders. Objects, structures and imported looks are protected. It can sample floors beneath objects without copying those objects. This is an editor planner, not a recovered native authoring algorithm.

The Sides tab changes wall artwork independently of height, terrain and top artwork. Select the higher tile, choose a pictured wall sample, select all faces or a direction, then choose all height sections or just the top/middle/bottom. Reset selected sides restores automatic matching. Wall overrides bake into the mesh on save. Automatic rebuilding also prefers terrain family, facing and wall-section role. Missing sample directions/roles are reported.

Background texture animation reads scene section 6. Ambient event-zero cell mappings update the GPU atlas at native frame holds on the preview’s 60-tick clock; triggered door groups do not loop. Compressed source art and saved texture bytes stay unchanged. The brush groups water as terrain; manual Blocks retain distinct shoreline pieces. Full ripple shaders and unrendered secondary geometry are outside this change.

### Cutscene palettes, battle actions and boat water

Scene cast colors use byte +8 of each cast row; cast thumbnails use the same
palette. Added/swapped looks copy their donor's palette. Scene images with
embedded palettes, including chairs, use their own RGBA colors. Ordinary
actor sheets retain the battle palette fallback.

The command bar adds Fly to, Body action / attack, Equipped weapon action,
and Cast spell / effect. Body poses use both actor sheets and the shared
SAS3 family. Unknown actions keep numeric names. Fly to writes native 96;
world offset 142 is relative XYZ, rather than another tile placement.
Flight previews use wing poses where present and walking artwork otherwise,
with continuous endpoint height interpolation. Exact native path/timing
behavior is not reproduced.

Weapon preview combines the body pose with original weapon artwork. An
explicit weapon preset or the battle actor's recorded equipment selects it;
runtime-generated gear remains unresolved.
Spell casts require a confirmed battle-map scene and battle-unit actor.
Native 258 takes caster, effect, X, Y and waits for the game's effect system.
The preview reads effect +0x83 for the caster pose and shares its effect
player with the ability viewer. It waits for the compiled visual duration;
damage, hit rolls and battle results are not simulated.

Flat painted boat scenes retain their animated terrain underlay. Their second
mesh block supplies native picture UV/position coordinates, used to recover
the projection instead of fitting a water plane to the boat's silhouette.
The finite water boundary remains visible; infinite sea and ripple shaders
are not synthesized. Game files are unchanged by these preview corrections.


### Ability effect viewer

Spells & abilities includes an original-asset effect preview on the right of the entry header. Items and Equipment show the effect referenced by On Use Effect, or an empty-effect message. Play/pause, replay, step or scrub by frame; change speed, isolate phases or layers, and drag/scroll the preview to rotate/zoom. Inspect effect lists the original sequence, referenced parts, textures and unsupported features. Alternate animation, timing and Preview strikes affect the preview only. Changes to the selected row are previewed before saving.

The player decodes native random ranges, quadratic B-spline curves, composite sprite frames, model face-corner colours/UVs, material blending and point/linear/three-point/four-point attachment routes. Missile pieces form above the caster, travel along their original route and retain independent trailing-particle origins. Page roles distinguish casting from per-hit sequences: Gnome and damaging ninjutsu repeat their launch and impact pages using the ability's base Strikes value. Preview strikes can inspect other counts; the preview uses one target and does not predict battle rolls or target allocation.

Particle motion follows the native integrator's force/mass units and downward gravity sign (500ABF–500C35). This corrects Tornado particles dropping below the floor, Cragfall fragments accelerating upward, and Exorcism streaks moving downward. The fallback head attachment is five elevation steps, matching the calibrated humanoid sprite more closely; exact actor-specific head heights remain unresolved.

Flat untextured white gradient lighting panels are recognized by geometry across both common and magic banks, rather than one resource number. Both bright and subtractive shade panels are off by default; Inspect effect > Lighting panels restores them for inspection. This prevents Thunderflare's large black panel from hiding its lightning. Textured effects and coloured models remain visible. Settings > Effect glow controls additive light in every 3D preview, from 0 to 100%, with a 35% default chosen to reduce washout in Vulcan Lance and Iceblast. This is a preview preference, not a claim that the game uses a 35% brightness multiplier. The effect shader also saturates texture/colour output before blending, matching the original simple shader in Shader.dat.

The effect viewer opens at yaw 135 degrees, two Rotate steps around from its former default, with the sample caster and target facing each other. Reset view restores that angle; the Caster/Target labels follow their horizontal screen positions as the view rotates.

Summon picture cards with the native unit-matrix flag and fixed 35-degree camera compensation face the editor camera while keeping their original scale and in-plane rotation. This preserves the picture proportions when rotating the preview. Full runtime unit matrices are still not reproduced; position curves and missile trajectories continue to use the original world coordinates.

Textured lightning (native kind 102) and ribbon trails (103) use the original textures, material passes, colour gradients, widths and timing in both the effect viewer and cutscenes. Lightning connects its original endpoints using the authored cubic path, strand count and independent flicker timers; Thunderflare's upper endpoint remains above the target. Ribbon histories follow the moving attachment and retain up to 47 samples, with authored length limits and prewarming. Scrubbing and replay reconstruct the same history. Their textures can repeat without changing how map and character textures are sampled.

Line rendering remains approximate: its deterministic random sequence differs from the game's battle RNG, ribbon history smoothing uses linear interpolation rather than the native Hermite controls, and fine ribbon twist/turbulence and some world-sized texture mappings are not reproduced. Inspect effect identifies these limits. Validation covers all 19 unique lightning and 35 unique ribbon layers referenced across 304 ability entries; this establishes data coverage and stable geometry, not visual parity with every original animation.

This remains a partial renderer. Casting cues, unit attachment heights, some emitter volumes and attachment inheritance are approximations. Screen layers, captured scene textures, multitexture model materials and some sequence controls remain unrendered and are listed in the inspector. Missing captured scene images are skipped instead of replaced by large white planes. Audio is not played. Full Exorcism visual parity and complete spell/skill/finisher coverage have not been established. The viewer does not edit or repack EFX assets.

Settings has Sprites over terrain, enabled by default in the shared 3D renderer. It paints whole sprites/effects above map geometry and keeps contact shadows on the floor. Turning it off restores terrain occlusion, including walls hiding characters. This is a preview display choice, not a change to the game's renderer or map positions.

Multitexture beams (107) now draw their original cubic control paths, endpoint attachments, gradients and up to three material passes in the shared player. Native adaptive subdivision currently uses a bounded 32-point approximation when the authored point count is zero. Reveal timing, endpoint wobble, asymmetric width and some scrolling remain approximate and are identified in Inspect effect. Full Exorcism visual parity remains unverified.


### Pre-battle conditions (Battles)

Use **Pre-battle conditions…** beside the battle title. Select the linked battle
stage, edit, press **Apply conditions**, then use the main **Save** button.

- **Objectives / terms of defeat:** the briefing message and named target, plus
  three defeat-message slots. These are display settings. Actual story win/loss
  triggers are edited separately under Actual chapter rules above the briefing.
  Chapter tasks may also override messages after battle starts.
- **Bonus objectives:** working task/reward combinations, up to ten candidates
  and up to three objectives drawn at battle preparation. Use all chapters or
  a specific chapter / CODA pool. Item reward presets include icons and keep
  their native conditional alternate rewards. Zero drawn objectives disables them.
- Changes are scoped to the selected battle stage. Shared pools are copied.
  New pairing IDs use slots unreferenced by every stage; the table stays within
  its original 640 completion-flag slots. Exhaustion produces an error before
  any bytes change. Unchanged bonuses retain their original pairing IDs.

Data: `battle/battle_data_release.dat`, stage table 17 (+04 objective message,
+05 named target, +30..38 chapter bonus pool selectors, +4E/+50/+52 defeat
messages), tables 67–70 (bonus pools, pairings, task definitions, reward presets).
Verified with read-only PC 1.0.2 native readers at 33A4A0/3423F0/342740,
2EB1E0/34C8F0 and 34BF40/34BDE0. UI and byte-preservation checks pass; changes
still need an in-game deployment/reward test before being considered game-tested.


### Actual chapter rules and Others

**Battles → Pre-battle conditions → Actual chapter rules** shows the chapter
checks for the selected recorded use. Direct closing-map paths are labeled
Victory sequence; explicit game-over paths are Defeat sequence. Dialogue,
retreats and conditionally linked endings remain under Other battle triggers.

Mapped checks can be changed between character fallen/alive, HP percentage
thresholds, primary-enemy counts and counts excluding a character. Existing
story guards and the original AND/OR expression remain intact; mirrored checks
in Action end and Story chain are updated together. Original invocation IDs,
scene IDs, recruitment/reward steps, death-suppression tasks and closing links
are kept. A rule shared outside the selected scope is rejected instead of
silently changing another battle. Add defeat condition creates a scriptless
Action-end game-over step with matching scene/invocation IDs and the battle's
progress guards. It clears formation flags so it cannot reopen deployment.

This edits the chapter scripts, not the executable's built-in side-defeat and
Denam checks. Not every conditional event is automatically classified. There
is no automatic creation of a new victory sequence where a battle has none;
existing mapped checks can be edited. Generic units with shared character IDs
cannot be addressed individually by these character-ID checks. Character
pickers only offer named units in the current battle's roster. A stored
reference outside that roster is preserved until explicitly replaced.

**Stats & Values → Others → Bonus award presets** replaces the redundant
Finishers tab. Per-unit assignments remain in Battles → Spells & finishers;
ability restrictions and proficiency requirements remain in Spells & abilities.
The Others panel edits shared reward table 70: rule (+00: always / item not
owned / first completion), primary type (+01), item or Goth (+02), quantity
(+04), alternate type (+06), alternate item/Goth (+08) and quantity (+0A).
Reserved byte +07 is preserved. Item IDs and quantities use native 16-bit
fields; Goth is limited to 65,535 per preset. Duplicates are capped at 255
usable IDs because bonus pairings select rewards with a single byte. Changes
use the shared battle-data document and the existing Save / backup workflow.

Validation: all nine chapter files are byte-exact without edits; original
invocation IDs and unrelated entries survive edits; changed opcode lengths
round-trip; new defeat steps preserve earlier records; all 159 stock reward
presets round-trip; duplicate presets reach the battle reward picker. UI tests
use a preview that blocks all file writes. In-game behavior still needs testing.

Others opens a category list in the left scrollable pane. Choose Bonus award
presets to browse the rewards; Back to categories returns to the category list.
Equipment sets and later categories can be added at this level without mixing
their entries into the reward list.


### Others → Equipment sets

Six native set groups can be edited: choose a set, stage member additions or
removals, Apply equipment set, then Save. Adding equipment from another set
moves its single membership. Only equipment byte +0x77 is changed.

The PC executable scans seven equipped slots, requires three matching pieces,
and keeps the highest-numbered qualifying set. Six fixed mappings grant skills
190, 195, 277, 200, 675 and 169. Set 6 (Charmproof) is empty in the base game
but recognized by the engine. A seventh bonus, a different threshold, a
different granted skill or simultaneous bonuses requires a runtime change.
The panel keeps those engine values read-only. Set membership may contain more
than three equipment entries. Each equipment entry can belong to only one set.

Others category rows use the full name column; reward and set names wrap in the
scrollable list. Native evidence: RVAs 4448F0, 445140, 445B30, 69AC58.


### Others → Shop hiring

Open a project and choose **Game default**, **Fixed roster**, or **Random pool**.
Fixed roster edits the ten slots shown in Hire. Random pool draws ten entries
from its own list of eligible choices. Each mode saves its own list.

Each choice accepts a class and either a single character sheet or a four-sheet
group. The game selects one sheet at random from a group. Sheets supply race
and character data. The shop creates recruits at level 1 for 2,000 Goth.
Choose a form under **Special characters** in the **Character or pool** picker
to use its battle record's sheet, class, name ID and clan. The game resolves
that name in its current language. For a regular offer using a single sheet,
open **Name and clan** to give it a custom identity. Both kinds of identity are
used in the Hire preview and carried into the army when purchased.

In **Random pool**, use **Pool contents** to include custom choices, large
monsters, or both. **Add pool choice** adds a class and sheet combination to the
custom list, which supports up to 64 choices. Large monsters adds all 17 normally
recruitable large classes. The pool needs at least ten eligible choices, and each
entry can be drawn once per lineup. Choose **After each battle** or **When
reopening Hire** under **Reroll lineup** to refresh the draw. With both off,
the game draws a lineup when Hire is initialized and keeps it for that session.

Save the project, apply it, and restart the game. Battle recruitment and story
joins use separate rules.

The stock shared templates (#159–166) link to Characters. Editing one of these
sheets changes it for every use, including the 2,558 stock battle-unit presets
that reference them.

Others → Equipment permissions edits the 64 shared class equipment permission groups. Choose a class, then toggle weapon/armor types or individual named items. Fusils (guns) can be enabled for Warrior here. Shared classes are listed; other group bits and unnamed entries are preserved. This is distinct from equipment-set bonuses and weapon proficiency skills.


Others → Auto loadouts edits global auto-equipment availability/minimum levels, the class/profile spell presets (table 72), and elemental spell families (table 73). A battle unit’s magic byte selects its class profile; zero disables automatic spells. The inspected battle loader copies four explicit skill slots, rather than using this spell-preset system. Existing native eligibility checks still apply.


Skill restriction edits now immediately register with the main Save button; there is no separate Apply step. The Group name field at the top renames any group. Created groups and names are saved through Save in project.json under editor.restrictionGroups (or on disk in projects/.restriction-groups.json when no project is open); assignments are saved in battle data. Names are editor labels and travel with the project folder, including Save project as copies; they are not game text. Empty groups survive reopening after saving. Existing browser labels are imported once when this scope has no disk metadata; Save migrates them. Project metadata takes precedence over browser labels. Restart the server after installing this update.

Others → Warren Report edits existing People biographies, Talk, Current Affairs, battle history, chapter summaries, music notes, help pages, anchor-point text and menu text. Entries follow the actual report text-key records, including story-state biography variants. Edits use the shared localization Save/project workflow and control-token encoder. Visibility conditions and mapped read actions are editable as described below. Artwork and WORLD links are preserved; creating entirely new entries still needs display metadata mapping.

Warren Report visibility rules and mapped read actions are editable beneath each entry. Existing global flag and party-character checks can be changed; All-checks rules support adding or removing checks. Compound expressions retain their original structure. Read actions support setting or raising global flags; other original actions are preserved. Apply the rule/actions, then use the main Save button. These changes are included in normal project saves in WarrenReport/WarrenReport.dat. People rows remain separate story-state variants; blank rows are not activated merely by editing conditions.

Effect viewer actor motions: spells and abilities animate the caster using the effect row's native body-action number. The first casting cue defaults to the native release cue when available, and Inspect effect still allows timing adjustment. Equipment with an attack category defaults to a skeleton demonstration with the selected weapon artwork; shields default to Shield push. The Preview selector switches between the attack and the item-use effect. All motions share the viewer transport and stop when hidden. Weapon overlays retain native palette and front/back draw priorities. Equipment stand-ins use matching front-view body/weapon tracks because some native weapons omit back tracks. World-offset projection and defender impact timing are preview approximations; equipment demonstrations do not simulate battle damage or ranged projectiles.


Equipment preview improvements (2026-11-07): the effect-viewer caster/target is the Pumpkin sprite with player palette 0 (blue robes), including casting and hurt frames. The attempted shared SAS3 coordinate conversion was reverted after it regressed working weapon alignment. Weapon placement uses the previous preview transform until an independently verified replacement is available. Innate melee/ranged equipment records also open an attack preview. Its actor comes from class-table innate attack assignments, preferring a monster animation family: Bite uses Cloud Dragon, Haymaker Clay Golem, Rake Gryphon and Flog Octopus. Selecting ordinary gear restores the Skeleton.

Bows and crossbows use their original misc-graphics arrow/bolt textures from the equipment projectile field (+0x6E). Event 2 in the native body sequence starts flight, then the target plays its hurt animation on arrival. Flight time scales inversely with the equipment speed field (+0x68); preview range, trajectory and impact timing remain illustrative, not a collision simulation. The stock bullet texture (#22, shared by guns and blowguns) has zero alpha, so those previews use a small generated tracer labelled “preview tracer”; the exact native muzzle/impact particle sequence is not reproduced. Scrubbing and camera rotation reconstruct the same projectile path without changing game data.


Weapon world-track correction (2026-11-07): the effect viewer now interprets SAS3 ShowFrame3D/Move3D X as native horizontal displacement, Y as elevation and Z as floor depth, with the sequence slot's horizontal mirroring applied before depth. The native basis is independent of the actor's facing; the camera projects it into the preview. Screen-position tracks and the existing atlas pixel scale are untouched. This separates the faulty 3D conversion used by fist weapons, spears, cudgels and whips from the already working screen-only sword/dagger tracks. Frame comparisons verify those screen-only families remain pixel-identical. This replaces the earlier attempted global scaling fix; no equipment or game-data records are changed.


Word of Pain / Lightning Bow investigation (2026-11-07): native point kind 15 reads the sequence destination at +0x420 (4FDF58); the normal battle setup supplies the selected impact tile through 30E9B0, and 41046B copies it into the effect sequence. Both the shared attachment resolver and explicit line endpoints now resolve that point. This corrects the missile route shared by Lightning Bow and the fixed destination of Word of Pain.

Kind 107 beams now integrate their authored speed (+790), acceleration (+7B0), initial head (+ECC) and length (+7D0) into a seekable reveal window, following 53E470. Previously the entire curve appeared at birth. Their authored full widths (+7F0/+810) become half-widths at the strip edges, matching the 0.5 multiplication at 53D59F. This improves Word of Pain's compressed sheet appearance without a global spell scale adjustment. Native random details, asymmetric scrolling and captured-scene distortion layers remain incomplete. That patch did not resolve Lightning Bow's remaining size discrepancy; a later preview-only calibration is documented below.


Lightning Bow preview size calibration (2026-11-07): based on the user's in-game comparison that its flying effect should be around Sparksphere's size, the shared renderer applies a 0.25 visual scale to the common family-140 projectile subtree rooted at element 181. This covers the main glow and its child sparks, halos and textured lightning together for all four ranks, including copies that reuse the same animation. It scales geometry and local scatter around the moving attachment; route positions, charge/release time, particle count, colours and result/impact layers are preserved. The multiplier is a visual calibration against the provided reference, not a recovered native engine constant. Sparksphere and Word of Pain are unchanged. The shared effect-viewer/cutscene renderer uses this preview correction without editing game assets or spell data.


### AI editor (Others)

Others → AI editor edits the AI profile table and per-status AI values in battle_data.dat. Profiles expose confirmed damage, relative-HP damage, friendly-fire, beneficial-status, enemy-ailment and healing weights. Duplicate profiles to keep original settings; assign added profiles in Battles → AI behaviour. The byte-sized battle selector supports IDs 0–255; profile 0 is shown read-only. Valid edits participate in the normal project/game Save workflow.

Status AI values are unsigned bytes at status-row offset 0x70, confirmed by the native scorer, and affect every profile evaluating that status. They do not change duration or application chance. Advanced profile values include partially mapped positioning fields and explicitly unconfirmed raw fields. The tile scorer (0x3cbb20) reads three of them: +0x36 is multiplied by a tile's enemy-threat count (map at think workspace +0x1ac8, built by 0x3b85c0 from tiles hostile units can attack), capped at +0x38; +0x3A (negative values only) is applied as a percentage of a 50/100 exposure rating (map +0x1ec8, built by 0x3b8870). Both results then pass through a difficulty multiplier table (0xcad390).

These data changes need no executable patch. A new Auto Battle menu option, changes to which actions the search considers, and hard-coded status-specific logic require executable/runtime work. Raising weights does not guarantee use of a disallowed or unavailable spell. The existing status-focused integrated mod refuses automatic removal when custom profiles would be lost.


### Art viewer and exporter (phase 1)

Files → Art importer/exporter opens a read-only art workspace. Browse character object packages, common/localized item/skill/spell/finisher icons, other menu art, class portraits, map textures and objects, cutscene art, shared equipment artwork and effect textures. The source is the saved open project over the game; save other editor changes before exporting them. Native resource/file names remain visible for precise identification.

The viewer supports palette selection, transparent backgrounds, native-size sheets, crisp zoom and in-place native character/action animation where the existing sequence reader supports it. Large multipart actors use native frame definitions. Map and effect categories show texture artwork, not a composed map or complete spell sequence. Use the existing map/effect viewers for those composed previews.

Export PNG keeps native dimensions. Indexed sheets export as 8-bit indexed PNG with palette-slot identity preserved, including duplicate visible colours; 4-bit sources retain original bpp in metadata. Full-colour textures export RGBA PNG. Avoid palette sorting/merging, trimming or resizing when preparing edits.

Export archive package produces a ZIP with PNGs, a versioned manifest, source locators/hashes, raw palette indices, palette data, native sequence metadata and the unchanged encrypted source archive. Export character package includes all saved object files with the same base name (including portrait variants), plus the native shared body-animation bank. Cutscene copies are deliberately reported as outside this package; they can be browsed/exported separately. Unsupported image decodes are recorded rather than silently omitted; their source archives remain intact.

Export packages are not installable mods. Indexed and full-colour PNG reimport, existing-appearance transfer and sprite-derived helper artwork are supported as described below. Exported-package PNG reimport is supported below. New resource IDs and cutscene-copy propagation remain later steps. Verified with independent PNG/ZIP readers and browser exports: native indices, transparency, decoded texture pixels, source archive identity and linked character packages.


### Art importing and rebuilding: first pilot

Files → Art importer/exporter includes Import appearance, Import PNG and Sprite art helper. Appearance transfer supports existing characters using the same native animation family and compatible atlas dimensions. It replaces pixels in existing slots, retaining target resource names, IDs, mask/aura layouts and unrelated archive content. For the Warrior → Pumpkin pilot, both male/female actor families, linked object portrait variants and small character/class menu faces are included: 24 changed files. The appearance tool now also generates both linked Warrior standing menu pictures from the donor pose. Embedded cutscene copies and special scene poses remain separate.

Sprite PNG import currently accepts non-interlaced, 8-bit indexed PNGs at native dimensions with the original palette-slot order. It also repacks indices into native 4-bit images when the indices fit. Changed/reordered palettes and incompatible animation families are rejected. An unchanged PNG produces no changed archive; changing a silhouette does not automatically generate matching masks or aura textures. Use Sprite art helper to generate an updated aura or template mask separately. Native appearance transfer copies the donor’s existing encoded textures; generated standing pictures use the colour encoder below.

The import preview rebuilds nested PAKD offsets and preserves IDs, writes valid native version-2 ASHG literal streams when changed compressed members need rebuilding, preserves DAT member names, re-encodes ZIP/encryption and reopens the output to verify it. Unchanged input retains original bytes. The before/after view shows native sheets.

Save import project creates a new, separate project atomically via /api/art/stage. It validates source hashes, source project identity, existing game paths and FileTable records before staging anything. Existing projects and game files are preserved; an existing open project is cloned so its other edits carry over. The new project is not opened or applied automatically. Save other pending editor changes first, then use Files → Load project and Apply project to the game when ready. The existing project apply flow patches external FileTable sizes. Restart the editor server after updating serve.py to enable import project saving.


### Full-colour art importing and sprite helper

Select a portrait, icon or other single-level BC7/RGBA texture, then choose Import PNG.
Use a non-interlaced PNG at the native canvas dimensions. RGB, RGBA, grayscale and
indexed colour PNGs are supported; APNG, 16-bit and interlaced PNGs are rejected with
format guidance. The importer retains resource names, IDs, dimensions and unrelated
archive entries. BC7 conversion is lossy, so the preview shows Before, Imported and
After rebuilding, with measured colour/alpha error. Only changed 4×4 blocks are
encoded; unchanged native blocks retain their exact bytes. RGBA textures retain all
four channels, including colour data beneath transparent pixels. BC7 data masks and
embedded effect resources remain excluded from colour PNG import.

Sprite art helper builds artwork from the source character’s saved indexed sheet,
native frame definition and selected palette. Choose a pose frame (usually 0 for
front standing or 4 for back standing on humanoids), then adjust zoom and offsets.
Standing menu pictures align visible feet to the target template’s baseline. Small
face icons crop the upper portion of the visible pose; Face crop controls how much
of the body is included. Both modes preserve crisp nearest-neighbour pixels. These
are practical starting images, not replacements for hand-drawn dialogue portraits.

Aura silhouette generates a blurred red/alpha silhouette. This matches the channel
convention observed in the stock Warrior aura; its exact runtime purpose and blur
kernel are not yet verified. Mask silhouette is explicitly experimental: native
masks contain more than coverage. It preserves the target’s red/green gradient
channels and rebuilds blue/alpha from the source sheet. Use only a matching-size
mask and inspect the result in game before distributing it. Generated masks do not
claim to reproduce every native shading detail.

The helper changes the selected resource and saves a separate project through the
same validated archive rebuild and FileTable-aware application path. To accumulate
several helper edits, load the last staged project before making the next one;
otherwise separate projects each start from the currently saved source. Appearance
transfer can build both linked Warrior standing menu pictures in one operation.
Automatic standing-menu linking currently covers the male/female Warrior pilot;
other classes can use the helper directly on their menu resources. Common menu art
and localized overrides are separate resources and can be inspected individually.

Verified with browser previews and staged projects for an edited portrait, an icon,
a standing picture, a head crop and an aura. Independent BC7 decoding checks the
encoder’s bit layout and transparent/opaque edges; native resource comparisons
check that unrelated art and unchanged compressed blocks survive rebuilding.


### Integrated mods → Menu controls

Chariot from the start, five-speed fast-forward, early Auto Battle, story level-cap
removal and chapter-video skipping are independent switches. All default to normal
game behaviour. Use the main Save button. With a project open these choices are
stored in project.json under editor.menuMods; Save project as and art-import
project copies retain them. The native chapter-video skip module still needs a
live transition check. The other four modules retain the previously tested Menu
Mods 008 behaviour.

*AI status scoring* is the editor's own module
(`tools/menu_mods/source/modules/ai_status.c`), added for the Status-focused AI
behaviours. It has two switches, so modders can keep the original AI with new
profiles, or adjust the original too:
- *new AI behaviours* (`aiStatus`): only AI numbers 113 and up, i.e. the added
  behaviours and profiles duplicated in the AI editor. The stock AI plays as before.
- *every AI* (`aiStatusAll`): every AI number, stock profiles included (covers the
  new ones as well).

Both write ini `[AIStatus]` (`Enabled`, `AllProfiles`). They live only here in Menu
controls; the AI editor stays mod-neutral, and the Status-focused AI behaviours page
just points here.

What it fixes (found with a stage-1 recording build, Almorica 2026-11-08): the AI
scores each simulated result as a (gain, loss) pair and keeps an action only when
gain − loss beats a threshold (think step 0x2f512a). The apply-status scorer
(0x3c3b10) computes target value × status AI value (status +0x70) × profile weight
(+0x12 own side, +0x14 enemies) × chance × status factor (0x3c2430), then stores the
same number as both gain and loss: status results net to zero, and a negative weight
makes the loss negative, which invalidates the whole action. The gates before it work
(the result kind 18 reached the scorer hundreds of times per turn). While an in-scope
unit thinks, the module turns (v, v) into (v, 0), or (0, −v) for negative v, as damage
is scored; the game's own skip result (0, −1) is left alone. Out-of-scope AI numbers
are never logged or changed. menu-mods.log gets one line per in-scope think and the
scored results of AI 113 and up.
Settings saved before this switch existed read it as off. The bundled loader replaces
the previous editor build (manifest `replaces`); any other loader is still refused.

Applying a project installs its menu choices for the next launch using the bundled
same-directory dinput8.dll loader and menu-mods.ini. This does not edit the executable
or save files on disk. The runtime checks the executable version and native code
fingerprints. Fast+/Faster/Turbo add 2×/3×/5× imported-clock timing on top of native
Fast; native Fast and the Normal step are retained. Chariot changes the early
availability predicate, preserving history and native battle/input restrictions.

The game must be closed to apply runtime or data-file changes. Project settings can
be saved while it runs. With no project open, Save applies these options directly
for the next launch. Another mod's dinput8.dll/config is never overwritten. Editor
ownership and file hashes are recorded in projects/.state.json; changes made outside
the editor are preserved with an error. Disabling all options, switching to a project
without enabled menu controls, or Restore originals removes only owned runtime files.
Application keeps backups and rolls back the data, FileTable and runtime if writing
fails. This is not an automatic merger with other native runtime mods.

### Art package reimport

Files → Art importer/exporter → Import package accepts ZIPs made by Export archive
package or Export character package. Edit the exported PNGs, preserve the original
manifest and source resources, zip the package contents with manifest.json at its
root, then build the import preview. Stored and Deflate ZIP entries are supported.
The reader checks bounds, expanded-size limits, CRCs, duplicate paths and path
traversal. Encrypted, linked, ZIP64 and multi-volume packages are rejected.

Every archive must still match its exported source hash. Each selected image's
locator, ID, name, native dimensions and source payload are checked before editing.
Indexed sprites must retain their palette order and native dimensions; changed
single-level RGBA/BC7 textures use the existing colour importer. Unsupported texture
formats can pass through unchanged, but editing them reports a clear error. New
resource IDs, new animation families, shared-palette replacement and arbitrary
rearranged generator sheets are not added by this feature.

Only PNG pixels are imported. Packaged native DAT, sequence and palette-bank files
are references, never installed as unchecked replacement payloads. The rebuild
retains unrelated native resources and existing names/IDs, verifies the finished
archive, and gives each edited image Before / Imported / After rebuilding previews.
Save import project creates a separate project and carries the open project's other
files and menu/restriction settings. It does not apply anything to the game.

Validation includes native portrait + indexed-sheet edits, unchanged-package byte
identity, independently compressed ZIPs, malformed/stale-source rejection, native
runtime bridge tests and project deployment/removal/rollback checks. The full browser
round trip of the werewolf's eleven character archives preserved all 76 exported
images without producing any changed archive.


Character package extras now has three independent, initially unchecked export
switches: Face icons, Aura / alpha masks, and Class-change pictures. Main indexed
sprite sheets and separate dialogue portraits are always included. Mask/aura
resources omitted from PNG export are still described in the manifest and retained
inside the native source archive. Reimport preserves them; use Sprite art helper
after changing body silhouettes or menu appearances. Package import retains omitted artwork. Use Batch character helpers to
regenerate the linked helpers from a saved body, or Import character to rebuild
helpers alongside newly supplied body sheets.

Face icons includes the actor's shared com_unit faces and mapped com_class faces.
Class-change pictures includes mapped standing pictures in com_class. Links use
the native class sprite/menu fields; actors without a mapped class picture do not
receive an invented link. Other menu resources can be exported directly. The
switches affect Export character package; single-archive exports and Export PNG
remain complete views of the selected resource. This keeps primary sheets and
portraits available while allowing modders to omit images they will derive.


Create new character with your art from the start
------------------------------------------------
Files → Art importer/exporter → Create new character… has a section *Start with your own
art (optional)*. It shows the chosen base's body sheet sizes; pick the body sheet PNGs, a
dialogue portrait, the colour mode and the palette the colours are matched to. The new
character is then created with that art in one step: the plain copy of the base is made
in memory and the normal Import character runs on it (same checks, previews, faces, auras
and portrait copies) before anything is saved. Leave the PNGs empty to copy the base as
before. Use the same number for the character's Palette so the game shows the matched
colours. Bases can now be humanoids (family 0) or large monsters such as Cyclops and the
golems (family 8); large monsters as independent characters are not tested in game yet.
Checked in the editor: an Ogre on Cyclops (palette 7) and a Demon on Hawkman (palette 16)
each built a 5-archive plan with 12 / 17 changed images.

**Character type instead of a base sheet.** Create new character now asks what kind of
character you are making: Human (male / female), Hawkman (flies), Lizardman, Lamia, Orc,
Skeleton (undead), Ghost (undead, floats), Fairy (floats), Gremlin (floats), Pumpkinhead,
Large monster, Large flying monster (Gryphon body or Cockatrice body), or Other (copy any
saved appearance). The race decides default behaviour:
the sheet's undead flag (undead rise again unless exorcised), its movement type (5 flies,
6 floats), race and class set. Each type also starts on the class that race's units use
most in the game's battles (Lizardman Juggernaut, Ghost Wizard and so on). Each type brings the body layout your PNGs
are drawn for and the game's own character sheet for that body, so there is no base sheet
to pick. The game has two layouts new characters can use. Humanoid: 34 frames, shared
exactly by humans, Hawkmen and Lizardmen. Large monster: 31 frames, Cyclops and golems.
A flying humanoid uses the humanoid layout but also fills frames 28–33 with wingbeat
poses, which walkers leave empty; the flying itself comes from its sheet (race 2, move
type 5). Dorgalua XL has a layout of its own (2048 × 1760 sheet) and is not offered.

**Large flying monsters.** Gryphons and Cockatrices have a body layout of their own
(animation family 7: the same two sheet sizes, but their own frames). The new character's
body settings (animation type 7, flying movement) come from the creature's ordinary sheet
(Gryphon 146, Cockatrice 129), and its stats from the generic Gryphon 4 / Cockatrice 4 sheets
(222 / 226), so there is no boss aura; classes default to Gryphon (40) / Cockatrice (41).
When several sheets use the same sprite, the body is taken from an ordinary one, never a
boss sheet with the aura flag. Not tested in game yet.

**Body settings come from the appearance.** A character sheet holds the body's race,
movement (flying), animation type and innate weapons as well as its stats. The new
sheet now takes those body settings from the appearance's own sheet (Cyclops 509,
Hawkman 170) and the stats from the base sheet you pick, which defaults to the
appearance's own. Before this fix the default base was sheet 160, a humanoid: an Ogre on
Cyclops then played humanoid motions in game (backwards, blank frames) and a Demon on
Hawkman could not fly. Large monsters default to the Cyclops class (43). Their stats,
tribe, aura and flags come from ordinary Cyclops sheet 231: the Cyclops' own sheet 509 is
a special one (with 506-510 for golems and others) that gives a boss aura in battle, so only
its movement and animation bytes are used.

**The editor animates project characters by their sheet.** The editor used to pick a
sprite's animation set from its name (Cyclops, Gol_…), so a new character such as
"OgreB" was drawn with humanoid motions even when its sheet was right. Project characters
now take their animation family from their sheet's animation type byte, which matches
the editor's family numbers (8 = large monster; Rodrick's 23 = Dorgalua's family). Characters made before this fix should be made again.

**Small face icon preview.** After a build, Create new character and Import character
show a *Small face icons* panel: the standing pose with the face box drawn on it, a live
preview of the icon that box makes, and the icons actually generated. Drag the box over
the head (click anywhere to centre it there), size it with the slider, then *Update
faces* rebuilds with your box. *Automatic box* goes back to the automatic crop (the top
part of the visible pose). The box is kept between rebuilds and reset when you pick
another body.

**Flight frames.** A flying humanoid's frames 28-30 fly toward the camera and 31-33 fly
away from it. The Demon in Art Import now uses its back-facing flight poses for 31-33.

**Masks follow the new body.** The game draws a body only inside its alpha mask, which
matches the base's outline pixel for pixel. Keeping the base's mask under new art cuts
the new body to the old outline (the Demon looked cut to the Hawkman's shape). New
characters with art now always rebuild the masks from the new body, and Import
character has Alpha masks on by default.

**Saved into the open project.** With a project open, the button is *Add to project*: the
character's files, art registrations and character entry go straight into that project
(through the same staging checks; the project folder is swapped in only after it is
complete), and the editor reloads with the character ready. IDs are taken after the ones
already in use in that project, so they never collide with its other characters. With no
project open it still saves a new project. Sandbox check: an Ogre added to an open test
project as template 513, sprite 134, appearance 701, palette 7.

Character import and batch helpers
----------------------------------
Files → Art importer/exporter → Import character accepts the native body atlases
(normally two) and an optional dialogue portrait. Each PNG is optional individually;
supply at least one. It updates the selected base object and its existing numbered
variants together. Portraits can replace all existing portrait variants or only 00.
This replaces an existing appearance slot; it does not allocate a new character ID.

Choose Native indexed palette slots to preserve the exported colour-slot layout.
Map RGB / RGBA to native palette accepts ordinary painting-tool PNGs at native
sheet dimensions, matches colours to the selected existing palette, and converts
alpha below 128 to transparent and the rest to opaque. It never replaces the shared
palette bank. Review colour loss in the before/imported/rebuilt comparison.

The same workflow can generate small faction face icons, mapped class/hiring
standing pictures and aura silhouettes from the imported body before saving.
Batch character helpers runs those outputs on the current saved body without PNG
uploads. It uses the character's native animation family and actual class/menu links.
Large monster silhouettes are fitted to the native aura canvas; the body is not
resized. Existing tiny 8×8 aura placeholders are retained. Alpha mask rebuilding is on
by default: the game shows the body only inside the mask's alpha, which in stock files
matches the body's coverage exactly. It keeps native red/green and sets blue/alpha from
the new body. The full meaning of the red/green channels is still unknown.

Review native body animations provides before/after motion, direction selection,
pause and Next pose. Identical distinct walk frames and frames that become blank
produce review notes. These checks cannot judge whether different drawings use
the same leading foot or whether a pose is artistically correct. Native animation
positions and timings are kept; arbitrary generator sheets must be arranged into
the exported native layout first. Weapon/spell overlays and embedded cutscene
artwork are separate from this body preview and replacement batch.

Build a preview, choose each changed image for inspection, then Save import project.
Each affected archive is rebuilt once and reopened. Image identities, resulting
payloads and unrelated native art are verified. Unchanged inputs remain byte-identical.
Source hashes and the original project must still match when saving. Saving creates
a separate project carrying existing project files/settings; applying it to the game
remains the normal Files action. No live game changes are made by preview or saving.


Full character portraits include native menu copies
-------------------------------------------------
Character import uses the supplied portrait PNG for existing object portraits
and matching full-size resources in menu/menu_classface.dat. These menu copies
are separate from the small face icons and standing pictures. They use the
same portrait artwork: a second drawing is not required. Native resource names
identify the matching actor; numeric image positions are not guessed. Choosing
only variant 00 limits both locations to that variant. Without a supplied
portrait, all full portrait copies are retained. Character package export also
includes these full-size menu copies even when optional helper extras are off.
This update affects future imports; previously created projects need their menu
portrait copy added and must be reapplied with the game closed.


Compressed art resource integrity
--------------------------------
ASHG header byte +14 stores the low byte of CRC32 over the complete expanded
resource. It is not an alignment-padding count. This was verified against all
80 stock class-menu portrait blocks and six other stock character blocks.
The ASHG writer now records that value, and DAT rebuilding repairs legacy
invalid CRC bytes in nested PAKD/ASHG resources before verifying the result.
The repair retains expanded artwork and existing resource IDs. Normal native
archives remain byte-identical on a no-op rebuild. Existing projects created
with the earlier writer need this repair and must be reapplied before testing.

Character portraits use a native 160 KiB compressed cache slot. Art imports now rebuild ASHG with native LZ matches, verify the result, and reject oversized linked object/class-menu portraits before saving. The art viewer warns about oversized portraits already present in a project. Reducing image detail or leaving more transparent space may be necessary for a portrait that still exceeds the limit.

Oversized portrait imports offer opt-in fitting in Import PNG, Import character and Import package. Reduce fine detail retains portrait size and the source alpha outline; Shrink inside canvas reduces the portrait and aligns it to the bottom centre of the original canvas. Only oversized portraits are adjusted. Each candidate is rebuilt and measured against the native 163,840-byte limit. Review the supplied PNG beside the adjusted rebuilt result and the reported settings/size before saving a separate project. Source PNGs and the game are not changed by previewing.
