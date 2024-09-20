export default class EventEmitter {
  callbacks: { [key in string]: (() => any)[] };
  constructor() {
    this.callbacks = {};
  }

  on(name: string, callback: (...args: any[]) => any) {
    if (!(this.callbacks[name] instanceof Array))
      this.callbacks[name] = [];

    this.callbacks[name].push(callback);

    return this;
  }

  off(name: string) {
    if (this.callbacks[name] instanceof Array) {
      delete this.callbacks[name];
    }
    return this;
  }

  trigger(name: string, _args?: any[]) {
    const triggerContext = this;
    let finalResult: any = null;
    let result = null;

    const args: any = !(_args instanceof Array) ? [] : _args;

    if (this.callbacks[name] instanceof Array) {
      this.callbacks[name].forEach(function (callback) {
        result = callback.apply(triggerContext, args);

        if (typeof finalResult === "undefined") {
          finalResult = result;
        }
      });
    }

    return finalResult;
  }
}
