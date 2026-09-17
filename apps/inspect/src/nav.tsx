import { BrowserCheck, MapNavControls, Status } from "@osmix/app-components";
import { Nav } from "@osmix/ui";

export function InspectNav() {
  return (
    <Nav
      links={
        <>
          <span className="font-normal text-info">Inspect</span>
          <BrowserCheck />
        </>
      }
      status={<Status />}
      controls={<MapNavControls />}
    />
  );
}
