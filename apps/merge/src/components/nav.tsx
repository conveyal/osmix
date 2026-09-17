import { AppLinks, BrowserCheck, MapNavControls, Status } from "@osmix/app-components";
import { Nav } from "@osmix/ui";

export default function MergeNav() {
  return (
    <Nav
      links={
        <>
          <AppLinks current="merge" />
          <BrowserCheck />
        </>
      }
      status={<Status />}
      controls={<MapNavControls />}
    />
  );
}
