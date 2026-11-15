// Maintained help text, independent of generated schemas and saved game data.
// Coverage/evidence: research/EDITOR_TOOLTIP_AUDIT.md, CLASS_FINISHER_FINDINGS.md,
// LIMITED_SKILLS_FEASIBILITY.md, and the editor's format readers and panel code.
// Descriptions explain purpose; they do not certify every combat formula.

const STATS = { hp: 'HP', mp: 'MP', str: 'Strength', vit: 'Vitality', dex: 'Dexterity', agi: 'Agility', avd: 'Avoidance', int: 'Intelligence', mnd: 'Mind', res: 'Resistance', luk: 'Luck', atk: 'Attack', def: 'Defense', rt: 'Recovery Time' };
const pending = {
  class: 'base_atk_attack base_def_defense atk_growth_10 def_growth_10 class_role height_size overwrite_female_sprite recruitable air earth lightning water fire ice light dark',
  armament: 'arc_throw_flags exceed_range level_sync_group exclude_from_level_sync_calc equip_drop_chance ai_cost resist_air_element resist_earth_element resist_lightning_element resist_water_element resist_fire_element resist_ice_element resist_light_element resist_dark_element',
  commodity: 'use_type_range delay_to_target_s_turn ai_cost restrict_use_to_battle_id',
  effect: 'strikes_0_1_1 projectile redact_on_recruit revive_type revive_type_2 revive_type_3 same_targets_value same_targets_value_2 text_delay text_delay_2 damage_to_obstacle damage_to_shadow battlefield_element battlefield_element_power density_palette_modifier activation_chance ai_cost minimum_value minimum_value_2 minimum_value_3 maximum_value maximum_value_2 maximum_value_3',
  template: 'bodysnatch_target bodysnatch_caster snapdragon aura_color aura weapon_offset dismiss_quote animation_override species death_agony rename_on_recruit',
};
const DEFERRED = Object.fromEntries(Object.entries(pending).map(([k, v]) => [k, new Set(v.split(' '))]));

const COMMON = {
  name: 'Selects the game text used for this entry’s name. Entries sharing the same name text can change together when that text is edited. Use the name editor to write the wording.',
  description: 'Selects the game text shown as this entry’s help or description. This changes its text reference, not the effect it performs. Shared text references can affect more than one entry.',
  default_sort_order: 'Changes where this entry appears when the inventory uses its default sorting. This is an ordering number, not an item ID or quantity; entries can share a sort number.',
  sort_order: 'Changes the display ordering of this ability. This does not change its strength, cost or ID.',
  found_flag: 'Selects the collection-tracking entry used to record that this item has been found. Reusing another item’s flag can make their discovery tracking overlap.',
  unique: 'Marks this as a unique item. The stock rule allows only one copy at a time and automatically sells additional copies.',
  key: 'Marks this as a key/story item that cannot be sold. This flag alone does not create a story event or quest.',
  on_use_effect: 'Chooses the spell or ability performed when this item or equipment is used. Edit that effect under Spells & abilities to change its targeting, cost or results.',
  on_use_charges: 'Sets the use-charge setting for the assigned On Use Effect. This is separate from the number of copies owned in inventory; check the item’s normal use behavior when changing it.',
  price: 'Sets the base price used by the shop price settings below. The purchase and inventory-sale percentages can change the final amount.',
  sale_at_shop: 'Changes the shop purchase-price percentage applied to the base Price. This changes pricing, not whether a town stocks the item.',
  sale_from_inventory: 'Changes the percentage of the base Price returned when selling this item from inventory. Key and other sale restrictions still apply.',
  crafting_recipe: 'Chooses the recipe book required to craft this entry. Ingredients are set separately. With no book and no ingredients, the editor treats the entry as not craftable.',
  inventory_icon: 'Chooses the small inventory icon used for this entry. The selected icon resource must exist in the game; this does not import new artwork.',
  icon_palette: 'Changes the colour/palette selection for the inventory icon where that icon supports variants. This does not recolour the unit’s battle sprite.',
  icon_background: 'Changes the background selection for this inventory icon. This is presentation only and does not change the item’s effect.',
  range_minimum: 'Sets the closest allowed target distance, measured in map tiles. Zero permits a target on the caster’s own tile when the other targeting rules allow it.',
  range_maximum_1: 'Sets the farthest target distance plus one. For a displayed maximum range of 3 tiles, enter 4. Targeting and trajectory rules can still prevent a shot.',
  rt_delay_recovery_time: 'Changes the Recovery Time added for this action. Higher delay generally makes the user wait longer for their next turn; this is not an MP cost.',
  can_target_units: 'Allows this attack or effect to select units as targets. Its targeting type, range and target restrictions still decide which units are valid.',
  can_target_tiles: 'Allows this attack or effect to select map tiles. This does not, by itself, add terrain-changing behavior; the assigned effect must support the intended result.',
  can_target_obstacles: 'Allows this attack or effect to select destructible map objects such as crates. The effect still needs an appropriate result to damage or affect them.',
  can_target_shadows: 'Controls whether this attack or effect may target the game’s shadow/decoy entities. This does not refer to shadows painted into the map.',
};

