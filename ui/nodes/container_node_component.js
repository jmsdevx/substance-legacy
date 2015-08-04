"use strict";

var OO = require('../../basics/oo');
var Component = require('../component');
var $$ = Component.$$;
var UnsupporedNode = require('./unsupported_node');
var Surface = require('../../surface');

function ContainerNodeComponent() {
  Component.apply(this, arguments);
}

ContainerNodeComponent.Prototype = function() {

  this.getChildContext = function() {
    return { surface: this.surface };
  };

  this.render = function() {
    var props = {
      classNames: "container-node " + this.props.node.id,
      spellCheck: false,
      "data-id": this.props.node.id,
      contentEditable: this.props.contentEditable,
    };
    return $$("div", props, this.renderComponents());
  };

  this.renderComponents = function() {
    var doc = this.props.doc;
    var containerNode = this.props.node;
    var componentRegistry = this.context.componentRegistry;
    return containerNode.nodes.map(function(nodeId) {
      var node = doc.get(nodeId);
      var ComponentClass = componentRegistry.get(node.type);
      if (!ComponentClass) {
        console.error('Could not resolve a component for type: ' + node.type);
        ComponentClass = UnsupporedNode;
      }
      return $$(ComponentClass, {
        key: node.id,
        doc: doc,
        node: node
      });
    });
  };

  // this._render = function() {
  //   debugger;
  //   Component.prototype._render.apply(this, arguments);
  // };

  this.willReceiveProps = function(newProps) {
    if (this.props.doc && this.props.doc !== newProps.doc) {
      this.surface.detach();
    }
  };

  this.didReceiveProps = function() {
    var doc = this.props.doc;
    var editor = this.props.editor;
    var options = {
      name: this.props.node.id,
      logger: this.context.notifications
    };
    this.surface = new Surface(this.context.surfaceManager, doc, editor, options);
  };

  this.didMount = function() {
    this.props.doc.connect(this, {
      'document:changed': this.onDocumentChange
    });
    this.surface.attach(this.$el[0]);
  };

  this.willUnmount = function() {
    this.props.doc.disconnect(this);
    this.surface.detach();
  };

  this.onDocumentChange = function(change) {
    // TODO: update the DOM element incrementally
    if (change.isAffected([this.props.node.id, 'nodes'])) {
      this.rerender();
    }
  };

};

OO.inherit(ContainerNodeComponent, Component);

module.exports = ContainerNodeComponent;
