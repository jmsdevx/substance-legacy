// Comments
// -----------------
// This seems to be very UI specific and should be removed from Substance.Session

Substance.Comments = function(session) {
  this.session = session;
  this.scopes = [];
};

_.extend(Substance.Comments.prototype, _.Events, {
  compute: function(scope) {
    var node = this.session.node();
    this.scopes = [];

    if (node) {
      var nodeData = this.session.document.content.nodes[node];
      var content = nodeData.content;
      var annotations = this.session.document.annotations(node);
    }
    this.commentsForNode(this.session.document, node, content, annotations, scope);
  },

  // Based on a new set of annotations (during editing)
  updateAnnotations: function(content, annotations) {
    var node = this.session.node();

    // Only consider markers as comment scopes
    var annotations = _.filter(annotations, function(a) {
      return _.include(["idea", "question", "error"], a.type);
    });

    this.commentsForNode(this.session.document, node, content, annotations);
  },

  commentsForNode: function(document, node, content, annotations, scope) {
    this.scopes = [];

    // Extract annotation text from the model
    function annotationText(a) {
      if (!a.pos) return "No pos";
      return content.substr(a.pos[0], a.pos[1]);
    }

    if (node) {
      this.scopes.push({
        name: "Node",
        type: "node",
        id: "node_comments",
        comments: document.comments(node)
      });

      _.each(annotations, function(a) {
        if (_.include(["idea", "question", "error"], a.type)) {
          this.scopes.push({
            name: annotationText(a),
            type: a.type,
            annotation: a.id,
            id: a.id,
            comments: document.commentsForAnnotation(a.id)
          });
        }

      }, this);
    } else {
      this.scopes.push({
        id: "document_comments",
        name: "Document",
        type: "document",
        comments: document.documentComments()
      });
    }
    this.session.trigger('comments:updated', scope);
  }
});


// Substance.Session
// -----------------
// 
// The Composer works with a session object, which maintains 
// all the state of a document session
// TODO: No multiuser support yet, use app.user

Substance.Session = function(options) {
  this.client = options.client;
  this.remoteStore = options.remoteStore;
  this.localStore = options.localStore;

  this.users = {
    "michael": {
      "color": "#2F2B26",
      "selection": []
    }
  };

  this.selections = {};

  // Comments view
  this.comments = new Substance.Comments(this);

  // That's the current editor
  this.user = "michael";
};