const DETAILS = {
  class: {
    innate_melee_weapon: 'Chooses the class’s natural close-range attack, such as Punch or Bite. This selects an attack effect, not an inventory weapon to equip.',
    innate_ranged_weapon: 'Chooses the class’s natural ranged attack when it has one. This selects an attack effect; it does not give the unit ammunition or an inventory weapon.',
    move_type: 'Chooses the class’s movement profile. This affects how the unit can travel over terrain; movement distance and special movement permissions are separate settings.',
    move_stride: 'Adds the selected special terrain-travel permission, such as Wade, Waterwalk, Lavawalk or one of the special walking modes. It does not set the number of tiles moved.',
    amphibious: 'Selects aquatic or lava-adapted movement for this class. This is a terrain-travel permission; movement distance, movement profile and equipment walking abilities are separate settings.',
    effect_spell_set: 'Chooses the shared spell/ability permission list used by this class. Edit its allowed groups and unlock levels in Spell sets. Other classes using that set share those list edits.',
    skill_set: 'Chooses the shared skill list and unlock levels for this class. Edit it in Skill sets. Classes using the same set share its changes; this does not add equipped-skill slots.',
    move_distance_1: 'Sets movement distance plus one. Enter 5 for a normal movement allowance of 4 tiles. Terrain and movement permissions can limit the route.',
    move_rt_per_step: 'Changes the Recovery Time added for each step moved. Higher values make moving a given distance delay the unit’s next turn more.',
    armament_equipment_set: 'Chooses which equipment-permission group this class uses. Equipment entries must include that group to be available to the class; this does not give the items to the unit.',
    include_in_class_set: 'Sets which character/race class-access groups may change into this class. The Races tab provides named checkboxes for these memberships. Class marks and story requirements still apply.',
    class_set_reference: 'Lists the bit meanings used by Include in Class Set. This community reference field overlaps the start of the record; it is not the character’s class-access assignment. Use the Races tab to edit access.',
    sprite_male: 'Selects the class’s male battle sprite. A character template with its own sprite override can keep that character’s appearance instead.',
    sprite_female: 'Selects the class’s female battle sprite. A character template with its own sprite override can take priority over this appearance.',
    palette: 'Selects the class’s colour palette when no higher-priority character palette overrides it. This changes colours on an existing sprite, not its shape or class rules.',
    class_list_sort_order: 'Sets where this class appears in class-selection lists. This does not select its icon or change which characters can use the class.',
  },
  armament: {
    item_type: 'Changes the equipment category, such as a weapon family or armour slot. This affects which equipment rules and weapon proficiency apply; changing it does not supply missing animations or mechanics.',
    require_gender: 'Restricts which gender may equip this entry. Class equipment permissions still apply.',
    disallow_auto_generate: 'Prevents the game from choosing this entry when filling unspecified equipment automatically. Explicitly assigned equipment is a separate setting.',
    two_handed: 'Makes this weapon occupy both hands when equipped. This affects whether another weapon or shield can be equipped alongside it.',
    arc_trajectory: 'Selects the arcing-projectile behavior used by this weapon. This changes its shot path; range and valid-target rules are configured separately.',
    damage_scaling: 'Chooses the damage-scaling formula/profile used by this weapon. The selected profile determines which attack statistics matter; it is not a flat damage amount.',
    accuracy: 'Changes the weapon’s accuracy setting. The game combines it with combat rules and unit statistics, so it is not a promise of the final forecast percentage.',
    targeting_type: 'Chooses the pattern used to select targets, such as a radius or line. Target flags and minimum/maximum range still apply.',
    range_area_0_1_1: 'Sets the area covered by the weapon’s attack pattern. Both 0 and 1 represent the single-tile area in the stock format; larger values depend on the targeting pattern.',
    physical_affinity: 'Selects the physical damage family, such as crushing, slashing or piercing. Target resistances can affect the resulting damage.',
    physical_affinity_bonus: 'Changes the bonus associated with the selected physical affinity. Its contribution is resolved by the damage calculation; it is not the weapon’s base ATK.',
    element_affinity: 'Selects this equipment’s elemental affinity. This can affect elemental interactions; it is separate from the character’s own element.',
    element_affinity_bonus: 'Changes the strength/bonus attached to the equipment’s selected element. The final effect depends on the game’s elemental calculation and the target.',
    tribe_affinity: 'Chooses the creature family affected by this equipment’s tribe bonus. This does not change the wearer’s race.',
    tribe_affinity_bonus: 'Changes the bonus for the selected creature family. It is separate from the equipment’s normal ATK and physical damage type.',
    damage_to_obstacle: 'Changes this equipment’s damage parameter for destructible map objects. This is separate from its normal damage against units.',
    undead_bane: 'Controls the equipment’s undead-bane property. This affects its special interaction with undead; it does not turn the wearer into an undead unit.',
    weight: 'Changes the equipment’s weight. Weight contributes to a unit’s equipment burden and Recovery Time; it does not change the weapon’s damage directly.',
    skill_rank_bonus_type: 'Chooses which skill receives this equipment’s rank bonus while equipped. The amount is set separately; this does not directly edit earned proficiency experience.',
    skill_rank_bonus_amount: 'Sets the size of the equipment’s bonus to the selected skill rank. This is an equipment bonus, separate from the unit’s earned skill progression.',
    on_hit_process: 'Chooses the extra operation performed on a hit, such as applying a status. Its argument, chance and value settings below must match that operation.',
    on_hit_argument_status: 'Chooses the status argument for the selected On Hit Process. It only has the intended meaning when that process uses a status argument.',
    on_hit_chance: 'Sets the chance parameter for the additional on-hit effect. This does not make the weapon’s main attack automatically hit; status rules may also affect the result.',
    on_hit_value_type: 'Chooses how the on-hit value is interpreted, such as a fixed amount or another process-specific measure. Choose a type compatible with On Hit Process.',
    on_hit_value: 'Sets the amount/parameter used by On Hit Process and On Hit Value Type. It is not a universal damage value.',
    knockback_chance: 'Changes the weapon’s knockback-chance parameter. A successful attack and the game’s knockback/terrain rules still affect whether a unit is moved.',
    battle_ability: 'Selects the battle ability supplied by this equipment. The ability record defines its behavior; this is separate from the equipment’s On Use Effect.',
    move_stride: 'Selects the special walking/terrain-travel permission supplied by this equipment. It does not set ordinary movement distance.',
    spell_range_bonus: 'Changes the equipment’s spell-range bonus. The spell’s own targeting rules still apply; this does not rewrite every spell’s base range.',
    equipment_set: 'Assigns this equipment to a matching set. The stock set rule can grant temporary skill access when enough matching pieces are worn; the underlying skill must exist.',
    include_in_arms_set: 'Sets which class equipment-permission groups include this item. A class chooses one of these groups through Armament (Equipment) Set. This does not place the equipment in inventory.',
    arms_set_reference: 'Lists the bit meanings used for equipment-permission groups. This community reference field is not a separate equipment rule; use Include in Arms Set to change membership.',
    level_required: 'Sets the level requirement used for automatically generated equipment. The inherited player equip-level restriction is ignored by Reborn; this does not raise party level.',
    animation_type: 'Selects the equipment’s animation profile. Use a profile compatible with its weapon/category; changing a number does not create a new animation.',
    animation_hit_effect: 'Chooses the visual effect shown on impact. This changes the appearance of the hit, not the damage/status operation.',
    animation_projectile_speed: 'Changes the projectile animation’s speed setting. This is visual timing, separate from turn Recovery Time and attack range.',
    battle_sprite: 'Selects the equipment graphic used in battle. The referenced resource must already exist; this does not import a new graphic.',
    sprite_palette: 'Selects the colour variant of the equipment’s battle graphic. It does not change the character’s own palette.',
    projectile_sprite: 'Selects the graphic shown for a fired/thrown projectile. Its flight behavior and resulting effect are configured separately.',
  },
  commodity: {
    item_type: 'Changes the consumable/item category. This can affect where the item is listed and which use rules apply; its actual result is selected by On Use Effect or the charm settings.',
    charm_type: 'Chooses what this charm modifies, such as a statistic, element, level or experience. The value controls below share storage and must be interpreted for that type.',
    charm_value_statistic: 'Chooses the statistic for a statistic charm. This is another view of the same stored argument as Charm Value – Element; changing one changes that shared value.',
    charm_value_element: 'Chooses the element for an elemental charm. It shares its stored argument with Charm Value – Statistic; it is not a second independent bonus.',
    charm_value_copy_stat_elem_here: 'Sets the charm’s additional value parameter. The inherited format expects the statistic/element selection to be copied here for those charm types; level/experience types use this as their value. Check the Charm Type first.',
    ai_unusable: 'Prevents normal AI item use for this entry. It does not remove the item from the player’s inventory or disable its use by the player.',
    throwable: 'Controls whether this item is available for throwing/lobbing use. The unit still needs a working item-use/Lobber setup and a valid target.',
    ai_throwable: 'Controls the item’s AI throwing/lobbing permission. This does not teach the AI a new ability or supply a missing Lobber effect.',
  },
  effect: {
    effect_type: 'Chooses the spell/ability category. Categories connect effects to magic families, skills or weapon finishers and influence availability and presentation. This is separate from the elemental damage settings inside each effect.',
    cost_type: 'Chooses the resource paid to use this effect. Reborn uses its current resource system; the inherited TP choices do not restore the removed TP mechanic.',
    cost_amount: 'Sets the amount of the selected resource paid to use this effect. With MP as Cost Type, zero removes its MP cost; reagents and other action rules are separate.',
    reagent: 'Chooses the inventory item consumed as a casting reagent. Nothing removes the reagent selection. Set its required quantity separately.',
    reagent_amount: 'Sets how many copies of the selected reagent are required. This is separate from MP cost; check both settings when making a free test spell.',
    targeting_type: 'Chooses how targets are selected, such as a single target, line or area. Target flags, range and each subeffect’s target restrictions still apply.',
    target_area_0_1_1: 'Sets the target area. Both 0 and 1 mean a one-tile area in the stock format; the targeting pattern determines how larger areas are used.',
    target_restrict: 'Filters the targets that may be selected for the action, such as enemies, allies or self. The individual effect operations can have additional target filters.',
    spell_chant: 'Selects the chant/text reference associated with casting this effect. This does not change its damage, status or animation resource.',
    terrain_restrict: 'Limits eligible terrain for this effect. Its targeting pattern and operation must also support the intended terrain interaction.',
    restrict_to_class: 'Controls which current class may receive this finisher through automatic generation. Zero removes this class restriction. Demon Rose #496 uses class 70, Ozma’s playable Knight Commander. Weapon family and proficiency requirements still apply; explicit battle presets are a separate route.',
    prerequisite_rank: 'Minimum weapon proficiency rank for an automatically generated finisher. This is weapon proficiency, not character level. Demon Rose requires Whips rank 20; the class and weapon-family checks still apply.',
    animation_caster: 'Selects the animation performed by the user while casting/using the action. This changes the caster’s motion, separate from the ability’s visual effect.',
    animation_ability: 'Selects the main visual effect/animation resource for the ability. Its damage and status operations are configured separately.',
    include_in_effect_set: 'Selects the shared spell-usability row for this effect. Classes allow that row through their Spell set. Several effects can share the row, so changing its permissions can affect all of them.',
  },
  template: {
    tribe: 'Selects the character’s creature-family grouping, such as Human, Beast or Dragon. Family-specific damage and ability rules can use this identity; the template’s Race and class-access group are separate settings.',
    scream_voice: 'Chooses the template’s scream/hurt voice setting used as a default for battle units. A battle unit can select its own Scream voice; recorded story dialogue is separate.',
    gender: 'Selects the character template’s gender. This can affect gender-specific class sprites and equipment restrictions; an explicit sprite override is separate.',
    undead: 'Makes this template use undead defeat behavior: it becomes Stilled rather than normally Incapacitated. This is separate from the character’s elemental affinity.',
    recruitable: 'Controls this template’s recruitment permission. Battle-specific Cannot be persuaded and story rules can still block recruitment; this alone does not create a story join.',
    cannot_use_items: 'Blocks normal item use for characters using this template. This does not remove their equipment or automatically remove carried items.',
    move_type_override: 'Selects a character-specific movement profile instead of the normal class profile where the override is used. This is separate from movement distance and equipment walking bonuses.',
    innate_melee_weapon: 'Chooses the template’s natural melee attack, such as Punch or Bite. This selects an effect, not an inventory weapon.',
    innate_ranged_weapon: 'Chooses the template’s natural ranged attack when it has one. This does not provide a normal weapon or ammunition.',
    class_set: 'Chooses the character/race class-access group this template belongs to. The Races tab edits which classes that group may use. Class marks and other unlock requirements still apply.',
    race: 'Changes the template’s race identity. Race-specific class icons, rules and appearance can depend on it; Class Set and the explicit Sprite override are separate settings.',
    sprite: 'Chooses this character’s own battle sprite override. A nonzero override can keep their personal appearance when class changes; zero normally lets the class supply the sprite.',
    palette: 'Chooses the template’s own sprite colour palette. Where set, a template palette can override the class/default colours. This does not create a new sprite or portrait.',
    damage_voice: 'Chooses the voice set used for hurt/damage reactions. This does not change recorded story dialogue or the character’s written name.',
    limited_skills_type: 'Selects this template’s skill restriction group. The inspected checks filter skills with a different nonzero group. None bypasses this filter; the class must still allow the skill. Faerie, Gremlin and Pumpkinhead are the stock groups.',
  },
  shop: {
    item: 'Chooses which inventory item/equipment this shop-list entry controls. Town levels and unlock requirements below belong to that selected item.',
    crafting_recipe_obtained: 'Requires the selected crafting/recipe-book unlock before this item is offered. None removes this prerequisite; town shop level and other requirements still apply.',
    character_recruited: 'Requires the selected character to have been recruited before the item is offered. Nothing removes this prerequisite; the other shop conditions still apply.',
    global_bought_counter: 'Sets the first global unlock-flag requirement. Zero means no requirement here. The stock Deneb orb entries use flags 1910–1918; changing the number does not trigger that flag.',
    global_sold_counter: 'Sets the second global unlock-flag requirement. Zero means no requirement here. The stock Glass Pumpkin entry waits for flag 1919; this is a flag reference, not a quantity sold.',
    unknown_flag: 'Sets the third story/unlock-flag requirement. Zero means none here. The stock Songstress and Wicce mark entries use story-related flags; this does not set those flags in the save.',
  },
};

