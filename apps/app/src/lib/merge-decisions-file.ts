import type { MergePlanOverview, PlanDecision } from "osmix";

const FORMAT = "osmix-merge-decisions";
const VERSION = 1;

/** A review's decisions as a file: the decisions, the inputs and options they were made on. */
export interface MergeDecisionsFile {
  format: typeof FORMAT;
  version: typeof VERSION;
  inputs: {
    base: { contentHash: string; name: string };
    patch: { contentHash: string; name: string };
  };
  options: MergePlanOverview["options"];
  decisions: PlanDecision[];
}

/** The decisions file for a plan's current decisions. */
export function mergeDecisionsFile(
  overview: Pick<MergePlanOverview, "inputs" | "options" | "decisions">,
  names: { base: string; patch: string },
): MergeDecisionsFile {
  const { decisions: _decisions, ...options } = overview.options;
  return {
    format: FORMAT,
    version: VERSION,
    inputs: {
      base: { contentHash: overview.inputs.base.contentHash, name: names.base },
      patch: { contentHash: overview.inputs.patch.contentHash, name: names.patch },
    },
    options,
    decisions: overview.decisions.map(({ proposalId, action }) => ({ proposalId, action })),
  };
}

/** Read a decisions file, refusing anything that is not one. */
export function parseMergeDecisionsFile(text: string): MergeDecisionsFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error("This file is not JSON, so it holds no merge choices.");
  }
  const file = value as Partial<MergeDecisionsFile> | null;
  if (file?.format !== FORMAT) throw Error("This file is not an Osmix merge choices file.");
  if (file.version !== VERSION) {
    throw Error(`This merge choices file is version ${String(file.version)}; expected ${VERSION}.`);
  }
  const decisions = file.decisions;
  if (
    !Array.isArray(decisions) ||
    !decisions.every(
      (decision) =>
        typeof decision?.proposalId === "string" &&
        (decision.action === "accept" || decision.action === "reject"),
    )
  ) {
    throw Error("This merge choices file has malformed choices.");
  }
  if (
    typeof file.inputs?.base?.contentHash !== "string" ||
    typeof file.inputs?.patch?.contentHash !== "string"
  ) {
    throw Error("This merge choices file does not say which files it was made on.");
  }
  return file as MergeDecisionsFile;
}

/** Whether a decisions file was made on these inputs; choices still apply where they match. */
export function sameInputs(file: MergeDecisionsFile, overview: Pick<MergePlanOverview, "inputs">) {
  return (
    file.inputs.base.contentHash === overview.inputs.base.contentHash &&
    file.inputs.patch.contentHash === overview.inputs.patch.contentHash
  );
}
