'use strict';

var OO = require('../../basics/oo');
var Component = require('../Component');
var UnsupportedNode = require('./unsupported_node');
var $$ = Component.$$;

function IncludeComponent() {
  Component.apply(this, arguments);
}

IncludeComponent.Prototype = function() {

  this.render = function() {
    var doc = this.props.doc;
    var node = doc.get(this.props.node.nodeId);
    var componentRegistry = this.context.componentRegistry;
    var ComponentClass = componentRegistry.get(node.type);
    if (!ComponentClass) {
      console.error('Could not resolve a component for type: ' + node.type);
      ComponentClass = UnsupportedNode;
    }
    return $$(ComponentClass, {
      key: node.id,
      doc: doc,
      node: node
    });
  };
};

OO.inherit(IncludeComponent, Component);

module.exports = IncludeComponent;
