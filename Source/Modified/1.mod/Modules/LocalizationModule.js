import { log } from '../Core/Logger.js';
import { resolveOptional, hookOptional } from '../Core/NativeResolver.js';

const Lang = new NativeClass('Terraria', 'Lang');
const Language = new NativeClass('Terraria.Localization', 'Language');
const LanguageManager = new NativeClass('Terraria.Localization', 'LanguageManager');

const catalogPath = './Localization/th-TH.json';
const settingsFallbackPath = './Localization/settings-fallback.json';
const copyReference = /\{\$([^{}]+)\}/g;

function isVanillaKey(key) {
    const value = String(key || '');
    return value.length > 0 &&
        !value.startsWith('Mods.') &&
        !value.startsWith('Mod.') &&
        !value.includes('.Mods.');
}

export class LocalizationModule {
    static prepared = false;
    static applying = false;
    static catalog = Object.create(null);
    static resolvedCatalog = Object.create(null);
    static settingsFallback = Object.create(null);
    static settingsSources = [];
    static getText = null;
    static exists = null;
    static initializeLegacy = null;
    static createDialogFilter = null;
    static findAll = null;
    static runtimeHooksInstalled = false;
    static runtimeHookCount = 0;
    static reloadHooksInstalled = false;
    static reloadHookCount = 0;
    static reloadHookDepth = 0;
    static reloadReapplying = false;

    static prepare() {
        if (this.prepared) return;
        if (!tl.file.exists(catalogPath)) {
            throw new Error('Localization file not found: ' + catalogPath);
        }

        const parsed = JSON.parse(tl.file.read(catalogPath));
        this.catalog = parsed && typeof parsed === 'object' ? parsed : Object.create(null);

        if (tl.file.exists(settingsFallbackPath)) {
            const fallback = JSON.parse(tl.file.read(settingsFallbackPath));
            this.settingsFallback = fallback && typeof fallback === 'object'
                ? fallback
                : Object.create(null);
        }

        this.settingsSources = Object.keys(this.settingsFallback);
        this.buildResolvedCatalog();
        this.resolveMethods();
        this.installRuntimeHooks();
        this.installReloadHooks();
        this.prepared = true;
        log('Prepared ' + Object.keys(this.resolvedCatalog).length + ' translations.');
    }

    static buildResolvedCatalog() {
        const resolved = Object.create(null);
        const resolving = Object.create(null);

        const resolveKey = key => {
            if (Object.prototype.hasOwnProperty.call(resolved, key)) return resolved[key];
            if (!Object.prototype.hasOwnProperty.call(this.catalog, key)) return null;
            if (resolving[key]) return String(this.catalog[key] ?? '');

            resolving[key] = true;
            const source = String(this.catalog[key] ?? '');
            const value = source.replace(copyReference, (token, reference) => {
                const nested = resolveKey(String(reference || ''));
                return nested === null ? token : nested;
            });
            resolving[key] = false;
            resolved[key] = value;
            return value;
        };

        for (const key of Object.keys(this.catalog)) {
            resolveKey(key);
        }

        this.resolvedCatalog = resolved;
    }

    static resolveMethods() {
        this.getText = Language['LocalizedText GetText(string key)'];
        this.exists = resolveOptional(Language, 'bool Exists(string key)');
        this.initializeLegacy = resolveOptional(Lang, 'void InitializeLegacyLocalization()');
        this.createDialogFilter = resolveOptional(
            Lang,
            'LanguageSearchFilter CreateDialogFilter(string startsWith, bool checkConditions)'
        );
        this.findAll = resolveOptional(Language, 'LocalizedText[] FindAll(LanguageSearchFilter filter)');
    }

    static translateRuntimeValue(value) {
        const raw = String(value ?? '');
        const fallback = this.settingsFallback;
        if (this.settingsSources.length === 0) return raw;

        if (Object.prototype.hasOwnProperty.call(fallback, raw)) {
            return String(fallback[raw] ?? raw);
        }

        const trimmed = raw.trim();
        if (Object.prototype.hasOwnProperty.call(fallback, trimmed)) {
            return String(fallback[trimmed] ?? raw);
        }

        let translated = raw;
        for (let i = 0; i < this.settingsSources.length; i++) {
            const source = this.settingsSources[i];
            if (source.length < 8 || !translated.includes(source)) continue;
            translated = translated.split(source).join(String(fallback[source] ?? source));
        }
        return translated;
    }

