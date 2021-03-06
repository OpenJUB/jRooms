'use strict';

var _ = require('lodash');
var config = require('../../config/environment');
var User = require('./../user/user.model');
var Admin = require('./../admin/admin.model');
var Phase = require('./../phase/phase.model');
var Room = require('./../room/room.model');
var request = require('request');
var utils = require('../../utils');

// Get settings from the database.. Or not?
var settings; 
Admin.findOne({}).exec(function(err, data) {
  if (!err && data) {
    settings = data;
  }
  else {
   settings = new Admin({
      isDatabaseReady : false,
      isDebug : false,
      tallPeople: '',
      disabledRooms: '',
      disabledUsers: '',
      maxRooms: 7,
      email: {
        preference1: false,
        preference2: false,
        preference3: false,
        preference4: false
      },
      isDone: false,
      phases: [],
      whitelistUsers: ''
    });

    settings.save();
  }
});

exports.currentSettings = function(req, res) {
  if (settings) {
    Phase.find({}).exec(function(err, data) {
      if(err) {
        return res.json(500, err);
      }
      var tmp = data;
      tmp.sort(function(a, b) {
          return a.id - b.id;
        });

      var clean_settings = {
        isDatabaseReady: settings.isDatabaseReady, 
        tallPeople: settings.tallPeople, 
        disabledRooms: settings.disabledRooms, 
        disabledUsers: settings.disabledUsers, 
        maxRooms: settings.maxRooms, 
        email: settings.email, 
        phases: tmp,
        isDebug: settings.isDebug,
        isDone: settings.isDone,
        whitelistUsers: settings.whitelistUsers,
        collegeGame: global.collegeGame
      };

      return res.json(200, clean_settings);
    });
  } else {
    return res.json(404, "No settings found!");
  }
}

exports.updateSettings = function(req, res) {

  if (req.body.settings) {
    Admin.find({}).remove().exec();

    var tmp = JSON.parse(JSON.stringify(settings));

    settings = new Admin(req.body.settings);
    settings.isDone = false;

    var newWhitelist = [];
    var oldWhitelist = [];

    if(settings.whitelistUsers && tmp.whitelistUsers) {
      newWhitelist = settings.whitelistUsers.split(',');
      oldWhitelist = tmp.whitelistUsers.split(',');
    }
    

    var removedWhitelistUsers = _.difference(oldWhitelist, newWhitelist);
    console.log("REMOVED: ", removedWhitelistUsers);

    if(removedWhitelistUsers.length > 0) {
      User.find({username: {$in: removedWhitelistUsers}}).exec(function(err, users) {
        if(err || !users) {
          return res.json(500, err);
        }

        for(var i = 0; i < users.length; ++i) {
          if(users[i].year >= (new Date()).getFullYear() - 2000) {
            continue;
          }

          users[i].remove();
          users[i].save();
        }

        settings.save(function() {
          utils.SetPhases(req.body.settings.phases, function() {
            utils.updatePhases();
            return res.json(200, {status: 'success'});
          });
        });
      });
    } else {
      settings.save(function() {
        utils.SetPhases(req.body.settings.phases, function() {
          utils.updatePhases();
          return res.json(200, {status: 'success'});
        });
      });
    }

  } else {
    //console.log("???");
      return res.json(400, "Please provide valid settings");
  } 
}

/**
 * @brief Get user
 * @details Gets user details by CampusNet username
 * 
 * @param req request
 * @param res response
 * 
 * @return 200 if success, 500 otherwise
 */
exports.getUser = function(req, res) {
  if (!req.query.username) {
    return res.json(500, 'Username field is not set');
  }

  User.findOne({ username : req.query.username }, function(err, data) {
    if (err) {
      return res.json(500, err);
    }

    if(!data) {
      return res.json(404, "User does not exist in the database");
    }

    if (data.token) delete data.token;
    if (data.__v) delete data.__v;
    if (data._id) delete data._id;

    return res.json(200, data);
  });
}

/**
 * @brief Set user
 * @details Modifies user's information by CampusNet username
 * 
 * @param req request
 * @param res result
 * 
 * @return 200 if success, 500 otherwise
 */
