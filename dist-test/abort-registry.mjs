// src/main/abort-registry.ts
function abortAll(controllers) {
  for (const controller of controllers.values()) {
    controller.abort();
  }
}
export {
  abortAll
};
