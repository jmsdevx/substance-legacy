'use strict';

var Substance = require('../basics');
var Document = require('../document');
var Selection = Document.Selection;
var Annotations = Document.AnnotationUpdates;

function FormEditor(doc) {
  this.document = doc;
  this.selection = Document.nullSelection;
}

FormEditor.Prototype = function() {

  this.isContainerEditor = function() {
    return false;
  };

  this.getContainer = function() {
    return null;
  };

  this.setContainer = function() {};

  this.getDocument = function() {
    return this.document;
  };

  this.insertText = function(textInput, selection, info) {
    // console.log("Inserting text: '%s' at %s", textInput, selection.toString());
    var tx = this.document.startTransaction({ selection: selection });
    tx.selection = selection;
    try {
      if (!this.selection.isCollapsed()) {
        this._delete(tx, 'right');
      }
      var range = tx.selection.getRange();
      tx.update(range.start.path, { insert: { offset: range.start.offset, value: textInput } } );
      Annotations.insertedText(tx, range.start, textInput.length);
      tx.selection = Selection.create(range.start.path, range.start.offset + textInput.length);
      tx.save({ selection: tx.selection }, info);
      this.selection = tx.selection;
    } finally {
      tx.cleanup();
    }
  };

  // implements backspace and delete
  this.delete = function(selection, direction, info) {
    var tx = this.document.startTransaction({ selection: selection });
    tx.selection = selection;
    try {
      this._delete(tx, direction);
      tx.save({ selection: tx.selection }, info);
      this.selection = tx.selection;
    } finally {
      tx.cleanup();
    }
  };

  // Selecting all in FormEditor selects the current property.
  this.selectAll = function() {
    var sel = this.selection;
    if (sel.isNull()) return;
    if (sel.isPropertySelection()) {
      var path = sel.start.path;
      var text = this.document.get(path);
      this.selection = Selection.create(path, 0, text.length);
    }
  };

  this._delete = function(tx, direction) {
    var selection = tx.selection;
    var range = selection.getRange();
    var startChar, endChar;
    // if collapsed see if we are at the start or the end
    // and try to merge
    if (selection.isCollapsed()) {
      var prop = this.document.get(range.start.path);
      if ((range.start.offset === 0 && direction === 'left') ||
          (range.start.offset === prop.length && direction === 'right')) {
        this._merge(tx, range.start.path, direction);
      } else {
        // simple delete one character
        startChar = (direction === 'left') ? range.start.offset-1 : range.start.offset;
        endChar = startChar+1;
        tx.update(range.start.path, {
          delete: { start: startChar, end: endChar }
        });
        Annotations.deletedText(tx, range.start.path, startChar, endChar);
        tx.selection = Document.Selection.create(range.start.path, startChar);
      }
    } else if (selection.isPropertySelection()) {
      this._deleteProperty(tx, range.start.path, range.start.offset, range.end.offset);
      tx.selection = Document.Selection.create(range.start);
    } else {
      // deal with container deletes
      this._deleteContainerSelection(tx, direction);
    }
  };

  this._deleteProperty = function(tx, path, startOffset, endOffset) {
    // if a property selection but not collapsed
    // simply delete the selected area
    tx.update(path, {
      delete: { start: startOffset, end: endOffset }
    });
    Annotations.deletedText(tx, path, startOffset, endOffset);
  };

  this._deleteContainerSelection = function(/*tx, direction*/) {
    console.info('Deleting ContainerSelections in form-editor is not supported.');
  };

  // no breaking
  this.break = function(selection/*, info*/) {
    // just update the selection
    this.selection = selection;
  };

  this.softBreak = function(selection, info) {
    this.insertText('\n', selection, info);
  };

  this.paste = function(selection, data) {
    // TODO: for now only plain text is inserted
    // We could do some stitching however, preserving the annotations
    // received in the document
    if (data.text) {
      this.insertText(data.text, selection);
    }
  };

  // no merging, just move cursor when pressing backspace
  /* jshint unused: false */
  this._merge = function(tx, path, dir) {
    // not possible
  };

};

Substance.initClass(FormEditor);

module.exports = FormEditor;