exports.setUser = function(req, res) {
  if (!req.body.username && req.body.user) {
    return res.json(404, 'Username or user field is not set');
  }

  var newUser = req.body.user;
  var username = req.body.username;

  User.findOne({username: username}).exec(function(err, user) {
    if(err) {
      return res.json(500, err);
    }

    if(!user) {
      return res.json(404, "User does not exist in the database");
    }

    if(user.nextRoom !== newUser.nextRoom) {
      newUser.phaseId = -1;
    }

    user.name = newUser.name;
    user.country = newUser.country;
    user.major = newUser.major;
    user.year = newUser.year;
    user.college = newUser.college;
    user.nextCollege = newUser.nextCollege;
    user.nextRoom = newUser.nextRoom;
    user.phaseId = newUser.phaseId;


    user.save(function() {
      return res.json(200, {});
    });
  });
}

exports.resetSystem = function(req, res) {
  User.find({}).remove().exec();
  Admin.find({}).remove().exec();
  Phase.find({}).remove().exec();
  Room.find({}).remove().exec();

   settings = new Admin({
    isDatabaseReady : false,
    isDebug : false,
    isDone : false,
    tallPeople: '',
    disabledRooms: '',
    disabledUsers: '',
    maxRooms: 7,
    email: {
      preference1: false,
      preference2: false,
      preference3: false,
      preference4: false
    },
    phases: []
  });

  settings.save();

  return res.json(200, settings);
}

exports.addFoundationYears = function(req, res) {

  var token = req.cookies.token;
  var url = config.openJUB.url + "query/?limit=10000&token=" + token;
  request({
    method: 'GET',
    uri: url,
    params: {'openjub_session' : token},
    headers: {'Cookie' : 'openjub_session=' + token}
  }, function(err, response) {
    if(err || !response) {
      return res.json(500, err);
    }

    if(!response.body) {
      return res.json(500, "OpenJUB Error");
    }

    var usersJson = JSON.parse(response.body);
    if(!usersJson) {
      return res.json(500, "Parsing error");
    }

    var users = usersJson.data;

    users.forEach(function(user) {
      //console.log(user.description, "fy " + user.year);
      if(user.description !== ("fy " + user.year)) {
        return;
      }

      console.log(user);

      User.findOne({username: user.username}, function(err, data) {
        if(err || data) { //This check is correct, I know what I'm doing
          return;
        }

        utils.AddOpenJubUser(user, null, function() {});
      });
    });

    return res.json(200, "Success");
  });
}
exports.importUsers = function(req, res) {
  settings.isDatabaseReady = true;
  settings.save();

  User.find({}).remove().exec();

  var token = req.cookies.token;
  var url = config.openJUB.url + "query/?limit=10000&token=" + token;
  request.cookie('openjub_session=' + token);

  request({
    method: 'GET',
    uri: url,
    params: {'openjub_session' : token},
    headers: {'Cookie' : 'openjub_session=' + token}
  }, function(err, response, body) {

    var users;

    if(err || !response.body) {
      return res.json(500, err);
    }
    else {
      users = JSON.parse(response.body).data;
      if(!users) {
        return res.json(500, "OpenJUB error");
      }

      res.json(200, { status: 'success' });
    }

    users.forEach(function(item) {
      var cur = (new Date()).getFullYear() - 2000;
      if(item.year <= cur)
        return;

      utils.AddOpenJubUser(item, null, function() {});
    });
  });
}


exports.forcePhase = function(req, res) {
  var phaseId = req.body.id;
  console.log(phaseId);

  Phase.find({}).exec(function(err, data) {
    if(err || !data) {
      return res.json(500, err);
    }

    settings.isDebug = true;
    settings.save(function() {

      data.forEach(function(item) {
        var status = (item.id === phaseId);
        if(item.isCurrent && !status) {

          utils.generateResults(item.id, true, function() {
            item.isCurrent = status;
            item.save();
          });
        } else {
          item.isCurrent = status;
          item.save();
        }
      });
    });
    return res.json(200, {status: "Success", isDebug: true});
  });
}

exports.cancelForce = function(req, res) {
  settings.isDebug = false;
  settings.save(function() {
    utils.updatePhases();
    return res.json(200, {status: "Success", isDebug: false});
  });
}

exports.endAllocation = function(req, res) {
  Phase.findOne({isCurrent: true}).exec(function(err, phase) {
    if(err) {
      return res.json(500, err);
    }

    if(!phase) {
      return res.json(200, {});
    }
    
    utils.generateResults(phase.id, true, function() {
      settings.isDone = true;
      phase.isCurrent = false;
      phase.save(function() {
        return res.json(200, {});
      });
    });
  });
}