'use strict';

var _ = require('lodash');
var User = require('./api/user/user.model');
var Phase = require('./api/phase/phase.model');
var Admin = require('./api/admin/admin.model');
var Room = require('./api/room/room.model');
var config = require('./config/environment');
var allRooms = require('./config/rooms/rooms');
var emails = require('emailjs');

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
	    token: token,
	    points: {
	    	totalPoints: 0,
	    	userPoints: (new Date()).getFullYear() - 2000 - item.year + 3,
	    	roommatePoints: 0,
	    	collegeSpiritPoints: 0,
	    	countryPoints: 0,
	    	regionPoints: 0,
	    	majorPoints: 0
	    }
    });


	exports.points(user, function(err, updated) {
		if(err || !updated) {
			console.log("Poof");
		}

		updated.save(function(err) {
			callback(err, updated);
		});
	});
}

exports.SetPhases = function(phases, callback) {
	Phase.find({}).remove().exec();

	console.log(phases);
	if(!phases)
		callback();

	for(var i = 0; i < phases.length; i++) {
		var item = phases[i];

		console.log(item);
		var tmp = new Phase({
			id: item.id,
			name: item.name,
			from: item.from,
			to: item.to,
			isCollegePhase: item.isCollegePhase,
			maxRooms: 7,
			next: item.next,
			filters: item.filters,
			isCurrent: false,
			results: item.results
		});
		tmp.save();
	}

	callback();
}

exports.updatePhases = function() {

	Admin.findOne({}).exec(function(err, settings) {
		if(err || !settings){
			console.log("PANIC");
			console.log(err);
		}

		if(settings && settings.isDebug)
			return;

		Phase.findOne({isCurrent: true}).exec(function(err, phase) {
			if(err) {
				return;
			}
			Phase.find({}).exec(function(err2, data) {
				if(err2 || !data) {
					console.log("ANOTHER PANIC");
					console.log(err);
				}
				data.forEach(function(item) {
					item.isCurrent = (item.from <= (new Date()) && item.to >= (new Date()));
					if(item.isCurrent && item !== phase) {

						phase.isCurrent = false;
						phase.save();

						exports.generateResults(phase.id, true, function() {});
					}

					item.save();
				});
			});
		});
	});
	//Add if statement for limiting it to certain hours if necessary
}

exports.points = function(user, callback) {
	if(!user || !user.points) {
		return callback("Points not defined", user);
	}

	user.points.totalPoints = user.points.userPoints;

	user.points.collegeSpiritPoints = config.collegeSpiritPoints * (user.college === user.nextCollege);
	user.points.totalPoints += user.points.collegeSpiritPoints;

	if(user.roommates.length > 0) {

		var tmp = [];
		for(var i = 0; i < user.roommates.length; i++) {
			tmp.push(user.roommates[i].username);
		}

		User.find({username: {$in: tmp}}).exec(function(err, users) {
			if(err || !users) {
				callback(err, null);
			}

			var roommatePoints = 0;

			var countries = [user.country];
			var regions = [getRegion(user.country)];
			var majors = [user.major];

			for(var i = 0; i < users.length; i++) {
				roommatePoints += users[i].points.userPoints;
				roommatePoints += config.collegeSpiritPoints * (users[i].college === users[i].nextCollege);

				countries.push(users[i].country);
				regions.push(getRegion(users[i].country));
				majors.push(users[i].major);
			}

			user.points.roommatePoints = roommatePoints;
			user.points.countryPoints = config.countryPoints * (countries.filter(exports.onlyUnique).length - 1);
			user.points.regionPoints = config.regionPoints * (regions.filter(exports.onlyUnique).length - 1);
			user.points.majorPoints = config.majorPoints * (majors.filter(exports.onlyUnique).length - 1);

			user.points.totalPoints += user.points.roommatePoints + user.points.countryPoints + user.points.regionPoints + user.points.majorPoints;

			//console.log(user);
			user.save(function() {
				callback(null, user);
			});
		});

	} else {
		user.save(function() {
			callback(null, user);
		});
	}
}

