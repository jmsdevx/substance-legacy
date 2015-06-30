'use strict';

var _ = require('../basics/helpers');
var Substance = require('../basics');
var Data = require('../data');

var AnnotationIndex = require('./annotation_index');
var ContainerAnnotationIndex = require('./container_annotation_index');

var TransactionDocument = require('./transaction_document');
var DocumentChange = require('./document_change');

var NotifyPropertyChange = require('./notify_property_change');
var Selection = require('./selection');
var PropertySelection = require('./property_selection');
var ContainerSelection = require('./container_selection');
var TableSelection = require('./table_selection');
var ClipboardImporter = require('./clipboard_importer');
var ClipboardExporter = require('./clipboard_exporter');

function Document(schema) {
  Substance.EventEmitter.call(this);

  this.schema = schema;

  this.data = new Data.Incremental(schema, {
    didCreateNode: _.bind(this._didCreateNode, this),
    didDeleteNode: _.bind(this._didDeleteNode, this),
  });

  // all by type
  this.nodeIndex = this.addIndex('type', Data.Index.create({
    property: "type"
  }));
  // special index for (property-scoped) annotations
  this.annotationIndex = this.addIndex('annotations', new AnnotationIndex());

  // special index for (contaoiner-scoped) annotations
  this.containerAnnotationIndex = this.addIndex('container-annotations', new ContainerAnnotationIndex());

  // the stage is a essentially a clone of this document
  // used to apply a sequence of document operations
  // without touching this document
  this.stage = new TransactionDocument(this);
  this.isTransacting = false;

  this.done = [];
  this.undone = [];

  // change event proxies are triggered after a document change has been applied
  // before the regular document:changed event is fired.
  // They serve the purpose of making the event notification more efficient
  // In earlier days all observers such as node views where listening on the same event 'operation:applied'.
  // This did not scale with increasing number of nodes, as on every operation all listeners where notified.
  // The proxies filter the document change by interest and then only notify a small set of observers.
  // Example: NotifyByPath notifies only observers which are interested in changes to a certain path.
  this.eventProxies = {
    'path': new NotifyPropertyChange(this),
  };

  this.initialize();

  // CONTRACT: containers should be added in this.initialize()
  this.containers = this.getIndex('type').get('container');
}

