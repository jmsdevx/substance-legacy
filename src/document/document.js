'use strict';

var Substance = require('../basics');
var Data = require('../data');

var AnnotationIndex = require('./annotation_index');
var TransactionDocument = require('./transaction_document');
var DocumentChange = require('./document_change');

var NotifyByPath = require('./notify_by_path');

function Document( schema, seed ) {
  Substance.EventEmitter.call(this);

  this.schema = schema;
  this.data = new Data.IncrementalGraph(schema, {
    seed: seed,
    didCreateNode: Substance.bind(this._didCreateNode, this),
    didDeleteNode: Substance.bind(this._didDeleteNode, this),
  });

  this.annotationIndex = this.addIndex('annotations', new AnnotationIndex(this));

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
    'path': new NotifyByPath()
  };
}

Document.Prototype = function() {

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

  this.toJSON = function() {
    return {
      schema: [this.schema.name, this.schema.version],
      nodes: this.getNodes()
    };
  };

  // Document manipulation
  //
  // var tx = doc.startTransaction()
  // tx.create(...);
  // ...
  // tx.save();
  //
  // Note: there is no direct manipulation without transaction
  this.startTransaction = function() {
    if (this.isTransacting) {
      throw new Error('Nested transactions are not supported.');
    }
    this.isTransacting = true;
    // TODO: maybe we need to prepare the stage
    return this.stage;
  };

  this.create = function(nodeData) {
    if (this.isTransacting) {
      this.stage.create(nodeData);
    } else {
      this.data.create(nodeData);
    }
    return this.data.get(nodeData.id);
  };

  this.delete = function(nodeId) {
    if (this.isTransacting) {
      this.stage.delete(nodeId);
    } else {
      this.data.delete(nodeId);
    }
  };

  this.set = function(path, value) {
    if (this.isTransacting) {
      this.stage.set(path, value);
    } else {
      this.data.set(path, value);
    }
  };

  this.update = function(path, diff) {
    if (this.isTransacting) {
      this.stage.update(path, diff);
    } else {
      this.data.update(path, diff);
    }
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

  this.finishTransaction = function(data, info) {
    if (!this.isTransacting) {
      throw new Error('Not in a transaction.');
    }
    info = info || {};

    // TODO: notify external listeners
    this.isTransacting = false;
    var ops = this.stage.getOperations();
    var documentChange = new DocumentChange(ops, data);
    this.undone = [];

    info.skipStage = true;
    this.apply(documentChange, info);
  };

  this.apply = function(documentChange, info) {
    if (this.isTransacting) {
      throw new Error('Can not replay a document change during transaction.');
    }
    info = info || {};
    // Note: we apply everything doubled, to keep the staging clone up2date.
    if (!info.skipStage) {
      this.stage.apply(documentChange);
    }
    Substance.each(documentChange.ops, function(op) {
      this.data.apply(op);
    }, this);
    this.done.push(documentChange);

    Substance.each(this.eventProxies, function(proxy) {
      proxy.onDocumentChanged(documentChange, info);
    });

    this.emit('document:changed', documentChange, info);
  };

  this.getEventProxy = function(name) {
    return this.eventProxies[name];
  };

};

Substance.inherit(Document, Substance.EventEmitter);

module.exports = Document;
