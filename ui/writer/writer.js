"use strict";

var OO = require('../../basics/oo');
var Component = require('../component');
var $$ = Component.$$;

var _ = require("../../basics/helpers");
var EventEmitter = require('../../basics/event_emitter');
var Registry = require('../../basics/registry');
var SurfaceManager = require('../../surface/surface_manager');
var Clipboard = require('../../surface/clipboard');
var ToolRegistry = require('../../surface/tool_registry');

var ExtensionManager = require('./extension_manager');
var ContextToggles = require('./context_toggles');
var ContentPanel = require("./content_panel");
var StatusBar = require("./status_bar");
var ModalPanel = require('./modal_panel');

// TODO: re-establish a means to set which tools are enabled for which surface

function Writer() {
  Component.apply(this, arguments);
  // Mixin
  EventEmitter.call(this);

  this.config = this.props.config || {};

  this.handleApplicationKeyCombos = this.handleApplicationKeyCombos.bind(this);
  this.onSelectionChangedDebounced = _.debounce(this.onSelectionChanged, 50);

  this._registerExtensions();
  this._initializeComponentRegistry();
  this._initializeToolRegistry();
}

Writer.Prototype = function() {

  // mix-in
  _.extend(this, EventEmitter.prototype);

  this.getChildContext = function() {
    return {
      getHighlightedNodes: this.getHighlightedNodes,
      getHighlightsForTextProperty: this.getHighlightsForTextProperty,
      componentRegistry: this.componentRegistry,
      toolRegistry: this.toolRegistry,
      surfaceManager: this.surfaceManager
    };
  };

  this.getInitialState = function() {
    return {"contextId": this.props.contextId || "toc"};
  };

  this.render = function() {
    var el = $$('div')
      .addClass('writer-component');
    if (!this.props.doc) {
      el.append($$('div').append('Loading'));
    } else {
      var doc = this.props.doc;
      var ContentToolbar = this.componentRegistry.get('content_toolbar');
      // main container
      el.append(
        $$('div').key('main-container').addClass("main-container").append(
          $$(ContentToolbar).key('toolbar'),
          $$(ContentPanel).key('content').addProps({
            doc: doc,
            containerId: this.config.containerId
          })
        )
      );
      // resource container
      el.append(
        $$('div').key('resource-container').addClass("resource-container").append(
          $$(ContextToggles).key("context-toggles").addProps({
            panelOrder: this.config.panelOrder
          }),
          this.renderContextPanel()
        )
      );
      // modal panel
      el.append(
        this.renderModalPanel()
      );
      // status bar
      el.append(
        $$(StatusBar).key('statusBar').addProps({ doc: doc })
      );
      // clipboard
      el.append(
        $$('div').key('clipboard').addClass("clipboard")
      );
    }
    return el;
  };

  this.renderModalPanel = function() {
    var modalPanelElement = this._getActiveModalPanelElement();
    if (!modalPanelElement) {
      // Just render an empty div if no modal active available
      return $$('div');
    } else {
      return $$(ModalPanel).key('modal-panel').addProps({
        panelElement: modalPanelElement
      });
    }
  };

  this.renderContextPanel = function() {
    var panelElement = this._getActivePanelElement();
    if (!panelElement) {
      return $$('div').append("No panels are registered");
    } else {
      return $$('div').key('context-panel').append(panelElement);
    }
  };

  this.willReceiveProps = function(newProps) {
    if (this.props.doc && newProps.doc !== this.props.doc) {
      this._disposeDoc();
    }
  };

  this.didReceiveProps = function() {
    if (this.props.doc) {
      var doc = this.props.doc;
      this.surfaceManager = new SurfaceManager(doc);
      this.clipboard = new Clipboard(this.surfaceManager, doc.getClipboardImporter(), doc.getClipboardExporter());
      doc.connect(this, {
        'transaction:started': this.transactionStarted,
        'document:changed': this.onDocumentChanged
      });
    }
  };

  this.willUpdateState = function(newState) {
    this.extensionManager.handleStateChange(newState, this.state);
  };

  this.didMount = function() {
    this.$el.on('keydown', this.handleApplicationKeyCombos);
  };

  this.willUnmount = function() {
    this.$el.off('keydown');
    if (this.props.doc) {
      this._disposeDoc();
    }
  };

  this.getDocument = function() {
    return this.props.doc;
  };

  // Event handlers
  // --------------

  // return true when you handled a key combo
  this.handleApplicationKeyCombos = function(e) {
    // console.log('####', e.keyCode, e.metaKey, e.ctrlKey, e.shiftKey);
    var handled = false;
    // TODO: we could make this configurable via extensions
    // Undo/Redo: cmd+z, cmd+shift+z
    if (e.keyCode === 90 && (e.metaKey||e.ctrlKey)) {
      if (e.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      handled = true;
    }
    // Reset to default state
    else if (e.keyCode === 27) {
      this.setState(this.getInitialState());
      handled = true;
    }
    // Save: cmd+s
    else if (e.keyCode === 83 && (e.metaKey||e.ctrlKey)) {
      this.requestSave();
      handled = true;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // FIXME: even if this seems to be very hacky,
  // it is quite useful to make transactions 'app-compatible'
  this.transactionStarted = function(tx) {
    // // store the state so that it can be recovered when undo/redo
    // tx.before.state = this.state;
    // tx.before.selection = this.getSelection();
  };

  this.onDocumentChanged = function(change, info) {
    var doc = this.getDocument();
    doc.__dirty = true;
    var notifications = this.context.notifications;
    notifications.addMessage({
      type: "info",
      message: "Unsaved changes"
    });
    // after undo/redo, also recover the stored writer state
    if (info.replay && change.after.state) {
      this.setState(change.after.state);
    }
  };

  this.onSelectionChanged = function(sel, surface) {
    this.extensionManager.handleSelectionChange(sel);
    this.toolRegistry.each(function(tool) {
      tool.update(surface, sel);
    }, this);
    this.emit('selection:changed', sel);
  };

  // Action handlers
  // ---------------

  this.switchContext = function(contextId) {
    this.setState({ contextId: contextId });
  };

  this.executeAction = function(actionName) {
    return this.extensionManager.handleAction(actionName);
  };

  this.closeModal = function() {
    var newState = _.cloneDeep(this.state);
    delete newState.modal;
    this.setState(newState);
  };

  this.saveDocument = function() {
    var doc = this.props.doc;
    var backend = this.context.backend;
    var notifications = this.context.notifications;
    if (doc.__dirty && !doc.__isSaving) {
      notifications.addMessage({
        type: "info",
        message: "Saving ..."
      });

      doc.__isSaving = true;
      backend.saveDocument(doc, function(err) {
        doc.__isSaving = false;
        if (err) {
          notifications.addMessage({
            type: "error",
            message: err.message || err.toString()
          });
        } else {
          doc.emit('document:saved');
          notifications.addMessage({
            type: "info",
            message: "No changes"
          });
          doc.__dirty = false;
        }
      });
    }
  };

  // TODO: this is a duplicate of this.executeAction()... which one?
  this.handleAction = function(actionName) {
    this.extensionManager.handleAction(actionName);
  };

  this.handleCloseDialog = function(e) {
    e.preventDefault();
    console.log('handling close');
    this.setState(this.getInitialState());
  };


  // Internal Methods
  // ----------------------

  this._registerExtensions = function() {
    // Note: we are treating basics as extension internally
    var config = this.config;
    var basics = {
      name: "_basics",
      components: this.config.components || {},
      stateHandlers: config.stateHandlers || {},
      tools: config.tools || []
    };
    var extensions = [basics];
    if (config.extensions) {
      extensions = extensions.concat(config.extensions);
    }
    this.extensionManager = new ExtensionManager(extensions, this);
  };

  this._initializeComponentRegistry = function() {
    var componentRegistry = new Registry();
    _.each(this.extensionManager.extensions, function(extension) {
      _.each(extension.components, function(ComponentClass, name) {
        componentRegistry.add(name, ComponentClass);
      });
    });
    this.componentRegistry = componentRegistry;
  };

  this._initializeToolRegistry = function() {
    var toolRegistry = new ToolRegistry();
    _.each(this.extensionManager.extensions, function(extension) {
      _.each(extension.tools, function(ToolClass, name) {
        // WARN: this could potentially get problematic, if React derives
        // the current context differently.
        var context = _.extend({}, this.context, this.getChildContext());
        toolRegistry.add(name, new ToolClass(context));
      }, this);
    }, this);
    this.toolRegistry = toolRegistry;
  };

  this._disposeDoc = function() {
    this.props.doc.disconnect(this);
    this.surfaceManager.dispose();
    this.clipboard.detach(this.$el[0]);
    this.surfaceManager.dispose();
    this.surfaceManager = null;
    this.clipboard = null;
  };

  this._panelPropsFromState = function (state) {
    var props = _.omit(state, 'contextId');
    props.doc = this.props.doc;
    return props;
  };

  this._getActivePanelElement = function() {
    var panelComponent = this.componentRegistry.get(this.state.contextId);
    if (panelComponent) {
      return $$(panelComponent).addProps(this._panelPropsFromState(this.state));
    } else {
      console.warn("Could not find component for contextId:", this.state.contextId);
    }
  };

  this._getActiveModalPanelElement = function() {
    var state = this.state;
    if (state.modal) {
      var modalPanelComponent = this.componentRegistry.get(state.modal.contextId);
      if (modalPanelComponent) {
        return $$(modalPanelComponent).addProps(this._panelPropsFromState(state.modal));
      } else {
        console.warn("Could not find component for contextId:", state.modal.contextId);
      }
    }
  };
};

OO.inherit(Writer, Component);

module.exports = Writer;