function uncertain(kind, f) {
  const k = f.key;
  if (kind === 'armament' && /^resist_.*_element$/.test(k)) return 'Unconfirmed details: Reborn repurposed the legacy elemental-resistance fields. The inherited labels can be misleading; the exact element mapping and calculation need verification before using this to balance elemental protection.';
  if (/^minimum_value|^maximum_value/.test(k)) return 'Unconfirmed details: this is a process-specific effect value. The inherited Minimum/Maximum labels do not establish how Reborn selects or scales it. Check a working effect using the same Process before changing it.';
  if (k === 'equip_drop_chance') return 'Unconfirmed details: this is the equipment’s drop parameter, separate from explicit battle drop slots. Its exact probability scale and interaction with battle settings need verification; do not assume it is a direct 0–100 percentage.';
  if (k === 'ai_cost') return 'Unconfirmed details: this is an AI evaluation parameter. Its exact weighting and direction have not been verified here. It is not the item’s shop price or the ability’s MP cost.';
  if (kind === 'class' && /^(air|earth|lightning|water|fire|ice|light|dark)$/.test(k)) return 'Unconfirmed details: this is the class’s element-permission setting. The inherited options include Forbidden, Allowed, Required and Tolerated; their exact enforcement in Reborn needs checking. It does not directly set a unit’s current element.';
  if (/bodysnatch|snapdragon/.test(k)) return 'Unconfirmed in Reborn: this is a retained setting associated with the older Bodysnatch/Snapdragon systems. Changing this flag alone does not restore a removed mechanic.';
  if (k === 'redact_on_recruit') return 'Unconfirmed details: this flag is labelled as recruitment-related in the inherited definitions. Which abilities Reborn removes, and at what point, still needs testing; do not rely on this alone to retain a boss ability.';
  if (k === 'activation_chance') return 'Unconfirmed details: this effect-table activation parameter is not established as a universal chance to hit. Skill activation and subeffect chance settings are separate; check the actual skill/effect path before changing it.';
  return `Unconfirmed details: the exact Reborn behavior of “${f.label.replace(/\?/g, '').trim()}” has not been verified in this pass. Its inherited label is a clue, not a confirmed rule. Compare with a working entry before using it for a gameplay change.`;
}

