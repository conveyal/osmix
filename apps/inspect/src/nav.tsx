import { AppLinks, BrowserCheck, MapNavControls, Status } from "@osmix/app-components";
import { Nav } from "@osmix/ui";

export function InspectNav() {
  return (
    <Nav
      links={
        <>
          <AppLinks current="inspect" />
          <BrowserCheck />
        </>
      }
      status={<Status />}
      controls={<MapNavControls />}
    />
  );
}