_.extend(Substance.Session.prototype, _.Events, {
  // When a doc changes, bind event handlers etc.
  initDoc: function() {
    var that = this;

    // Rebind event handlers
    this.document.off('commit:applied');
    this.document.off('ref:updated');

    this.document.on('commit:applied', function(commit) {
      // Persist update in docstore
      this.updateDocument([commit]);
      this.updateMeta();
    }, this);

    this.document.on('ref:updated', function(ref, sha) {
      this.localStore.setRef(this.document.id, ref, sha);
      this.updateMeta();
    }, this);
  },

  // Create a new document locally
  createDocument: function(cb) {
    var id = Math.uuid();
    var that = this;

    this.localStore.create(id, function(err, doc) {
      if (err) return cb(err);
      doc.meta = {"creator": user()};
      // Instead use new update + empty commit array
      this.localStore.updateMeta(id, doc.meta, function(err) {
        if (err) return cb(err);

        that.document = new Substance.Document(doc);
        that.initDoc();
        cb(null, that.document);
      });
    });
  },

  // Load new Document from localStore
  loadDocument: function(id, cb) {
    var that = this;
    this.localStore.get(id, function(err, doc) {
      if (err) return cb(err);
      that.document = new Substance.Document(doc);
      that.initDoc();
      cb(err, that.document);
    });
  },

  // Update local document
  updateDocument: function(commits, meta, refs, cb) {
    this.localStore.update(this.document.id, commits, meta, refs, cb);
  },

  // Update meta info of current document
  updateMeta: function(cb) {
    var doc = this.document;
    _.extend(doc.meta, doc.content.properties);
    doc.meta.updated_at = new Date();
    this.localStore.updateMeta(doc.id, doc.meta, function(err) {
      if (cb) cb(err);
    });
  },

  deleteDocument: function(id, cb) {
    this.localStore.delete(id, cb);
  },

  // Replicate local docstore with remote docstore
  // Not yet working
  replicate: function(cb) {
    var replicator = new Substance.Replicator();
    replicator.replicate(this.localStore, this.remoteStore, cb);
  },

  // Select a document
  // Triggers re-render of comments panel etc.
  select: function(nodes, options) {

    if (!options) options = {};
    var user = options.user || this.user; // Use current user by default

    // Do nothing if selection hasn't changed
    // It's considered a change if you operate on the same node 
    // but change from edit to selection mode (options.edit check)
    if (!this.selectionChanged(user, nodes, !!options.edit)) return;

    this.edit = !!options.edit;

    if (this.users[this.user].selection) {
      _.each(this.users[user].selection, function(node) {
        delete this.selections[node];
      }, this);
    }

    this.users[user].selection = nodes;
    _.each(nodes, function(node) {
      this.selections[node] = user;
    }, this);
    
    // New selection leads to new comment context
    this.comments.compute();
    this.trigger('node:selected');
  },

  createPublication: function(network, cb) {
    var doc = this.document;
    var that = this;
  
    this.client.createPublication(doc.id, network, function(err) {
      if (err) return cb(err);
      that.loadPublications(cb);
    });
  },

  deletePublication: function(network, cb) {
    var that = this;
    var doc = this.document;
    this.client.deletePublication(doc.id, network, function(err) {
      if (err) return cb(err);
      that.loadPublications(cb);
    });
  },

  createVersion: function(cb) {
    var doc = this.document;
    var that = this;

    this.client.createVersion(doc.id, doc.content, function(err) {
      if (err) return cb(err);
      doc.meta.published_at = new Date();
      doc.meta.published_commit = doc.getRef('master');
      that.updateMeta(function() {
        that.loadPublications(cb);
      });
    });
  },

  // Unpublish document
  unpublish: function(cb) {
    var doc = this.document;
    var that = this;
    // console.log('unpublishing...');
    this.client.unpublish(doc.id, function(err) {
      if (err) return cb(err);
      delete doc.meta["published_at"];
      delete doc.meta["published_commit"];
      that.updateMeta(cb)
    });
  },

  // Retrieve current publish state
  publishState: function() {
    var doc = this.document;
    if (!doc.meta.published_commit) return "unpublished";
    if (doc.getRef('master') === doc.meta.published_commit) return "published";
    return "dirty";
  },

  // Checks if selection has actually changed for a user
  selectionChanged: function(user, nodes, edit) {
    // this.edit remembers the previous selection/edit state
    return !_.isEqual(nodes, this.selection(user)) || edit !== this.edit;
  },

  // Retrieve current node selection
  selection: function(user) {
    if (!user) user = this.user;
    return this.users[user].selection;
  },

  // Returns the node id of current active node
  // Only works if there's just one node selected
  node: function() {
    var lvl = this.level(),
        sel = this.selection();

    if (lvl >= 2 && sel.length === 1) {
      return sel[0];
    }
  },

  // Returns current navigation level (1..3)
  level: function() {
    var selection = this.users[this.user].selection;

    // Edit mode
    if (this.edit) return 3;

    // Selection mode (one or more nodes)
    if (selection.length >= 1) return 2;

    // no selection -> document level
    return 1;
  },

  // Load Publish state
  loadPublications: function(cb) {
    var doc = this.document;
    var that = this;

    this.client.loadNetworks(function(err, networks) {
      if (err) return cb(err);
      that.networks = networks; // all networks
      that.client.loadPublications(doc.id, function(err, publications) {
        that.publications = publications;
        _.each(that.publications, function(p) {
          // Attach network information
          p.network = _.find(that.networks, function(n) { return n.id === p.network; });
        });
        cb(null);
      });
    });
  },

  // Load Collaborators for current document
  loadCollaborators: function(cb) {
    var doc = this.document;
    var that = this;
    this.client.loadCollaborators(doc.id, function(err, collaborators) {
      that.collaborators = collaborators;
      cb(null);
    });
  },

  // Create new collaborator on the server
  createCollaborator: function(collaborator, cb) {
    var doc = this.document;
    var that = this;
    this.client.createCollaborator(doc.id, collaborator, function(err) {
      if (err) return cb(err);
      that.loadCollaborators(cb);
    });
  },

  // Delete collaborator on the server
  deleteCollaborator: function(collaborator, cb) {
    var doc = this.document;
    var that = this;
    this.client.deleteCollaborator(doc.id, collaborator, function(err) {
      if (err) return cb(err);
      that.loadCollaborators(cb);
    });
  },

  // Authenticate session
  authenticate: function(username, password, cb) {
    this.client.authenticate(username, password, function(err, data) {
      if (err) return cb(err);
      initSession(username, data.token);
      cb(null, data);
    });
  },

  // Create a new user on the server
  createUser: function(user, cb) {
    this.client.createUser(user, cb);
  },

  listDocuments: function(cb) {
    this.localStore.list(function(err, documents) {
      var res = _.map(documents, function(doc) {
        return {
          title: doc.meta.title,
          author: "le_author",
          file: doc.id,
          id: doc.id,
          meta: doc.meta,
          updated_at: doc.meta.updated_at
        };
      });
      cb(null, res);
    });
  }
});
