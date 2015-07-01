var Annotation = require('../annotation');

var Strong = Annotation.extend({
  name: "strong",

  // this means that it will annotate also when you have
  // selected multiple paragraphs, creating a single annotation
  // for every paragraph
  splitContainerSelections: true

});

Strong.static.tagName = 'strong';

Strong.static.matchElement = function($el) {
  return $el.is(Strong.static.tagName);
};

module.exports = Strong;