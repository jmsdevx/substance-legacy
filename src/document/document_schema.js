'use strict';

var Substance = require('../basics');
var Data = require('../data');

var Node = require('./node');
var Annotation = require('./annotation');
var Container = require('./container');
var ContainerAnnotation = require('./container_annotation');
var TextNode = require('./text_node');

function DocumentSchema(name, version) {
  DocumentSchema.super.call(this, name, version);
}

DocumentSchema.Prototype = function() {

  this.isAnnotationType = function(type) {
    var nodeClass = this.getNodeClass(type);
    return (nodeClass && nodeClass.prototype instanceof Annotation);
  };

  this.getBuiltIns = function() {
    return [ Node, Annotation, Container, ContainerAnnotation, TextNode ];
  };
};

Substance.inherit( DocumentSchema, Data.Schema );

module.exports = DocumentSchema;
