'use strict';

var _ = require('lodash');
var User = require('./api/user/user.model');
var Phase = require('./api/phase/phase.model');
var config = require('./config/environment');

exports.AddOpenJubUser = function(item, token, callback) {
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
	    imageURL: 'https://api.jacobs-cs.club/user/image/' + item.username + '/image.jpg',
	    token: token
    });

    user.save(callback);
}

exports.SetPhases = function(phases, callback) {
	Phase.find({}).remove().exec();

	phases.forEach(function (item) {
		var tmp = new Phase({
			id: item.id,
			name: item.name,
			from: item.from,
			to: item.to,
			isCollegePhase: item.isCollegePhase,
			maxRooms: item.maxRooms,
			next: item.next,
			filters: item.filters,
			isCurrent: false
		});
		tmp.save();
	});

	callback();
}