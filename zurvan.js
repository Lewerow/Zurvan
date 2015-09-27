var ImmediateInterceptor = require("./detail/ImmediateInterceptor");
var TimerInterceptor = require("./detail/TimerInterceptor");
var ProcessTimerInterceptor = require("./detail/ProcessTimerInterceptor");
var DateInterceptor = require("./detail/DateInterceptor");
var TypeChecks = require("./detail/TypeChecks");
var APIHelper = require("./detail/APIHelper");
var TimeUnit = require("./TimeUnit");

var assert = require("assert");

function mergeConfigurations(localConfiguration, globalConfiguration) {
  var finalConfiguration = {};
  
  Object.keys(globalConfiguration).forEach(function(key) {
    finalConfiguration[key] = globalConfiguration[key];
  });
  
  if(localConfiguration !== undefined) {
    Object.keys(localConfiguration).forEach(function(key) {
      finalConfiguration[key] = localConfiguration[key];
    });
  }  
  return finalConfiguration;
};

function Zurvan(config) {
  this.timeForwardingOngoing = false;
  this.isStopped = false;
  this.globalConfig = config;
   
  this.timerInterceptor = new TimerInterceptor(this);
  this.immediateInterceptor = new ImmediateInterceptor();	
  this.dateInterceptor = new DateInterceptor(this);
  this.processTimerInterceptor = new ProcessTimerInterceptor(this);
}

Zurvan.prototype.interceptTimers = function(config) {
  var that = this;
  return new Promise(function(resolve, reject) {
    if(that.isStopped) {
	  return reject(Error("Cannot stop time that is already stopped"));
	}
	return resolve();
  }).then(function() {
    that.config = mergeConfigurations(config, that.globalConfig);
    that.isStopped = true;
	that.setupTime(that.config.timeSinceStartup, that.config.systemTime);
  
    that.timerInterceptor.intercept(that.config);
    that.immediateInterceptor.intercept();	
    that.dateInterceptor.intercept();
	
	if(!that.config.ignoreProcessTimers) {
      that.processTimerInterceptor.intercept();
	}
	
	return that.waitForEmptyQueue();
  });
};

Zurvan.prototype.releaseTimers = function() {
  var that = this;
  return new Promise(function(resolve, reject) {
    if(that.isStopped && !that.isExpiringEvents()) {
	  return resolve();
	}
	
	return reject(Error("Cannot start time during event expiration"));
  }).then(function() {
    that.isStopped = false;
    that.immediateInterceptor.release();
		
	if(!that.config.ignoreProcessTimers) {
      that.processTimerInterceptor.release();
	}
	
    that.timerInterceptor.release();
	that.dateInterceptor.release();
	return that.waitForEmptyQueue();
  });
};

Zurvan.prototype.setupTime = function(timeSinceStartup, systemTime) {
  if(TypeChecks.isNumber(timeSinceStartup)) {
    this.currentTime = TimeUnit.seconds(timeSinceStartup);
  }
  else if (timeSinceStartup && timeSinceStartup.length === 2){
    this.currentTime = TimeUnit.seconds(timeSinceStartup[0]).extended(TimeUnit.nanoseconds(timeSinceStartup[1]));
  }
  else {
    this.currentTime = TimeUnit.seconds(0);
	if(timeSinceStartup) {
	  this.currentTime.add(timeSinceStartup);
	}
  }
  
  this.targetTime = this.currentTime.copy();
  this.setSystemTime(systemTime || 0);
};

Zurvan.prototype.stopExpiringEvents = function() {
  this.timeForwardingOngoing = false;
};

Zurvan.prototype.startExpiringEvents = function() {
  this.timeForwardingOngoing = true;  
};

Zurvan.prototype.isExpiringEvents = function() {
  return this.timeForwardingOngoing;
};

