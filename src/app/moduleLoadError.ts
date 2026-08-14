const MODULE_LOAD_ERROR_PATTERNS = [
  /dynamically imported module/i,
  /importing a module script failed/i,
  /failed to fetch module script/i,
  /chunkloaderror/i,
  /loading chunk .* failed/i,
];

export function isModuleLoadError(error: Error): boolean {
  return error.name === "ChunkLoadError"
    || MODULE_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}
