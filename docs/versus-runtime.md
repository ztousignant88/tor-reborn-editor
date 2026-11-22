# Versus runtime on Steam 1.0.8

The editor imports teams from local or uploaded saves, defaults to the first available units, and lets each selected unit use any populated AI profile in the installed battle table. Check match setup validates the selected equipment, skills, books, effects, sprite resources and spawn points. It rebuilds the native training archives in memory. Original saves and game files are read only during setup.

## Setting up and switching fights

1. Open or create a project in the Steam editor. Open **Integrated Mods → Versus Mode** and turn on **Enable Versus Mode**. Save the project to unlock the **Versus** button. Apply the project and restart the game to load Versus.
2. Choose two saves, the arena, the team size, and each fighter's AI. Use **Save & Queue Fight** to send the matchup to Training. Use **Save for Later** to add it to the companion's library.
3. In the game, select **Almorica Castle → Versus**. The castle's **Train** command appears as **Versus** when a match is queued. It automatically deploys one spectator and opens the battle. Formation appears if the game needs you to make a selection. Both teams' AI exclude the spectator from targeting, independent of their gear.
4. Keep **Match queue** open to see the winner. You can queue another saved fight as soon as the current one starts. Return to the world map and select Training again to play the next fight.

Opening Versus offers to enable **Expanded Battle Limit** if needed. Confirm, then apply the project and restart the game before queuing **24 vs 24** or a **30 vs 30** tournament. If you decline, you can use the 3 vs 3, 6 vs 6, and 12 vs 12 formats.

Team A uses the player's faction palette and Team B uses Bakram's. Inspect a fighter to see the game's normal movement range in that faction's colour. Generic fighters with faction-dependent art use the team's sprite palette, while the game's fixed character art rules still apply. The game uses its ordinary Training victory and retreat messages. The companion records which team won. A queued match remains selected until replaced or cleared, so you can replay it. Clearing the queue restores the project's normal Training fight on the next entry.

Versus imports copies of equipped relics from each save and uses the game's resolver to preserve their individual bonuses. During battle it assigns those copies to unused relic IDs and keeps the host's inventory intact. If the host runs out of unused IDs, the remaining relics use their base stats and the companion reports it. If a fighter wears a cursed snapshot weapon, choose another fighter or select **Leave snapshot weapons unequipped**. This leaves the slot empty for the match and preserves the original save.

Open **Match queue → Set up a tournament** and choose **4 teams** or **8 teams**. An eight-team bracket starts with four quarterfinals, followed by two semifinals and a final. Choose 3, 6, 12, 24, or 30 fighters per side. Load one save per team, split a single save across teams without reusing fighters, or assign themed squads. You can revise each lineup and its AI before saving the bracket.

Use **Assign random team** to roll a themed lineup for one side in Versus or the tournament setup. **Assign random teams** fills every side, using distinct themes for slots set to **Any theme** when possible. Each roll supplies 30 level-50 fighters from the installed generic battle units to choose from. Fighters receive four random consumables (orbs excluded), eligible equipment and abilities, and the finishers unlocked by their equipped weapon proficiencies. The roll fills spell and skill slots where the class has eligible choices. A fighter keeps the same rolled loadout through every tournament round. Each fighter's AI can be changed before saving. A team from a save can fight a generated team.

Choose **Random arena** to draw from the ten Versus arenas. A standalone match keeps the arena drawn for its formation preview or, if you skip preview, at save time. A tournament draws each time it queues a fight and shows the selected arena on that round. You can turn random arenas on or off for future fights in a saved tournament.

Use **Queue next tournament fight**, then choose **Versus** at **Almorica Castle**. After each result, return to the world map and queue the next fight in the same companion. The semifinal winners advance automatically. If the game omits a result from its log, use **Record a result manually** after confirming the outcome. A drawn fight can be replayed. Once the bracket is saved, it uses the captured lineups even if their source saves change.

Enable **Auto advance** to queue the next fight when a winner is recorded. Keep the editor server running between fights. With **Auto start next fight** enabled, a round title covers EXP, the world map, and formation while the game opens the next match. Training automatically picks a spectator for the first match, and later rounds reuse that unit through the game's formation check. If deployment needs your input, the formation screen appears. Auto advance waits on draws and stops after the final. **Restart tournament** starts a fresh run with the saved squads, AI assignments, arena, and tournament settings.

Every tournament round has a title card that stacks both team names with **Versus** between them. A decisive final shows **Tournament Champions** with the winning team's name. The game advances through the final EXP results under that card and returns to the world map. This also works in tournaments that advance manually.

