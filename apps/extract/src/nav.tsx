import { AppLinks, BrowserCheck, MapNavControls, Status } from "@osmix/app-components";
import { Nav } from "@osmix/ui";

export function ExtractNav() {
  return (
    <Nav
      links={
        <>
          <AppLinks current="extract" />
          <BrowserCheck />
        </>
      }
      status={<Status />}
      controls={<MapNavControls />}
    />
  );
}