    static installRuntimeHooks() {
        if (this.runtimeHooksInstalled) return;

        let installed = 0;
        const getTextMethod = Language['LocalizedText GetText(string key)'];
        getTextMethod.hook((original, key) => {
            const text = original(key);
            if (!text) return text;

            const normalizedKey = String(key ?? '');
            if (Object.prototype.hasOwnProperty.call(LocalizationModule.resolvedCatalog, normalizedKey)) {
                LocalizationModule.setValue(text, LocalizationModule.resolvedCatalog[normalizedKey]);
            } else {
                const current = String(text.Value ?? '');
                const translated = LocalizationModule.translateRuntimeValue(current);
                if (translated !== current) {
                    LocalizationModule.setValue(text, translated);
                }
            }

            return text;
        });
        installed++;

        const signatures = [
            'string GetTextValue(string key)',
            'string GetTextValue(string key, object arg0)',
            'string GetTextValue(string key, object arg0, object arg1)',
            'string GetTextValue(string key, object arg0, object arg1, object arg2)',
            'string GetTextValue(string key, object[] args)'
        ];

        for (const signature of signatures) {
            const didHook = hookOptional(Language, signature, (original, ...args) => {
                const key = args.length > 0 ? String(args[0] ?? '') : '';
                if (args.length === 1 && Object.prototype.hasOwnProperty.call(LocalizationModule.resolvedCatalog, key)) {
                    return LocalizationModule.resolvedCatalog[key];
                }
                const raw = original(...args);
                const translated = LocalizationModule.translateRuntimeValue(raw);
                return translated;
            });
            if (didHook) installed++;
        }

        this.runtimeHooksInstalled = installed > 0;
        this.runtimeHookCount = installed;
        log('Installed ' + installed + ' runtime localization hooks.');
    }

    static installReloadHooks() {
        if (this.reloadHooksInstalled) return;

        let installed = 0;
        const signatures = [
            'void SetLanguage(int legacyId)',
            'void SetLanguage(string cultureName)',
            'void SetLanguage(GameCulture culture)'
        ];

        for (const signature of signatures) {
            const didHook = hookOptional(LanguageManager, signature, (original, self, ...args) => {
                LocalizationModule.reloadHookDepth++;
                let result;
                try {
                    result = original(self, ...args);
                } finally {
                    LocalizationModule.reloadHookDepth--;
                }

                if (LocalizationModule.reloadHookDepth === 0) {
                    LocalizationModule.reapplyAfterReload('language reload');
                }
                return result;
            });
            if (didHook) installed++;
        }

        this.reloadHooksInstalled = installed > 0;
        this.reloadHookCount = installed;
        log('Installed ' + installed + ' localization reload hooks.');
    }

    static refreshLegacy() {
        if (!this.initializeLegacy) return false;
        try {
            this.initializeLegacy();
            return true;
        } catch (error) {
            log('Legacy localization refresh skipped: ' + String(error));
            return false;
        }
    }

    static reapplyAfterReload(reason) {
        if (!this.prepared || this.reloadReapplying) return;

        this.reloadReapplying = true;
        try {
            const first = this.applyAll();
            const refreshed = this.refreshLegacy();
            const second = refreshed
                ? this.applyAll()
                : { applied: 0, missing: 0, failed: 0 };
            const settings = this.applySettingsFallbacks();

            log(
                'Localization reapplied after ' + reason + ': ' +
                (first.applied + second.applied) + ' assignments, ' +
                settings.applied + ' settings fallbacks.'
            );
        } finally {
            this.reloadReapplying = false;
        }
    }

    static keyExists(key) {
        if (this.exists) return Boolean(this.exists(key));
        const text = this.getText(key);
        return Boolean(text) && String(text.Key || '') === key;
    }

    static setValue(text, value) {
        if (!text) return false;
        text['void SetValue(string text)'](String(value ?? ''));
        return true;
    }

    static applyAll() {
        if (!this.prepared || this.applying) {
            return { applied: 0, missing: 0, failed: 0 };
        }

        this.applying = true;
        let applied = 0;
        let missing = 0;
        let failed = 0;

        try {
            for (const key of Object.keys(this.resolvedCatalog)) {
                if (!isVanillaKey(key)) continue;
                if (!this.keyExists(key)) {
                    missing++;
                    continue;
                }

                const text = this.getText(key);
                if (this.setValue(text, this.resolvedCatalog[key])) applied++;
                else failed++;
            }
        } finally {
            this.applying = false;
        }

        return { applied, missing, failed };
    }

    static applySettingsFallbacks() {
        if (!this.createDialogFilter || !this.findAll || this.settingsSources.length === 0) {
            return { applied: 0, failed: 0 };
        }

        let applied = 0;
        let failed = 0;
        const filter = this.createDialogFilter('', false);
        const texts = this.findAll(filter);
        if (!texts) return { applied, failed };

        const length = Number(texts.length) || 0;
        for (let i = 0; i < length; i++) {
            const text = texts[i];
            if (!text) continue;

            const current = String(text.Value ?? '');
            const trimmed = current.trim();
            const key = Object.prototype.hasOwnProperty.call(this.settingsFallback, current)
                ? current
                : trimmed;
            if (!Object.prototype.hasOwnProperty.call(this.settingsFallback, key)) continue;

            if (this.setValue(text, this.settingsFallback[key])) applied++;
            else failed++;
        }

        return { applied, failed };
    }

    static applyBeforeInitialization() {
        const result = this.applyAll();
        log('Early localization: ' + result.applied + ' applied, ' + result.missing + ' unavailable, ' + result.failed + ' failed.');
        return result;
    }

    static applyAfterInitialization() {
        const first = this.applyAll();
        const refreshed = this.refreshLegacy();
        const second = refreshed
            ? this.applyAll()
            : { applied: 0, missing: 0, failed: 0 };
        const settings = this.applySettingsFallbacks();

        log(
            'Localization active: ' +
            (first.applied + second.applied) + ' assignments, ' +
            first.missing + ' unavailable, ' +
            (first.failed + second.failed) + ' failed, ' +
            settings.applied + ' settings fallbacks.'
        );
    }
}
