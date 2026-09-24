import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@osmix/ui";
import { SearchIcon } from "lucide-react";
import type { OsmEntity } from "osmix";
import { useActionState } from "react";

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
    <form action={formAction} className="px-inset py-2">
      <InputGroup>
        <InputGroupInput
          type="text"
          name="entityId"
          aria-label="Entity ID"
          placeholder="Find by ID: node/…, way/…, or relation/…"
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton type="submit" size="icon-xs" variant="ghost" aria-label="Find entity">
            <SearchIcon aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
