import { atomWithStorage } from "jotai/utils"

export const sidebarIsOpenAtom = atomWithStorage(
	"@osmix:layout:sidebarIsOpen",
	true,
)
