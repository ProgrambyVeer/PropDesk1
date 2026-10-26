// Object.hasOwn is Safari 15.4+; bundled dependencies (charts, state helpers) call it. Needed for iOS 13-15.3.
const ObjectCtor = Object as ObjectConstructor & { hasOwn?: (target: object, key: PropertyKey) => boolean };
if (typeof ObjectCtor.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: (target: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(Object(target), key),
    configurable: true,
    writable: true,
  });
}
