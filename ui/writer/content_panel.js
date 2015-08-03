'use strict';

var _ = require('../../basics/helpers');
var OO = require('../../basics/oo');
var Component = require('../component');
var $$ = Component.$$;

var Panel = require("./panel");
var Scrollbar = require("./scrollbar");

function ContentPanel() {
  Panel.apply(this, arguments);
}

ContentPanel.Prototype = function() {

  this.render = function() {
    return $$('div', {classNames:"panel content-panel-component"},
      $$(Scrollbar, {
        key: "scrollbar",
        id: "content-scrollbar"
      }),
      $$('div', { key: "scanline", classNames: 'scanline' } ),
      $$('div', {
          key: "panelContent",
          classNames: "panel-content",
          style: {
            position: 'absolute',
            overflow: 'auto'
          }
        },
        this.renderContentEditor()
      )
    );
  };

  this.renderContentEditor = function() {
    var componentRegistry = this.context.componentRegistry;
    var doc = this.props.doc;
    var containerNode = doc.get(this.props.containerId);
    var ContentContainerClass = componentRegistry.get("content_editor");
    return $$(ContentContainerClass, {
      key: "contentEditor",
      doc: doc,
      node: containerNode
    });
  };

  // Since component gets rendered multiple times we need to update
  // the scrollbar and reattach the scroll event
  this.didMount = function() {
    this.updateScrollbar();
    $(window).on('resize', this.updateScrollbar);
    this.props.doc.connect(this, {
      'document:changed': this.onDocumentChange,
      'toc:entry-selected': this.onTocEntrySelected
    }, -1);
  };

  this.willUnmount = function() {
    $(window).off('resize');
    this.props.doc.disconnect(this);
  };

  this.onDocumentChange = function() {
    this.updateScrollbar();
  };

  this.onTocEntrySelected = function(nodeId) {
    this.scrollToNode(nodeId);
  };

  this.updateScrollbar = function() {
    var scrollbar = this.refs.scrollbar;
    var $panelContent = this.refs.panelContent.$el;
    // We need to await next repaint, otherwise dimensions will be wrong
    _.delay(function() {
      scrollbar.update($panelContent[0], this);
    }.bind(this),0);
    // (Re)-Bind scroll event on new panelContentEl
    $panelContent.off('scroll');
    $panelContent.on('scroll', this._onScroll);
  };

  this.onScroll = function() {
    var $panelContent = this.refs.panelContent.$el;
    this.refs.scrollbar.update($panelContent[0], this);
    this.markActiveTOCEntry();
  };

  this.markActiveTOCEntry = function() {
    var $panelContent = this.refs.panelContent.$el;

    var contentHeight = this.getContentHeight();
    var panelHeight = this.getPanelHeight();
    var scrollTop = this.getScrollPosition();

    var scrollBottom = scrollTop + panelHeight;

    var regularScanline = scrollTop;
    var smartScanline = 2 * scrollBottom - contentHeight;
    var scanline = Math.max(regularScanline, smartScanline);

    $('.scanline').css({
      top: (scanline - scrollTop)+'px'
    });
    // TODO: this should be generic
    var headings = $panelContent.find('.content-node.heading');
    if (headings.length === 0) return;
    // Use first heading as default
    var activeNode = _.first(headings).dataset.id;
    headings.each(function() {
      if (scanline >= $(this).position().top) {
        activeNode = this.dataset.id;
      }
    });

    var doc = this.getDocument();
    doc.emit('toc:entry-focused', activeNode);
  };
};

OO.inherit(ContentPanel, Panel);

module.exports = ContentPanel;