var getRegion = function(country) {
	for(var property in config.regions) {
		if(config.regions.hasOwnProperty(property)) {
			if(config.regions[property].indexOf(country) >= 0) {
				return property;
			}
		}
	}

	return null;
}

exports.onlyUnique = function (value, index, self) { 
    return self.indexOf(value) === index;
}

exports.isEligible = function(token, round, callback) {
  var status = true;
  User.findOne({token: token}).exec(function(err, user) {
    if(err || !user) {
      status = false;
      round.isEligible = status;
      return callback(round);
    }
    Admin.findOne({}).exec(function(err2, settings) {
    	if(err2 || !settings) {
    		status = false;
    		round.isEligible = status;
      	return callback(round);
    	}
    	//console.log(round);
    	if(!round.filters) { // Malformed round. Return false. Exists because of the possibility for no active phase.
    		status = false;
    		round.isEligible = status;
      	return callback(round);
    	}

    	if(round.isCollegePhase && user.nextCollege) {
    		status = false;
    		round.isEligible = status;
    		return callback(round);
    	}

    	if(!round.isCollegePhase && user.nextRoom) {
    		status = false;
    		round.isEligible = status;
    		return callback(round);
    	}

      if(round.filters.enableFilterTall) {
        var tall = settings.tallPeople.split(',');
        status = Math.min((tall.indexOf(user.username) >= 0), status);
      }

      //console.log(status);

      if(round.filters.enableFilterColleges) {
        var tmp = [];
        if(round.filters.colleges.krupp) {
          tmp.push("Krupp");
        }
        if(round.filters.colleges.mercator) {
          tmp.push("Mercator");
        }
        if(round.filters.colleges.c3) {
          tmp.push("C3");
        }
        if(round.filters.colleges.nordmetall) {
          tmp.push("Nordmetall");
        }

        status = Math.min((tmp.indexOf(user.nextCollege) >= 0), status);
      }

      if(round.filters.enableFilterExchange) {
        status = Math.min(user.isExchange, status);
      } else {
        status = Math.min(!user.isExchange, status);
      }

      if(round.filters.enableFilterPoints) {
        status = Math.min((user.points.total >= round.filters.pointsMin) , status);
      }

      if(round.filters.enableFilterRooms) {
        var num = user.roommates.length + 1;
        status = Math.min(((round.filters.rooms.single && num === 1) || (round.filters.rooms.double && num === 2) || (round.filters.rooms.triple && num === 3)), status);
      } else {
      	//status = Math.min(status, user.roommates.length === 1);
      }

      round.isEligible = status;
      console.log(status);
      return callback(round);
    });
  });
}

exports.phaseResult = function(phase, callback) {
	//console.log(phase);
  if(phase.isCollegePhase) {
    User.find({$where: 'this.nextCollege != null'}).exec(function(err, users) {
      //console.log(users);
      var results = {krupp: [], c3: [], nordmetall: [], mercator: []};
      if(err || !users) {
        console.log(err);
        return {};
      }
      //console.log(users);
      for(var i = 0; i < users.length; i++) {
        switch(users[i].nextCollege) {
          case 'Krupp':
            results.krupp.push({name: users[i].name});
            break;
          case 'Mercator':
            results.mercator.push({name: users[i].name});
            break;
          case 'Nordmetall':
            results.nordmetall.push({name: users[i].name});
            break;
          case 'C3':
            results.c3.push({name: users[i].name});
            break;
        }
      }
      //console.log(results);
      phase.results = results;
      return phase.save(function() {
        return callback(phase);
      });
    });
  } else {
    User.find({phaseId: phase.id}).exec(function(err, users) {
      var results = {krupp: [], c3: [], nordmetall: [], mercator: []};
      if(err || !users) {
      	//console.log("Scaramoosh");
        return results;
      }
      //console.log(users);

      for(var i = 0; i < users.length; i++) {
      	//console.log(users[i].username, users[i].nextRoom);
        switch(users[i].nextCollege) {
          case 'Krupp':
            results.krupp.push({name: users[i].name, room: users[i].nextRoom});
            break;
          case 'Mercator':
            results.mercator.push({name: users[i].name, room: users[i].nextRoom});
            break;
          case 'C3':
            results.c3.push({name: users[i].name, room: users[i].nextRoom});
            break;
          case 'Nordmetall':
            results.nordmetall.push({name: users[i].name, room: users[i].nextRoom});
            break;
        }
      }

      //console.log(results);

      phase.results = results;
      return phase.save(function() {
        return callback(phase);
      });
    });
  }
}

