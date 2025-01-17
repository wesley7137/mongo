/**
 * indexed_insert_ttl.js
 *
 * Creates a TTL index with a short expireAfterSeconds value (5 seconds). Each
 * thread does an insert on each iteration. The first insert done by each
 * thread is marked with an extra field. At the end, we assert that the first
 * doc inserted by each thread is no longer in the collection.
 * @tags: [uses_ttl]
 */

import {assertAlways, assertWhenOwnColl} from "jstests/concurrency/fsm_libs/assert.js";
import {BalancerHelper} from "jstests/concurrency/fsm_workload_helpers/balancer.js";

export const $config = (function() {
    var states = {
        init: function init(db, collName) {
            var res = db[collName].insert({indexed_insert_ttl: new ISODate(), first: true});
            assertAlways.commandWorked(res);
            assertWhenOwnColl.eq(1, res.nInserted, tojson(res));
        },

        insert: function insert(db, collName) {
            var res = db[collName].insert({indexed_insert_ttl: new ISODate()});
            assertAlways.commandWorked(res);
            assertWhenOwnColl.eq(1, res.nInserted, tojson(res));
        }
    };

    var transitions = {init: {insert: 1}, insert: {insert: 1}};

    function setup(db, collName, cluster) {
        var res = db[collName].createIndex({indexed_insert_ttl: 1},
                                           {expireAfterSeconds: this.ttlSeconds});
        assertAlways.commandWorked(res);
    }

    function teardown(db, collName, cluster) {
        if (TestData.runningWithBalancer) {
            // Disallow balancing 'ns' so that it does not cause the TTLMonitor to fail rounds due
            // to ongoing migration critical sections. TTLMonitor will retry on the next round, but
            // it might not converge in time for the following assertion to pass.
            BalancerHelper.disableBalancerForCollection(db, db[collName].getFullName());
            BalancerHelper.joinBalancerRound(db);
        }

        // By default, the TTL monitor thread runs every 60 seconds.
        var defaultTTLSecs = 60;

        // We need to wait for the initial documents to expire. It's possible for this code to run
        // right after the TTL thread has started to sleep, which requires us to wait at least ~60
        // seconds for it to wake up and delete the expired documents. We wait at least another
        // minute just to avoid race-prone tests on overloaded test hosts.
        var timeoutMS =
            (TestData.inEvergreen ? 10 : 2) * Math.max(defaultTTLSecs, this.ttlSeconds) * 1000;

        assertWhenOwnColl.soon(function checkTTLCount() {
            // All initial documents should be removed by the end of the workload.
            var count = db[collName].find({first: true}).itcount();
            return count === 0;
        }, 'Expected oldest documents with TTL fields to be removed', timeoutMS);
    }

    return {
        threadCount: 20,
        iterations: 200,
        states: states,
        transitions: transitions,
        setup: setup,
        data: {ttlSeconds: 5},
        teardown: teardown
    };
})();