Zurvan.prototype.advanceTime = function(timeToForward) {
  var advanceStep = (TypeChecks.isNumber(timeToForward)) ? TimeUnit.milliseconds(timeToForward) : timeToForward;  
  var that = this;
  return new Promise(function(resolve, reject) {
    if(advanceStep.isShorterThan(TimeUnit.milliseconds(0))) {
      reject("Even Zurvan cannot move back in time!");
    }

    if(that.isExpiringEvents()) {
      return reject(Error("Cannot forward time shortened previous forwarding ends. Currently at: " + 
	    that.currentTime.toMilliseconds() + " ms, target: " + that.targetTime.toMilliseconds() + " ms"));
    }

    that.targetTime = that.currentTime.extended(advanceStep);
  
    that.startExpiringEvents();
    setImmediate(function() {
	  advanceTimeHelper();
    });
  
    function advanceTimeHelper() {
      if(that.immediateInterceptor.areAwaiting()) {
        setImmediate(function() {
          advanceTimeHelper();
        });
        return;
      }
	
	  var closestTimer = that.timerInterceptor.nextTimer();
      if(closestTimer && !closestTimer.dueTime.isLongerThan(that.targetTime)) {
	    that.timerInterceptor.clearTimer(closestTimer.uid);
        that.currentTime.setTo(closestTimer.dueTime);
        setImmediate(function() {
  	      closestTimer.expire();
          advanceTimeHelper();
        });
      }
	  else {
        that.currentTime.setTo(that.targetTime);
        that.stopExpiringEvents();
		resolve();
      }
    }
  });  
};

Zurvan.prototype.setSystemTime = function(value) {
  if(TypeChecks.isString(value)) {
    value = new Date(value);
  }
  else if(TypeChecks.isNumber(value)) {
    value = new Date(value);
  }
  
  this.systemTimeOffset = TimeUnit.milliseconds(value.getTime() - this.currentTime.toMilliseconds());
};

Zurvan.prototype.expireAllTimeouts = function() {
  var lastTimeout = this.timerInterceptor.lastTimeout();
  if(lastTimeout) {
    var that = this;
	return this.advanceTime(lastTimeout.dueTime.shortened(that.currentTime)).then(function() {
	  return that.expireAllTimeouts();
	});
  }

  return Promise.resolve();
};

Zurvan.prototype.forwardTimeToNextTimer = function() {
  var closestTimer = this.timerInterceptor.nextTimer();
  if(closestTimer) {
    return this.advanceTime(closestTimer.dueTime.shortened(this.currentTime));
  }
  
  return Promise.resolve();
};

Zurvan.prototype.blockSystem = function(timeToBlock) {
  var blockStep = (TypeChecks.isNumber(timeToBlock)) ? TimeUnit.milliseconds(timeToBlock) : timeToBlock;  

  var that = this;  
  return new Promise(function(resolve, reject) {
    if(blockStep.isShorterThan(TimeUnit.milliseconds(0))) {
      return reject(Error("Even Zurvan cannot move back in time!"));
    }
	
	if(!that.isExpiringEvents()) {
	  assert(that.targetTime.isEqualTo(that.currentTime));
	  that.targetTime.add(blockStep);
	}
	else if(that.targetTime.isShorterThan(that.currentTime.extended(blockStep))) {
	  return reject(Error("Cannot block system during advancing for longer than requested advance time"));
	}
	
    that.currentTime.add(blockStep);
		
    var closestTimer = that.timerInterceptor.nextTimer();
    while(closestTimer && !closestTimer.dueTime.isLongerThan(that.currentTime)) {
      that.timerInterceptor.clearTimer(closestTimer.uid);
  	  setImmediate(closestTimer.expire.bind(closestTimer));
      closestTimer = that.timerInterceptor.nextTimer();
    }
	
  	resolve();
  }).then(function() {
    if(!that.isExpiringEvents()) {
      return that.waitForEmptyQueue();
	}
  });
};

Zurvan.prototype.waitForEmptyQueue = function() {
  return this.advanceTime(0);
};

var defaultZurvanConfiguration = {

};

function createZurvanAPI(newDefaultConfig) {
  var apiFunctions = ["releaseTimers", "interceptTimers", "advanceTime", 
    "blockSystem", "setSystemTime", "expireAllTimeouts", 
	"forwardTimeToNextTimer", "waitForEmptyQueue"];
  
  var configuration = mergeConfigurations(newDefaultConfig, defaultZurvanConfiguration);
  var api = APIHelper.createAPI(new Zurvan(configuration), apiFunctions);
  
  api.withDefaultConfiguration = function(config) {
    return createZurvanAPI(config);
  }
  
  return api; 
}

module.exports = createZurvanAPI();