import { ROOT_MARKER } from '../../core/store/path.js';
export { ROOT_MARKER };
export declare function projectDirOf(): string;
/** Directory holding the marker; also the natural place for the CLI's output. */
export declare function dshDirOf(): string;
/**
 * Paths that mark an episode as "the plugin operating on itself".
 *
 * Failures while editing the plugin's own install or storage files are
 * maintenance, not pitfalls — learning from them fills the library with rules
 * no future session can use. Hooks share this one definition.
 *
 * When the session runs inside the plugin's own development repository (the
 * plugin root sits under the project directory), the whole project tree counts
 * as self: developing the plugin is maintenance by definition.
 */
export declare function selfMarkers(): string[];
export declare function rememberPluginRoot(): void;
