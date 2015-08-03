'use strict';

var OO = require('../basics/oo');
var _ = require('../basics/helpers');

var __id__ = 0;

/**
 * A light-weight component implementation inspired by React and Ember.
 * In contrast to the large frameworks it does much less things automagically
 * in favour of a simple and synchronous life-cyle.
 *
 * Features:
 * - light-weight but simplified rerendering
 * - minimalistic life-cycle with hooks
 * - up-tree communication (send action)
 * - dependency injection
 *
 * ## Concepts
 *
 * ### `props`
 *
 * Props are provided by a parent component. There is a set of built-in properties,
 * such as `data` attributes or `classNames`.
 * An initial set of properties is provided via constructor. After that, the parent
 * component can call `setProps` to update these properties which triggers rerendering if the properties
 * change.
 *
 * ### `state`
 *
 * The component state is a set of flags and values which are used to control how the component
 * gets rendered give the current props.
 * Using `setState` the component can change its internal state, which leads to a rerendering if the state
 * changes.
 *
 * ### The `key` property
 *
 * A child component with a `key` id will be reused on rerender. All others will be wiped and rerender from scratch.
 * If you want to preserve a grand-child (or lower), then make sure that all anchestors have a key id.
 * After rendering the child will be accessible via `this.refs[key]`.
 *
 * ### Actions
 *
 * A component can send actions via `send` which are bubbled up through all parent components
 * until one handles it.
 * Attention: the action name must match a function name.
 * TODO: maybe we should introduce a naming convention.
 */
function Component(parent, props) {
  if (!parent && parent !== "root") {
    throw new Error("Contract: every component needs to have a parent.");
  }
  this.__id__ = __id__++;

  this.parent = parent;
  this.content = [];
  this.children = {};
  this.refs = {};

  this._setProps(props);
  this._setState(this.getInitialState());

  // get context from parent (dependency injection)
  this.context = this._getContext();

  this.didReceiveProps();

  this._data = {
    props: {},
    children: []
  };
}

