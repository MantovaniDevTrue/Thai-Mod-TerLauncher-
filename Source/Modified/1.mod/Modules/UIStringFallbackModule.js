import { log } from '../Core/Logger.js';
import { hookOptional } from '../Core/NativeResolver.js';
import { LocalizationModule } from './LocalizationModule.js';

function translate(value) {
    return LocalizationModule.translateRuntimeValue(String(value ?? ''));
}

function tryHook(owner, signature, callback) {
    try {
        return hookOptional(owner, signature, callback) ? 1 : 0;
    } catch (error) {
        log('UI string hook skipped for ' + signature + ': ' + String(error));
        return 0;
    }
}

export class UIStringFallbackModule {
    static installed = false;
    static hookCount = 0;

    static install() {
        if (this.installed) return this.hookCount;

        let installed = 0;

        try {
            const UIText = new NativeClass('Terraria.GameContent.UI.Elements', 'UIText');

            installed += tryHook(
                UIText,
                'void .ctor(string text, float textScale, bool large)',
                (original, self, text, textScale, large) => {
                    return original(self, translate(text), textScale, large);
                }
            );

            installed += tryHook(
                UIText,
                'void InternalSetText(object text, float textScale, bool large)',
                (original, self, text, textScale, large) => {
                    if (typeof text === 'string') {
                        return original(self, translate(text), textScale, large);
                    }
                    return original(self, text, textScale, large);
                }
            );
        } catch (error) {
            log('UIText fallback bridge unavailable: ' + String(error));
        }

        try {
            const UIHeader = new NativeClass('Terraria.GameContent.UI.Elements', 'UIHeader');
            installed += tryHook(UIHeader, 'void set_Text(string value)', (original, self, value) => {
                return original(self, translate(value));
            });
        } catch (error) {
            log('UIHeader fallback bridge unavailable: ' + String(error));
        }

        this.hookCount = installed;
        this.installed = true;
        log('UI string fallback bridge installed with ' + installed + ' assignment hooks.');
        return installed;
    }
}