exports.populateRoomInfo = function() {
	Room.remove({}).exec();

	for(var i = 0; i < allRooms.length; ++i) {
		for(var j = 0; j < allRooms[i].blocks.length; ++j) {
			for(var fl = 0; fl < allRooms[i].blocks[j].floors.length; ++fl) {
				for(var ro = 0; ro < allRooms[i].blocks[j].floors[fl].rooms.length; ++ro) {
					for(var room = 0; room < allRooms[i].blocks[j].floors[fl].rooms[ro].contains.length; ++room) {

						var result = new Room({
							college : allRooms[i].name,
							block : allRooms[i].blocks[j].name,
							floor : allRooms[i].blocks[j].floors[fl].number,
							type : allRooms[i].blocks[j].floors[fl].rooms[ro].type,
							rooms : allRooms[i].blocks[j].floors[fl].rooms[ro].contains,
							name : allRooms[i].blocks[j].floors[fl].rooms[ro].contains[room]
						});

						result.save();
					}
				}
			}
		}
	}
}

exports.generateResults = function(phaseId, save, callback) {
  Phase.findOne({id: phaseId}).exec(function(err, phase) {
    if(phase.isCollegePhase) {
      return calculateColleges(phase, save, callback);
    } else {
      return calculatePhase(phase, save, callback);
    }
  });
}

