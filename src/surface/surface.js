'use strict';

var _ = require('../basics/helpers');
var Substance = require('../basics');
var SurfaceSelection = require('./surface_selection');
var Document = require('../document');
var SurfaceManager = require('./surface_manager');

var __id__ = 0;

function Surface(surfaceManager, doc, editor, options) {
  Substance.EventEmitter.call(this);

  options = options || {};

  this.__id__ = __id__++;
  this.name = options.name || __id__;
  this.doc = doc;
  this.surfaceManager = surfaceManager;

  this.selection = Document.nullSelection;

  // this.element must be set via surface.attach(element)
  this.element = null;
  this.$element = null;
  this.editor = editor;

  this.surfaceSelection = null;

  this.logger = options.logger || window.console;

  // TODO: VE make jquery injectable
  this.$ = $;
  this.$window = this.$( window );
  this.$document = this.$( window.document );

  this.dragging = false;

  this._onMouseUp = Substance.bind( this.onMouseUp, this );
  this._onMouseDown = Substance.bind( this.onMouseDown, this );
  this._onMouseMove = Substance.bind( this.onMouseMove, this );

  this._onKeyDown = Substance.bind(this.onKeyDown, this);
  this._onTextInput = Substance.bind(this.onTextInput, this);
  this._onTextInputShim = Substance.bind( this.onTextInputShim, this );
  this._onCompositionStart = Substance.bind( this.onCompositionStart, this );

  this._onDomMutations = Substance.bind(this.onDomMutations, this);
  this.domObserver = new window.MutationObserver(this._onDomMutations);
  this.domObserverConfig = { subtree: true, characterData: true };
  this.skipNextObservation = false;

  // set when editing is enabled
  this.enabled = true;

  // surface usually gets frozen while showing a popup
  this.frozen = false;
  this.$caret = $('<span>').addClass('surface-caret');

  this.isIE = Surface.detectIE();
  this.isFF = window.navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

  this.undoEnabled = true;

  /*jshint eqnull:true */
  if (options.undoEnabled != null) {
    this.undoEnabled = options.undoEnabled;
  }
  if (options.contentEditable != null) {
    this.enableContentEditable = options.contentEditable;
  } else {
    this.enableContentEditable = true;
  }

  this.surfaceManager.registerSurface(this);
  /*jshint eqnull:false */
}

