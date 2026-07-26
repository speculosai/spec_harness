/**
 * Every label the workspace can render, and the resolver that turns a key into
 * copy.
 *
 * A host overrides one label or all of them by passing `strings` to
 * `<HarnessProvider>`: a flat bag, or a `t()`-style function if it already runs an
 * i18n library. Anything not overridden falls back to the built-in English below, so
 * partial translation is a supported state rather than a broken one.
 */

/** Variables interpolated into a label's `{{placeholders}}`. */
export type StringVars = Record<string, unknown>;

/**
 * A string bag or a `t()`-style function overriding every UI label, so the workspace
 * speaks your product's language without a fork. Defaults to built-in English.
 */
export type HarnessStrings = Record<string, string> | ((key: string, vars?: Record<string, unknown>) => string);

/** The resolver handed to every component through the context. */
export type Translate = (key: string, vars?: StringVars) => string;

/**
 * The built-in English copy. Keys are dotted and grouped by surface; the two the
 * embedding guide pins by name - `composer.placeholder` and `empty.title` - are part
 * of the documented contract and must keep their spelling.
 */
export const DEFAULT_STRINGS: Record<string, string> = {
  // Workspace chrome
  'workspace.title': 'Builder',
  'workspace.hideFiles': 'Hide files',
  'workspace.showFiles': 'Show files',
  'workspace.dragToResize': 'Drag to resize',
  'workspace.protocolMismatch':
    'This workspace speaks protocol {{client}}; the server speaks {{server}}. Some things will not work until they match.',

  // Empty state
  'empty.title': 'Describe the app you need',
  'empty.body':
    'Say what you want in plain language. The agent writes the files and the preview refreshes itself - there is no run button.',

  // Composer
  'composer.placeholder': 'Describe the app you want to build',
  'composer.send': 'Send',
  'composer.stop': 'Stop',
  'composer.attach': 'Attach an image or a CSV',
  'composer.model': 'Model',
  'composer.modelAuto': 'Server default',
  'composer.readOnly': 'You have read-only access to this project.',

  // Chat
  'chat.planning': 'Planning the approach',
  'chat.building': 'Building the app',
  'chat.composing': 'Composing the next step',
  'chat.running': 'Running {{name}}',
  'chat.result': 'Reading the result',
  'chat.rows': '{{rows}} rows',
  'chat.remove': 'Remove',
  'chat.imageTooLarge': '{{name}} is larger than {{mb}} MB, so it was not attached.',
  'chat.csvTooLarge': '{{name}} is larger than {{mb}} MB, so it was not attached.',
  'chat.notImageOrCsv': '{{name}} is not an image or a CSV, so it was not attached.',
  'chat.readFailed': '{{name}} could not be read, so it was not attached.',
  'chat.planOff': 'Skip planning for this session',
  'chat.planOffNotice': 'Planning is off for this session.',
  'chat.planBackOn': 'Planning is back on.',
  'chat.undo': 'Undo',
  'chat.choicesOther': 'Something else…',
  'chat.choicesSend': 'Send',
  'chat.choicesConfirm': 'Confirm',
  'chat.loadingHistory': 'Loading this project…',

  // Errors, in plain language. A provider failure is never shown raw.
  'error.http': 'The builder could not be reached ({{status}}). Please try again.',
  'error.generic': 'Something went wrong on the way to the model. Please try again.',
  'error.modelUnavailable':
    'That model is not available on this deployment. Pick another one, or ask an admin to enable it.',
  'error.accessDenied': 'The model provider refused this request. The deployment credentials need attention.',
  'error.rateLimited': 'The model provider is rate limiting this deployment. Try again in a moment.',
  'error.network': 'The connection dropped mid-answer. Everything written so far was saved.',
  'error.loadProject': 'This project could not be loaded. {{detail}}',

  // Tool cards, in product language rather than function names.
  'tool.wroteFile': 'Wrote {{path}}',
  'tool.editedFile': 'Edited {{path}}',
  'tool.deletedFile': 'Deleted {{path}}',
  'tool.readFile': 'Read {{path}}',
  'tool.installed': 'Installed {{name}}',
  'tool.ran': 'Ran {{name}}',
  'tool.working': 'Working…',
  'tool.fallbackFile': 'a file',
  'tool.fallbackPackage': 'a package',

  // Preview
  'preview.title': 'Preview',
  'preview.building': 'Building',
  'preview.rebuild': 'Rebuild',
  'preview.patching': 'Patching the app…',
  'preview.buildFailed': 'The app did not build',
  'preview.buildUnavailable': 'The build service could not be reached',
  'preview.runtimeError': 'The app hit an error',
  'preview.askToFix': 'Ask the agent to fix it',
  'preview.dismiss': 'Dismiss',
  'preview.iframeTitle': 'App preview',
  'preview.renderedNothing': 'The app loaded but rendered nothing.',
  'preview.errorHeading': 'This app could not run',
  'preview.errorRepairing': 'The error went back to the agent, which can read the files and repair it.',
  'preview.notConnected': '{{name}} is not connected, so it returned no data.',
  'preview.requestTimedOut': 'The data request timed out after 60s.',
  'preview.unknownError': 'Unknown error',
  'preview.repairPrompt':
    'The preview just failed with this error. Read the current files, find the cause, and fix it. Do not re-introduce the bug.\n\n```\n{{error}}\n```',

  // File explorer
  'files.title': 'Files',
  'files.empty': 'No files yet. The agent writes them as it builds.',
  'files.note': 'Read-only. This is the record of what the agent changed.',
  'files.changedLastTurn': 'Changed in the last turn',
  'files.changedTurn': 'Changed in turn {{turn}}',
  'files.close': 'Close',
  'files.bytes': '{{bytes}} bytes',

  // Version timeline
  'versions.title': 'Versions',
  'versions.empty': 'No versions yet. Every turn is captured as one.',
  'versions.restore': 'Restore',
  'versions.restoring': 'Restoring…',
  'versions.restoreConfirm':
    'Restore this version? The current state is captured first, so the restore itself can be undone.',
  'versions.restored': 'Restored an earlier version.',
  'versions.turn': 'Turn {{turn}}',
  'versions.undo': 'Undo',
  'versions.undoKind': 'Undo point',
};

/** Replace every `{{name}}` in `template` with the matching var. */
export function interpolate(template: string, vars?: StringVars): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? whole : String(value);
  });
}

/**
 * Build the `t()` a component calls. A `strings` function is trusted to do its own
 * interpolation; a bag (and the built-in default) is interpolated here.
 */
export function makeTranslator(strings?: HarnessStrings): Translate {
  return (key: string, vars?: StringVars): string => {
    if (typeof strings === 'function') {
      const resolved = strings(key, vars);
      if (typeof resolved === 'string' && resolved !== '') return resolved;
    } else if (strings && typeof strings[key] === 'string') {
      return interpolate(strings[key], vars);
    }
    const fallback = DEFAULT_STRINGS[key];
    // An unknown key renders as itself rather than as an empty node, so a typo is
    // visible in the UI instead of silently blanking a label.
    return interpolate(fallback ?? key, vars);
  };
}
