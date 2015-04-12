'use strict';

var Substance = require('../basics');
var PathAdapter = Substance.PathAdapter;

function DocumentChange(ops, before, after) {
  this.ops = ops.slice(0);
  this.before = before;
  this.after = after;
  this.updated= null;
  this._init();
  Object.freeze(this);
  Object.freeze(this.ops);
  Object.freeze(this.before);
  Object.freeze(this.after);
  Object.freeze(this.updated);
}

DocumentChange.Prototype = function() {

  this._init = function() {
    var ops = this.ops;
    var deletes = [];
    var updated = new PathAdapter.Arrays();
    var i;
    for (i = 0; i < ops.length; i++) {
      var op = ops[i];
      if (op.type === "delete") {
        deletes.push(op);
      }
      if (op.type === "set" || op.type === "update") {
        // The old as well the new one is affected
        updated.add(op.path, op);
      }
      // HACK: also register changes to 'path' so that a TextProperty reacts
      // to changes where an annotation is attached
      else if ((op.type === "create" || op.type === "delete") && op.val.path) {
        updated.add(op.val.path, op);
      }
      else if (op.type === "set" && op.path[1] === "path") {
        updated.add(op.val, op);
        updated.add(op.original, op);
      }
    }
    // Remove all updates for properties of nodes that got deleted
    // to prevent that an observer is triggered with no model available anymore.
    for (i = 0; i < deletes.length; i++) {
      var del = deletes[i];
      delete updated[del.val.id];
    }
    this.updated = updated;
  };

  this.isAffected = function(path) {
    var ops = this.updated.get(path);
    return ops && ops.length > 0;
  };

  this.invert = function() {
    var ops = [];
    for (var i = this.ops.length - 1; i >= 0; i--) {
      ops.push(this.ops[i].invert());
    }
    var before = this.after;
    var after = this.before;
    return new DocumentChange(ops, before, after);
  };

  this.traverse = function(fn, ctx) {
    this.updated.traverse(function() {
      fn.apply(ctx, arguments);
    });
  };

};

Substance.initClass(DocumentChange);

module.exports = DocumentChange;