Queued Versus matches have no bonus objectives. Clearing the queue restores the normal Training bonus objectives on the next entry.

Apply **AI Plus** to make **113 · Support (Buff)** and **114 · Ailments (Debuff)** available in the Versus AI dropdowns. Use **Edit team AI** on a saved bracket to change the profiles for future queues. The companion keeps the current fight and recorded results. Enabling AI Plus requires a game restart. Queueing later fights uses the installed profiles without a restart.

## Almorica's Training command

| Record | Value |
|---|---|
| Stronghold | 25 |
| Training invocation | 8 in `event/event_data.dat` entry 16, group 3 |
| Training progression record | 1250 in entry 15. Map is a u16 at +2, invocation is 8 at +6, and battle stage is 547 at +0x10. |
| Original arena | Map 16, Almorica Castle gates |
| Stage table | `battle/battle_data_release.dat` entry 17, row 547 |
| Training roster | Directory 1001, file ID 249, `battle/entry/ENTRY_UNIT_1574.dat` |
| Explicit team limits | Stage +0x10/+0x11/+0x12 for deployed units, guests and enemies |

At Steam RVA `0x3e39d3` the Training action calls `0x3556f0`, which selects the training progression record. The roster load at `0x2ef910` copies the entry rows and registers their sprite preloads. Formation setup at `0x2f07b0` adds deployed units, then guests and enemies. The calls to add team 1 and team 2 read the stage's explicit counts at +0x11 and +0x12. These are separate from the 12-unit player formation limit.

## Spectator match verification

Including the spectator, 12 vs 12 uses 25 live slots, 24 vs 24 uses 49, and 30 vs 30 uses 61 of the expanded 62. Keep the spectator behind Team A at the reserved tile. The Reeking set grants Invisibility. Versus uses the same native AI exclusion flag in each simulated battlefield and applies it on both teams' turns without requiring the set. The flag leaves ordinary targeting available for the fighters. Stopped is condition 14 in the condition table and prevents the spectator from taking a turn. The existing Starting Status implementation provides native apply and persistent timer handling.

The formation preview can dim the spectator's tile. In combat, the runtime skips drawing the spectator and their ground shadow. The spectator remains deployed with persistent Stop so the game can reuse them for later rounds.

The native defeat path at `0x362e4e` counts qualifying team 1 records. A living spectator would keep that count nonzero after the last guest falls. Count only Team A fighters for defeat and Team B fighters for victory. Use the existing native active-unit predicate so revivable undead and incapacitated units behave consistently. Verify guest loss, enemy loss and a simultaneous elimination before reporting a winner. Keep tournament progression out of the normal campaign and test the effects of training results on the host's army and inventory.

Team A uses the guest flag for AI control. That flag also selects a Shiftstone retreat at zero HP. The pilot keeps the flag and maps the Versus-only fall to the same outcome as Team B. Both the forecast and combat paths use the normal enemy outcome for living fighters and the native undead outcome for undead fighters. The local loader fixture covers the spectator and other Training stages as well.

The compiler passes fixed levels, ordinary equipment, consumables, skill ranks, spell effects and finishers through the native roster. Skip Hard Mode's enemy-only level and loadout changes for Versus so both squads play by the same rules. The Steam queue supplies saved unit names and permanent stat boosts in roster order. At `0x2f0b4a`, the formation routine copies the fighter's saved HP, MP and attribute bonuses into the same fields used by the native save decoder. The game then recalculates totals with the match's equipment. Matches saved before this addition can be saved again from their source squads to import the boosts. Relic packets append each fighter's 94-byte item records by equipment slot. The Steam routine at `0x386100` builds their resolved rows. The formation hook at `0x2f08fb` assigns unused IDs before the first guest spawns.

## Switching matches between fights

The companion publishes one complete packet containing the arena, both lineups, spectator tile and roster sprite resources. The filename identifies the applied revision of the project. The runtime reads a single packet when you select Almorica Training, then uses its snapshot throughout deployment and combat. It reports the match ID when the spectator spawns and again when the result resolves. The editor keeps queued and active matches separate. If a packet is absent or invalid, the runtime restores the project's default Training configuration. If the game data used by a saved match has changed, the editor asks you to save the match again before queuing it.

Each stored bracket contains two semifinals and all possible finals built when the lineups are saved. Only the next scheduled fight is published. Each attempt gets a fresh match ID so a draw or a canceled queue entry can be replayed independently of its earlier result. The bracket reads the winners from the native log. For supplementary AI presets, identify fighters by save slot within a particular save revision. Names can repeat within and between armies.