function familyHelp(kind, f) {
  const k = f.key;
  let m = k.match(/^(hp|mp|str|vit|dex|agi|avd|int|mnd|res)_growth_10$/);
  if (m) return `Changes the ${kind === 'class' ? 'class' : 'character-template'} contribution to ${STATS[m[1]]} growth per level. Values use tenths: 12 represents 1.2. Growth settings are separate from a unit’s current statistics.`;
  m = k.match(/^(bonus|base)_(hp|mp|str|vit|dex|agi|avd|int|mnd|res|luk|rt)_/);
  if (m) return `Changes the ${kind === 'class' ? 'class contribution to' : 'character-template starting value for'} ${STATS[m[2]]}. This affects characters using this ${kind === 'class' ? 'class' : 'template'}; it does not directly set the current stat of one saved character.${m[2] === 'rt' ? ' Higher Recovery Time means a longer turn delay.' : ''}`;
  m = k.match(/^(atk|def|hp|mp|luk|str|vit|dex|agi|avd|int|mnd|res)_/);
  if (kind === 'armament' && m) return `Sets this equipment’s ${STATS[m[1]]} value/modifier. It affects the unit while this equipment is used or worn; it does not edit that character’s permanent base ${STATS[m[1]]}.`;
  if (/^craft_ingriedient_[1-4]$/.test(k)) return `Chooses crafting ingredient ${k.slice(-1)} for this entry. Nothing leaves the slot empty. The recipe book is set separately; these are ingredient IDs, not quantity fields.`;
  if (kind === 'armament' && /^resist_(crushing|slashing|piercing)_damage$/.test(k)) return `Changes the equipment’s resistance parameter against ${k.split('_')[1]} physical damage. This affects protection while equipped, not the physical type of attacks made with the item.`;
  if (kind === 'armament' && /^resist_.*_tribe$/.test(k)) return `Changes protection against the ${f.label.replace(/^Resist /, '').replace(/ Tribe$/, '')} creature family while equipped. This does not change the wearer’s race or the weapon’s target-family bonus.`;
  if (kind === 'class' && /^(male|female)_(wallister|galgastan|bakram|xenobia|lodis|bolmocca|balboede)$/.test(k)) return `Chooses the large portrait used for this class’s ${f.label.toLowerCase()} variant when a character-specific portrait does not take priority. This does not change its small class-list icon.`;
  if (kind === 'class' && /^(human_male|human_female|winged|lizardman|lamia|orc|skeleton|ghost|faerie|gremlin|pumpkinhead|dragon|golem)$/.test(k)) return `Chooses this class’s class-list artwork for ${f.label}. This is shared class artwork, not an individual character’s face. The stock no-icon value is 255; the selected resource must exist.`;
  if (kind === 'template' && (k === 'single_portrait_or_palette_0_player' || /^palette_[1-6]_portrait_/.test(k))) return `Chooses this character template’s large portrait for ${k === 'single_portrait_or_palette_0_player' ? 'the player/default colour variant' : f.label.replace(/^Palette \d Portrait /, '')}. This is separate from the small face icon and battle sprite; the portrait resource must exist.`;
  if (kind === 'shop') return `Sets the shop progression level from which this item may be sold at ${f.label}. Zero means it is not sold here. Recipe, character and story requirements still apply; this is not a stock quantity.`;
  if (kind === 'effect') {
    const base = k.replace(/_[234]$/, '');
    const effect = f.offset >= 0x5E ? 3 : f.offset >= 0x44 ? 2 : 1;
    const prefix = `Effect operation ${effect}: `;
    const effects = {
      process: 'chooses what this operation does, such as damage, healing or applying a status. Its argument, value and chance controls must match that operation. Retained TP operations do not restore TP in Reborn.',
      argument_status: 'selects the status argument for a Process that uses a status. The status, condition, statistic and numeric argument controls are different views of the same stored value; they are not separate effects.',
      argument_condition: 'selects the condition argument for a Process that uses a condition. It shares storage with the status, statistic and numeric argument controls; use the view matching Process.',
      argument_statistic: 'selects the statistic argument for a Process that uses a statistic. It shares storage with the status, condition and numeric argument controls; changing one changes the same argument.',
      argument_also_set_here: 'edits the same underlying argument shown by the status, condition and statistic controls. Its meaning depends on Process; this is not an additional independent argument.',
      target_restrict: 'filters which targets this operation can affect. The action’s main target selection is separate, so an operation may skip a target that the overall action can select.',
      hit_rate: 'chooses how this operation resolves success, such as calculated accuracy, a chance parameter or a dependency on the first operation. Chance % is not used in the same way by every mode.',
      chance: 'sets the chance parameter used when Hit Rate selects a chance-based mode. It does not universally force the final forecast to this percentage; other success and target rules can apply.',
      accuracy: 'chooses the accuracy calculation profile for this operation. It is a formula selection, not a direct hit percentage.',
      value_type: 'chooses how the operation’s value is interpreted, such as an amount, duration or percentage. The available meanings depend on Process.',
      damage_scaling: 'selects the scaling/formula profile for this operation. The inherited dropdown primarily describes HP-damage formulas; do not assume every formula fits healing or MP effects.',
      physical_affinity: 'chooses crushing, slashing or piercing for this operation’s physical damage. It is separate from elemental affinity and from other operations in the same ability.',
      element_affinity: 'chooses the elemental affinity of this operation. It is separate from the effect’s magic category and the caster’s own element.',
      target_caster: 'directs this operation at the user when enabled. This can differ from the target chosen for the main action, allowing an action to affect both its target and its caster.',
    };
    if (effects[base]) return prefix + effects[base];
  }
  return null;
}

