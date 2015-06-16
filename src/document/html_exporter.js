"use strict";

var Substance = require('../basics');
var Annotator = require('./annotator');

var inBrowser = (typeof window !== 'undefined');

function HtmlExporter(config) {
  this.config = config || {};
  this.state = null;
}

HtmlExporter.Prototype = function() {

  /**
   * @param doc Substance.Document instance
   * @param object options TODO: what options are available?
   * @return $element
   */
  this.convert = function(doc, options) {
    /* jshint unused:false */
    throw new Error('Method is abstract.');

    /**
      Example:

      this.initialize(doc, options);
      var body = doc.get('body');
      this.convertContainer(body);
      return this.state.$root;
    */
  };

  this.convertProperty = function(doc, path, options) {
    this.initialize(doc, options);
    var $wrapper = $('<div>')
      .append(this.annotatedText(path));
    return $wrapper.html();
  };

  this.initialize = function(doc, options) {
    options = {} || options;
    this.state =  {
      doc: doc,
      options: options
    };
  };

  this.convertNode = function(node) {
    return node.toHtml(this);
  };

  this.convertContainer = function(containerNode) {
    var state = this.state;
    var nodeIds = containerNode.nodes;
    var elements = [];
    for (var i = 0; i < nodeIds.length; i++) {
      var node = state.doc.get(nodeIds[i]);
      var $el = node.toHtml(this);
      if (!$el || !this.isElementNode($el[0])) {
        throw new Error('Contract: Node.toHtml() must return a DOM element. NodeType: '+node.type);
      }
      $el.attr('id', node.id);
      elements.push($el);
    }
    return elements
  };

  this.annotatedText = function(path) {
    var self = this;
    var doc = this.state.doc;
    var annotations = doc.getIndex('annotations').get(path);
    var text = doc.get(path);

    var annotator = new Annotator();
    annotator.onText = function(context, text) {
      context.children.push(text);
    };
    annotator.onEnter = function(entry) {
      var anno = entry.node;
      return {
        annotation: anno,
        children: []
      };
    };
    annotator.onExit = function(entry, context, parentContext) {
      var anno = context.annotation;
      var $el = anno.toHtml(self, context.children);
      if (!$el || !self.isElementNode($el[0])) {
        throw new Error('Contract: Annotation.toHtml() must return a DOM element.');
      }
      $el.attr('id', anno.id);
      parentContext.children.push($el);
    };
    var wrapper = { children: [] };
    annotator.start(wrapper, text, annotations);
    return wrapper.children;
  };

  this.isElementNode = function(el) {
    if (inBrowser) {
      return (el.nodeType === window.Node.ELEMENT_NODE);
    } else {
      return el.type === "tag";
    }
  };

  this.createDoc = function() {
    if (inBrowser) {
      var doc = window.document.implementation.createDocument ('http://www.w3.org/1999/xhtml', 'html', null);
      return $(doc);
    } else {
      // creating document using cheerio
      var EMPTY_DOC = '<!DOCTYPE html><html><head></head><body></body></html>';
      var $root = $.load(EMPTY_DOC).root();
      return $root;
    }
  };
};

Substance.initClass(HtmlExporter);

module.exports = HtmlExporter;
