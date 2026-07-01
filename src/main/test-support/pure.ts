/**
 * Pure-logic re-exports for unit tests. Avoid pulling in the side-effectful
 * workspace/electron imports from tools.ts. The runner bundles this file
 * with esbuild and asserts on the exports.
 */
export {
  cleanFileContent,
  findNextAction,
  chatSystemPrompt,
  codeSystemPrompt,
  TOOLS,
  type ToolSpec,
  type ParsedAction
} from '../tools'
