var TimeUnit = require("../TimeUnit");
var zurvan = require("../zurvan");

var assert = require("assert");

describe('zurvan', function() {
  describe('under special configuration', function() { 
	it('runs at arbitrary time since process startup', function(done) {
	  zurvan.interceptTimers({timeSinceStartup: 4}).then(function() {
	    assert.equal(4, process.uptime());
		assert.deepEqual([4, 0], process.hrtime());
		return zurvan.releaseTimers();
	  }).then(function() {
	    return zurvan.interceptTimers({timeSinceStartup: [100, 132587951]});
	  }).then(function() {
	    assert(Math.abs(100.132587951 - process.uptime()) < 1e-12);
		assert.deepEqual([100, 132587951], process.hrtime());
		return zurvan.releaseTimers();
	  }).then(function() {
	    return zurvan.interceptTimers({timeSinceStartup: TimeUnit.microseconds(12e8 + 100)});
	  }).then(function() {
	    assert(Math.abs(1200.0001 - process.uptime()) < 1e-12);
		assert.deepEqual([1200, 100000], process.hrtime());
		return zurvan.releaseTimers();
	  }).then(function() {
	    return zurvan.interceptTimers({timeSinceStartup: [0, 1e10]});
	  }).then(function() {
	    assert.equal(10, process.uptime());
		assert.deepEqual([10, 0], process.hrtime());
		return zurvan.releaseTimers();
	  }).then(done, done);
	});
	
	it('runs at any required system time', function(done) {
	  zurvan.interceptTimers({systemTime: Date.UTC(2015, 0, 5)}).then(function() {
	    var nowDate = new Date();
		assert.equal(nowDate.toISOString(), "2015-01-05T00:00:00.000Z");
		assert.equal(0, process.uptime());
		return zurvan.releaseTimers();
	  }).then(function() {
	    return zurvan.interceptTimers({systemTime: new Date(Date.UTC(2010, 5, 6))});
	  }).then(function() {
  	    var nowDate = new Date();
	    assert.equal(nowDate.toISOString(), "2010-06-06T00:00:00.000Z");
		assert.equal(0, process.uptime());
		return zurvan.releaseTimers();
	  }).then(function() {
	    return zurvan.interceptTimers({systemTime: new Date(Date.UTC(1999, 9, 8, 15)).toString(),
		  timeSinceStartup: TimeUnit.seconds(45)});
	  }).then(function() {
	    var nowDate = new Date();
        assert(nowDate.toISOString(), "1999-10-08T15:00:00.000Z");
		assert.equal(45, process.uptime());
		return zurvan.releaseTimers();
	  }).then(done, done);
	});
  });
});