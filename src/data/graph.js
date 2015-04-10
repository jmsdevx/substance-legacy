'use strict';

var Substance = require('../basics');
var PathAdapter = Substance.PathAdapter;
var EventEmitter = Substance.EventEmitter;

function Graph(schema, options) {
  EventEmitter.call(this);

  options = options || {};

  this.schema = schema;

  this.seed = options.seed;
  this.didCreateNode = options.didCreateNode || function() {};
  this.didDeleteNode = options.didDeleteNode || function() {};

  this.nodes = {};
  this.indexes = {};

  this.init();
}

Graph.Prototype = function() {

  this.get = function(path) {
    if (!path) {
      throw new Error('Path or id required');
    }
    return this.nodes.get(path);
  };

  this.getNodes = function() {
    return this.nodes;
  };

  this.create = function(nodeData) {
    var node = this.schema.getNodeFactory().create(nodeData.type, nodeData);
    if (!node) {
      throw new Error('Illegal argument: could not create node for data:', nodeData);
    }
    if (this.contains(node.id)) {
      throw new Error("Node already exists: " + node.id);
    }
    if (!node.id || !node.type) {
      throw new Error("Node id and type are mandatory.");
    }
    this.nodes[node.id] = node;
    this.didCreateNode(node);
    Substance.each(this.indexes, function(index) {
      if (index.select(node)) {
        index.create(node);
      }
    });
    return node;
  };

  this.delete = function(nodeOrId) {
    var node, nodeId;
    if (Substance.isString(nodeOrId)) {
      nodeId = nodeOrId;
      node = this.nodes[nodeId];
    } else {
      node = nodeOrId;
      nodeId = node.id;
    }
    delete this.nodes[nodeId];
    this.didDeleteNode(node);
    Substance.each(this.indexes, function(index) {
      if (index.select(node)) {
        index.delete(node);
      }
    });
    return node;
  };

  this.set = function(path, newValue) {
    var node = this.get(path[0]);
    var oldValue = this.nodes.get(path);
    this.nodes.set(path, newValue);
    Substance.each(this.indexes, function(index) {
      if (index.select(node)) {
        index.update(node, path, newValue, oldValue);
      }
    });
    return oldValue;
  };

  // TODO: it does not make too much sense to use this incremental method
  // on the non-incremental graph
  // We leave it here so that the two versions are compatible API-wise
  this.update = function(path, diff) {
    var oldValue = this.nodes.get(path);
    var newValue;
    if (diff.isOperation) {
      newValue = diff.apply(oldValue);
    } else {
      var start, end, pos, val;
      if (Substance.isString(oldValue)) {
        if (diff['delete']) {
          // { delete: [2, 5] }
          start = diff['delete'].start;
          end = diff['delete'].end;
          newValue = oldValue.split('').splice(start, end-start).join('');
        } else if (diff['insert']) {
          // { insert: [2, "foo"] }
          pos = diff['insert'].offset;
          val = diff['insert'].value;
          newValue = [oldValue.substring(0, pos), val, oldValue.substring(pos)].join('');
        } else {
          throw new Error('Diff is not supported:', JSON.stringify(diff));
        }
      } else if (Substance.isArray(oldValue)) {
        newValue = oldValue.slice(0);
        if (diff['delete']) {
          // { delete: 2 }
          pos = diff['delete'].offset;
          newValue.splice(pos, 1);
        } else if (diff['insert']) {
          // { insert: [2, "foo"] }
          pos = diff['insert'].offset;
          val = diff['insert'].value;
          newValue.splice(pos, 0, val);
        } else {
          throw new Error('Diff is not supported:', JSON.stringify(diff));
        }
      } else {
        throw new Error('Diff is not supported:', JSON.stringify(diff));
      }
    }

    this.nodes.set(path, newValue);
    var node = this.get(path[0]);
    Substance.each(this.indexes, function(index) {
      if (index.select(node)) {
        index.update(node, path, oldValue, newValue);
      }
    });
    return oldValue;
  };

  this.toJSON = function() {
    return {
      schema: [this.schema.id, this.schema.version],
      nodes: Substance.deepclone(this.nodes)
    };
  };

  this.contains = function(id) {
    return (!!this.nodes[id]);
  };

  this.reset = function() {
    this.init();
  };

  // Graph initialization.
  this.init = function() {
    this.nodes = new PathAdapter();
    if (this.seed) {
      var nodes = this.seed.nodes;
      Substance.each(nodes, function(nodeData) {
        this.create(nodeData);
      }, this);
    }
  };

  this.addIndex = function(name, index) {
    if (this.indexes[name]) {
      console.error('Index with name %s already exists.', name);
    }
    index.setGraph(this);
    index.initialize();
    this.indexes[name] = index;
    return index;
  };

  this.getIndex = function(name) {
    return this.indexes[name];
  };


};

Substance.inherit(Graph, EventEmitter);

module.exports = Graph;