var calculatePhase = function(phase, save, callback) {
  //console.log("Here bruh");
  //console.log(phase);
  User.find({phaseId: phase.id}).exec(function(err, u) {
    if(err || !u) {
      callback(null);
    }

    var users = shuffle(u);

    var matrix = {};
    var rooms = [];
    var used = [];

    for(var i = 0; i < users.length; i++) {
      rooms = rooms.concat(users[i].rooms);
    }

    console.log(rooms);

    rooms = rooms.filter(exports.onlyUnique, users[i]);

    for(var i = 0; i < users.length; i++) {
      if(used.indexOf(users[i].username) >= 0) {
        continue;
      }

      matrix[users[i].username] = calc(rooms, users[i], phase.filters.pointsMax);
      used.push(users[i]);
      for(var j = 0; j < users[i].roommates.length; j++) {
        used.push(users[i].roommates[j].username);
      }
    }

    console.log(matrix);

    var tmp_count = 0;
    while(_.size(matrix) < rooms.length) { // We need to make the matrix square
      matrix["BLANK" + tmp_count] = calc(rooms, {rooms: []}, phase.filters.pointsMax);
      ++tmp_count;
    }

    while(rooms.length < _.size(matrix)) {
      for(var prop in matrix) {
        matrix[prop].push(100000);
      }
      rooms.push("Unallocated this round");
    }
    console.log(matrix);

    /*matrix = {
      'fstankovsk' : [20, 25, 22, 28],
      'slal' : [15, 18, 23, 17],
      'dcucleschi' : [19, 17, 21, 24],
      'abarbarosi' : [25, 23, 24, 24]
    };

    rooms = ["First", "Second", "Third", "Fourth"];*/
    
    return HungarianOne(matrix, rooms, function(data) {
      if(save) {
        var users = [];
        for(var prop in data) {

          if(/^(\-|\+)?([0-9]+|Infinity)$/.test(prop)) 
            continue;
          users.push(prop);
        }
        //console.log(users);
        //console.log(data);
       
       var newCallback = function(data, nUsers, i) {
          //console.log("You're here. Welcome");
          if(!i && i !== 0) {
            //console.log("You're here. Welcome");
            return callback(null);
          }
          //console.log(nUsers);
          if(i >= nUsers.length - 1) {
            console.log("WooHoo");
            return exports.phaseResult(phase, callback);
          } else {
            //console.log("Blink");
            return saveUser(data, nUsers, i + 1, newCallback);
          }
       };

       var saveUser = function(data, nUsers, i, callB) {
          //console.log(i);
          if(i >= nUsers.length) {
            return callB(data, nUsers, []);
          }
          User.findOne({username: nUsers[i]}).exec(function(err, item) {
            if(err || !item) {
              //console.log("Error, Error");
              if(nUsers[i].lastIndexOf("BLANK", 0) === 0) {
                return callB(data, nUsers, i);
              }

              return callB(data, nUsers, null);
            }

            console.log(data);
            //console.log(item.username);
            //console.log(data[item.username]);
            Room.findOne({name: data[item.username]}).exec(function(err, room) {
              if(err) {
                return callB(data, nUsers, null);
              }

              console.log(room);

              if(!room) { // Unallocated this round
                item.phaseId = null;
                item.save();

                item.roommates.forEach(function(tmp) {
                  var usernames = _.pluck(item.roommates, 'username');
                  User.update({username: {$in:usernames}}, {phaseId: null}).exec();
                });
              } else {
                item.nextRoom = room.rooms[0];
                item.save(function() {
                  //console.log(i);
                  var counter = 1;
                  item.roommates.forEach(function(tmp) {
                    User.findOne({username: tmp.username}).exec(function(err, use) {
                      use.nextRoom = room.rooms[counter];
                      ++counter;
                      use.save();
                    });
                  });
                });
              }

              return callB(data, nUsers, i);
            });
          });
        };

        return saveUser(data, users, 0, newCallback);
      } else {
        return callback(data);
      }
    });
  });
}

var HungarianOne = function(matrix, rooms, callback) {
  for(var user in matrix) {
    var min = _.min(matrix[user]);
    for(var i = 0; i < matrix[user].length; ++i) {
      matrix[user][i] -= min;
    }
  }

  return HungarianTwo(matrix, rooms, callback);
}

var HungarianTwo = function(matrix, rooms, callback) {

  for(var i = 0; i < _.size(matrix); ++i) {
    var min = 100000;
    for(var prop in matrix) {
      min = Math.min(min, matrix[prop][i]);
    }

    for(var prop in matrix) {
      matrix[prop][i] -= min;
    }
  }

  return HungarianAssign(matrix, rooms, callback);
}

