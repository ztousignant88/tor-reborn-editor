"""Generate the class-change pictures using the local sprite, pose and palette."""
from functools import lru_cache
import json
from pathlib import Path
import struct

from art_pixels import Picture
from local_game_art import (battle_palettes, decode_texture, indexed_object,
                            rebuild_texture, rename_texture, texture_bank)
from tools.menu_mods.compiler.tor_formats import DatArchive, Pakd

ROOT = Path(__file__).resolve().parent / 'tools/class_change'
ARCHIVE = 'menu/texture_x4/com_class.dat'
STANDING = {64: 'com_class00_unit0017_00', 68: 'com_class00_unit0031_00',
            96: 'com_class00_unit0006_00'}
FACE = 'com_class00_face0017_00'


def read_pose(body, bank, frame, palette):
    w, h, indices = body
    frames = struct.unpack_from('<I', bank, 8)[0]
    if frame >= struct.unpack_from('<I', bank, frames)[0]:
        raise ValueError('Class picture references a missing pose')
    at = struct.unpack_from('<I', bank, frames+4+frame*4)[0]
    if bank[at] != 0:
        raise ValueError('Class picture needs a different sprite sheet')
    cells = [struct.unpack_from('<hhHHHH', bank, at+6+i*12) for i in range(bank[at+1])]
    cells = [cell for cell in cells if cell[2] and cell[3]]
    x0, y0 = min(c[0] for c in cells), min(c[1] for c in cells)
    x1, y1 = max(x+cw for x, _, cw, _, _, _ in cells), max(y+ch for _, y, _, ch, _, _ in cells)
    pose = Picture(x1-x0, y1-y0)
    for x, y, cw, ch, u, v in cells:
        if u+cw > w or v+ch > h:
            raise ValueError('Class picture pose exceeds its sprite sheet')
        for cy in range(ch):
            for cx in range(cw):
                index = indices[(v+cy)*w+u+cx]
                if index:
                    pose[x+cx-x0,y+cy-y0] = tuple(palette[index*4:index*4+4])
    return pose, -x0


def standing_picture(pose, pivot, w, h, scale, foot, dx=0):
    bounds = pose.bounds()
    x0, y0 = w/2-pivot*scale+dx, foot-bounds[3]*scale
    out = Picture(w,h)
    for y in range(h):
        sy = int((y-y0)//scale)
        if not 0 <= sy < pose.height:
            continue
        for x in range(w):
            sx = int((x-x0)//scale)
            if 0 <= sx < pose.width:
                out[x,y] = pose[sx,sy]
    return out


def recolour(image, indices, source, target):
    out = image.copy()
    @lru_cache(maxsize=None)
    def colour(r, g, b):
        rgb = (r,g,b)
        i = min(indices, key=lambda i: sum((source[i*4+c]-rgb[c])**2 for c in range(3)))
        return tuple(max(0,min(255,v+target[i*4+c]-source[i*4+c])) for c,v in enumerate(rgb))
    for y in range(out.height):
        for x in range(out.width):
            r,g,b,a = out[x,y]
            if a:
                out[x,y] = (*colour(r,g,b),a)
    return out


def build_textures(read, battle, archive):
    recipes = json.loads((ROOT/'art-sources.json').read_bytes())
    bank = texture_bank(archive)
    pack = Pakd(battle.pack)
    animations = Pakd(pack.entry(0))
    palettes = battle_palettes(pack)

    @lru_cache(maxsize=None)
    def body(path):
        return indexed_object(read(path))

    @lru_cache(maxsize=None)
    def pixels(name):
        return decode_texture(bank[name])

    @lru_cache(maxsize=None)
    def posed(path, family, frame, palette):
        return read_pose(body(path), animations.entry(family), frame, palettes[palette])

    output = {}
    for recipe in recipes:
        name, mode = recipe['name'], recipe['mode']
        donor = recipe['donor']
        if mode == 'alias':
            output[name] = rename_texture(output[donor], name)
            continue
        template = bank[donor]
        original = pixels(donor)
        if mode == 'empty':
            rgba = Picture(*original.size)
        elif mode == 'palette':
            indices = recipe.get('indices') or sorted(set(body(recipe['path'])[2])-{0})
            rgba = recolour(original, indices, palettes[recipe['sourcePalette']], palettes[recipe['palette']])
        else:
            pose,pivot = posed(recipe['path'],recipe['family'],recipe['frame'],recipe['palette'])
            left,top,right,bottom = pose.bounds()
            w,h = original.size
            foot = recipe.get('foot') or original.bounds()[3]
            scale = recipe.get('scale')
            if scale is None:
                scale = (w/2-2)/max(1,pivot-left,right-pivot)
                if 'top' not in recipe:
                    scale = min(scale, (foot-2)/(bottom-top))
            if 'maxHeight' in recipe:
                scale = min(scale, recipe['maxHeight']/(bottom-top))
            if 'maxScale' in recipe:
                scale = min(scale, recipe['maxScale'])
            if mode == 'head':
                if 'top' in recipe:
                    rgba = standing_picture(pose,pivot,w,h,scale,recipe['top']+(bottom-top)*scale)
                elif recipe.get('crop'):
                    full = standing_picture(pose,pivot,64,128,scale,recipe.get('foot',116))
                    rgba = full.crop((0,12,64,76))
                else:
                    # Match the art helper's head-band crop while keeping native pixel scale.
                    band = pose.crop((0,top,pose.width,min(pose.height,top+36))).bounds()
                    x = (band[0]+band[2])/2-32/scale
                    y = top-4/scale
                    rgba = pose.sample(64,64,x,y,1/scale)
            else:
                rgba = standing_picture(pose,pivot,w,h,scale,foot,recipe.get('dx',0))
        output[name] = rebuild_texture(template,name,rgba,original)
    return output