Component.Prototype = function ComponentPrototype() {

  this.getChildContext = function() {
    return this.childContext || {};
  };

  this.getInitialState = function() {
    return {};
  };

  this.getParent = function() {
    return this.parent;
  };

  /**
   * Renders the component.
   *
   * Note: actually it does not create a DOM presentation directly
   * but a virtual representation which is compiled into a DOM element.
   */
  this.render = function() {
    return Component.$$('div');
  };

  this.shouldRerender = function(newProps, newState) {
    /* jshint unused: false */
    return !_.isEqual(newProps, this.props) || !_.isEqual(newState, this.state);
  };

  this.rerender = function() {
    this._render(this.render());
  };

  /**
   * Renders and appends this component to a given element.
   *
   * If the element is in the DOM already, triggers `component.didMount()`
   * on this component and all of its children.
   */
  this.mount = function($el) {
    this._render(this.render());
    $el.append(this.$el);
    // trigger didMount automatically if the given element is already in the DOM
    if (_isInDocument($el[0])) {
      this.triggerDidMount();
    }
    return this;
  };

  /**
   * Triggers didMount handlers recursively.
   *
   * Gets called when using `component.mount(el)` on an element being
   * in the DOM already. Typically this is done for a root component.
   *
   * If this is not possible because you want to do things differently, make sure
   * you call 'component.triggerDidMount()' on root components.
   *
   * @example
   * ```
   * var frag = document.createDocumentFragment();
   * var component = new MyComponent();
   * component.mount(frag);
   * ...
   * $('body').append(frag);
   * component.triggerDidMount();
   * ```
   */
  this.triggerDidMount = function() {
    this.didMount();
    _.each(this.children, function(child) {
      child.triggerDidMount();
    });
  };

  /**
   * Called when the element is inserted into the DOM.
   *
   * Node: make sure that you call `component.mount(el)` using an element
   * which is already in the DOM.
   *
   * @example
   * ```
   * var component = new MyComponent();
   * component.mount($('body')[0])
   * ```
   */
  this.didMount = function() {};

  /**
   * Removes this component from its parent.
   */
  this.unmount = function() {
    this.triggerWillUnmount();
    this.$el.remove();
    // TODO: do we need to remove this from parents children
    // right now it feels like that it doesn't make a great difference
    // because most often this method is called by the parent during rerendering
    // and on other cases it would be gone after the next parent rerender.
    return this;
  };

  this.triggerWillUnmount = function() {
    _.each(this.children, function(child) {
      child.triggerWillUnmount();
    });
    this.willUnmount();
  };

  this.willUnmount = function() {
    console.log('Will unmount', this);
  };

  this.send = function(action) {
    var comp = this;
    while(comp) {
      if (comp[action]) {
        return comp[action].apply(comp, Array.prototype.slice.call(arguments, 1));
      }
      comp = comp.getParent();
    }
    throw new Error('No component handled action: ' + action);
  };

  this.setState = function(newState) {
    var needRerender = this.shouldRerender(this.getProps(), newState);
    this.willUpdateState(newState);
    this._setState(newState);
    this.didUpdateState();
    if (needRerender) {
      this.rerender();
    }
  };

  this.getState = function() {
    return this.state;
  };

  this.willUpdateState = function(newState) {
    /* jshint unused: false */
  };

  this.didUpdateState = function() {};

  this.setProps = function(newProps) {
    var needRerender = this.shouldRerender(newProps, this.getState());
    this.willReceiveProps(newProps);
    this._setProps(newProps);
    this.didReceiveProps();
    if (needRerender) {
      this.rerender();
    }
  };

  this.getProps = function() {
    return this.props;
  };

  this.willReceiveProps = function(newProps) {
    /* jshint unused: false */
  };

  this.didReceiveProps = function() {};

  /* Internal API */

  var _isDocumentElement = function(el) {
    // Node.DOCUMENT_NODE = 9
    return (el.nodeType === 9);
  };

  var _isInDocument = function(el) {
    while(el) {
      if (_isDocumentElement(el)) {
        return true;
      }
      el = el.parentNode;
    }
    return false;
  };

  var _indexByKey = function(children, old) {
    var index = {};
    for (var i = 0; i < children.length; i++) {
      var key;
      var child = children[i];
      // yuck
      if (old) {
        key = child.component.key;
      } else {
        key = child.props.key;
      }
      if (key) {
        index[key] = child;
      }
    }
    return index;
  };

  this._createElement = function(data) {
    var $el = $('<' + data.tagName + '>');
    if (data.props.id) {
      $el.attr('id', data.props.id);
    }
    if (data.props.classNames) {
      $el.addClass(data.props.classNames);
    }
    var attributes = this._getHtmlAttributesFromProps(data.props);
    if (attributes) {
      $el.attr(attributes);
    }
    if (data.props.style) {
      $el.css(data.props.style);
    }
    return $el;
  };

  this._updateElement = function(data, oldData) {
    var $el = this.$el;
    var oldClassNames = oldData.props.classNames;
    var newClassNames = data.props.classNames;
    if (oldClassNames !== newClassNames) {
      $el.removeClass(oldClassNames);
      $el.addClass(newClassNames);
    }
    var oldAttributes = this._getHtmlAttributesFromProps(oldData.props);
    var newAttributes = this._getHtmlAttributesFromProps(data.props);
    if (!_.isEqual(oldAttributes, newAttributes)) {
      $el.removeAttr(oldAttributes);
      $el.attr(newAttributes);
    }
    // css styles must be overwritten explicitly (there is no '$.removeCss')
    if (oldData.props.style !== data.props.style) {
      if (data.props.style) {
        $el.css(data.props.style);
      }
    }
    return $el;
  };

  this._render = function(data) {
    if (data.type !== 'element') {
      throw new Error("Component.render() must return one html element: e.g., $$('div')");
    }
    var oldData = this._data;
    // the first time we need to create the component element
    if (!this.$el) {
      this.$el = this._createElement(data);
    } else {
      // update the element
      this._updateElement(data, oldData);
    }
    var el = this.$el[0];
    var isMounted = _isInDocument(el);

    var oldContent = oldData.children;
    var newContent = data.children;

    var oldComps = _indexByKey(oldData.children, "old");
    var newComps = _indexByKey(data.children);

    var pos = 0;
    var oldPos = 0;
    var newPos = 0;

    var children = {};
    var refs = {};

    function _removeOldData(key) {
      // remove the data so we do not process it again
      delete oldComps[key];
      for (var i = oldPos+1; i < oldContent.length; i++) {
        if (oldContent[i].component.key === key) {
          oldContent.splice(i, 1);
          break;
        }
      }
    }

    function _replace(oldComp, newComp) {
      oldComp.triggerWillUnmount();
      oldComp.$el.replaceWith(newComp.$el[0]);
    }

    function _update(comp, data) {
      if (comp instanceof Component.Container) {
        comp._render(data);
      } else {
        comp.setProps(data.props);
      }
    }

    function _registerComponent(comp) {
      children[comp.__id__] = comp;
      if (comp.props.key) {
        refs[comp.props.key] = comp;
      }
    }

    // step through old and new content data (~virtual DOM)
    // and apply changes to the component element
    while(oldPos < oldContent.length || newPos < newContent.length) {
      var node = el.childNodes[pos];
      var _old = oldContent[oldPos];
      var _new = newContent[newPos];
      var comp = null;

      // append remaining new components if there is no old one left
      if (!_old) {
        for (var i = newPos; i < newContent.length; i++) {
          comp = this._compileComponent(newContent[i]);
          if (isMounted) comp.triggerDidMount();
          this.$el.append(comp.$el);
          _registerComponent(comp);
        }
        break;
      }
      // unmount remaining old components if there is no old one left
      if (!_new) {
        for (var j = 0; j < oldContent.length; j++) {
          oldContent[j].component.unmount();
        }
        break;
      }

      // otherwise do a differential update
      if (node !== _old.component.$el[0]) {
        throw new Error('Assertion failed: DOM structure is not as expected.');
      }

      // Note: if the key property is set the component is treated preservatively
      var newKey = _new.props.key;
      var oldKey = _old.component.key;
      if (oldKey && newKey) {
        // the component is in the right place already
        if (oldKey === newKey) {
          comp = _old.component;
          _update(comp, _new);
          pos++; oldPos++; newPos++;
        }
        // a new component has been inserted
        else if (!oldComps[newKey] && newComps[oldKey]) {
          comp = this._compileComponent(_new);
          comp.$el.insertBefore(node);
          if (isMounted) comp.triggerDidMount();
          pos++; newPos++;
        }
        // old component has been replaced
        else if (!oldComps[newKey] && !newComps[oldKey]) {
          comp = this._compileComponent(_new);
          _replace(_old.component, comp);
          if (isMounted) comp.triggerDidMount();
          newPos++; oldPos++;
        }
        // component has been moved to a different position
        else if (oldComps[newKey]) {
          comp = oldComps[newKey].component;
          _update(comp, _new);
          // if the old component is coming up components have been swapped
          if (newComps[oldKey]) {
            comp.$el.insertBefore(node);
          }
          // otherwise we can replace the old one
          else {
            _replace(_old.component, comp);
            oldPos++;
          }
          pos++; newPos++;
          // remove the data so we do not process it again
          _removeOldData(newKey);
        }
        else {
          throw new Error('Assertion failed: should not reach this statement.');
        }
      } else if (newKey) {
        if (oldComps[newKey]) {
          _old.component.unmount();
          oldPos++;
          // continueing as we did not insert a component
          continue;
        }
        else {
          comp = this._compileComponent(_new);
          _replace(_old.component, comp);
          if (isMounted) comp.triggerDidMount();
          pos++; oldPos++; newPos++;
        }
      } else if (oldKey) {
        comp = this._compileComponent(_new);
        if (newComps[oldKey]) {
          comp.$el.insertBefore(node);
        } else {
          _replace(_old.component, comp);
          oldPos++;
        }
        if (isMounted) comp.triggerDidMount();
        pos++; newPos++;
      } else {
        // do not replace text components if they are equal
        if (_new.type === "text" && _old.type === "text" && _new.props.text === _old.props.text) {
          // skip
          pos++; oldPos++; newPos++;
          continue;
        }
        comp = this._compileComponent(_new);
        _replace(_old.component, comp);
        if (isMounted) comp.triggerDidMount();
        pos++; oldPos++; newPos++;
      }

      _registerComponent(comp);
    }

    this.children = children;
    this.refs = refs;
    this._data = data;
  };

  this._compileComponent = function(data) {
    var component;
    switch(data.type) {
      case 'text':
        component = new Component.Text(this, data.props.text);
        component._render();
        break;
      case 'element':
        component = new Component.HtmlElement(this, data.tagName, data.props);
        component._render(data);
        break;
      case 'component':
        component = new data.ComponentClass(this, data.props);
        component._render(component.render());
        break;
      default:
        throw new Error('Illegal state.');
    }
    data.component = component;
    return component;
  };

  this._getContext = function() {
    var parent = this.getParent();
    var parentContext = parent.context || {};
    if (parent.getChildContext) {
      return _.extend(parentContext, parent.getChildContext());
    } else {
      return parentContext;
    }
  };

  this._getHtmlAttributesFromProps = function(props) {
    var attributes = {};
    _.each(props, function(val, key) {
      switch (key) {
        // Add all html element attributes you want to get rendered into
        // the DOM element
        case 'colspan':
        case 'contentEditable':
        case 'href':
        case 'rowspan':
        case 'spellCheck':
        case 'src':
        case 'title':
          attributes[key] = val;
          break;
        default:
          if (/^data-/.exec(key)) {
            attributes[key] = val;
          }
      }
    }, this);
    return attributes;
  };

  this._setProps = function(props) {
    this.props = props || {};
    // freezing state to 'enforce' immutability
    Object.freeze(props);
  };

  this._setState = function(state) {
    this.state = state || {};
    // freezing state to 'enforce' immutability
    Object.freeze(state);
  };

};

