(function () {
  "use strict";

  var TRANSITIONS = {
    STOPPED: ["STARTING"],
    STARTING: ["READY", "ERROR", "STOPPED"],
    READY: ["MONITORING", "PROCESSING", "RECOVERING", "ERROR", "STOPPED"],
    MONITORING: ["PROCESSING", "RECOVERING", "ERROR", "STOPPED"],
    PROCESSING: ["MONITORING", "RECOVERING", "ERROR", "STOPPED"],
    RECOVERING: ["READY", "MONITORING", "ERROR", "STOPPED"],
    ERROR: ["STARTING", "STOPPED"]
  };

  function StateMachine(initial, onChange) {
    this.state = initial || "STOPPED";
    this.onChange = onChange || function () {};
  }

  StateMachine.prototype.can = function (next) {
    return (TRANSITIONS[this.state] || []).indexOf(next) >= 0;
  };

  StateMachine.prototype.transition = function (next, meta) {
    if (!this.can(next)) {
      throw new Error("Invalid state transition: " + this.state + " -> " + next);
    }
    var previous = this.state;
    this.state = next;
    this.onChange(next, previous, meta || {});
    return this.state;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { StateMachine: StateMachine, TRANSITIONS: TRANSITIONS };
  } else {
    this.WxBotStateMachine = { StateMachine: StateMachine, TRANSITIONS: TRANSITIONS };
  }
}());
