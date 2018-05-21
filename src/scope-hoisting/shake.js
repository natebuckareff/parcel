const t = require('babel-types');

const EXPORTS_RE = /^\$([\d]+)\$exports$/;

/**
 * This is a small small implementation of dead code removal specialized to handle
 * removing unused exports. All other dead code removal happens in workers on each 
 * individual file by babel-minify.
 */
function treeShake(scope) {
  // Keep passing over all bindings in the scope until we don't remove any.
  // This handles cases where we remove one binding which had a reference to
  // another one. That one will get removed in the next pass if it is now unreferenced.
  let removed;
  do {
    removed = false;

    // Recrawl to get all bindings.
    scope.crawl();
    Object.keys(scope.bindings).forEach(name => {
      let binding = getUnusedBinding(scope.path, name);

      // If it is not safe to remove the binding don't touch it.
      if (!binding) {
        return;
      }

      // Remove the binding and all references to it.
      binding.path.remove();
      binding.referencePaths
        .concat(binding.constantViolations)
        .forEach(path => {
          if (path.parentPath.isMemberExpression()) {
            let parent = path.parentPath.parentPath;
            if (parent.parentPath.isSequenceExpression() && parent.parent.expressions.length === 1) {
              parent.parentPath.remove();
            } else if (!parent.removed) {
              parent.remove();
            }
          } else if (path.isAssignmentExpression()) {
            path.remove();
          }
        });

      scope.removeBinding(name);
      removed = true;
    });
  } while (removed);
}

module.exports = treeShake;

// Check if a binding is safe to remove and returns it if it is.
function getUnusedBinding(path, name) {
  let binding = path.scope.getBinding(name);

  if (isPure(binding)) {
    return binding;
  }

  if (!EXPORTS_RE.test(name)) {
    return null;
  }

  // Is there any references which aren't simple assignments?
  let bailout = binding.referencePaths.some(
    path => !isExportAssignment(path) && !isUnusedWildcard(path)
  );

  if (bailout) {
    return null;
  } else {
    return binding;
  }

  function isPure(binding) {
    if (binding.referenced) {
      return false;
    }

    if (binding.path.isVariableDeclarator() && binding.path.get('id').isIdentifier()) {
      let init = binding.path.get('init');
      return init.isPure() || init.isIdentifier() || init.isThisExpression();
    }

    return binding.path.isPure();
  }

  function isExportAssignment(path) {
    return (
      // match "path.any = any;"
      path.parentPath.isMemberExpression() &&
      path.parentPath.parentPath.isAssignmentExpression() &&
      path.parentPath.parentPath.node.left === path.parentPath.node
    );
  }

  function isUnusedWildcard(path) {
    let {parent, parentPath} = path;

    return (
      // match "var $id$exports = $parcel$exportWildcard(any, path);"
      t.isCallExpression(parent) &&
      t.isIdentifier(parent.callee, {name: '$parcel$exportWildcard'}) &&
      parent.arguments[1] === path.node &&
      parentPath.parentPath.isVariableDeclarator() &&
      // check if the $id$exports variable is used
      getUnusedBinding(path, parentPath.parent.id.name) !== null
    );
  }
}