OO.initClass(Component);

/* Built-in components */

Component.Root = function(props) {
  Component.call(this, "root", props);
};
OO.inherit(Component.Root, Component);

Component.Container = function(parent, props) {
  Component.call(this, parent, props);
};

Component.Container.Prototype = function() {
  this.setPropsAndChildren = function(props, children) {
    if (children) {
      this._setProps(props);
      this._render(children);
    } else {
      this.setProps(props);
    }
  };
};
OO.inherit(Component.Container, Component);

Component.HtmlElement = function(parent, tagName, props) {
  this.tagName = tagName;
  Component.Container.call(this, parent, props);
};

OO.inherit(Component.HtmlElement, Component.Container);

Component.Text = function(parent, text) {
  Component.call(this, parent, {text: text});
};

Component.Text.Prototype = function() {
  this._render = function() {
    var el = document.createTextNode(this.props.text);
    if (this.$el) {
      this.$el.replaceWith(el);
    }
    this.$el = $(el);
  };
};

OO.inherit(Component.Text, Component);

/* Virtual Components */

function VirtualContainer() {}

VirtualContainer.Prototype = function() {

  this.append = function(/* ...children */) {
    var children;
    if (arguments.length === 1) {
      var child = arguments[0];
      if (!child) {
        return this;
      }
      if (_.isArray(child)) {
        children = child;
        Component.$$.prepareChildren(children);
        this.children = this.children.concat(children);
      } else if (_.isString(child)) {
        this.children.push(new VirtualTextNode(child));
      } else {
        this.children.push(child);
      }
    } else {
      children = Array.prototype.slice.call(arguments,0);
      Component.$$.prepareChildren(children);
      for (var i = 0; i < children.length; i++) {
        this.children.push(children[i]);
      }
    }
    return this;
  };

  this.addClass = function(className) {
    if (!this.props.classNames) {
      this.props.classNames = "";
    }
    this.props.classNames += " " + className;
    return this;
  };
};

