import { log } from '../Core/Logger.js';
import { resolveOptional } from '../Core/NativeResolver.js';

const FontAssets = new NativeClass('Terraria.GameContent', 'FontAssets');
const SpriteFont = new NativeClass('Microsoft.Xna.Framework.Graphics', 'SpriteFont');
const Rectangle = new NativeClass('Microsoft.Xna.Framework', 'Rectangle');
const Char = new NativeClass('System', 'Char');
const Glyph = SpriteFont.Glyph;

const mouseMetaPath = './Assets/ThaiGlyphsMouse.json';
const mouseAtlasPath = 'Assets/ThaiGlyphsMouse.png';
const deathMetaPath = './Assets/ThaiGlyphs.json';
const deathAtlasPath = 'Assets/ThaiGlyphs.png';
const itemMetaPath = './Assets/ThaiGlyphsItemStack.json';
const itemAtlasPath = 'Assets/ThaiGlyphsItemStack.png';

function rect(x, y, width, height) {
    const value = Rectangle.new();
    value['void .ctor(int x, int y, int width, int height)'](
        x | 0,
        y | 0,
        width | 0,
        height | 0
    );
    return value;
}

function extendNativeArray(source, extra) {
    if (!source || !extra || extra.length === 0) return source;

    const baseLength = source.length | 0;
    const result = source.cloneResized(baseLength + extra.length);
    for (let i = 0; i < extra.length; i++) {
        result[baseLength + i] = extra[i];
    }
    return result;
}

function csharpChar(code) {
    return Char['char Parse(string s)'](String.fromCharCode(code));
}

function loadJson(path) {
    if (!tl.file.exists(path)) {
        throw new Error('Missing Thai font metadata: ' + path);
    }
    return JSON.parse(tl.file.read(path));
}

export class ThaiFontModule {
    static ready = false;
    static failed = false;

    static getGlyphs(font) {
        return font['Glyph[] get_Glyphs()']();
    }

    static getTextures(font) {
        return font['Texture2D[] get_Textures()']();
    }

    static getDefaultCharacter(font) {
        const getter = resolveOptional(font, 'Nullable`1 get_DefaultCharacter()');
        return getter ? getter() : null;
    }

    static getLiftForLabel(label, lineScale) {
        const baseLift = Math.max(1, Math.round((1 - lineScale) * 8));
        if (label === 'MouseText') return baseLift + 3;
        if (label === 'ItemStack') return baseLift + 2;
        if (label === 'DeathText') return baseLift + 1;
        return baseLift;
    }

    static buildGlyph(entry, textureIndex, lineScale, yLift) {
        const glyph = Glyph.new();
        const left = Number(entry.left) || 0;
        const width = Number(entry.w) || 0;
        const advance = Number(entry.advance) || width;
        const rawYOffset = Number(entry.yOffset) || 0;
        const normalizedYOffset = Math.max(0, Math.round(rawYOffset * lineScale) - (yLift | 0));

        glyph.Character = csharpChar(entry.code | 0);
        glyph.BoundsInTexture = rect(entry.x, entry.y, entry.w, entry.h);
        glyph.Cropping = rect(0, normalizedYOffset, entry.w, entry.h);
        glyph.LeftSideBearing = left;
        glyph.RightSideBearing = advance - width - left;
        glyph.Width = width;
        glyph.WidthIncludingBearings = advance;
        glyph.TexureIndex = textureIndex | 0;
        return glyph;
    }

    static mergeAsset(asset, label, meta, atlas) {
        if (!asset || !asset.Value) {
            throw new Error('FontAssets.' + label + '.Value is not ready');
        }

        const original = asset.Value;
        const oldGlyphs = this.getGlyphs(original);
        const oldTextures = this.getTextures(original);
        if (!oldGlyphs || !oldTextures) {
            throw new Error('Could not read native arrays for ' + label);
        }

        const textureIndex = oldTextures.length | 0;
        if (textureIndex > 255) {
            throw new Error(label + ' texture page limit exceeded: ' + textureIndex);
        }

        const originalLineSpacing = Number(original['int get_LineSpacing()']()) || 0;
        const metaLineHeight = Number(meta.lineHeight) || originalLineSpacing || 1;
        const lineScale = originalLineSpacing > 0 && metaLineHeight > 0
            ? Math.min(1, originalLineSpacing / metaLineHeight)
            : 1;
        const yLift = this.getLiftForLabel(label, lineScale);

        const addedGlyphs = new Array(meta.glyphs.length);
        for (let i = 0; i < meta.glyphs.length; i++) {
            addedGlyphs[i] = this.buildGlyph(meta.glyphs[i], textureIndex, lineScale, yLift);
        }

        const textures = extendNativeArray(oldTextures, [atlas]);
        const glyphs = extendNativeArray(oldGlyphs, addedGlyphs);
        const merged = SpriteFont.new();

        merged['void .ctor(Texture2D[] textures, Glyph[] glyphs, int lineSpacing, float spacing, Nullable`1 defaultCharacter)'](
            textures,
            glyphs,
            originalLineSpacing,
            Number(original['float get_Spacing()']()),
            this.getDefaultCharacter(original)
        );

        if (meta.glyphs.length && !merged['bool HasCharacter(char c)'](csharpChar(meta.glyphs[0].code | 0))) {
            throw new Error(label + ' did not index the first Thai glyph');
        }

        asset.Value = merged;
        log('FontAssets.' + label + ' patched with ' + addedGlyphs.length + ' Thai glyphs. lineScale=' + lineScale.toFixed(3) + ', yLift=' + yLift + '.');
        return true;
    }

    static installAfterInitialization() {
        if (this.ready || this.failed) return this.ready;

        try {
            const mouseMeta = loadJson(mouseMetaPath);
            const deathMeta = loadJson(deathMetaPath);
            const itemMeta = loadJson(itemMetaPath);
            const mouseAtlas = tl.texture.load(mouseAtlasPath);
            const deathAtlas = tl.texture.load(deathAtlasPath);
            const itemAtlas = tl.texture.load(itemAtlasPath);

            if (!mouseAtlas || !deathAtlas) {
                throw new Error('Thai font atlas could not be loaded');
            }

            const mouseOk = this.mergeAsset(FontAssets.MouseText, 'MouseText', mouseMeta, mouseAtlas);
            const deathOk = this.mergeAsset(FontAssets.DeathText, 'DeathText', deathMeta, deathAtlas);
            let itemOk = false;

            try {
                if (!itemAtlas) throw new Error('ItemStack atlas could not be loaded');
                itemOk = this.mergeAsset(FontAssets.ItemStack, 'ItemStack', itemMeta, itemAtlas);
            } catch (error) {
                log('ItemStack Thai font patch skipped: ' + String(error));
            }

            this.ready = mouseOk && deathOk;
            log('Thai fonts ready. ItemStack=' + (itemOk ? 'available' : 'unavailable') + '.');
            return this.ready;
        } catch (error) {
            this.failed = true;
            log('Thai font installation failed: ' + String(error));
            return false;
        }
    }
}
