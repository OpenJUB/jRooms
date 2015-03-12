'use strict';

angular.module('jRoomsApp', [
  'ipCookie',
  'ngResource',
  'ngSanitize',
  'ui.router',
  'ui.bootstrap'
])
  .config(function ($stateProvider, $urlRouterProvider, $locationProvider, $httpProvider, $compileProvider) {
    $urlRouterProvider.otherwise('/');

    $locationProvider.html5Mode(true);
    $httpProvider.defaults.withCredentials = true;
    $compileProvider.aHrefSanitizationWhitelist(/^s*(https?|ftp|blob|mailto|chrome-extension|data):/);
  })

  .run(function($rootScope, $state, $location, State) {
    // First get the actual user's status
    State.updateUser(function(loggedIn, user) {
      $rootScope.$on('$stateChangeStart', function (event, toState, toParams, fromState) {
        // Check for login
        if (toState.data !== undefined
          && toState.data.needsLogin
          && !State.loggedIn()) {
          $location.path('/');
        }

        // Check for admin
        if (toState.data !== undefined
          && toState.data.needsAdmin
          && !State.isAdmin()) {
          $location.path('/');
        }
      });
    });
  });