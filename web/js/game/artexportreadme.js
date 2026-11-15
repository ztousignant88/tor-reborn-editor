// Human-readable guide plus an inventory of the files actually written to this ZIP.
const line=value=>String(value??'').replace(/[\r\n\t\x00-\x08\x0b\x0c\x0e-\x1f]+/g,' ');
const formatName=id=>({0:'RGBA (uncompressed full colour)',7:'BC1',8:'BC2',9:'BC3',13:'BC7'}[id]??'native texture format '+id);
function role(archive,image){
 if(image.kind==='indexed')return archive.path.startsWith('object/')?'Character animation sprite sheet':'Palette-indexed art sheet';
 if(/_aura$/i.test(image.name))return 'Aura silhouette helper';
 if(/_mask$/i.test(image.name))return 'Sprite mask helper';
 if(/^com_unit_face_/i.test(image.name))return 'Small unit menu face icon';
 if(/^com_class00_face/i.test(image.name))return 'Small class menu face icon';
 if(/^com_class00_unit/i.test(image.name))return 'Standing class-change menu picture';
 if(archive.path==='menu/menu_classface.dat')return 'Full class / unit menu portrait';
 if(/^object\/[^/]+[0-9]{2}\.dat$/i.test(archive.path)&&image.width===512&&image.height===512)return 'Painted character portrait';
 if(archive.path.startsWith('bg/'))return 'Map texture / tile / object art (inspect its preview for the exact piece)';
 if(archive.path.startsWith('effect/'))return 'Spell / ability effect texture piece';
 if(/(?:itemicon|skill_icon|spell_icon|finishblow_icon)/i.test(archive.path))return 'Item / equipment / spell / skill / finisher icon sheet';
 if(archive.path.startsWith('event/scene/'))return 'Art embedded in this cutscene';
 return 'Full-colour texture (its native name and preview identify the artwork)';
}
const GUIDE=`Tactics Ogre Reborn art export
==============================

START HERE
----------
Edit the PNG artwork in an image editor. Keep its filename, folder, canvas size,
frame positions and transparent margins. Keep the other files with the package.
Zip the contents again with manifest.json at the ZIP root, then choose Files >
Art importer/exporter > Import package. Review the rebuilt images and save a
separate project. Apply that project to the game when you are ready to test.
Import PNG can rebuild one selected image; Import character handles body sheets,
portraits and helper generation together. Export PNG alone downloads only an
image: use a package export to include this guide and the supporting files.

An export ZIP is an editing package. It is not a ready-to-install game mod.
Preview zoom never changes exported image dimensions. The inventory below lists
every file in THIS package, the game archive it belongs to, and its purpose.

FOLDERS AND FILE TYPES
----------------------
README.txt (.txt = plain text)
  This guide and the exact package inventory. Read it in any text editor.
  Its contents are not imported into the game.

manifest.json (.json = structured text / metadata)
  The importer's map from each PNG to its original game resource. It records the
  game file path, image name, dimensions, image ID, archive location, palette,
  export settings, animation metadata and SHA-256 fingerprints. Fingerprints
  detect changed source data; archive locations identify the correct resource
  inside a file. Keep this file unchanged. If the saved game/project art changes
  after export, export it again before importing edited PNGs.

archive-001/, archive-002/, ...
  One folder for each exported game archive. The number is just the order of
  export; it is not a character, palette, frame or battle ID. The inventory maps
  each folder to the real game path. Character exports may include several
  related object archives and additional linked menu archives.

archive-NNN/images/*.png (.png = editable image)
  The pictures to edit. A numeric filename prefix is the resource's position in
  that archive, displayed starting at 1. It is NOT an animation frame number.
  One PNG may hold many poses, tiles, icons or effect pieces on the same sheet.
  The rest of the filename comes from the native resource name when available.
  Keep the full canvas and all frame/atlas positions; do not crop it to visible
  pixels or rearrange individual poses. See IMAGE TYPES below.

archive-NNN/indices/*.bin (.bin = raw binary palette indices)
  The original colour-slot number of each pixel in an indexed PNG, in row order
  from the top left. There is one byte per pixel, even if the native game sheet
  uses packed 4-bit pixels. These are not RGB colours or another picture format.
  They preserve a reference to duplicate-looking colour slots and help technical
  inspection. Keep them unchanged. Package import takes edits from the PNG;
  editing a BIN does not change the imported artwork.

archive-NNN/source/*.dat (.dat = original game data archive)
  The exact saved game/project archive from which the images were exported.
  It can contain sprites, portraits, compressed textures and other resources.
  It is retained for comparison and source verification. Keep it unchanged.
  Package import rebuilds supported PNG edits against the matching saved source;
  it does not install the DAT stored in the ZIP or use an edited DAT as artwork.

archive-NNN/source/*.efz (.efz = compressed effect library, when present)
  The original effect container, including more than its visible texture images.
  Its PNGs are individual effect pieces, not the complete spell animation.
  Keep the EFZ unchanged. Effect-library PNG rebuilding is not supported by this
  package importer yet; export/view support does not imply import support.

palettes/battle-palettes.json (when present)
  A reference copy of the game's shared battle colour palettes. Each palette is
  a flat list of red, green, blue, alpha values (0-255) for its colour slots.
  Alpha describes transparency. The manifest also records the palette used to
  render each indexed PNG. Keep this JSON unchanged: package import does not
  install palette-bank edits. Full-colour portraits and icons have their own
  colours and are not recoloured by this battle-sprite palette bank.

animation/body.sas3 (.sas3 = native binary body-animation sequence, when present)
  A reference copy of the body's animation family: which frames are used, their
  timing, facing and placement commands. The parsed description is also in
  manifest.json under bodyAnimation.definition. This helps explain how poses on
  the sheets become walking, attacking, flying and other actions. It is not an
  image or video. Keep it unchanged; this importer does not apply SAS3 edits.
  Other animation sequences found inside archives are described in the
  manifest's sequences fields rather than exported as separate SAS3 files.

The downloaded .zip is the container for all of the above. When repacking, keep
the original folder structure and place manifest.json directly at the ZIP root,
not inside an extra enclosing folder. Files marked 'when present' only appear
when the source and export options provide them.

IMAGE TYPES AND HOW TO EDIT THEM
-------------------------------
Indexed sprite / art sheets
  Each pixel stores a palette slot rather than a full RGB colour. The exported
  PNG uses 8-bit indexed mode; the original game sheet may use 4 or 8 bits.
  Keep colour-slot order, including duplicate colours, and slot 0 transparency.
  Duplicate-looking slots can change differently with another faction palette.
  Native indexed editing preserves that behaviour. RGB/RGBA, reordered palettes,
  other PNG bit depths and interlacing can use 'Convert and preview' on import.
  Conversion maps to the selected native palette and makes sprite transparency
  opaque or transparent at the 50% threshold. It may change colours and their
  faction behaviour. It keeps the source PNG, sheet size and frame layout.

Painted portraits
  Full-colour images with alpha transparency, normally on a 512 x 512 canvas for
  character portraits. Use the native image as the framing reference: transparent
  margins, cropped sides, rounded lower corners and painted edging are part of
  the artwork. Human busts such as Denam / Warrior are roughly 328 pixels wide
  inside that canvas; creatures, ears and hats can differ. Do not force every
  portrait into that human silhouette. Separate object and menu portrait copies
  can need the same edit for consistent dialogue, army and hiring views.
  The game's limit for supported rebuilt compressed portraits is 160 KiB; that
  is not the PNG file size. The importer checks it and offers fitting options.

Small face icons and standing class-change pictures
  Separate menu textures, not automatic views of the live battle sprite. Their
  PNG dimensions are listed below. Edit them directly or regenerate them from
  a standing body pose with Sprite art helper / Batch character helpers.

Aura images (_aura)
  Helper silhouettes associated with the character. The helper follows the
  observed red/alpha silhouette convention. A strange red or silhouette-like
  image is not necessarily a damaged sprite. Some resources are intentional
  8 x 8 placeholders. Keep their native sizes. Helper generation can derive a
  silhouette from the body art; the full native rendering meaning remains only
  partly mapped.

Mask images (_mask)
  Channel-based rendering helpers, not ordinary coloured character pictures.
  Experimental mask generation keeps the native red/green channels and derives
  blue/alpha coverage from the body. Their complete rendering meaning is not
  established. Do not replace every channel with a plain silhouette. Use the
  helper and inspect the result in game when changing body coverage.

Item, equipment, spell, skill and finisher icons
  Full-colour textures, often with many icons in one atlas. Edit the intended
  icon in place without resizing or moving its neighbours. Multiple levels or
  variants may occupy different cells. Separate menu archives can hold copies.

Map tiles / objects, cutscene art and effect textures
  Can be texture atlases, animation frames or just one piece of a larger scene
  or effect. A texture PNG alone does not change map geometry, tile connections,
  animation timing or spell behaviour. Keep its canvas and internal layout.
  Cutscenes may embed their own art copies; character export does not scan and
  update those automatically. Browse Cutscene art to inspect them separately.

Native texture formats
  RGBA means full-colour pixels with alpha transparency. BC1, BC2, BC3 and BC7
  are the game's compressed texture formats, not extra exported image types.
  They are decoded into ordinary RGBA PNGs for painting. BC7 rebuilding is lossy,
  so compare the supplied and rebuilt images. This importer rebuilds supported
  RGBA and BC7 resources; other formats, some masks and unsupported layouts are
  view/export only. A successful export is not a promise that every PNG can be
  rebuilt. Import preview checks the actual resource before making a project.

RELATED COPIES, COLOURS AND OPTIONAL FILES
-----------------------------------------
Character.dat is usually a base body archive. Character00.dat, Character02.dat,
and other numbered files can bundle copies of that body with separate portraits.
Those suffixes are native variant names; do not treat the export folder number
or filename suffix as a guaranteed shared-palette selection or a new sprite ID.
Body copies can be byte-for-byte identical even when their portraits differ.
The exporter normally renders sheets with shared palette 0, except a selected
sheet's chosen palette or an embedded native palette. Identical exported colours
do not prove that every copy uses those colours in every in-game situation.
Each sheet's actual export palette is recorded in manifest.json.

Editing one PNG updates its listed resource only. Other exported copies can need
the same edit. Import character can update the linked body/portrait copies and
generate helpers together. Different drawings in archives sharing one actor ID
are not automatically independent characters; use Create new character to give
a supported new character its own art IDs.

Face icons, aura/alpha-mask PNGs and class-change picture PNGs can be omitted by
the Character package extras switches. Their native data remains in source DATs
and their omissions are recorded in the manifest. Missing helper PNGs therefore
do not mean the original game art was deleted. Regenerate affected helpers after
body edits. Linked full menu portraits are separate from these optional extras.
If an image could not be exported, its manifest exportError and the inventory
explain that it has no PNG. Unedited and unsupported resources stay in place.
`;

