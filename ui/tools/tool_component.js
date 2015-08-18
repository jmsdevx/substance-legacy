'use strict';

var OO = require("../../basics/oo");
var Component = require('../component');
var $$ = Component.$$;
var Tool = require('../../surface/tool');

// ToolComponent
// -------------

function ToolComponent() {
  Component.apply(this, arguments);
}

ToolComponent.Prototype = function() {

  this.initialize = function() {
    this._initializeTool();
  };

  this.getInitialState = function() {
    // Derive initial state from tool
    return this.tool.state;
  };

  this.render = function() {
    var title = this.props.title;

    if (this.state.mode) {
      title += "("+this.state.mode+")";
    }

    var el = $$("button")
      .attr('title', title)
      .on('mousedown', this.onMouseDown)
      .on('click', this.onClick);
    if (this.state.disabled) {
      el.addClass('disabled');
    }
    if (this.state.active) {
      el.addClass('active');
    }
    if (this.state.mode) {
      el.addClass(this.state.mode);
    }

    el.append(this.props.children);
    return el;
  };

  this.didMount = function() {
    var toolName = this.props.tool;
    if (!toolName) {
      throw new Error('Prop "tool" is mandatory.');
    }
    this.tool = this.context.toolRegistry.get(toolName);
    if (!this.tool) {
      console.warn('No tool registered with name %s', toolName);
      this.tool = new ToolComponent.StubTool(toolName);
    }
    // Derive initial state from tool
    this.state = this.tool.state;
    this.tool.connect(this, {
      'toolstate:changed': this.onToolstateChanged
    });
  };

  this._initializeTool = function() {
    var toolName = this.props.tool;
    if (!toolName) {
      throw new Error('Prop "tool" is mandatory.');
    }
    this.tool = this.context.toolRegistry.get(toolName);
    if (!this.tool) {
      console.warn('No tool registered with name %s', toolName);
      this.tool = new ToolComponent.StubTool(toolName);
    }
    this.tool.connect(this, {
      'toolstate:changed': this.onToolstateChanged
    });
  };

  this.onToolstateChanged = function(toolState/*, tool, oldState*/) {
    this.setState(toolState);
  };

  this.onClick = function(e) {
    e.preventDefault();
  };

  this.onMouseDown = function(e) {
    e.preventDefault();
    if (this.state.disabled) {
      return;
    }
    this.tool.performAction();
  };
};

OO.inherit(ToolComponent, Component);

ToolComponent.StubTool = Tool.extend({

  init: function(name) {
    this.name = name;
  },

  performAction: function() {
    console.log('Stub-Tool %s', this.name);
  }
});

module.exports = ToolComponent;