export function describeDataField(kind, f) {
  if (/<unused>|<not used>/i.test(f.label) || /^\s*\?/.test(f.label)) return { status: 'unknown', text: 'Purpose not confirmed in Reborn, or marked unused in the inherited definitions. This raw setting is retained for research; changing it does not establish that the game uses it.' };
  if (DEFERRED[kind]?.has(f.key)) return { status: 'uncertain', text: uncertain(kind, f) };
  const text = DETAILS[kind]?.[f.key] || COMMON[f.key] || familyHelp(kind, f);
  return text ? { status: 'described', text } : { status: 'uncovered', text: 'This setting still needs a verified explanation. Its name alone does not establish its exact gameplay behavior.' };
}

export function dataFieldHelp(kind, f) { return describeDataField(kind, f).text; }

const BATTLE = {
  name: 'Chooses the unit’s name text. Zero uses a generic/generated name where the battle supports it. This does not select the unit’s character template.',
  template: 'Chooses the shared character template supplying base statistics, growth, gender, race, personal sprite and portraits. Editing the template affects all units that use it; choosing it here changes this battle unit’s reference.',
  randomName: 'Chooses the pool used to generate a generic unit’s name. A fixed Unit name can take priority; this does not change class or allegiance.',
  class: 'Chooses this battle unit’s class, which supplies class stats and equipment/skill/spell permissions. A personal sprite override can keep the character’s appearance. Class-specific finishers also depend on weapon proficiency.',
  x: 'Places this unit on the selected map’s X tile coordinate. Moving outside the map can leave it at an invalid position; elevation comes from the tile it stands on.',
  z: 'Places this unit on the selected map’s Y tile coordinate. This is a position on the map, not its elevation; the tile supplies standing height.',
  facing: 'Chooses the direction the unit faces when placed. Facing can affect combat positioning; it does not move the unit to another tile.',
  appears: 'Controls whether this row is placed at battle start or left for a story/reinforcement command. No means the story must add it; simply giving an absent unit coordinates does not make it appear.',
  team: 'Changes which battle side the unit belongs to. Player control and guest behavior also depend on Guest, AI and the story; this does not permanently recruit the unit by itself.',
  guest: 'Marks the unit as a guest participant. Guest units can act under AI control even on the allied side; a permanent story join is configured separately.',
  leader: 'Marks this unit as a battle leader. This is separate from the Defeat target flag and does not make it the player’s army leader.',
  target: 'Marks this unit as a defeat target for the battle. The encounter’s victory/story rules still determine what happens when a target is defeated.',
  zombie: 'Selects the unit’s undead state for this battle record. Undead defeat/revival behavior is different from ordinary incapacitation; the character template also has undead-related settings.',
  alignment: 'Sets this unit’s Lawful, Neutral or Chaotic alignment. This is separate from its current team and elemental affinity.',
  loyalty: 'Changes the unit’s starting loyalty setting. This can matter to recruitment and army loyalty; it does not guarantee a persuasion attempt succeeds.',
  clan: 'Selects the unit’s clan/national background. This is separate from the allied/enemy team and the template’s race.',
  element: 'Sets the unit’s elemental affinity for this battle. This is separate from the elements of its weapon or individual spell effects.',
  ai: 'Chooses the AI behavior profile used to evaluate actions such as damage, healing, buffs and positioning. It does not by itself make an enemy player-controlled; team, guest and story rules still apply.',
  scream: 'Chooses the hurt/scream voice used by this unit. Zero uses the character template’s voice setting. Recorded cutscene dialogue is separate.',
  noPersuade: 'Blocks ordinary persuasion/recruitment of this battle unit. Removing it does not bypass all template, race or story recruitment rules.',
  autoEquipment: 'Zero disables automatic equipment. Nonzero fills eligible empty slots using class permissions, proficiency and level. Explicit equipment remains; ID 999 blocks a slot. Edit the shared pool under Stats & Values → Auto Loadouts.',
  autoSpellProfile: 'Zero disables automatic spells. Nonzero selects the current class’s numbered spell profile under Stats & Values → Auto Loadouts. A missing class/profile pair generates no spells through this path. This is a profile ID, not a level.',
  autoFinishers: 'Controls the battle record’s automatic finisher setup. Generated finishers depend on equipped weapon, weapon proficiency and the finisher’s class restriction. Explicit preset slots are a separate source; the exact meaning of every nonzero flag value has not been verified.',
  arms_id: 'Assigns equipment to this battle unit’s numbered equipment slot. Weapon category and class permissions affect how it is used; this does not change the shared equipment definition.',
  item_id: 'Assigns a carried battle item to this unit. This is separate from the explicit rewards listed under Drops on defeat.',
  drop_id: 'Chooses an explicit reward this unit can drop on defeat. Quantity and chance are set separately; this is not a carried item or equipment slot.',
  drop_qty: 'Sets the quantity for this explicit defeat-drop entry when it is awarded. The item ID and chance are separate controls.',
  drop_chance: 'Sets the chance for this explicit defeat-drop entry. Other reward and story rules can also apply; this does not set every equipment item’s drop chance.',
  skill_id: 'Assigns a skill in this battle unit’s skill preset. This does not add player equipped-skill slots; automatic skill selection, class permissions and the game’s active-skill rules can still affect the loaded unit.',
  skill_rank: 'Sets the rank paired with this preset skill where that skill uses ranks. Reborn’s weapon proficiencies use ranks; this is not character level or an MP cost.',
  spell_id: 'Assigns a spell/ability to this unit’s battle spell preset. Availability and use still depend on the game’s class, resource and targeting rules.',
  finisher_id: 'Assigns an explicit finisher to this unit’s battle preset. This is separate from class-aware automatic generation. For Ozma’s class-linked Demon Rose use effect #496; #460 is a different duplicate record.',
  card_id: 'Chooses a buff-card entry preloaded for this unit in the battle record. This does not place a collectible card on a map tile.',
};
const BATTLE_PENDING = {
  event: 'Unconfirmed details: this number connects the unit to battle/story event logic. The exact references depend on the encounter; changing it can disconnect scripted actions.',
  levelBase: 'Partially understood: sets the battle record’s base level. Later encounters often use zero for scaling. The exact combination with Level modifier and encounter scaling is not confirmed.',
  levelMod: 'Partially understood: sets the battle record’s level modifier. Its exact interaction with base level and encounter scaling is not confirmed; this is not a direct edit of a saved character’s level.',
  appearValue: 'Unconfirmed details: parameter used with On the field mode 2. Stock values vary, and the exact spawn/reinforcement meaning has not been established.',
  subtarget: 'Unconfirmed details: this is a secondary battle-target flag. Which victory or story rules use it depends on the encounter; it is not established as a general recruitment switch.',
  union: 'Partially understood: selects an allegiance/union classification that can affect default appearance. Its full interaction with team and story logic is not established; use Team for the battle side.',
  arms_drop: 'Unconfirmed details: drop parameter attached to this equipped item, separate from explicit Drops on defeat. Its probability and interaction with the equipment definition need verification.',
  item_drop: 'Unconfirmed details: drop parameter attached to this carried item, separate from explicit Drops on defeat. Its full probability/reward behavior needs verification.',
};
export function battleFieldHelp(f) {
  const key = f.key.replace(/\d+_/, '_');
  return BATTLE[key] || BATTLE_PENDING[key] || 'This battle setting still needs a verified gameplay description.';
}

// Pickers refresh their own title when a value is selected. Keep help alongside
// that selected value so it survives selection changes, including repeated slots.
export function attachHelp(element, text) {
  if (!element) return element;
  if (typeof element.setHelp === 'function') element.setHelp(text);
  else element.title = text;
  if (element.matches?.('input, select, textarea, button')) element.setAttribute('aria-description', text);
  return element;
}
