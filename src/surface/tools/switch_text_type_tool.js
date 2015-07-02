'use strict';

var Tool = require('../tool');

var TEXT_NODE_TYPES = ["paragraph", "heading"];

var TEXT_TYPES = {
  "paragraph": {label: "paragraph", data: {type: "paragraph"}},
  "heading1": {label: "heading1", data: {type: "heading", level: 1}},
  "heading2": {label: "heading2", data: {type: "heading", level: 2}},
  "heading3": {label: "heading3", data: {type: "heading", level: 3}}
};

var TextTool = Tool.extend({

  name: "text",

  update: function(surface, sel) {
    this.surface = surface; // IMPORTANT!

    // Set disabled when not a property selection
    if (!surface.isEnabled() || sel.isNull() || !sel.isPropertySelection()) {
      return this.setDisabled();
    }

    var doc = this.getDocument();
    var path = sel.getPath();
    var node = doc.get(path[0]);
    var textType = this.getTextType(node);
    var parentNode = node.getRoot();
    var currentContext = this.getContext(parentNode, path);

    var newState = {
      surface: surface,
      sel: sel,
      disabled: !textType,
      currentTextType: textType,
      currentContext: currentContext,
    };

    this.setToolState(newState);
  },

  getAvailableTextTypes: function() {
    return TEXT_TYPES;
  },

  isTextType: function(type) {
    return TEXT_NODE_TYPES.indexOf(type) >= 0;
  },

  // Get text type for a given node
  getTextType: function(node) {
    if (this.isTextType(node.type)) {
      var textType = node.type;
      if (textType === "heading") {
        textType += node.level;
      }
      return textType;
    }
  },

  switchTextType: function(textTypeName) {
    var state = this.getToolState();
    if (this.isDisabled()) return;

    var textType = TEXT_TYPES[textTypeName];
    var surface = state.surface;
    var editor = surface.getEditor();
    editor.switchType(state.sel, textType.data);
  },

  getContext: function(parentNode, path) {
    if (parentNode.id === path[0]) {
      return path[1];
    } else {
      return parentNode.type;
    }
  },

});

module.exports = TextTool;