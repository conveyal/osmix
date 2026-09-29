import type { UseOsmFileReturn } from "@osmix/app-core";
import { Menu, MenuContent, MenuItem, MenuTrigger, useAction } from "@osmix/ui";
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react";

import { OPEN_IN_LABELS, type OpenInTarget, useOpenIn } from "../lib/open-in";

/**
 * "Open in" for a loaded dataset: send it to another page (`targets`) without reloading it. The
 * menu is disabled while any task runs.
 */
export function OpenInMenu({
  osmFile,
  targets,
}: {
  osmFile: UseOsmFileReturn;
  targets: readonly OpenInTarget[];
}) {
  const openIn = useOpenIn();
  const { isPending, runAction } = useAction();
  if (!osmFile.osmInfo) return null;
  return (
    <Menu>
      <MenuTrigger variant="outline" disabled={isPending} className="w-full">
        <ExternalLinkIcon aria-hidden="true" />
        Open in
        <ChevronDownIcon aria-hidden="true" className="ml-auto" />
      </MenuTrigger>
      <MenuContent>
        {targets.map((target) => (
          <MenuItem
            key={target}
            onClick={() => runAction(() => openIn(target, osmFile.snapshot()))}
          >
            {OPEN_IN_LABELS[target]}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}
