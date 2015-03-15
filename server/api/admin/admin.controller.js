'use strict';

var _ = require('lodash');
var config = require('../../config/environment');
var User = require('./../user/user.model');
var controller = require('./../user/user.controller');
var request = require('request');

var settings = {
  isDatabaseReady : false,
  tallPeople: '',
  disabledRooms: '',
  maxRooms: 7,
  email: {
    preference1: false,
    preference2: false,
    preference3: false,
    preference4: false
  },
  phases: []
};

exports.currentSettings = function(req, res) {
  if (settings) {
    return res.json(200, settings);
  }

  return res.json(500, "No settings found!");
}

exports.updateSettings = function(req, res) {
  if (req.body.settings) {
    settings = req.body.settings;
  }

  return res.json(200, {});
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
      return res.json(500, 'Couldn\'t find user (' + req.query.username + ')');
    }

    delete data.token;
    delete data._v;
    delete data._id;

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
    return res.json(500, 'Username or user field is not set');
  }

  User.update({ username : req.body.username }, req.body.user, function(err, data) {
      if (err) {
        return res.json(500, err);
      }

      return res.json(200, {});
  });
}

exports.resetSystem = function(req, res) {
  User.$where({}).remove().exec();

  settings = {
    isDatabaseReady : false,
    tallPeople: '',
    disabledRooms: '',
    maxRooms: 7,
    email: {
      preference1: false,
      preference2: false,
      preference3: false,
      preference4: false
    },
    phases: []
  };

  return res.json(200, settings);
}


exports.importUsers = function(req, res) {
  settings.isDatabaseReady = true;
  User.$where({}).remove().exec();

  var url = "https://api.jacobs-cs.club/query/?limit=10000";
  var token = req.cookies.token;
  request.cookie('openjub_session=' + token);

  request({
    method: 'GET',
    uri: url,
    params: {'openjub_session' : token},
    headers: {'Cookie' : 'openjub_session=' + token}
  }, function(err, response, body) {
    if(err) {
      return res.json(500, err);
    }
    else {
      res.json(200, { status: 'success' });
    }

    var users = JSON.parse(response.body).data;

    users.forEach(function(item){
      var this_year = new Date().getFullYear();
      if (item.status !== "undergrad") { //|| item.year < (this_year - 2000)) {
        if (!config.admins.indexOf(item.username) > -1) {
          return;
        }
      }

      var user = new User({
        name: item.fullName,
        surname: item.lastName,
        username: item.username,
        eid: item.eid,
        major: item.major,
        description: item.description,
        country: item.country,
        graduation_year: item.year,
        college: item.college,
        isAdmin: (config.admins.indexOf(item.username) > -1),
      });

      user.points = JSON.stringify(controller.calculate(user));
      user.save();
    });
  });
}