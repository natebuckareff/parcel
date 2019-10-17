// @flow

import semver from 'semver';
import generate from '@babel/generator';
import {parse} from '@babel/parser';
import {Transformer} from '@parcel/plugin';
import {relativeUrl} from '@parcel/utils';
import SourceMap from '@parcel/source-map';
import template from '@babel/template';

const loader = template(`var prevRefreshReg = window.$RefreshReg$;
var prevRefreshSig = window.$RefreshSig$;
var RefreshRuntime = require('react-refresh/runtime');

window.$RefreshReg$ = function(type, id) {
  RefreshRuntime.register(type, module.id + ' ' + id);
};
window.$RefreshSig$ = RefreshRuntime.createSignatureFunctionForTransform;

try {
  %%module%%
} finally {
  window.$RefreshReg$ = prevRefreshReg;
  window.$RefreshSig$ = prevRefreshSig;
}

if (isReactRefreshBoundary(module)) {
  registerExportsForReactRefresh(module);

  module.hot.accept(/*TODO error handling ?*/);
  if (RefreshRuntime.hasUnrecoverableErrors()) {
    window.location.reload();
  }
  window.parcelReactRefreshEnqueueUpdate();
}

// https://github.com/facebook/metro/blob/febdba2383113c88296c61e28e4ef6a7f4939fda/packages/metro/src/lib/polyfills/require.js#L748-L774
function isReactRefreshBoundary(module) {
  var exports = module.exports;
  if (RefreshRuntime.isLikelyComponentType(exports)) {
    return true;
  }

  if (!exports || typeof exports !== 'object') {
    return false;
  }

  var hasExports = false;
  for(var key in exports){
    if(key === "__esModule") {
      continue;
    }
    hasExports = true;
    
    if (!RefreshRuntime.isLikelyComponentType(exports[key])) {
      areAllExportsComponents = false;
      return false;
    }
  }

  return hasExports;
}

// https://github.com/facebook/metro/blob/febdba2383113c88296c61e28e4ef6a7f4939fda/packages/metro/src/lib/polyfills/require.js#L818-L835
function registerExportsForReactRefresh(module) {
  var exports = module.exports;
  var id = module.id;

  if (RefreshRuntime.isLikelyComponentType(exports)) {
    // Register module.exports if it is likely a component
    RefreshRuntime.register(exports, id + ' exports');
  }

  if (!exports || typeof exports !== 'object') {
    return;
  }

  for (var key in exports) {
    if (key === '__esModule') {
      continue;
    }

    var exportValue = exports[key];
    if (RefreshRuntime.isLikelyComponentType(exportValue)) {
      RefreshRuntime.register(exportValue, id + ' exports%' + key);
    }
  }
}`);

function shouldExclude(asset, options) {
  return (
    !asset.env.isBrowser() ||
    !options.hot ||
    !asset.isSource ||
    asset.filePath.endsWith('ReactRefreshRuntime.js') ||
    asset.filePath.endsWith('HMRRuntime.js')
  );
}

export default new Transformer({
  canReuseAST({ast}) {
    return ast.type === 'babel' && semver.satisfies(ast.version, '^7.0.0');
  },

  async parse({asset, options}) {
    let code = await asset.getCode();
    if (shouldExclude(asset, options)) {
      return null;
    }

    return {
      type: 'babel',
      version: '7.0.0',
      isDirty: false,
      program: parse(code, {
        filename: this.name,
        allowReturnOutsideFunction: true,
        strictMode: false,
        sourceType: 'module',
        plugins: ['exportDefaultFrom', 'exportNamespaceFrom', 'dynamicImport']
      })
    };
  },

  transform({asset, options}) {
    asset.type = 'js';
    if (!asset.ast || shouldExclude(asset, options)) {
      return [asset];
    }

    let ast = asset.ast;

    ast.program.program.body = loader({module: ast.program.program.body});
    ast.isDirty = true;

    asset.addDependency({
      moduleSpecifier: 'react-refresh/runtime'
    });

    return [asset];
  },

  async generate({asset, options}) {
    let code = await asset.getCode();
    let res = {
      code
    };

    let ast = asset.ast;
    if (ast && ast.isDirty !== false) {
      let sourceFileName: string = relativeUrl(
        options.projectRoot,
        asset.filePath
      );

      let generated = generate(
        ast.program,
        {
          sourceMaps: options.sourceMaps,
          sourceFileName: sourceFileName
        },
        code
      );

      res.code = generated.code;
      // $FlowFixMe...
      res.map = new SourceMap(generated.rawMappings, {
        [sourceFileName]: null
      });
    }

    if (asset.meta.globals && asset.meta.globals.size > 0) {
      res.code =
        Array.from(asset.meta.globals.values())
          .map(g => (g ? g.code : ''))
          .join('\n') +
        '\n' +
        res.code;
    }
    delete asset.meta.globals;

    return res;
  }
});
