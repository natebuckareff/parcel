// @flow
import type {FilePath} from '@parcel/types';

import jsonMap from 'json-source-map';
import nullthrows from 'nullthrows';

export type DiagnosticHighlightLocation = {|
  // These positions are 1-based
  line: number,
  column: number
|};

export type DiagnosticSeverity = 'error' | 'warn' | 'info';

// Note: A tab character is always counted as a single character
// This is to prevent any mismatch of highlighting across machines
export type DiagnosticCodeHighlight = {|
  // start and end are included in the highlighted region
  start: DiagnosticHighlightLocation,
  end: DiagnosticHighlightLocation,
  message?: string
|};

export type DiagnosticCodeFrame = {|
  code: string,
  codeHighlights: DiagnosticCodeHighlight | Array<DiagnosticCodeHighlight>
|};

// A Diagnostic is a style agnostic way of emitting errors, warnings and info
// The reporter's are responsible for rendering the message, codeframes, hints, ...
export type Diagnostic = {|
  message: string,
  origin: string, // Name of plugin or file that threw this error

  // basic error data
  stack?: string,
  name?: string,

  // Asset metadata
  filePath?: FilePath,
  language?: string,

  // Codeframe data
  codeFrame?: DiagnosticCodeFrame,

  // Hints to resolve issues faster
  hints?: Array<string>
|};

// This type should represent all error formats Parcel can encounter...
export type PrintableError = Error & {
  fileName?: string,
  filePath?: string,
  codeFrame?: string,
  highlightedCodeFrame?: string,
  loc?: {
    column: number,
    line: number,
    ...
  },
  source?: string,
  ...
};

// Something that can be turned into a diagnostic...
export type Diagnostifiable =
  | Diagnostic
  | Array<Diagnostic>
  | ThrowableDiagnostic
  | PrintableError
  | string;

export function anyToDiagnostic(
  input: Diagnostifiable
): Diagnostic | Array<Diagnostic> {
  // $FlowFixMe
  let diagnostic: Diagnostic | Array<Diagnostic> = input;
  if (input instanceof ThrowableDiagnostic) {
    diagnostic = input.diagnostics;
  } else if (input instanceof Error) {
    diagnostic = errorToDiagnostic(input);
  }

  return diagnostic;
}

export function errorToDiagnostic(
  error: ThrowableDiagnostic | PrintableError | string,
  realOrigin?: string
): Diagnostic | Array<Diagnostic> {
  let codeFrame: DiagnosticCodeFrame | void = undefined;

  if (typeof error === 'string') {
    return {
      origin: realOrigin || 'Error',
      message: error,
      codeFrame
    };
  }

  if (error instanceof ThrowableDiagnostic) {
    return error.diagnostics.map(d => {
      return {
        ...d,
        origin: realOrigin || d.origin
      };
    });
  }

  if (error.loc && error.source) {
    codeFrame = {
      code: error.source,
      codeHighlights: {
        start: {
          line: error.loc.line,
          column: error.loc.column
        },
        end: {
          line: error.loc.line,
          column: error.loc.column
        }
      }
    };
  }

  return {
    origin: realOrigin || 'Error',
    message: error.message,
    name: error.name,
    filePath: error.filePath || error.fileName,
    stack: error.highlightedCodeFrame || error.codeFrame || error.stack,
    codeFrame
  };
}

type ThrowableDiagnosticOpts = {
  diagnostic: Diagnostic | Array<Diagnostic>,
  ...
};

export default class ThrowableDiagnostic extends Error {
  diagnostics: Array<Diagnostic>;

  constructor(opts: ThrowableDiagnosticOpts) {
    let diagnostics = Array.isArray(opts.diagnostic)
      ? opts.diagnostic
      : [opts.diagnostic];

    // construct error from diagnostics...
    super(diagnostics[0].message);
    this.stack = diagnostics[0].stack || super.stack;
    this.name = diagnostics[0].name || super.name;

    this.diagnostics = diagnostics;
  }
}

// ids.key has to be "/some/parent/child"
export function generateJSONCodeHighlights(
  code: string,
  ids: Array<{|key: string, type?: ?'key' | 'value', message?: string|}>
): Array<DiagnosticCodeHighlight> {
  let map = jsonMap.parse(code);
  return ids.map(({key, type, message}) => {
    let pos = nullthrows(map.pointers[key]);
    if (!type && pos.value) {
      // key and value
      return {
        start: {line: pos.key.line + 1, column: pos.key.column + 1},
        end: {line: pos.valueEnd.line + 1, column: pos.valueEnd.column},
        message
      };
    } else if (type == 'key' || !pos.value) {
      return {
        start: {line: pos.key.line + 1, column: pos.key.column + 1},
        end: {line: pos.keyEnd.line + 1, column: pos.keyEnd.column},
        message
      };
    } else {
      return {
        start: {line: pos.value.line + 1, column: pos.value.column + 1},
        end: {line: pos.valueEnd.line + 1, column: pos.valueEnd.column},
        message
      };
    }
  });
}
