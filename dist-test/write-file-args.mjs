// src/main/write-file-args.ts
function getWriteFileContent(args) {
  return typeof args.content === "string" ? args.content : null;
}
export {
  getWriteFileContent
};