Surface.Prototype = function() {

  this.getName = function() {
    return this.name;
  };

  this.getElement = function() {
    return this.element;
  };

  this.getContainerName = function() {
    if (this.editor.isContainerEditor()) {
      return this.editor.getContainerId();
    }
  };

  this.getContainer = function() {
    if (this.editor.isContainerEditor()) {
      return this.doc.get(this.editor.getContainerId());
    }
  };

  this.getEditor = function() {
    return this.editor;
  };

  this.getDocument = function() {
    return this.doc;
  };

  this.dispose = function() {
    this.detach();
    this.surfaceManager.unregisterSurface(this);
  };

  this.attach = function(element) {
    if (!element) {
      throw new Error('Illegal argument: Surface element is required. was ' + element);
    }
    var doc = this.getDocument();

    // Initialization
    this.element = element;
    this.$element = $(element);

    // We leave this now to the view implementation, because readers don't have ce on.
    // if (this.enableContentEditable) {
    //   this.$element.prop('contentEditable', 'true');
    // }
    this.surfaceSelection = new SurfaceSelection(element, doc, this.getContainer());

    this.$element.addClass('surface');

    // Keyboard Events
    //
    this.attachKeyboard();

    // Mouse Events
    //
    this.$element.on( 'mousedown', this._onMouseDown );

    // Document Change Events
    //
    this.domObserver.observe(element, this.domObserverConfig);

    this.attached = true;
  };

  this.attachKeyboard = function() {
    this.$element.on('keydown', this._onKeyDown);
    // OSX specific handling of dead-keys
    if (this.element.addEventListener) {
      this.element.addEventListener('compositionstart', this._onCompositionStart, false);
    }
    if (window.TextEvent && !this.isIE) {
      this.element.addEventListener('textInput', this._onTextInput, false);
    } else {
      this.$element.on('keypress', this._onTextInputShim);
    }
  };

  this.detach = function() {
    var doc = this.getDocument();

    this.domObserver.disconnect();

    // Document Change Events
    //
    doc.disconnect(this);

    // Mouse Events
    //
    this.$element.off('mousemove', this._onMouseMove );
    this.$element.off('mousedown', this._onMouseDown );

    // Keyboard Events
    //
    this.detachKeyboard();

    this.$element.removeClass('surface');

    // Clean-up
    //
    this.element = null;
    this.$element = null;
    this.surfaceSelection = null;

    this.attached = false;
  };

  this.detachKeyboard = function() {
    this.$element.off('keydown', this._onKeyDown);
    if (this.element.addEventListener) {
      this.element.removeEventListener('compositionstart', this._onCompositionStart, false);
    }
    if (window.TextEvent && !this.isIE) {
      this.element.removeEventListener('textInput', this._onTextInput, false);
    } else {
      this.$element.off('keypress', this._onTextInputShim);
    }
  };

  this.isAttached = function() {
    return this.attached;
  };

  this.enable = function() {
    if (this.enableContentEditable) {
      this.$element.prop('contentEditable', 'true');
    }
    this.enabled = true;
  };

  this.isEnabled = function() {
    return this.enabled;
  };

  this.disable = function() {
    if (this.enableContentEditable) {
      this.$element.removeAttr('contentEditable');
    }
    this.enabled = false;
  };

  this.freeze = function() {
    console.log('Freezing surface...');
    if (this.enableContentEditable) {
      this.$element.removeAttr('contentEditable');
    }
    this.$element.addClass('frozen');
    this.domObserver.disconnect();
    this.frozen = true;
  };

  this.unfreeze = function() {
    if (!this.frozen) {
      return;
    }
    console.log('Unfreezing surface...');
    if (this.enableContentEditable) {
      this.$element.prop('contentEditable', 'true');
    }
    this.$element.removeClass('frozen');
    this.domObserver.observe(this.element, this.domObserverConfig);
    this.frozen = false;
  };

  // ###########################################
  // Keyboard Handling
  //

  /**
   * Handle document key down events.
   */
  this.onKeyDown = function( e ) {
    if (this.frozen) {
      return;
    }
    if ( e.which === 229 ) {
      // ignore fake IME events (emitted in IE and Chromium)
      return;
    }
    switch ( e.keyCode ) {
      case Surface.Keys.LEFT:
      case Surface.Keys.RIGHT:
        return this.handleLeftOrRightArrowKey(e);
      case Surface.Keys.UP:
      case Surface.Keys.DOWN:
        return this.handleUpOrDownArrowKey(e);
      case Surface.Keys.ENTER:
        return this.handleEnterKey(e);
      case Surface.Keys.SPACE:
        return this.handleSpaceKey(e);
      case Surface.Keys.BACKSPACE:
      case Surface.Keys.DELETE:
        return this.handleDeleteKey(e);
      default:
        break;
    }

    // Built-in key combos
    // console.log('####', e.keyCode, e.metaKey, e.ctrlKey, e.shiftKey);
    // Ctrl+A: select all
    var handled = false;
    if ( (e.ctrlKey||e.metaKey) && e.keyCode === 65 ) {
      var newSelection = this.editor.selectAll(this.getDocument(), this.getSelection());
      this.setSelection(newSelection);
      this.surfaceSelection.setSelection(newSelection);
      this.emit('selection:changed', newSelection, this);
      handled = true;
    }
    // Undo/Redo: cmd+z, cmd+shift+z
    else if (this.undoEnabled && e.keyCode === 90 && (e.metaKey||e.ctrlKey)) {
      if (e.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  this.undo = function() {
    console.log('UNDO!');
    var doc = this.getDocument();
    if (doc.done.length>0) {
      doc.undo();
    }
  };

  this.redo = function() {
    var doc = this.getDocument();
    if (doc.undone.length>0) {
      doc.redo();
    }
  };

  /**
   * Run a transformation as a transaction properly configured for this surface.
   * @param beforeState (optional) use this to override the default before-state (e.g. to use a different the initial selection).
   * @param transformation a (surface) transformation function(tx, args) which receives
   *                       the selection the transaction was started with, and should return
   *                       output arguments containing a selection, as well.
   * @param ctx (optional) will be used as `this` object when calling the transformation.
   *
   * @example
   *
   *   ```
   *   surface.transaction(function(tx, args) {
   *     var selection = args.selection;
   *     ...
   *     selection = tx.createSelection(...);
   *     return {
   *       selection: selection
   *     };
   *   });
   *
   *   surface.transaction(function(tx, args) {
   *     ...
   *     this.foo();
   *     ...
   *     return args;
   *   }, this);
   *
   *   surface.transaction(beforeState, function(tx, args) {
   *     ...
   *   });
   *   ```
   */
  this.transaction = function(transformation, ctx) {
    // `beforeState` is saved with the document operation and will be used
    // to recover the selection when using 'undo'.
    var beforeState = {
      surfaceId: this.getName(),
      selection: this.getSelection()
    };
    // Note: this is to provide the optional signature transaction(before)
    if (!_.isFunction(arguments[0]) && arguments.length >= 2) {
      var customBeforeState = arguments[0];
      beforeState = _.extend(beforeState, customBeforeState);
      transformation = arguments[1];
      ctx = arguments[2];
    }
    var afterState;
    this.getDocument().transaction(beforeState, function(tx) {
      // A transformation receives a set of input arguments and should return a set of output arguments.
      var result = transformation.call(ctx, tx, { selection: beforeState.selection });
      // The `afterState` is saved with the document operation and will be used
      // to recover the selection whe using `redo`.
      afterState = result || {};
      // If no selection is returned, the old selection is for `afterState`.
      if (!afterState.selection) {
        afterState.selection = beforeState.selection;
      }
      afterState.surfaceId = beforeState.surfaceId;
      return afterState;
    });
    this.setSelection(afterState.selection);
  };

  this.onTextInput = function(e) {
    if (this.frozen) {
      return;
    }
    if (!e.data) return;
    // console.log("TextInput:", e);
    e.preventDefault();
    e.stopPropagation();
    // necessary for handling dead keys properly
    this.skipNextObservation=true;
    this.transaction(function(tx, args) {
      return this.editor.insertText(tx, { selection: args.selection, text: e.data });
    }, this);
    this.rerenderDomSelection();
  };

  // Handling Dead-keys under OSX
  this.onCompositionStart = function() {
    // just tell DOM observer that we have everything under control
    this.skipNextObservation = true;
  };

  // a shim for textInput events based on keyPress and a horribly dangerous dance with the CE
  this.onTextInputShim = function( e ) {
    if (this.frozen) {
      return;
    }
    // Filter out non-character keys. Doing this prevents:
    // * Unexpected content deletion when selection is not collapsed and the user presses, for
    //   example, the Home key (Firefox fires 'keypress' for it)
    // * Incorrect pawning when selection is collapsed and the user presses a key that is not handled
    //   elsewhere and doesn't produce any text, for example Escape
    if (
      // Catches most keys that don't produce output (charCode === 0, thus no character)
      e.which === 0 || e.charCode === 0 ||
      // Opera 12 doesn't always adhere to that convention
      e.keyCode === Surface.Keys.TAB || e.keyCode === Surface.Keys.ESCAPE ||
      // prevent combinations with meta keys, but not alt-graph which is represented as ctrl+alt
      !!(e.metaKey) || (!!e.ctrlKey^!!e.altKey)
    ) {
      return;
    }
    var character = String.fromCharCode(e.which);
    this.skipNextObservation=true;
    if (!e.shiftKey) {
      character = character.toLowerCase();
    }
    if (character.length>0) {
      this.transaction(function(tx, args) {
        this.editor.insertText(tx, { selection: args.selection, text: character });
      }, this);
      this.rerenderDomSelection();
      e.preventDefault();
      e.stopPropagation();
      return;
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  this.handleLeftOrRightArrowKey = function ( e ) {
    var self = this;
    // Note: we need this timeout so that CE updates the DOM selection first
    // before we map the DOM selection
    window.setTimeout(function() {
      var options = {
        direction: (e.keyCode === Surface.Keys.LEFT) ? 'left' : 'right'
      };
      self._updateModelSelection(options);
    });
  };

  this.handleUpOrDownArrowKey = function ( e ) {
    var self = this;
    // Note: we need this timeout so that CE updates the DOM selection first
    // before we map the DOM selection
    window.setTimeout(function() {
      var options = {
        direction: (e.keyCode === Surface.Keys.UP) ? 'left' : 'right'
      };
      self._updateModelSelection(options);
    });
  };

  this.handleSpaceKey = function( e ) {
    e.preventDefault();
    e.stopPropagation();
    this.transaction(function(tx, args) {
      return this.editor.insertText(tx, { selection: args.selection, text: " " });
    }, this);
    this.rerenderDomSelection();
  };

  this.handleEnterKey = function( e ) {
    e.preventDefault();
    if (e.shiftKey) {
      this.transaction(function(tx, args) {
        return this.editor.softBreak(tx, args);
      }, this);
    } else {
      this.transaction(function(tx, args) {
        return this.editor.break(tx, args);
      }, this);
    }
    this.rerenderDomSelection();
  };

  this.handleDeleteKey = function ( e ) {
    e.preventDefault();
    var direction = (e.keyCode === Surface.Keys.BACKSPACE) ? 'left' : 'right';
    this.transaction(function(tx, args) {
      return this.editor.delete(tx, { selection: args.selection, direction: direction });
    }, this);
    this.rerenderDomSelection();
  };

  // ###########################################
  // Mouse Handling
  //

  this.onMouseDown = function(e) {
    if (this.frozen) {
      this.unfreeze();
    }
    if ( e.which !== 1 ) {
      return;
    }
    // Bind mouseup to the whole document in case of dragging out of the surface
    this.dragging = true;
    this.$document.on( 'mouseup', this._onMouseUp );
    this.$document.on( 'mousemove', this._onMouseMove );
  };

  this.onMouseUp = function(/*e*/) {
    // ... and unbind the temporary handler
    this.$document.off( 'mouseup', this._onMouseUp );
    this.$document.off( 'mousemove', this._onMouseMove );
    this.dragging = false;
    if (!this.isFocused) {
      this.surfaceManager.didFocus(this);
      this.isFocused = true;
    }
    // HACK: somehow the DOM selection is not ready yet
    var self = this;
    if (self.surfaceSelection) {
      var sel = self.surfaceSelection.getSelection();
      self._setModelSelection(sel);
    }
  };

  this.onMouseMove = function() {
    if (this.dragging) {
      // TODO: do we want that?
      // update selection during dragging
      // this._setModelSelection(this.surfaceSelection.getSelection());
    }
  };

  // called by SurfaceManager when another surface get's the focus
  this._blur = function() {
    this.setSelection(Substance.Document.nullSelection);
    this.isFocused = false;
  };

  // called by SurfaceManager when another surface get's the focus
  this._focus = function() {
    this.isFocused = true;
    this.rerenderDomSelection();
  };

  this.onDomMutations = function() {
    if (this.skipNextObservation) {
      this.skipNextObservation = false;
      return;
    }
    // Known use-cases:
    //  - Context-menu:
    //      - Delete
    //      - Note: copy, cut, paste work just fine
    console.info("We want to enable a DOM MutationObserver which catches all changes made by native interfaces (such as spell corrections, etc). Lookout for this message and try to set Surface.skipNextObservation=true when you know that you will mutate the DOM.");
  };

  // ###########################################
  // Document and Selection Changes
  //

  this.getSelection = function() {
    return this.selection;
  };

  /**
   * Set the model selection and update the DOM selection accordingly
   */
  this.setSelection = function(sel) {
    if (this._setModelSelection(sel)) {
      if (this.surfaceSelection) {
        // also update the DOM selection
        this.surfaceSelection.setSelection(sel);
      }
    }
  };

  this.rerenderDomSelection = function() {
    this.surfaceSelection.setSelection(this.getSelection());
  };

  this.getDomNodeForId = function(nodeId) {
    return this.element.querySelector('*[data-id='+nodeId+']');
  };

  this._updateModelSelection = function(options) {
    this._setModelSelection(this.surfaceSelection.getSelection(options));
  };

  /**
   * Set the model selection only (without DOM selection update).
   *
   * Used internally if we derive the model selection from the DOM selcection.
   */
  this._setModelSelection = function(sel) {
    sel = sel || Substance.Document.nullSelection;
    // if (!this.getSelection().equals(sel)) {
      // console.log('Surface.setSelection: %s', sel.toString());
      this.selection = sel;
      this.emit('selection:changed', sel, this);
      // FIXME: ATM rerendering an expanded selection leads
      // to a strante behavior. So do not do that for now
      // if (sel.isCollapsed()) {
      this.rerenderDomSelection();
      // }
    // }
  };

  this.getLogger = function() {
    return this.logger;
  };

  this.placeCaretElement = function() {
    var sel = this.getSelection();
    if (sel.isNull()) {
      throw new Error('Selection is null.');
    }
    var $caret = this.$caret;
    $caret.empty().remove();
    var pos = this.surfaceSelection._findDomPosition(sel.start.path, sel.start.offset);
    if (pos.node.nodeType === window.Node.TEXT_NODE) {
      var textNode = pos.node;
      if (textNode.length === pos.offset) {
        $caret.insertAfter(textNode);
      } else {
        // split the text node into two pieces
        var wsel = window.getSelection();
        var wrange = window.document.createRange();
        var text = textNode.textContent;
        var frag = window.document.createDocumentFragment();
        var textFrag = window.document.createTextNode(text.substring(0, pos.offset));
        frag.appendChild(textFrag);
        frag.appendChild($caret[0]);
        frag.appendChild(document.createTextNode(text.substring(pos.offset)));
        $(textNode).replaceWith(frag);
        wrange.setStart(textFrag, pos.offset);
        wsel.removeAllRanges();
        wsel.addRange(wrange);
      }
    } else {
      pos.node.appendChild($caret[0]);
    }
    return $caret;
  };

  this.removeCaretElement = function() {
    this.$caret.remove();
  };

  this.updateCaretElement = function() {
    this.$caret.remove();
    this.placeCaretElement();
  };

};

Substance.inherit( Surface, Substance.EventEmitter );

Surface.Keys =  {
  UNDEFINED: 0,
  BACKSPACE: 8,
  DELETE: 46,
  LEFT: 37,
  RIGHT: 39,
  UP: 38,
  DOWN: 40,
  ENTER: 13,
  END: 35,
  HOME: 36,
  TAB: 9,
  PAGEUP: 33,
  PAGEDOWN: 34,
  ESCAPE: 27,
  SHIFT: 16,
  SPACE: 32
};

Surface.detectIE = function() {
  var ua = window.navigator.userAgent;
  var msie = ua.indexOf('MSIE ');
  if (msie > 0) {
      // IE 10 or older => return version number
      return parseInt(ua.substring(msie + 5, ua.indexOf('.', msie)), 10);
  }
  var trident = ua.indexOf('Trident/');
  if (trident > 0) {
      // IE 11 => return version number
      var rv = ua.indexOf('rv:');
      return parseInt(ua.substring(rv + 3, ua.indexOf('.', rv)), 10);
  }
  var edge = ua.indexOf('Edge/');
  if (edge > 0) {
     // IE 12 => return version number
     return parseInt(ua.substring(edge + 5, ua.indexOf('.', edge)), 10);
  }
  // other browser
  return false;
};


module.exports = Surface;
