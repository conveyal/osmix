/**
 * Same-process conflation capabilities for trusted merge orchestrators.
 *
 * This module is deliberately absent from the package entry point. Its callers
 * own both untouched inputs and the canonical discovery object for the lifetime
 * of one merge. General callers must use the defensive public generators, which
 * rediscover candidates before changing topology.
 *
 * @internal
 */
export {
  discoverConflationCandidatesForTrustedMerge,
  generateConflationApplicationArtifactsFromTrustedDiscovery,
  generateConflationArtifactsFromTrustedDiscovery,
} from "../conflation.ts";