var HungarianAssign = function(matrix, rooms, callback) {
  //console.log(matrix);
  var assigned = {};
  var lastSize = 0;
  var matrixSize = _.size(matrix);
  //console.log(matrixSize);
  var broken = false;

  while(lastSize < 2 * matrixSize) {
    console.log(assigned);
    for(var user in matrix) {
      if(assigned[user])
        continue;

      var count = 0;
      var index = -1;

      for(var i = 0; i < matrixSize; ++i) {
        if(matrix[user][i] === 0 && !assigned.hasOwnProperty(i)) {
          console.log("Found zero at " + user + " " + i);
          ++count;
          index = i;
        }      
      }

      if(count === 1 && index !== -1) {
        assigned[index] = user;
        assigned[user] = rooms[index];
      }
    }

    for(var i = 0; i < matrixSize; ++i) {
      if(assigned.hasOwnProperty(i))
        continue;

      var count = 0;
      var username = "";

      for(var user in matrix) {
        if(matrix[user][i] === 0 && !assigned.hasOwnProperty(user)) {
          ++count;
          username = user;
        }      
      }

      if(count === 1 && username !== "") {
        assigned[username] = rooms[i];
        assigned[i] = username;
      }
    }

    if(_.size(assigned) === lastSize) {
      var unassigned = null;
      for(var user in matrix) {// Check if all our users are allocated. If so, we're done. If not, we can't continue so we return an empty array.
        /*if(user.lastIndexOf("BLANK", 0) !== 0) {
          
          continue;
        }*/
        console.log("I'm in your loop");
        console.log(user);
        if(!assigned.hasOwnProperty(user)) {
          
          var zeroes = [];
          for(var i = 0; i < matrixSize; ++i) {
            if(matrix[user][i] === 0 && !assigned.hasOwnProperty(i))
              zeroes.push(i);
          }
          console.log(zeroes);
          if(zeroes.length > 1) {
            var rand = Math.round(Math.random() * (zeroes.length - 1));
            console.log(rand);
            assigned[user] = rooms[zeroes[rand]];
            assigned[zeroes[rand]] = user;
            unassigned = user;
            break;
          }
        }
      }
      if(unassigned) {
        lastSize = _.size(assigned);
        continue;
      } else {
        broken = true;
        break;
      }
    }

    lastSize = _.size(assigned);
  }

  console.log(assigned);

  if(!broken) {
    return callback(assigned);
  }

  var markedRows = {};
  var markedColumns = {};

  for(var user in matrix) {
    if(!assigned.hasOwnProperty(user)) {
      markedRows[user] = true;
    }
  }

  var lastRows = _.size(markedRows);
  var lastCols = _.size(markedColumns);

  while(true) {
    for(var user in markedRows) {
      for(var i = 0; i < matrixSize; ++i) {
        if(matrix[user][i] === 0) {
          markedColumns[i] = true;
        }
      }
    }

    for(var col in markedColumns) {
      if(!assigned.hasOwnProperty(col))
        continue;
      markedRows[assigned[col]] = true;
    }

    if(lastRows === _.size(markedRows) && lastCols === _.size(markedColumns)) { // No assignment was made
      break;
    }

    lastRows = _.size(markedRows);
    lastCols = _.size(markedColumns);
  }

  // Lines go through UNMARKED rows and MARKED columns

  var minimum = 100000;

  for(var user in matrix) {
    for(var i = 0; i < matrixSize; ++i) { // Minimum from MARKED rows and UNMARKED columns
      if(markedRows.hasOwnProperty(user) && !markedColumns.hasOwnProperty(i)) {
        minimum = Math.min(minimum, matrix[user][i]);
      }
    }
  }

  for(var user in matrix) {
    for(var i = 0; i < matrixSize; ++i) { // Add to crossroads of lines, subtract from open points
      if(markedRows.hasOwnProperty(user) && !markedColumns.hasOwnProperty(i)) {
        matrix[user][i] -= minimum;
      } else if(!markedRows.hasOwnProperty(user) && markedColumns.hasOwnProperty(i)) {
        matrix[user][i] += minimum;
      }
    }
  }

  return HungarianAssign(matrix, rooms, callback);
}

var calc = function(rooms, user, cap) {
  var res = [];
  for(var i = 0; i < rooms.length; i++) {
    if(!user || !user.rooms) {
      return [];
    }

    var ind = user.rooms.indexOf(rooms[i]);
    res.push(ind < 0 ? 100000 : (20 - Math.min(user.points.totalPoints, cap)) * (ind + 1));
  }

  return res;
}

var shuffle = function (o){ //v1.0
    for(var j, x, i = o.length; i; j = Math.floor(Math.random() * i), x = o[--i], o[i] = o[j], o[j] = x);
    return o;
};