OO.initClass(VirtualContainer);

function VirtualElement(tagName) {
  this.type = 'element';
  this.tagName = tagName;
}
OO.inherit(VirtualElement, VirtualContainer);

function VirtualComponent(ComponentClass) {
  this.type = 'component';
  this.ComponentClass = ComponentClass;
}
OO.inherit(VirtualComponent, VirtualContainer);

function VirtualTextNode(text) {
  this.type = 'text';
  this.props = { text: text };
}

Component.$$ = function() {
  var content = null;
  var props = arguments[1];
  var children = arguments[2];
  if (arguments.length > 3) {
    children = Array.prototype.slice.call(arguments, 2);
  }
  if (_.isString(arguments[0])) {
    content = new VirtualElement(arguments[0]);
  } else if (_.isFunction(arguments[0]) && arguments[0].prototype instanceof Component) {
    content = new VirtualComponent(arguments[0]);
  } else {
    throw new Error('Illegal usage of Component.$$.');
  }
  content.props = props || {};
  if (!children) {
    children = [];
  } else if (!_.isArray(children)) {
    children = [ children ];
  }
  Component.$$.prepareChildren(children);
  content.children = children;
  return content;
};

Component.$$.prepareChildren = function(children) {
  for (var i = 0; i < children.length; i++) {
    if(_.isString(children[i])) {
      children[i] = new VirtualTextNode(children[i]);
    }
  }
};

Component.VirtualTextNode = VirtualTextNode;

module.exports = Component;
