import { SearchIcon } from "lucide-react";
import type { OsmEntity } from "osmix";
import { useActionState } from "react";

import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./ui/input-group";

export default function EntityLookup({
  setSelectedEntity,
}: {
  setSelectedEntity: (id: string) => OsmEntity | null;
}) {
  const [, formAction] = useActionState<OsmEntity | null, FormData>((_state, formData) => {
    const fde = formData.get("entityId");
    if (!fde) return null;
    return setSelectedEntity(typeof fde === "string" ? fde : fde.name);
  }, null);
  return (
    <form action={formAction}>
      <InputGroup>
        <InputGroupInput
          type="text"
          name="entityId"
          placeholder={`Find entity by ID (prefix "node/", "way/", or "relation/")`}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" size="icon-sm" variant="ghost">
            <SearchIcon />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
