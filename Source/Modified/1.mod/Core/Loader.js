import { log } from './Logger.js';
import { LocalizationModule } from '../Modules/LocalizationModule.js';
import { ThaiFontModule } from '../Modules/ThaiFontModule.js';
import { UIStringFallbackModule } from '../Modules/UIStringFallbackModule.js';

const Main = new NativeClass('Terraria', 'Main');

export class Loader {
    static started = false;

    static start() {
        if (this.started) return;

        LocalizationModule.prepare();
        UIStringFallbackModule.install();
        Main['void Initialize_AlmostEverything()'].hook((original, self) => {
            LocalizationModule.applyBeforeInitialization();
            original(self);
            ThaiFontModule.installAfterInitialization();
            LocalizationModule.applyAfterInitialization();
        });

        this.started = true;
        log('Loaded through modular loader.');
    }
}