export function artExportReadme(manifest,files){
 const lines=[GUIDE,'','THIS PACKAGE: EVERY EXPORTED FILE','---------------------------------'];
 if(manifest.created)lines.push('Created: '+line(manifest.created));
 lines.push('Scope: '+(manifest.scope==='related-object-files'?'Character and linked archives':'Single archive'));
 const listed=new Set(),add=(name,...notes)=>{if(!name||listed.has(name))return;listed.add(name);lines.push('',line(name),...notes.map(n=>'  '+line(n)));};
 add('README.txt','Plain-text guide and the inventory you are reading. Not imported.');
 add('manifest.json','Resource map, settings, checksums and parsed metadata. Keep unchanged.');
 if(manifest.sharedPaletteFile)add(manifest.sharedPaletteFile,'Shared battle palettes for reference. Not installed by package import.');
 if(manifest.bodyAnimation?.file)add(manifest.bodyAnimation.file,'Native body animation family '+line(manifest.bodyAnimation.family)+'. Binary reference, not imported.');
 for(const archive of manifest.archives){
  lines.push('','Game archive: '+line(archive.path));
  add(archive.source,'Unchanged original '+(/\.efz$/i.test(archive.path)?'compressed effect library':'game data archive')+' for '+line(archive.path)+'. Keep unchanged.');
  for(const image of archive.images){const description=role(archive,image),size=`${image.width} x ${image.height}`,native=image.kind==='indexed'?`${image.bpp}-bit native indices`:formatName(image.format);
   if(image.png){add(image.png,description+`; ${size}; ${native}.`,image.kind==='indexed'?`Editable indexed PNG. Export palette: ${image.paletteSource==='embedded'?'embedded in this image':'shared battle palette '+(image.paletteIndex??0)}. Preserve layout and palette slots, or use Convert and preview.`:'Full-colour RGBA PNG. Keep its native dimensions and transparent margins; import checks whether rebuilding is supported.');}
   else if(image.omitted)lines.push(`  [No PNG] ${line(image.name)}: ${description}; ${size}. Omitted by helper-art export settings; native art retained.`);
   else if(image.exportError)lines.push(`  [No PNG] ${line(image.name)}: ${description}; ${size}. Export failed: ${line(image.exportError)}. Native source retained.`);
   else lines.push(`  [No PNG] ${line(image.name)}: ${description}; ${size}. See its manifest record.`);
   if(image.indices)add(image.indices,`Original ${size} palette-slot bytes for ${line(image.png??image.name)}. One byte per pixel, in row order. Reference only; edit the PNG instead.`);
  }
  if(archive.sequences?.length)lines.push(`  ${archive.sequences.length} embedded animation sequence(s) described in manifest.json; no separate files generated for these.`);
  for(const warning of archive.warnings??[])lines.push('  Source / export note: '+line(warning));
 }
 // Include any future export file even before it has a more specific guide entry.
 for(const file of files)if(!listed.has(file.name))add(file.name,'Additional export file. Keep with the package; consult manifest.json for its association.');
 lines.push('','END OF INVENTORY',`${listed.size} files listed, including README.txt and manifest.json.`,'');
 return lines.join('\n');
}