var calculateColleges = function(phase, save, callback) {
  User.find({$where: "this.college_preference.length > 0" }).exec(function(err, u) {
      if(err || !u) {
        return res.json(500, err);
      }

      var users = shuffle(u);

      var c3 = [];
      var krupp = [];
      var nordmetall = [];
      var mercator = [];

      for(var i = 0; i < users.length; i++) {
        var tmp = users[i];
        switch(users[i].college_preference[0]) {
          case 'C3':
            c3.push(tmp);
            break;
          case 'Nordmetall':
            nordmetall.push(tmp);
            break;
          case 'Mercator':
            mercator.push(tmp);
            break;
          case 'Krupp':
            krupp.push(tmp);
            break;
        }
      }

      var percentages = [];

      percentages.push({
        people: c3, 
        college: 'C3', 
        fill: collegeFill(c3.length, 'C3')
      }); 

      percentages.push({
        people: mercator, 
        college: 'Mercator', 
        fill: collegeFill(mercator.length, 'Mercator')
      }); 

      percentages.push({
        people: krupp, 
        college: 'Krupp', 
        fill: collegeFill(krupp.length, 'Krupp')
      }); 

      percentages.push({
        people: nordmetall, 
        college: 'Nordmetall', 
        fill: collegeFill(nordmetall.length, 'Nordmetall')
      }); 

      percentages.sort(function(a, b) {
        return a.fill - b.fill;
      });

      //console.log(percentages);
      var counter = 0;

      while(percentages[0].fill < config.collegeFillMinimum) {
        var second_choice = [];
        for(var i = 0; i < percentages[3].people; ++i) {
          if(percentages[3].college_preference[1] === percentages[0].name) {
            second_choice.push(i);
          }
        }

        if(second_choice.length === 0) {
          for(var i = 0; i < percentages[3].people; ++i) {
            if(percentages[3].college_preference[2] === percentages[0].name) {
              second_choice.push(i);
            }
          }
        }

        var ind = Math.random() * (second_choice.length - 1);
        var tmp = percentages[3].people[second_choice[ind]];

        percentages[3].people.splice(ind, 1);
        percentages[0].push(tmp);

        percentages[3].fill = collegeFill(percentages[3].people.length, percentages[3].college);
        percentages[0].fill = collegeFill(percentages[0].people.length, percentages[0].college);

        percentages.sort(function(a, b) {
          return a.fill - b.fill;
        });

        counter++;
        if(1000 == counter) {
          break;
        }
      }
      if(save) {
        //console.log("SAAVE");
        for(var i = 0; i < percentages.length; i++) {
          for(var j = 0; j < percentages[i].people.length; j++) {
              percentages[i].people[j].nextCollege = percentages[i].college;
              percentages[i].people[j].points.collegeSpiritPoints = config.collegeSpiritPoints * (percentages[i].people[j].nextCollege === percentages[i].people[j].college);
              percentages[i].people[j].save();
          }
        }

        return exports.phaseResult(phase, callback);
      } else {
        return callback();
      }
  });
}

var collegeFill = function(number, name) {
  switch(name) {
    case 'C3':
      return 100.0 * number /config.collegeCapacity.c3;
      break;
    case 'Mercator':
      return 100.0 * number /config.collegeCapacity.mercator;
      break;
    case 'Nordmetall':
      return 100.0 * number /config.collegeCapacity.nordmetall;
      break;
    case 'Krupp':
      return 100.0 * number /config.collegeCapacity.krupp;
      break;
  }
}

/*var sendEmails = function() {
	var email   = require("./path/to/emailjs/email");
	var server  = email.server.connect({
	   user:    "username", 
	   password:"password", 
	   host:    "smtp-mail.outlook.com", 
	   ssl: true
	});

	var message = {
	   text:    "i hope this works", 
	   from:    "you <fstankovsk@jacobs-university.de>", 
	   to:      "someone <someone@your-email.com>, another <another@your-email.com>",
//	   cc:      "else <else@your-email.com>",
	   subject: "testing emailjs",
	   attachment: 
	   [
	      {data:"<html>i <i>hope</i> this works!</html>", alternative:true},
	      // {path:"path/to/file.zip", type:"application/zip", name:"renamed.zip"}
	   ]
	};
}*/

setInterval(exports.updatePhases, 1000 * 7);