Document.Prototype = function() {

  this.isTransaction = function() {
    return false;
  };

  this.newInstance = function() {
    return new Document(this.schema);
  };

  this.initialize = function() {
    // add things to the document, such as containers etc.
  };

  this.loadSeed = function(seed) {
    _.each(seed.nodes, function(nodeData) {
      var id = nodeData.id;
      if (this.get(id)) {
        this.delete(id);
      }
      this.create(nodeData);
    }, this);
    _.each(this.getIndex('type').get('container'), function(container) {
      container.reset();
    });
    this.stage.reset();
    this.documentDidLoad();
  };

  this.documentDidLoad = function() {};

  this.fromSnapshot = function(data) {
    var doc = this.newInstance();
    doc.loadSeed(data);
    return doc;
  };

  this.getSchema = function() {
    return this.schema;
  };

  this.get = function(path) {
    return this.data.get(path);
  };

  this.getNodes = function() {
    return this.data.getNodes();
  };

  this.addIndex = function(name, index) {
    return this.data.addIndex(name, index);
  };

  this.getIndex = function(name) {
    return this.data.getIndex(name);
  };

  this.getEventProxy = function(name) {
    return this.eventProxies[name];
  };

  this.getTextForSelection = function(sel) {
    var result = [];
    var text;
    if (!sel || sel.isNull()) {
      return "";
    } else if (sel.isPropertySelection()) {
      text = this.get(sel.start.path);
      result.push(text.substring(sel.start.offset, sel.end.offset));
    } else if (sel.isContainerSelection()) {
      var container = this.get(sel.container.id);
      var components = container.getComponentsForRange(sel.range);
      for (var i = 0; i < components.length; i++) {
        var comp = components[i];
        text = this.get(comp.path);
        if (components.length === 1) {
          result.push(text.substring(sel.start.offset, sel.end.offset));
        } else if (i===0) {
          result.push(text.substring(sel.start.offset));
        } else if (i===components.length-1) {
          result.push(text.substring(0, sel.end.offset));
        } else {
          result.push(text);
        }
      }
    }
    return result.join('');
  };

  this.toJSON = function() {
    var nodes = {};
    _.each(this.getNodes(), function(node) {
      nodes[node.id] = node.toJSON();
    });
    return {
      schema: [this.schema.name, this.schema.version],
      nodes: nodes
    };
  };

  // Document manipulation
  //

  /**
   * @param beforeState object which will be used as before start of transaction
   * @param eventData object which will be used as payload for the emitted change event
   * @param transformation a function(tx) that performs actions on the transaction document tx
   *
   * @example
   * ```
   *   doc.transaction({ selection: sel }, {'event-hack': true}, function(tx, args) {
   *     tx.update(...);
   *     ...
   *     return {
   *       selection: newSelection
   *     };
   *   })
   * ```
   */
  this.transaction = function(beforeState, eventData, transformation) {
    if (arguments.length === 2) {
      transformation = arguments[1];
      eventData = {};
    } else {
      eventData = eventData || {};
    }
    if (!_.isFunction(transformation)) {
      throw new Error('Document.transaction() requires a transformation function.');
    }
    // var time = Date.now();
    // HACK: ATM we can't deep clone as we do not have a deserialization
    // for selections.
    var tx = this.startTransaction(_.clone(beforeState));
    // console.log('Starting the transaction took', Date.now() - time);
    try {
      // time = Date.now();
      var result = transformation(tx);
      // console.log('Executing the transformation took', Date.now() - time);
      var afterState = {};
      // only keys that are in the beforeState can be in the afterState
      // TODO: maybe this is to sharp?
      // we could also just merge the transformation result with beforeState
      // but then we might have non-state related information in the after state.
      for (var key in beforeState) {
        if (result[key]) {
          afterState[key] = result[key];
        } else {
          afterState[key] = beforeState[key];
        }
      }
      // save automatically if not yet saved or cancelled
      if (this.isTransacting) {
        tx.save(afterState, eventData);
      }
    } finally {
      tx.finish();
    }
  };

  this.startTransaction = function(beforeState) {
    if (this.isTransacting) {
      throw new Error('Nested transactions are not supported.');
    }
    this.isTransacting = true;
    // TODO: maybe we need to prepare the stage
    this.stage.before = beforeState || {};
    this.emit('transaction:started', this.stage);
    return this.stage;
  };

  this.create = function(nodeData) {
    if (this.isTransacting) {
      this.stage.create(nodeData);
    } else {
      this.stage.create(nodeData);
      var op = this.data.create(nodeData);
      this._updateContainers(op);
    }
    return this.data.get(nodeData.id);
  };

  this.delete = function(nodeId) {
    if (this.isTransacting) {
      this.stage.delete(nodeId);
    } else {
      this.stage.delete(nodeId);
      var op = this.data.delete(nodeId);
      this._updateContainers(op);
    }
  };

  this.set = function(path, value) {
    if (this.isTransacting) {
      this.stage.set(path, value);
    } else {
      this.stage.set(path, value);
      var op = this.data.set(path, value);
      this._updateContainers(op);
    }
  };

  this.setText = function(path, text, annotations) {
    var idx;
    var oldAnnos = this.getIndex('annotations').get(path);
    // TODO: what to do with container annotations
    for (idx = 0; idx < oldAnnos.length; idx++) {
      this.delete(oldAnnos[idx].id);
    }
    this.set(path, text);
    for (idx = 0; idx < annotations.length; idx++) {
      this.create(annotations[idx]);
    }
  };

  this.update = function(path, diff) {
    if (this.isTransacting) {
      this.stage.update(path, diff);
    } else {
      this.stage.update(path, diff);
      var op = this.data.update(path, diff);
      this._updateContainers(op);
    }
  };

  this.undo = function() {
    var change = this.done.pop();
    if (change) {
      var inverted = change.invert();
      this._apply(inverted);
      this.undone.push(inverted);
      this._notifyChangeListeners(inverted, { 'replay': true });
    } else {
      console.error('No change can be undone.');
    }
  };

  this.redo = function() {
    var change = this.undone.pop();
    if (change) {
      var inverted = change.invert();
      this._apply(inverted);
      this.done.push(inverted);
      this._notifyChangeListeners(inverted, { 'replay': true });
    } else {
      console.error('No change can be redone.');
    }
  };

  // sel: PropertySelection
  // options:
  //   container: container instance
  //   type: string (annotation type filter)
  //
  // WARNING: Returns an empty array when selection is a container selection
  this.getAnnotationsForSelection = function(sel, options) {
    options = options || {};
    var annotations;
    var path, startOffset, endOffset;

    if (sel.isPropertySelection()) {
      path = sel.getPath();
      startOffset = sel.getStartOffset();
      endOffset = sel.getEndOffset();
    } else {
      return [];
    }
    annotations = this.annotationIndex.get(path, startOffset, endOffset);
    if (options.type) {
      annotations = _.filter(annotations, AnnotationIndex.filterByType(options.type));
    }
    return annotations;
  };

  // Attention: looking for container annotations is not as efficient
  // as property selections, as we do not have an index that has
  // notion of the spatial extend of an annotation
  // (which would depend on a model-side implementation of Container).
  // Opposed to that, common annotations are bound to properties which make it easy to lookup.
  this.getContainerAnnotationsForSelection = function(sel, container, options) {
    if (!container) {
      // Fail more silently
      return [];
      // throw new Error('Container required.');
    }
    var annotations;
    // Also look for container annotations if a Container instance is given
    if (options.type) {
      annotations = this.getIndex('type').get(options.type);
    } else {
      annotations = this.getIndex('container-annotations').byId;
    }
    annotations = _.filter(annotations, function(anno) {
      var annoSel = anno.getSelection();
      return sel.overlaps(annoSel);
    });
    return annotations;
  };

  this.getDocumentMeta = function() {
    return this.get('document');
  };

  /**
   * Creates a selection which is attached to this document.
   * Every selection implementation provides its own
   * parameter format which is basically a JSON representation.
   *
   * @param an object describing the selection.
   * @example
   *   doc.createSelection({
   *     type: 'property',
   *     path: [ 'text1', 'content'],
   *     startOffset: 10,
   *     endOffset: 20
   *   })
   */
  this.createSelection = function(sel) {
    if (!sel) {
      return Selection.nullSelection;
    }
    switch(sel.type) {
      case 'property':
        return new PropertySelection(sel).attach(this);
      case 'container':
        return new ContainerSelection(sel).attach(this);
      case 'table':
        return new TableSelection(sel).attach(this);
      default:
        throw new Error('Unsupported selection type', sel.type);
    }
  };

  this.getClipboardImporter = function() {
    return new ClipboardImporter();
  };

  this.getClipboardExporter = function() {
    return new ClipboardExporter();
  };

  // Called back by Substance.Data after a node instance has been created
  this._didCreateNode = function(node) {
    // create the node from schema
    node.attach(this);
  };

  this._didDeleteNode = function(node) {
    // create the node from schema
    node.detach(this);
  };

  this._saveTransaction = function(beforeState, afterState, info) {
    // var time = Date.now();
    if (!this.isTransacting) {
      throw new Error('Not in a transaction.');
    }
    this.isTransacting = false;
    var ops = this.stage.getOperations();
    var documentChange = new DocumentChange(ops, beforeState, afterState);
    // apply the change
    this._apply(documentChange, 'skipStage');
    // push to undo queue and wipe the redo queue
    this.done.push(documentChange);
    this.undone = [];
    // console.log('Document._saveTransaction took %s ms', (Date.now() - time));
    // time = Date.now();
    this._notifyChangeListeners(documentChange, info);
    // console.log('Notifying change listener took %s ms', (Date.now() - time));
  };

  this._cancelTransaction = function() {
    if (!this.isTransacting) {
      throw new Error('Not in a transaction.');
    }
    this.isTransacting = false;
  };

  this._updateContainers = function(op) {
    var containers = this.containers;
    _.each(containers, function(container) {
      container.update(op);
    });
  };


  this._apply = function(documentChange, mode) {
    if (this.isTransacting) {
      throw new Error('Can not replay a document change during transaction.');
    }
    // Note: we apply everything doubled, to keep the staging clone up2date.
    if (mode !== 'skipStage') {
      this.stage.apply(documentChange);
    }
    _.each(documentChange.ops, function(op) {
      this.data.apply(op);
      this._updateContainers(op);
    }, this);
  };

  this._notifyChangeListeners = function(documentChange, info) {
    info = info || {};
    _.each(this.eventProxies, function(proxy) {
      proxy.onDocumentChanged(documentChange, info);
    });
    this.emit('document:changed', documentChange, info);
  };

};

Substance.inherit(Document, Substance.EventEmitter);

Object.defineProperty(Document.prototype, 'id', {
  get: function() {
    return this.getDocumentMeta().guid;
  },
  set: function() {
    throw new Error("Id is an immutable property.");
  }
});

module.exports = Document;
